/**
 * Unified Agent Lifecycle API — Single Agent Operations
 *
 * GET    /api/agents/:id  → get agent details
 * PATCH  /api/agents/:id  → update agent
 * DELETE /api/agents/:id  → delete agent
 */

import { requireAuth } from '@/app/api/middleware/auth';
import { getEmployeeById, upsertEmployee, deleteEmployee, employeeRowToJson } from '@/lib/db';
import { validateAgentConfig, configToBackendPayload } from '@/lib/agentSchema';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const { id } = await params;
  const employee = getEmployeeById(id);
  if (!employee || employee.status === 'deleted') {
    return Response.json({ error: 'Agent not found' }, { status: 404 });
  }

  return Response.json({ success: true, agent: employeeRowToJson(employee) });
}

export async function PATCH(request, { params }) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const { id } = await params;
  const existing = getEmployeeById(id);
  if (!existing || existing.status === 'deleted') {
    return Response.json({ error: 'Agent not found' }, { status: 404 });
  }

  const updates = await request.json();

  // Merge with existing config
  const merged = {
    name: updates.name ?? existing.name,
    role: updates.role ?? existing.role,
    greeting: updates.greeting ?? existing.greeting,
    prompt: updates.prompt ?? existing.prompt,
    voice: updates.voice ?? existing.voice,
    language: updates.language ?? existing.language,
    temperature: updates.temperature ?? existing.temperature,
    functions: updates.functions ?? JSON.parse(existing.enabled_functions || '[]'),
    transferNumber: updates.transferNumber ?? existing.transfer_number,
    smsFromNumber: updates.smsFromNumber ?? existing.sms_from_number,
  };

  // Update Python backend
  const agentCredentials = getAgentCredentials();
  const backendUrl = agentCredentials?.app_domain || 'http://localhost:8000';
  const backendPayload = configToBackendPayload(merged, {
    id,
    projectId: auth.projectId,
    spaceName: auth.spaceUrl,
    token: auth.apiToken,
  });

  try {
    const res = await fetch(`${backendUrl}/api/employee/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backendPayload),
    });
    if (!res.ok) {
      console.warn('[agents/update] Python backend update failed');
    }
  } catch (err) {
    console.warn('[agents/update] Python backend unreachable:', err.message);
  }

  // Update SQLite
  upsertEmployee({
    id,
    projectId: auth.projectId,
    name: merged.name,
    role: merged.role,
    greeting: merged.greeting,
    prompt: merged.prompt,
    voice: merged.voice,
    language: merged.language,
    temperature: merged.temperature,
    enabledFunctions: merged.functions,
    transferNumber: merged.transferNumber,
    smsFromNumber: merged.smsFromNumber,
  });

  const updated = getEmployeeById(id);
  return Response.json({ success: true, agent: employeeRowToJson(updated) });
}

export async function DELETE(request, { params }) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const { id } = await params;
  const existing = getEmployeeById(id);
  if (!existing || existing.status === 'deleted') {
    return Response.json({ error: 'Agent not found' }, { status: 404 });
  }

  // Delete from Python backend
  const agentCredentials = getAgentCredentials();
  const backendUrl = agentCredentials?.app_domain || 'http://localhost:8000';
  try {
    await fetch(`${backendUrl}/api/employee/${id}`, { method: 'DELETE' });
  } catch (err) {
    console.warn('[agents/delete] Python backend unreachable:', err.message);
  }

  // Soft-delete in SQLite
  deleteEmployee(id);

  return Response.json({ success: true, message: 'Agent deleted' });
}

function getAgentCredentials() {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), 'agent-credentials.json'), 'utf-8'));
  } catch {
    return null;
  }
}
