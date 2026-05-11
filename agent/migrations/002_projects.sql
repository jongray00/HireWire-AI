-- HireWire-AI/agent/migrations/002_projects.sql
-- Phase 2 redesigns the projects table for per-tenant SignalWire auth.
-- The Phase 1 projects table had no data (Phase 1 was a dormant backport),
-- so we drop and recreate. Other tables (employees, documents, calls,
-- customers) have FK ON DELETE CASCADE refs to projects(id); these
-- continue to resolve by name against the new projects table.
DROP TABLE IF EXISTS projects;

CREATE TABLE projects (
  id                          TEXT PRIMARY KEY,
  space_url                   TEXT NOT NULL,
  signalwire_project_id       TEXT NOT NULL,
  signalwire_api_token_enc    BLOB NOT NULL,
  wizard_resource_id          TEXT,
  agent_resource_id           TEXT,
  webhook_basic_auth_user     TEXT NOT NULL,
  webhook_basic_auth_pwd_enc  BLOB NOT NULL,
  created_at                  INTEGER NOT NULL,
  updated_at                  INTEGER NOT NULL,
  UNIQUE (space_url, signalwire_project_id)
);

CREATE UNIQUE INDEX idx_projects_basic_auth_user ON projects(webhook_basic_auth_user);
CREATE INDEX idx_projects_sw_project ON projects(signalwire_project_id);
