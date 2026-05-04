import { AsyncLocalStorage } from 'node:async_hooks';
import nodeConsole from 'node:console';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { contextStorage, getContext } from 'hono/context-storage';
import { cors } from 'hono/cors';
import { proxy } from 'hono/proxy';
import { requestId } from 'hono/request-id';
import { createHonoServer } from 'react-router-hono-server/node';
import { serializeError } from 'serialize-error';
import { getDb, getAllEmployees, getEmployeeById, getSetting } from '../src/lib/db';
import { getHTMLForErrorPage } from './get-html-for-error-page';
import { API_BASENAME, api } from './route-builder';

// Initialize the database on server start
getDb();
console.log('[DB] SQLite database initialized');

/**
 * Read current agent credentials from the file written by Python backend.
 * This is still needed for the BasicAuth header on SWML proxy requests.
 */
function getAgentCredentials(): string {
  try {
    const credentialsPath = join(process.cwd(), 'agent-credentials.json');
    const credentialsData = readFileSync(credentialsPath, 'utf-8');
    const credentials = JSON.parse(credentialsData);
    return `${credentials.username}:${credentials.password}`;
  } catch (error) {
    console.error('[Auth] Error reading agent credentials:', error);
    return 'signalwire:signalwire';
  }
}

const als = new AsyncLocalStorage<{ requestId: string }>();

for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  const original = nodeConsole[method].bind(console);

  console[method] = (...args: unknown[]) => {
    const requestId = als.getStore()?.requestId;
    if (requestId) {
      original(`[traceId:${requestId}]`, ...args);
    } else {
      original(...args);
    }
  };
}

const app = new Hono();

app.use('*', requestId());

app.use('*', (c, next) => {
  const requestId = c.get('requestId');
  return als.run({ requestId }, () => next());
});

app.use(contextStorage());

app.onError((err, c) => {
  if (c.req.method !== 'GET') {
    return c.json(
      {
        error: 'An error occurred in your app',
        details: serializeError(err),
      },
      500
    );
  }
  return c.html(getHTMLForErrorPage(err), 200);
});

if (process.env.CORS_ORIGINS) {
  app.use(
    '/*',
    cors({
      origin: process.env.CORS_ORIGINS.split(',').map((origin) => origin.trim()),
    })
  );
}

app.all('/integrations/:path{.+}', async (c, next) => {
  const queryParams = c.req.query();
  const url = `${process.env.NEXT_PUBLIC_CREATE_BASE_URL ?? 'https://www.create.xyz'}/integrations/${c.req.param('path')}${Object.keys(queryParams).length > 0 ? `?${new URLSearchParams(queryParams).toString()}` : ''}`;

  return proxy(url, {
    method: c.req.method,
    body: c.req.raw.body ?? null,
    // @ts-ignore - this key is accepted even if types not aware and is
    // required for streaming integrations
    duplex: 'half',
    redirect: 'manual',
    headers: {
      ...c.req.header(),
      'X-Forwarded-For': process.env.NEXT_PUBLIC_CREATE_HOST,
      'x-createxyz-host': process.env.NEXT_PUBLIC_CREATE_HOST,
      Host: process.env.NEXT_PUBLIC_CREATE_HOST,
      'x-createxyz-project-group-id': process.env.NEXT_PUBLIC_PROJECT_GROUP_ID,
    },
  });
});

// ---------------------------------------------------------------------------
// SWML Proxy with lazy agent re-creation
//
// When SignalWire hits /api/swml/{employeeId}, the proxy forwards to the
// Python backend.  If the backend returns 404 (agent not registered — e.g.
// after a restart) the proxy reads the persisted employee config from the
// SQLite database, re-creates the agent in the Python backend, then retries
// the original request.  This makes the system self-healing.
// ---------------------------------------------------------------------------

function readEmployeesFromDb(): any[] {
  try {
    return getAllEmployees();
  } catch {
    return [];
  }
}

async function ensureAgentRegistered(employeeId: string, pythonBackendUrl: string): Promise<boolean> {
  const employee = getEmployeeById(employeeId);

  if (!employee) {
    console.warn(`[SWML Proxy] No persisted config for employee ${employeeId}`);
    return false;
  }

  console.log(`[SWML Proxy] Re-creating agent for ${employee.name} (${employeeId}) in Python backend`);

  try {
    // Parse JSON fields from DB
    const speechHints = typeof employee.speech_hints === 'string' ? JSON.parse(employee.speech_hints) : employee.speech_hints || [];
    const enabledFunctions = typeof employee.enabled_functions === 'string' ? JSON.parse(employee.enabled_functions) : employee.enabled_functions || [];

    const res = await fetch(`${pythonBackendUrl}/api/create-employee`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: employee.id,
        name: employee.name,
        role: employee.role,
        greeting: employee.greeting,
        prompt: employee.prompt,
        voice: employee.voice,
        language: employee.language,
        temperature: employee.temperature,
        speech_hints: speechHints,
        enabled_functions: enabledFunctions,
      }),
    });

    if (!res.ok) {
      console.error(`[SWML Proxy] Failed to re-create agent: ${res.status} ${await res.text()}`);
      return false;
    }

    console.log(`[SWML Proxy] Agent ${employeeId} re-created successfully`);
    return true;
  } catch (err) {
    console.error('[SWML Proxy] Error re-creating agent:', err);
    return false;
  }
}

