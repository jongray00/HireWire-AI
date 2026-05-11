/**
 * Thin client for web -> agent internal API.
 *
 * Spec §Flow B: every call includes X-Agent-API-Key (constant-time-compared
 * server-side). X-Project-Id is included when the caller has a project context.
 */

export class AgentClientError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function getAgentBaseUrl(): string {
  const url = process.env.HIREWIRE_AGENT_BASE_URL;
  if (!url) throw new AgentClientError(0, 'HIREWIRE_AGENT_BASE_URL not set');
  return url.replace(/\/$/, '');
}

function getAgentApiKey(): string {
  const key = process.env.AGENT_API_KEY;
  if (!key) throw new AgentClientError(0, 'AGENT_API_KEY not set');
  return key;
}

interface AgentRequestOpts {
  projectId?: string;
  body?: unknown;
}

export async function agentRequest(
  method: string,
  path: string,
  opts: AgentRequestOpts = {},
): Promise<unknown> {
  const url = `${getAgentBaseUrl()}${path}`;
  const headers: Record<string, string> = {
    'X-Agent-API-Key': getAgentApiKey(),
    'Content-Type': 'application/json',
  };
  if (opts.projectId) headers['X-Project-Id'] = opts.projectId;
  const resp = await fetch(url, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new AgentClientError(
      resp.status,
      `agent ${method} ${path} -> ${resp.status}: ${text}`,
    );
  }
  if (resp.status === 204) return undefined;
  return resp.json();
}

export async function validateCredentialsViaAgent(
  signalwireProjectId: string,
  apiToken: string,
  spaceUrl: string,
): Promise<{ valid: boolean; displayName: string | null }> {
  return agentRequest('POST', '/api/auth/validate-credentials', {
    body: {
      signalwire_project_id: signalwireProjectId,
      api_token: apiToken,
      space_url: spaceUrl,
    },
  }) as Promise<{ valid: boolean; displayName: string | null }>;
}
