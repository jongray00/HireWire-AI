/**
 * Unified Agent Lifecycle API — List & Create
 *
 * GET  /api/agents     → list all agents (from SQLite, enriched with Python backend status)
 * POST /api/agents     → create agent (validate → Python → SignalWire → SQLite)
 */

import { requireAuth } from '@/app/api/middleware/auth';
import { getEmployeesByProject, upsertEmployee, employeeRowToJson } from '@/lib/db';
import { getBaseUrl, getSwmlWebhookUrl } from '@/app/api/utils/getBaseUrl';
import { validateAgentConfig, configToBackendPayload } from '@/lib/agentSchema';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET(request) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const employees = getEmployeesByProject(auth.projectId);
  return Response.json({
    success: true,
    agents: employees.map(employeeRowToJson),
    count: employees.length,
  });
}

export async function POST(request) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const config = await request.json();

  // Validate
  const validation = validateAgentConfig(config);
  if (!validation.valid) {
    return Response.json({ error: 'Invalid config', details: validation.errors }, { status: 400 });
  }

  const employeeId = config.id || crypto.randomUUID().slice(0, 8);

  // 1. Create employee in Python backend
  const agentCredentials = getAgentCredentials();
  const backendUrl = agentCredentials?.app_domain || 'http://localhost:8000';
  const backendPayload = configToBackendPayload(config, {
    id: employeeId,
    projectId: auth.projectId,
    spaceName: auth.spaceUrl,
    token: auth.apiToken,
  });

  let pythonEmployee;
  try {
    const res = await fetch(`${backendUrl}/api/create-employee`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backendPayload),
    });
    if (!res.ok) {
      const err = await res.text();
      return Response.json({ error: 'Python backend failed', details: err }, { status: 502 });
    }
    pythonEmployee = await res.json();
  } catch (err) {
    return Response.json({ error: 'Python backend unreachable', details: err.message }, { status: 502 });
  }

  // 2. Create SignalWire SWML resource
  const swmlRoute = `/swml/${employeeId}/`;
  const webhookUrl = getSwmlWebhookUrl(request, swmlRoute);
  const resourceName = `employee-${config.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${employeeId}`;

  const normalizedSpaceUrl = auth.spaceUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const baseUrl = `https://${normalizedSpaceUrl}`;
  const basicAuth = Buffer.from(`${auth.projectId}:${auth.apiToken}`).toString('base64');

  let resource = null;
  let callFabricAddress = null;
  try {
    const resCreate = await fetch(`${baseUrl}/api/fabric/resources`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: resourceName,
        display_name: config.name,
        type: 'swml_webhook',
        swml_webhook: { url: webhookUrl },
      }),
    });
    if (resCreate.ok) {
      resource = await resCreate.json();
      callFabricAddress = `/public/${resourceName}`;
    } else {
      console.warn('[agents/create] SignalWire resource creation failed, agent still usable via direct SWML URL');
    }
  } catch (err) {
    console.warn('[agents/create] SignalWire resource creation error:', err.message);
  }

  // 3. Store in SQLite
  upsertEmployee({
    id: employeeId,
    projectId: auth.projectId,
    name: config.name,
    role: config.role,
    greeting: config.greeting,
    prompt: config.prompt,
    voice: config.voice,
    language: config.language,
    temperature: config.temperature,
    enabledFunctions: config.functions,
    transferNumber: config.transferNumber,
    smsFromNumber: config.smsFromNumber,
    businessHoursStart: config.businessHours?.start,
    businessHoursEnd: config.businessHours?.end,
    businessDays: config.businessHours?.days,
    documents: config.knowledgeDocs,
    sendgridApiKey: config.emailConfig?.sendgridKey,
    emailFromAddress: config.emailConfig?.fromAddress,
    emailFromName: config.emailConfig?.fromName,
    resourceId: resource?.id || null,
    resourceName: resourceName,
    callFabricAddress: callFabricAddress,
    webhookUrl: webhookUrl,
    status: 'active',
  });

  return Response.json({
    success: true,
    agent: {
      id: employeeId,
      ...config,
      resourceId: resource?.id || null,
      resourceName,
      callFabricAddress,
      webhookUrl,
      swmlRoute: pythonEmployee.swml_route,
    },
  }, { status: 201 });
}

function getAgentCredentials() {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), 'agent-credentials.json'), 'utf-8'));
  } catch {
    return null;
  }
}