app.all('/api/swml/:employeeId{.*}', async (c) => {
  // Strip trailing slashes — the route pattern captures them as part of the param
  const employeeId = c.req.param('employeeId').replace(/\/+$/, '');
  const pythonBackendUrl = process.env.AGENT_BACKEND_URL || 'http://localhost:8000';

  // Construct the backend URL, ensuring proper path formatting
  let backendPath = `/swml/${employeeId}`;
  if (!backendPath.endsWith('/')) {
    backendPath += '/';
  }

  const backendUrl = `${pythonBackendUrl}${backendPath}`;
  const queryString = c.req.url.includes('?') ? c.req.url.split('?')[1] : '';
  const fullBackendUrl = queryString ? `${backendUrl}?${queryString}` : backendUrl;

  console.log(`[SWML Proxy] ${c.req.method} /api/swml/${employeeId} -> ${fullBackendUrl}`);

  const authCredentials = getAgentCredentials();
  const base64Auth = Buffer.from(authCredentials).toString('base64');

  const proxyHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Basic ${base64Auth}`,
    'X-Forwarded-Host': c.req.header('host') || '',
    'X-Forwarded-Proto': c.req.header('x-forwarded-proto') || 'https',
  };

  try {
    // First attempt
    const response = await fetch(fullBackendUrl, {
      method: c.req.method,
      headers: proxyHeaders,
      body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? c.req.raw.body : undefined,
      // @ts-ignore
      duplex: 'half',
    });

    // If the backend knows this agent, return immediately
    if (response.status !== 404) {
      const body = await response.text();
      console.log(`[SWML Proxy] Response ${response.status} from Python backend`);
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    // 404 — agent not registered.  Try to re-create it from persisted config.
    console.log(`[SWML Proxy] 404 for ${employeeId} — attempting lazy re-creation`);

    const created = await ensureAgentRegistered(employeeId, pythonBackendUrl);
    if (!created) {
      return c.json({ error: 'Agent not found and could not be re-created' }, 404);
    }

    // Retry the original request
    const retry = await fetch(fullBackendUrl, {
      method: c.req.method,
      headers: proxyHeaders,
    });

    const retryBody = await retry.text();
    console.log(`[SWML Proxy] Retry response ${retry.status}`);

    return new Response(retryBody, {
      status: retry.status,
      statusText: retry.statusText,
      headers: retry.headers,
    });
  } catch (error) {
    console.error('[SWML Proxy] Error proxying to Python backend:', error);
    return c.json(
      {
        error: 'Failed to proxy SWML request',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// ---------------------------------------------------------------------------
// Direct /swml/* proxy (for SWAIG function callbacks from SignalWire)
//
// The Python backend generates webhook URLs at /swml/{id}/swaig/ (no /api/
// prefix). SignalWire calls these directly, so we must proxy them to the
// Python backend just like /api/swml/*.
// ---------------------------------------------------------------------------

app.all('/swml/:rest{.*}', async (c) => {
  const rest = c.req.param('rest').replace(/\/+$/, '');
  const pythonBackendUrl = process.env.AGENT_BACKEND_URL || 'http://localhost:8000';

  let backendPath = `/swml/${rest}`;
  if (!backendPath.endsWith('/')) {
    backendPath += '/';
  }

  const queryString = c.req.url.includes('?') ? c.req.url.split('?')[1] : '';
  const fullBackendUrl = queryString
    ? `${pythonBackendUrl}${backendPath}?${queryString}`
    : `${pythonBackendUrl}${backendPath}`;

  console.log(`[SWML Direct Proxy] ${c.req.method} /swml/${rest} -> ${fullBackendUrl}`);

  const authCredentials = getAgentCredentials();
  const base64Auth = Buffer.from(authCredentials).toString('base64');

  try {
    const response = await fetch(fullBackendUrl, {
      method: c.req.method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${base64Auth}`,
        'X-Forwarded-Host': c.req.header('host') || '',
        'X-Forwarded-Proto': c.req.header('x-forwarded-proto') || 'https',
      },
      body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? c.req.raw.body : undefined,
      // @ts-ignore
      duplex: 'half',
    });

    const body = await response.text();
    console.log(`[SWML Direct Proxy] Response ${response.status}`);

    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    console.error('[SWML Direct Proxy] Error:', error);
    return c.json({ error: 'Failed to proxy SWML request' }, 500);
  }
});

app.route(API_BASENAME, api);

// `createHonoServer` calls `serve()` immediately when NODE_ENV=production,
// which would start an HTTP server *during the build* because @react-router/dev
// imports this bundle to read its named exports for prerendering. We only want
// the server to actually start when launched by the production `start` script,
// so gate the call behind an explicit env var.
//
// Additionally, in production we avoid `createHonoServer`'s built-in
// `serve()` call (which has been observed to hang inside this bundle's
// top-level await graph) and instead expose the configured `app`. The
// production entry script (`scripts/start-prod.mjs`) imports `app`, wires up
// the React Router request handler, and binds the HTTP listener itself.
let honoApp: unknown = app;
if (process.env.HIREWIRE_START === '1') {
  honoApp = await createHonoServer({
    app,
    defaultLogger: false,
  });
}
export default honoApp;
export { app };
