/**
 * GET /api/employees/:id/code/:kind
 *
 * Thin proxy to the Python agent. Returns text/plain.
 *   - kind = "swml" → forwards to GET <agent>/swml/:id
 *   - kind = "sdk"  → forwards to GET <agent>/agent-code/:id
 *
 * The agent base URL is read from agent-credentials.json (same source the
 * other web → agent calls use), with localhost:8000 as the dev fallback.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

function readAgentCreds() {
  try {
    const data = readFileSync(join(process.cwd(), 'agent-credentials.json'), 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function getAgentBackendUrl(creds) {
  if (creds?.app_domain) return creds.app_domain.replace(/\/$/, '');
  return (process.env.AGENT_BACKEND_URL || 'http://localhost:8000').replace(/\/$/, '');
}

function basicAuthHeader(creds) {
  if (!creds?.username || !creds?.password) return null;
  return 'Basic ' + Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
}

export async function GET(request, { params }) {
  const id = params?.id;
  const kind = params?.kind;

  if (!id || typeof id !== 'string') {
    return new Response('Missing employee id', { status: 400 });
  }
  if (kind !== 'swml' && kind !== 'sdk') {
    return new Response('kind must be "swml" or "sdk"', { status: 400 });
  }

  const creds = readAgentCreds();
  const backend = getAgentBackendUrl(creds);
  const upstreamPath = kind === 'swml' ? `/swml/${id}` : `/agent-code/${id}`;
  const upstreamUrl = `${backend}${upstreamPath}`;

  // /swml/* on the agent is HTTP-Basic protected by signalwire-agents.
  // /agent-code/* is open (we own that route).
  const headers = { Accept: kind === 'swml' ? 'application/json' : 'text/plain' };
  if (kind === 'swml') {
    const auth = basicAuthHeader(creds);
    if (auth) headers.Authorization = auth;
  }

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, { method: 'GET', headers });
  } catch (err) {
    return new Response(`Agent unreachable at ${backend}: ${err.message}`, { status: 502 });
  }

  const body = await upstream.text();
  // Pretty-print SWML JSON when the agent returns JSON.
  let pretty = body;
  if (kind === 'swml') {
    try {
      pretty = JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      // Agent returned XML or already-formatted text — pass through unchanged.
    }
  }

  return new Response(pretty, {
    status: upstream.status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
