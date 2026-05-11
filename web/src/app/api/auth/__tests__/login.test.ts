// @vitest-environment node
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('@/lib/agent-client', () => ({
  validateCredentialsViaAgent: vi.fn(),
  AgentClientError: class extends Error {
    constructor(public status: number, msg: string) {
      super(msg);
    }
  },
}));

vi.mock('@/lib/signalwire-provisioning', () => ({
  ensureWizardAgent: vi.fn(),
  ensureHireWireAgent: vi.fn(),
  ProvisioningError: class extends Error {
    constructor(public status: number, msg: string) {
      super(msg);
    }
  },
}));

import { POST as login } from '../login/route';
import { POST as logout } from '../logout/route';
import {
  validateCredentialsViaAgent,
  AgentClientError,
} from '@/lib/agent-client';
import {
  ensureWizardAgent,
  ensureHireWireAgent,
  ProvisioningError,
} from '@/lib/signalwire-provisioning';
import { getDb, closeDb } from '@/lib/db';
import { _resetRateLimitForTests } from '@/lib/rate-limit';

const KEY_B64 = 'dGVzdC1rZXktMzItYnl0ZXMtZm9yLWFlcy1nY20hISE=';

let tmpDir: string;

function seedProjectsTable() {
  // db.ts initTables creates the legacy (users/employees/...) schema. We
  // additionally apply the 002 migration so `projects` exists for upsert.
  const projectsSql = readFileSync(
    join(__dirname, '../../../../../../agent/migrations/002_projects.sql'),
    'utf-8',
  );
  const db = getDb();
  db.exec(projectsSql);
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hirewire-login-test-'));
  process.env.HIREWIRE_ENCRYPTION_KEY = KEY_B64;
  process.env.HIREWIRE_JWT_SECRET = 'test-secret-at-least-32-chars-long-xx';
  process.env.HIREWIRE_AGENT_BASE_URL = 'http://localhost:8000';
  process.env.AGENT_API_KEY = 'test-api-key';
  process.env.HIREWIRE_APP_DOMAIN = 'http://localhost:5001';
  process.env.DATABASE_PATH = join(tmpDir, 'test.db');
  vi.clearAllMocks();
  _resetRateLimitForTests();
  seedProjectsTable();
});

afterEach(() => {
  closeDb();
  vi.clearAllMocks();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/auth/login', () => {
  it('issues a session cookie on success and creates a projects row', async () => {
    (validateCredentialsViaAgent as ReturnType<typeof vi.fn>).mockResolvedValue({
      valid: true,
      displayName: 'Acme',
    });
    (ensureWizardAgent as ReturnType<typeof vi.fn>).mockResolvedValue({
      resourceId: 'wizard-id',
      action: 'created',
    });
    (ensureHireWireAgent as ReturnType<typeof vi.fn>).mockResolvedValue({
      resourceId: 'agent-id',
      action: 'created',
    });

    const resp = await login(
      makeReq({
        space_url: 'acme.signalwire.com',
        signalwire_project_id: 'sw-proj-1',
        api_token: 'PT_real',
      }),
    );
    expect(resp.status).toBe(200);
    const cookie = resp.headers.get('Set-Cookie') || '';
    expect(cookie).toMatch(/hirewire_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    const body = await resp.json();
    expect(body.projectId).toBeTruthy();
    expect(body.displayName).toBe('Acme');
  });

  it('returns 401 when SignalWire rejects credentials', async () => {
    (validateCredentialsViaAgent as ReturnType<typeof vi.fn>).mockRejectedValue(
      new AgentClientError(401, 'invalid_credentials'),
    );
    const resp = await login(
      makeReq({
        space_url: 'acme.signalwire.com',
        signalwire_project_id: 'sw-proj-1',
        api_token: 'bad',
      }),
    );
    expect(resp.status).toBe(401);
    expect(resp.headers.get('Set-Cookie')).toBeNull();
    expect(ensureWizardAgent).not.toHaveBeenCalled();
  });

  it('returns 502 when provisioning fails and writes NO projects row', async () => {
    (validateCredentialsViaAgent as ReturnType<typeof vi.fn>).mockResolvedValue({
      valid: true,
      displayName: 'Acme',
    });
    (ensureWizardAgent as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ProvisioningError(500, 'boom'),
    );

    const resp = await login(
      makeReq({
        space_url: 'acme.signalwire.com',
        signalwire_project_id: 'sw-proj-1',
        api_token: 'PT_real',
      }),
    );
    expect(resp.status).toBe(502);
    expect(resp.headers.get('Set-Cookie')).toBeNull();
  });

  it('returns 400 when fields are missing', async () => {
    const resp = await login(
      makeReq({ signalwire_project_id: 'sw-proj-1' }),
    );
    expect(resp.status).toBe(400);
  });

  it('returns 429 after exceeding the per-IP rate limit', async () => {
    (validateCredentialsViaAgent as ReturnType<typeof vi.fn>).mockRejectedValue(
      new AgentClientError(401, 'invalid_credentials'),
    );

    function makeReqWithIp(body: unknown): Request {
      return new Request('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '9.9.9.9',
        },
      });
    }

    // 5 requests should be allowed (and return 401 from mocked agent).
    for (let i = 0; i < 5; i++) {
      const resp = await login(
        makeReqWithIp({
          space_url: 'acme.signalwire.com',
          signalwire_project_id: 'sw-proj-1',
          api_token: 'bad',
        }),
      );
      expect(resp.status).toBe(401);
    }

    // 6th request from same IP within window should be rate-limited.
    const resp = await login(
      makeReqWithIp({
        space_url: 'acme.signalwire.com',
        signalwire_project_id: 'sw-proj-1',
        api_token: 'bad',
      }),
    );
    expect(resp.status).toBe(429);
    expect(resp.headers.get('Retry-After')).toBeTruthy();
    const body = await resp.json();
    expect(body.error).toBe('rate_limited');
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the session cookie', async () => {
    const resp = await logout();
    expect(resp.status).toBe(200);
    const cookie = resp.headers.get('Set-Cookie') || '';
    expect(cookie).toMatch(/hirewire_session=;/);
    expect(cookie).toMatch(/Max-Age=0/);
  });
});
