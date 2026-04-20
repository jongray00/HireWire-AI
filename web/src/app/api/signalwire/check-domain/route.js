/**
 * Domain Health Check API
 *
 * Verifies that the stored (or provided) application domain is publicly
 * reachable. SignalWire must be able to reach the webhook URL to deliver
 * calls, so this check confirms the tunnel / deployment is live.
 *
 * POST body (optional): { domain: "https://..." }
 *   — if omitted, reads stored domain from agent-credentials.json
 *
 * Returns: { reachable, domain, latency?, status?, error?, suggestion? }
 */

import { requireAuth } from '@/app/api/middleware/auth';
import { readFile } from 'fs/promises';
import { join } from 'path';

const CREDENTIALS_PATH = join(process.cwd(), 'agent-credentials.json');

async function getStoredDomain() {
  try {
    const data = await readFile(CREDENTIALS_PATH, 'utf8');
    const credentials = JSON.parse(data);
    return credentials.app_domain || null;
  } catch {
    return null;
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));

    // Try session-based auth (no fallback needed since this route doesn't require SW credentials)
    // This allows auth-gating the endpoint in the future
    const auth = await requireAuth(request);
    // No credential check needed - this endpoint only checks domain reachability

    const domain = body.domain || await getStoredDomain();

    if (!domain) {
      return Response.json({
        reachable: false,
        domain: null,
        error: 'No application domain configured',
        suggestion: 'Go to Settings and set your application domain (e.g., your ngrok URL).',
      });
    }

    // Validate URL
    let url;
    try {
      url = new URL(domain);
    } catch {
      return Response.json({
        reachable: false,
        domain,
        error: 'Invalid domain URL format',
        suggestion: 'Check the domain URL in Settings. It should start with https://.',
      });
    }

    // Localhost check
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      return Response.json({
        reachable: false,
        domain,
        error: 'Domain uses localhost, which is not publicly accessible',
        suggestion:
          'SignalWire needs a public URL to deliver calls. Start a tunnel (e.g., ngrok http 5000) and update your domain in Settings with the tunnel URL.',
      });
    }

    // Reach out to the health endpoint
    const start = Date.now();
    try {
      const response = await fetch(`${domain}/health`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      const latency = Date.now() - start;

      if (response.ok) {
        return Response.json({
          reachable: true,
          domain,
          latency,
          status: response.status,
        });
      }

      return Response.json({
        reachable: false,
        domain,
        latency,
        status: response.status,
        error: `Domain responded with HTTP ${response.status}`,
        suggestion:
          'The domain is reachable but the backend may not be running. Make sure the Python agent backend is started.',
      });
    } catch (fetchError) {
      const msg = fetchError.name === 'TimeoutError'
        ? 'Connection timed out after 8 seconds'
        : fetchError.message;

      return Response.json({
        reachable: false,
        domain,
        error: `Cannot reach ${domain}: ${msg}`,
        suggestion:
          'Make sure your tunnel (e.g., ngrok) is running and the URL matches the one in Settings. Tunnels get a new URL every time they restart.',
      });
    }
  } catch (error) {
    return Response.json(
      { reachable: false, error: 'Health check failed: ' + error.message },
      { status: 500 },
    );
  }
}
