/**
 * Bulk Webhook Reconciliation API
 *
 * Fetches all SWML webhook resources from SignalWire and updates any
 * whose primary_request_url domain doesn't match the current app_domain.
 */

import { getSwmlWebhookUrl } from '@/app/api/utils/getBaseUrl.js';
import { requireAuth } from '@/app/api/middleware/auth';

export async function POST(request) {
  try {
    const { credentials } = await request.json();

    // Try session-based auth first, fall back to body credentials
    let creds = credentials;
    const auth = await requireAuth(request);
    if (!auth.error) {
      creds = { spaceUrl: auth.spaceUrl, projectId: auth.projectId, apiToken: auth.apiToken };
    } else if (!creds?.spaceUrl || !creds?.projectId || !creds?.apiToken) {
      return Response.json({ error: 'Missing credentials' }, { status: 401 });
    }

    const { spaceUrl, projectId, apiToken } = creds;

    const normalizedSpaceUrl = spaceUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const baseUrl = `https://${normalizedSpaceUrl}`;
    const basicAuth = Buffer.from(`${projectId}:${apiToken}`).toString('base64');

    // Get the current authenticated base webhook URL (no path suffix)
    const currentWebhookBase = getSwmlWebhookUrl(request);
    // Extract just the domain+auth portion (everything before /api/swml)
    const currentBaseUrl = currentWebhookBase.replace(/\/api\/swml$/, '');

    console.log('[Reconcile] Current webhook base:', currentBaseUrl);

    // Fetch all SWML webhook resources
    const listResponse = await fetch(`${baseUrl}/api/fabric/resources/swml_webhooks`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
      },
    });

    if (!listResponse.ok) {
      const errorText = await listResponse.text();
      console.error('[Reconcile] Failed to list resources:', listResponse.status, errorText);
      return Response.json(
        { error: 'Failed to list SWML webhook resources: ' + errorText },
        { status: listResponse.status }
      );
    }

    const listData = await listResponse.json();
    const allResources = listData.data || [];
    const swmlResources = allResources.filter(r => r.type === 'swml_webhook');

    console.log(`[Reconcile] Found ${swmlResources.length} SWML webhook resource(s)`);

    const updated = [];
    const unchanged = [];
    const errors = [];

    for (const resource of swmlResources) {
      const storedUrl = resource.swml_webhook?.primary_request_url || '';

      // Extract the path suffix from the stored URL (e.g., /api/swml/7ef75cb6/)
      let pathSuffix = '';
      try {
        const parsed = new URL(storedUrl.replace(/^[^:]+:\/\/[^@]+@/, 'https://'));
        pathSuffix = parsed.pathname;
      } catch {
        // If URL can't be parsed, use default
        pathSuffix = '/api/swml';
      }

      // Build the correct URL with current domain
      const correctUrl = getSwmlWebhookUrl(request, pathSuffix.replace(/^\/api/, ''));

      // Compare domains — if they match, skip
      if (storedUrl === correctUrl) {
        unchanged.push({
          id: resource.id,
          name: resource.display_name || resource.name,
          url: storedUrl,
        });
        continue;
      }

      // Domain is stale — patch the resource
      console.log(`[Reconcile] Updating ${resource.display_name || resource.name}: ${storedUrl} -> ${correctUrl}`);

      try {
        const patchResponse = await fetch(
          `${baseUrl}/api/fabric/resources/swml_webhooks/${resource.id}`,
          {
            method: 'PATCH',
            headers: {
              'Authorization': `Basic ${basicAuth}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              primary_request_url: correctUrl,
              primary_request_method: 'GET',
            }),
          }
        );

        if (!patchResponse.ok) {
          const errorText = await patchResponse.text();
          console.error(`[Reconcile] Failed to update ${resource.id}:`, errorText);
          errors.push({
            id: resource.id,
            name: resource.display_name || resource.name,
            error: errorText,
          });
        } else {
          console.log(`[Reconcile] Updated ${resource.display_name || resource.name}`);
          updated.push({
            id: resource.id,
            name: resource.display_name || resource.name,
            oldUrl: storedUrl,
            newUrl: correctUrl,
          });
        }
      } catch (err) {
        errors.push({
          id: resource.id,
          name: resource.display_name || resource.name,
          error: err.message,
        });
      }
    }

    return Response.json({
      success: true,
      total: swmlResources.length,
      updated,
      unchanged,
      errors,
    });
  } catch (error) {
    console.error('[Reconcile] Error:', error);
    return Response.json(
      { error: 'Failed to reconcile webhooks: ' + error.message },
      { status: 500 }
    );
  }
}
