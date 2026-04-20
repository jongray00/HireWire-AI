/**
 * Demo Reset — Clears all data for a fresh demo
 * POST /api/demo/reset
 */

import { getDb } from '@/lib/db';
import { requireAuth } from '@/app/api/middleware/auth';

export async function POST(request) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const db = getDb();

  // Delete all data for this project
  db.prepare('DELETE FROM call_actions WHERE employee_id IN (SELECT id FROM employees WHERE project_id = ?)').run(auth.projectId);
  db.prepare('DELETE FROM sms_logs WHERE employee_id IN (SELECT id FROM employees WHERE project_id = ?)').run(auth.projectId);
  db.prepare('DELETE FROM call_logs WHERE project_id = ?').run(auth.projectId);
  db.prepare('DELETE FROM employees WHERE project_id = ?').run(auth.projectId);

  // Also clear Python backend employees
  try {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const creds = JSON.parse(readFileSync(join(process.cwd(), 'agent-credentials.json'), 'utf-8'));
    const backendUrl = creds?.app_domain || 'http://localhost:8000';
    const listRes = await fetch(`${backendUrl}/api/list-employees`);
    if (listRes.ok) {
      const { employees } = await listRes.json();
      for (const emp of employees) {
        if (emp.id !== 'wizard') {
          await fetch(`${backendUrl}/api/employee/${emp.id}`, { method: 'DELETE' });
        }
      }
    }
  } catch (err) {
    console.warn('[demo/reset] Could not clear Python backend:', err.message);
  }

  return Response.json({ success: true, message: 'Demo data cleared' });
}
