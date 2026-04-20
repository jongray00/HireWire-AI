/**
 * Fix Employee Webhook API
 *
 * PATCHes a single employee's SWML webhook resource in SignalWire so its
 * primary_request_url points to the current application domain.
 *
 * The domain is derived from the incoming request itself (via forwarded
 * headers or origin), so if the user can reach this page the domain is
 * provably active — no separate health check is needed.
 *
 * As a side-effect the stored app_domain in agent-credentials.json is
 * updated to stay in sync.
 *
 * POST body: { employeeId, resourceId, credentials: { spaceUrl, projectId, apiToken } }
 * Returns:   { success, webhookUrl, domain, error? }
 */

import { getSwmlWebhookUrl, getBaseUrl } from '@/app/api/utils/getBaseUrl.js';
import { requireAuth } from '@/app/api/middleware/auth';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const CREDENTIALS_PATH = join(process.cwd(), 'agent-credentials.json');

async function syncStoredDomain(domain) {
  try {
    let credentials = {};
    try {
      const data = await readFile(CREDENTIALS_PATH, 'utf8');
      credentials = JSON.parse(data);
    } catch { /* file may not exist yet */ }

    const cleanDomain = domain.replace(/\/+$/, '');
    if (credentials.app_domain === cleanDomain) return; // already current

    credentials.app_domain = cleanDomain;
    credentials.timestamp = new Date().toISOString();
    if (credentials.username && credentials.password) {
      credentials.swml_url = `${cleanDomain}/api/swml`;
    }
    await writeFile(CREDENTIALS_PATH, JSON.stringify(credentials, null, 2));
    console.log(`[FixWebhook] Synced stored domain to: ${cleanDomain}`);
  } catch (err) {
    console.warn('[FixWebhook] Could not sync stored domain:', err.message);
  }
}

export async function POST(request) {
  try {
    const { employeeId, resourceId, credentials } = await request.json();

    if (!employeeId || !resourceId) {
      return Response.json(
        { success: false, error: 'Missing required parameters (employeeId, resourceId)' },
        { status: 400 },
      );
    }

    // Try session-based auth first, fall back to body credentials
    let creds = credentials;
    const auth = await requireAuth(request);
    if (!auth.error) {
      creds = { spaceUrl: auth.spaceUrl, projectId: auth.projectId, apiToken: auth.apiToken };
    } else if (!creds?.spaceUrl || !creds?.projectId || !creds?.apiToken) {
      return Response.json({ success: false, error: 'Missing credentials' }, { status: 401 });
    }

    const { spaceUrl, projectId, apiToken } = creds;

    const normalizedSpaceUrl = spaceUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const baseUrl = `https://${normalizedSpaceUrl}`;
    const basicAuth = Buffer.from(`${projectId}:${apiToken}`).toString('base64');

    // Derive domain from the live request — if the user can see the page, this is reachable
    const liveDomain = getBaseUrl(request);

    // Keep stored domain in sync so future page loads reflect the correct host
    await syncStoredDomain(liveDomain);

    // Build the correct webhook URL using the current domain
    const webhookUrl = getSwmlWebhookUrl(request, `/swml/${employeeId}/`);

    console.log(`[FixWebhook] Updating resource ${resourceId} -> ${webhookUrl}`);

    // PATCH the SWML webhook resource in SignalWire
    const patchResponse = await fetch(
      `${baseUrl}/api/fabric/resources/swml_webhooks/${resourceId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          primary_request_url: webhookUrl,
          primary_request_method: 'GET',
        }),
      },
    );

    if (!patchResponse.ok) {
      const errorText = await patchResponse.text();
      console.error(`[FixWebhook] PATCH failed (${patchResponse.status}):`, errorText);
      return Response.json(
        { success: false, error: `SignalWire API error: ${errorText}` },
        { status: patchResponse.status },
      );
    }

    const resource = await patchResponse.json();
    console.log(`[FixWebhook] Resource ${resourceId} updated successfully`);

    return Response.json({
      success: true,
      webhookUrl,
      domain: liveDomain,
      resourceId: resource.id,
      message: 'Webhook updated successfully',
    });
  } catch (error) {
    console.error('[FixWebhook] Error:', error);
    return Response.json(
      { success: false, error: 'Failed to fix webhook: ' + error.message },
      { status: 500 },
    );
  }
}
