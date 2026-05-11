// @vitest-environment node
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  upsertProject,
  getProjectById,
  getProjectByNaturalKey,
  getProjectByBasicAuthUser,
  decryptApiToken,
  decryptWebhookPassword,
  ProjectNotFound,
} from '../projects-repo';

const KEY_B64 = 'dGVzdC1rZXktMzItYnl0ZXMtZm9yLWFlcy1nY20hISE=';

function migrate(db: Database.Database) {
  const initial = readFileSync(
    join(__dirname, '../../../../agent/migrations/001_initial_schema.sql'),
    'utf-8',
  );
  const projects = readFileSync(
    join(__dirname, '../../../../agent/migrations/002_projects.sql'),
    'utf-8',
  );
  db.exec(initial);
  db.exec(projects);
}

let db: Database.Database;

beforeEach(() => {
  process.env.HIREWIRE_ENCRYPTION_KEY = KEY_B64;
  db = new Database(':memory:');
  migrate(db);
});

afterEach(() => {
  db.close();
});

describe('projects-repo', () => {
  it('upsert creates a new row with encrypted columns', () => {
    const id = upsertProject(db, {
      spaceUrl: 'acme.signalwire.com',
      signalwireProjectId: 'sw-proj-1',
      apiToken: 'PTsecret',
      webhookBasicAuthUser: 'proj_abcd1234',
      webhookBasicAuthPassword: 'pw-secret',
    });
    const row = getProjectById(db, id);
    expect(row.spaceUrl).toBe('acme.signalwire.com');
    expect(row.signalwireProjectId).toBe('sw-proj-1');
    expect(row.webhookBasicAuthUser).toBe('proj_abcd1234');
    expect(decryptApiToken(db, id)).toBe('PTsecret');
    expect(decryptWebhookPassword(db, id)).toBe('pw-secret');
  });

  it('upsert is idempotent on (space_url, signalwire_project_id)', () => {
    const idA = upsertProject(db, {
      spaceUrl: 'acme.signalwire.com',
      signalwireProjectId: 'sw-proj-1',
      apiToken: 'PT1',
      webhookBasicAuthUser: 'proj_aaaa1111',
      webhookBasicAuthPassword: 'pw-1',
    });
    const idB = upsertProject(db, {
      spaceUrl: 'acme.signalwire.com',
      signalwireProjectId: 'sw-proj-1',
      apiToken: 'PT2',
      webhookBasicAuthUser: 'proj_bbbb2222',
      webhookBasicAuthPassword: 'pw-2',
    });
    expect(idB).toBe(idA);
    expect(decryptApiToken(db, idA)).toBe('PT2');
    expect(decryptWebhookPassword(db, idA)).toBe('pw-2');
    expect(getProjectById(db, idA).webhookBasicAuthUser).toBe('proj_bbbb2222');
  });

  it('lookup by natural key', () => {
    const id = upsertProject(db, {
      spaceUrl: 'acme.signalwire.com',
      signalwireProjectId: 'sw-proj-x',
      apiToken: 'PT',
      webhookBasicAuthUser: 'proj_cccc3333',
      webhookBasicAuthPassword: 'pw',
    });
    const row = getProjectByNaturalKey(db, 'acme.signalwire.com', 'sw-proj-x');
    expect(row.id).toBe(id);
  });

  it('lookup by webhook basic-auth username', () => {
    const id = upsertProject(db, {
      spaceUrl: 'acme.signalwire.com',
      signalwireProjectId: 'sw-proj-y',
      apiToken: 'PT',
      webhookBasicAuthUser: 'proj_dddd4444',
      webhookBasicAuthPassword: 'pw',
    });
    const row = getProjectByBasicAuthUser(db, 'proj_dddd4444');
    expect(row.id).toBe(id);
  });

  it('throws ProjectNotFound for missing id', () => {
    expect(() => getProjectById(db, 'nope')).toThrow(ProjectNotFound);
    expect(() => getProjectByBasicAuthUser(db, 'nope_user')).toThrow(ProjectNotFound);
  });
});
