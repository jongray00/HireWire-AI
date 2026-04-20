/**
 * Employee Sync API
 *
 * Persists the employee list from the browser to the SQLite database
 * so that the SWML proxy can lazily re-create agents in the Python
 * backend after a restart without needing the browser to be open.
 *
 * POST body: { employees: [...], projectId: string }
 * GET: returns the current server-side employee list
 */

import {
  getAllEmployees,
  getEmployeesByProject,
  upsertEmployee,
  employeeRowToJson,
} from '@/lib/db';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');

  const rows = projectId ? getEmployeesByProject(projectId) : getAllEmployees();
  const employees = rows.map(employeeRowToJson);

  return Response.json({ success: true, employees });
}

export async function POST(request) {
  try {
    const { employees, projectId } = await request.json();

    if (!Array.isArray(employees)) {
      return Response.json(
        { error: 'employees must be an array' },
        { status: 400 },
      );
    }

    // Default projectId for backwards compatibility
    const pid = projectId || 'default';

    for (const emp of employees) {
      upsertEmployee({
        id: emp.id,
        projectId: pid,
        name: emp.name,
        role: emp.role,
        greeting: emp.greeting,
        prompt: emp.prompt,
        voice: emp.voice,
        language: emp.language,
        temperature: emp.temperature,
        speechHints: emp.speech_hints,
        enabledFunctions: emp.enabled_functions,
        transferNumber: emp.transfer_number,
        transferFrom: emp.transfer_from,
        smsFromNumber: emp.sms_from_number,
        phoneNumber: emp.phone_number,
        videoIdleUrl: emp.video_idle_url,
        videoTalkingUrl: emp.video_talking_url,
        resourceId: emp.resourceId,
        resourceName: emp.resourceName,
        callFabricAddress: emp.callFabricAddress,
        webhookUrl: emp.webhookUrl,
        status: emp.status || 'active',
      });
    }

    console.log(`[Employee Sync] Persisted ${employees.length} employee(s) to database`);
    return Response.json({ success: true, count: employees.length });
  } catch (error) {
    console.error('[Employee Sync] Error:', error);
    return Response.json(
      { error: 'Failed to sync employees: ' + error.message },
      { status: 500 },
    );
  }
}
