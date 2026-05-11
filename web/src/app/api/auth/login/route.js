import { getDb } from '@/lib/db';
import {
  upsertProject,
  generateWebhookCredentials,
} from '@/lib/projects-repo';
import { validateCredentialsViaAgent, AgentClientError } from '@/lib/agent-client';
import {
  ensureWizardAgent,
  ensureHireWireAgent,
  ProvisioningError,
} from '@/lib/signalwire-provisioning';
import { issueSession, buildSessionCookie } from '@/lib/jwt';

function appDomain() {
  return process.env.HIREWIRE_APP_DOMAIN || 'http://localhost:5001';
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  const { space_url, signalwire_project_id, api_token } = body || {};
  if (!space_url || !signalwire_project_id || !api_token) {
    return Response.json({ error: 'missing_fields' }, { status: 400 });
  }

  const normalizedSpaceUrl = String(space_url)
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');

  let info;
  try {
    info = await validateCredentialsViaAgent(
      signalwire_project_id,
      api_token,
      normalizedSpaceUrl,
    );
  } catch (err) {
    if (err instanceof AgentClientError) {
      if (err.status === 401) {
        return Response.json({ error: 'invalid_credentials' }, { status: 401 });
      }
      if (err.status === 503) {
        return Response.json({ error: 'signalwire_unreachable' }, { status: 503 });
      }
    }
    return Response.json({ error: 'login_failed' }, { status: 500 });
  }

  const creds = generateWebhookCredentials();
  let wizardResult;
  let agentResult;
  try {
    wizardResult = await ensureWizardAgent({
      spaceUrl: normalizedSpaceUrl,
      signalwireProjectId: signalwire_project_id,
      apiToken: api_token,
      appDomain: appDomain(),
      basicAuthUser: creds.user,
      basicAuthPassword: creds.password,
    });
    agentResult = await ensureHireWireAgent({
      spaceUrl: normalizedSpaceUrl,
      signalwireProjectId: signalwire_project_id,
      apiToken: api_token,
      appDomain: appDomain(),
      basicAuthUser: creds.user,
      basicAuthPassword: creds.password,
    });
  } catch (err) {
    if (err instanceof ProvisioningError) {
      return Response.json({ error: 'provisioning_failed' }, { status: 502 });
    }
    return Response.json({ error: 'login_failed' }, { status: 500 });
  }

  const db = getDb();
  const projectId = upsertProject(db, {
    spaceUrl: normalizedSpaceUrl,
    signalwireProjectId: signalwire_project_id,
    apiToken: api_token,
    webhookBasicAuthUser: creds.user,
    webhookBasicAuthPassword: creds.password,
    wizardResourceId: wizardResult.resourceId,
    agentResourceId: agentResult.resourceId,
  });

  const jwt = await issueSession({ projectId });
  return new Response(
    JSON.stringify({
      projectId,
      displayName: info.displayName ?? null,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': buildSessionCookie(jwt),
      },
    },
  );
}
