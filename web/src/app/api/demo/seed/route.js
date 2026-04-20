/**
 * Demo Seed — Populate with example agents and call logs
 * POST /api/demo/seed
 */

import { upsertEmployee, insertCallLog } from '@/lib/db';
import { requireAuth } from '@/app/api/middleware/auth';
import { randomUUID } from 'crypto';

const SEED_EMPLOYEES = [
  {
    name: 'Sally Sales',
    role: 'Sales Representative',
    greeting: 'Hi there! Welcome to our company. How can I help you today?',
    prompt: 'You are Sally, a friendly and knowledgeable sales representative. Help customers find the right products, answer pricing questions, and guide them through the purchasing process.',
    voice: 'openai.nova',
    functions: ['transfer_to_human', 'send_summary_sms', 'collect_customer_info', 'end_call'],
  },
  {
    name: 'Tech Support Tom',
    role: 'Technical Support Agent',
    greeting: 'Hello! You\'ve reached tech support. What issue can I help you with?',
    prompt: 'You are Tom, a patient and thorough technical support agent. Help customers troubleshoot issues, walk them through solutions step-by-step, and escalate when needed.',
    voice: 'openai.onyx',
    functions: ['transfer_to_human', 'send_summary_sms', 'schedule_callback', 'check_business_hours', 'end_call'],
  },
];

const SEED_CALL_LOGS = [
  { summary: 'Customer inquired about enterprise pricing. Provided quote for 50 seats.', outcome: 'resolved', sentiment: 'positive', durationSec: 180 },
  { summary: 'Caller had login issues. Walked through password reset successfully.', outcome: 'resolved', sentiment: 'positive', durationSec: 240 },
  { summary: 'Customer wanted to cancel subscription. Transferred to retention team.', outcome: 'transferred', sentiment: 'negative', durationSec: 120 },
];

export async function POST(request) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  // Create seed employees
  const createdEmployees = [];
  for (const emp of SEED_EMPLOYEES) {
    const id = randomUUID().slice(0, 8);
    upsertEmployee({
      id,
      projectId: auth.projectId,
      name: emp.name,
      role: emp.role,
      greeting: emp.greeting,
      prompt: emp.prompt,
      voice: emp.voice,
      enabledFunctions: emp.functions,
    });
    createdEmployees.push({ id, name: emp.name });

    // Also create in Python backend
    try {
      const { readFileSync } = require('fs');
      const { join } = require('path');
      const creds = JSON.parse(readFileSync(join(process.cwd(), 'agent-credentials.json'), 'utf-8'));
      const backendUrl = creds?.app_domain || 'http://localhost:8000';
      await fetch(`${backendUrl}/api/create-employee`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          name: emp.name,
          role: emp.role,
          greeting: emp.greeting,
          prompt: emp.prompt,
          voice: emp.voice,
          enabled_functions: emp.functions,
        }),
      });
    } catch { /* best effort */ }
  }

  // Create seed call logs
  for (let i = 0; i < SEED_CALL_LOGS.length; i++) {
    const log = SEED_CALL_LOGS[i];
    const empIdx = i % createdEmployees.length;
    const hoursAgo = (SEED_CALL_LOGS.length - i) * 2;
    const timestamp = new Date(Date.now() - hoursAgo * 3600000).toISOString();

    insertCallLog({
      id: randomUUID(),
      projectId: auth.projectId,
      employeeId: createdEmployees[empIdx].id,
      employeeName: createdEmployees[empIdx].name,
      timestamp,
      durationSec: log.durationSec,
      summary: log.summary,
      outcome: log.outcome,
      sentiment: log.sentiment,
      topics: ['demo'],
      userMessages: Math.floor(Math.random() * 10) + 3,
      assistantMessages: Math.floor(Math.random() * 10) + 3,
      totalMessages: Math.floor(Math.random() * 20) + 6,
    });
  }

  return Response.json({
    success: true,
    employees: createdEmployees,
    callLogs: SEED_CALL_LOGS.length,
    message: 'Demo data seeded',
  });
}
