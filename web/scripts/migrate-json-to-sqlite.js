#!/usr/bin/env node

/**
 * One-time migration script: imports existing JSON data into the SQLite database.
 *
 * Usage: node scripts/migrate-json-to-sqlite.js
 *
 * This script:
 * 1. Reads employees.json, call-logs.json, and agent-credentials.json
 * 2. Inserts the data into the SQLite database
 * 3. Creates a default user if none exists
 *
 * Safe to run multiple times — uses INSERT OR REPLACE.
 */

import Database from 'better-sqlite3';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const dbDir = join(projectRoot, 'data');
const dbPath = join(dbDir, 'sally_sales.db');

// Ensure data directory exists
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
// Disable FK checks during migration to handle orphaned references
db.pragma('foreign_keys = OFF');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    space_url TEXT NOT NULL,
    project_id TEXT UNIQUE NOT NULL,
    api_token TEXT NOT NULL,
    subscriber_id TEXT,
    subscriber_data TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES users(project_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'Assistant',
    greeting TEXT,
    prompt TEXT,
    voice TEXT DEFAULT 'openai.nova',
    language TEXT DEFAULT 'en-US',
    temperature REAL DEFAULT 0.7,
    speech_hints TEXT DEFAULT '[]',
    enabled_functions TEXT DEFAULT '[]',
    transfer_number TEXT DEFAULT '',
    transfer_from TEXT DEFAULT '',
    sms_from_number TEXT DEFAULT '',
    phone_number TEXT DEFAULT '',
    video_idle_url TEXT DEFAULT '',
    video_talking_url TEXT DEFAULT '',
    resource_id TEXT,
    resource_name TEXT,
    call_fabric_address TEXT,
    webhook_url TEXT,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS call_logs (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES users(project_id) ON DELETE SET NULL,
    employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
    employee_name TEXT,
    employee_role TEXT,
    timestamp TEXT,
    duration_sec INTEGER DEFAULT 0,
    summary TEXT,
    caller_intent TEXT,
    outcome TEXT,
    sentiment TEXT,
    topics TEXT DEFAULT '[]',
    follow_up TEXT,
    user_messages INTEGER DEFAULT 0,
    assistant_messages INTEGER DEFAULT 0,
    total_messages INTEGER DEFAULT 0,
    swaig_calls INTEGER DEFAULT 0,
    avg_latency_ms INTEGER,
    total_input_tokens INTEGER DEFAULT 0,
    total_output_tokens INTEGER DEFAULT 0,
    raw_payload TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sms_logs (
    id TEXT PRIMARY KEY,
    employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
    call_id TEXT,
    from_number TEXT NOT NULL,
    to_number TEXT NOT NULL,
    body TEXT,
    status TEXT DEFAULT 'sent',
    signalwire_sid TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

function readJsonFile(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    console.warn(`  Warning: Could not read ${path}:`, err.message);
    return null;
  }
}

// --- Default user ---
const DEFAULT_PROJECT_ID = 'default';

// Check if a default user already exists
const existingUser = db.prepare('SELECT * FROM users WHERE project_id = ?').get(DEFAULT_PROJECT_ID);
if (!existingUser) {
  console.log('Creating default user...');
  db.prepare(`
    INSERT INTO users (id, space_url, project_id, api_token)
    VALUES (?, ?, ?, ?)
  `).run(DEFAULT_PROJECT_ID, 'localhost', DEFAULT_PROJECT_ID, 'migration-placeholder');
  console.log('  Default user created (project_id: "default")');
} else {
  console.log('  Default user already exists');
}

// --- Employees ---
const employeesPath = join(projectRoot, 'employees.json');
const employees = readJsonFile(employeesPath);

if (employees && Array.isArray(employees)) {
  console.log(`\nMigrating ${employees.length} employee(s)...`);

  const insertEmp = db.prepare(`
    INSERT OR REPLACE INTO employees (
      id, project_id, name, role, greeting, prompt, voice, language, temperature,
      speech_hints, enabled_functions, transfer_number, transfer_from,
      sms_from_number, phone_number, video_idle_url, video_talking_url,
      resource_id, resource_name, call_fabric_address, webhook_url, status,
      created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?
    )
  `);

  for (const emp of employees) {
    insertEmp.run(
      emp.id,
      emp.projectId || DEFAULT_PROJECT_ID,
      emp.name,
      emp.role || 'Assistant',
      emp.greeting || null,
      emp.prompt || null,
      emp.voice || 'openai.nova',
      emp.language || 'en-US',
      emp.temperature ?? 0.7,
      JSON.stringify(emp.speech_hints || []),
      JSON.stringify(emp.enabled_functions || []),
      emp.transfer_number || '',
      emp.transfer_from || '',
      emp.sms_from_number || '',
      emp.phone_number || '',
      emp.video_idle_url || '',
      emp.video_talking_url || '',
      emp.resourceId || null,
      emp.resourceName || null,
      emp.callFabricAddress || null,
      emp.webhookUrl || null,
      emp.status || 'active',
      emp.created_at || new Date().toISOString(),
      emp.updated_at || new Date().toISOString(),
    );
    console.log(`  Migrated employee: ${emp.name} (${emp.id})`);
  }
} else {
  console.log('\nNo employees.json found or empty — skipping');
}

// --- Call Logs ---
const callLogsPath = join(projectRoot, 'call-logs.json');
const callLogs = readJsonFile(callLogsPath);

if (callLogs && Array.isArray(callLogs)) {
  console.log(`\nMigrating ${callLogs.length} call log(s)...`);

  const insertLog = db.prepare(`
    INSERT OR REPLACE INTO call_logs (
      id, project_id, employee_id, employee_name, employee_role, timestamp,
      duration_sec, summary, caller_intent, outcome, sentiment, topics,
      follow_up, user_messages, assistant_messages, total_messages,
      swaig_calls, avg_latency_ms, total_input_tokens, total_output_tokens,
      raw_payload
    ) VALUES (
      @id, @projectId, @employeeId, @employeeName, @employeeRole, @timestamp,
      @durationSec, @summary, @callerIntent, @outcome, @sentiment, @topics,
      @followUp, @userMessages, @assistantMessages, @totalMessages,
      @swaigCalls, @avgLatencyMs, @totalInputTokens, @totalOutputTokens,
      @rawPayload
    )
  `);

  let migrated = 0;
  for (const log of callLogs) {
    try {
      insertLog.run({
        id: log.id,
        projectId: log.projectId ?? null,
        employeeId: log.employeeId ?? null,
        employeeName: log.employeeName ?? null,
        employeeRole: log.employeeRole ?? null,
        timestamp: log.timestamp ?? null,
        durationSec: log.durationSec ?? 0,
        summary: log.summary ?? null,
        callerIntent: log.callerIntent ?? null,
        outcome: log.outcome ?? null,
        sentiment: log.sentiment ?? null,
        topics: JSON.stringify(log.topics || []),
        followUp: log.followUp ?? null,
        userMessages: log.userMessages ?? 0,
        assistantMessages: log.assistantMessages ?? 0,
        totalMessages: log.totalMessages ?? 0,
        swaigCalls: log.swaigCalls ?? 0,
        avgLatencyMs: log.avgLatencyMs ?? null,
        totalInputTokens: log.totalInputTokens ?? 0,
        totalOutputTokens: log.totalOutputTokens ?? 0,
        rawPayload: log._raw ? JSON.stringify(log._raw) : null,
      });
      migrated++;
    } catch (err) {
      console.warn(`  Warning: Skipped call log ${log.id}: ${err.message}`);
    }
  }
  console.log(`  Migrated ${migrated}/${callLogs.length} call log(s)`);
} else {
  console.log('\nNo call-logs.json found or empty — skipping');
}

// --- Agent Credentials / App Settings ---
const credentialsPath = join(projectRoot, 'agent-credentials.json');
const credentials = readJsonFile(credentialsPath);

if (credentials) {
  console.log('\nMigrating app settings from agent-credentials.json...');

  const insertSetting = db.prepare(`
    INSERT OR REPLACE INTO app_settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
  `);

  if (credentials.app_domain) {
    insertSetting.run('app_domain', credentials.app_domain);
    console.log(`  Migrated app_domain: ${credentials.app_domain}`);
  }
} else {
  console.log('\nNo agent-credentials.json found — skipping');
}

// Summary
const empCount = db.prepare('SELECT COUNT(*) as count FROM employees').get().count;
const logCount = db.prepare('SELECT COUNT(*) as count FROM call_logs').get().count;
const settingCount = db.prepare('SELECT COUNT(*) as count FROM app_settings').get().count;

console.log('\n=== Migration Complete ===');
console.log(`  Database: ${dbPath}`);
console.log(`  Employees: ${empCount}`);
console.log(`  Call Logs: ${logCount}`);
console.log(`  Settings:  ${settingCount}`);
console.log('');

db.close();
