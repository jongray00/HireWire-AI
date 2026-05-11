import { randomUUID, randomBytes } from 'crypto';
import type Database from 'better-sqlite3';

import { encrypt, decrypt } from './crypto';

export class ProjectNotFound extends Error {}

export interface ProjectRow {
  id: string;
  spaceUrl: string;
  signalwireProjectId: string;
  wizardResourceId: string | null;
  agentResourceId: string | null;
  webhookBasicAuthUser: string;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertProjectInput {
  spaceUrl: string;
  signalwireProjectId: string;
  apiToken: string;
  webhookBasicAuthUser: string;
  webhookBasicAuthPassword: string;
  wizardResourceId?: string | null;
  agentResourceId?: string | null;
}

function rowToProject(row: any): ProjectRow {
  return {
    id: row.id,
    spaceUrl: row.space_url,
    signalwireProjectId: row.signalwire_project_id,
    wizardResourceId: row.wizard_resource_id,
    agentResourceId: row.agent_resource_id,
    webhookBasicAuthUser: row.webhook_basic_auth_user,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Upsert by natural key (space_url, signalwire_project_id). Returns the
 * internal project UUID. On conflict, rotates api_token + webhook creds.
 */
export function upsertProject(db: Database.Database, input: UpsertProjectInput): string {
  const now = Math.floor(Date.now() / 1000);
  const existing = db
    .prepare(
      'SELECT id FROM projects WHERE space_url = ? AND signalwire_project_id = ?',
    )
    .get(input.spaceUrl, input.signalwireProjectId) as { id: string } | undefined;

  const id = existing?.id ?? randomUUID();
  const apiTokenEnc = encrypt(input.apiToken);
  const webhookPwdEnc = encrypt(input.webhookBasicAuthPassword);

  if (existing) {
    db.prepare(
      `UPDATE projects SET
         signalwire_api_token_enc = @apiTokenEnc,
         webhook_basic_auth_user = @webhookBasicAuthUser,
         webhook_basic_auth_pwd_enc = @webhookPwdEnc,
         wizard_resource_id = COALESCE(@wizardResourceId, wizard_resource_id),
         agent_resource_id = COALESCE(@agentResourceId, agent_resource_id),
         updated_at = @now
       WHERE id = @id`,
    ).run({
      id,
      apiTokenEnc,
      webhookBasicAuthUser: input.webhookBasicAuthUser,
      webhookPwdEnc,
      wizardResourceId: input.wizardResourceId ?? null,
      agentResourceId: input.agentResourceId ?? null,
      now,
    });
  } else {
    db.prepare(
      `INSERT INTO projects (
         id, space_url, signalwire_project_id, signalwire_api_token_enc,
         wizard_resource_id, agent_resource_id,
         webhook_basic_auth_user, webhook_basic_auth_pwd_enc,
         created_at, updated_at
       ) VALUES (
         @id, @spaceUrl, @signalwireProjectId, @apiTokenEnc,
         @wizardResourceId, @agentResourceId,
         @webhookBasicAuthUser, @webhookPwdEnc,
         @now, @now
       )`,
    ).run({
      id,
      spaceUrl: input.spaceUrl,
      signalwireProjectId: input.signalwireProjectId,
      apiTokenEnc,
      wizardResourceId: input.wizardResourceId ?? null,
      agentResourceId: input.agentResourceId ?? null,
      webhookBasicAuthUser: input.webhookBasicAuthUser,
      webhookPwdEnc,
      now,
    });
  }
  return id;
}

export function getProjectById(db: Database.Database, id: string): ProjectRow {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!row) throw new ProjectNotFound(id);
  return rowToProject(row);
}

export function getProjectByNaturalKey(
  db: Database.Database,
  spaceUrl: string,
  signalwireProjectId: string,
): ProjectRow {
  const row = db
    .prepare('SELECT * FROM projects WHERE space_url = ? AND signalwire_project_id = ?')
    .get(spaceUrl, signalwireProjectId);
  if (!row) throw new ProjectNotFound(`${spaceUrl}/${signalwireProjectId}`);
  return rowToProject(row);
}

export function getProjectByBasicAuthUser(
  db: Database.Database,
  basicAuthUser: string,
): ProjectRow {
  const row = db
    .prepare('SELECT * FROM projects WHERE webhook_basic_auth_user = ?')
    .get(basicAuthUser);
  if (!row) throw new ProjectNotFound(basicAuthUser);
  return rowToProject(row);
}

export function decryptApiToken(db: Database.Database, id: string): string {
  const row = db.prepare('SELECT signalwire_api_token_enc FROM projects WHERE id = ?').get(id) as
    | { signalwire_api_token_enc: Buffer }
    | undefined;
  if (!row) throw new ProjectNotFound(id);
  return decrypt(row.signalwire_api_token_enc);
}

export function decryptWebhookPassword(db: Database.Database, id: string): string {
  const row = db
    .prepare('SELECT webhook_basic_auth_pwd_enc FROM projects WHERE id = ?')
    .get(id) as { webhook_basic_auth_pwd_enc: Buffer } | undefined;
  if (!row) throw new ProjectNotFound(id);
  return decrypt(row.webhook_basic_auth_pwd_enc);
}

/** Returns a tuple of (username, password) suitable for SignalWire Basic Auth. */
export function generateWebhookCredentials(): { user: string; password: string } {
  const userSuffix = randomBytes(4).toString('hex'); // 8 hex chars
  return {
    user: `proj_${userSuffix}`,
    password: randomBytes(32).toString('base64url'),
  };
}
