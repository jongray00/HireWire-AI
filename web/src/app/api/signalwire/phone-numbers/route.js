/**
 * Phone Numbers API
 *
 * GET: Lists all purchased phone numbers from the SignalWire account
 *      with their capabilities (voice, SMS) and current assignments.
 */

import { requireAuth } from '@/app/api/middleware/auth';
import { getAllEmployees } from '@/lib/db';

export async function GET(request) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const { spaceUrl, projectId, apiToken } = auth;
  const baseUrl = `https://${spaceUrl}`;
  const basicAuth = Buffer.from(`${projectId}:${apiToken}`).toString('base64');

  try {
    const response = await fetch(
      `${baseUrl}/api/laml/2010-04-01/Accounts/${projectId}/IncomingPhoneNumbers.json`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Phone Numbers] Failed to list:', response.status, errorText);
      return Response.json(
        { error: 'Failed to list phone numbers' },
        { status: response.status }
      );
    }

    const data = await response.json();
    const numbers = (data.incoming_phone_numbers || []).map((num) => ({
      sid: num.sid,
      phoneNumber: num.phone_number,
      friendlyName: num.friendly_name,
      capabilities: {
        voice: num.capabilities?.voice ?? true,
        sms: num.capabilities?.sms ?? true,
        mms: num.capabilities?.mms ?? false,
      },
    }));

    // Check which numbers are assigned to employees
    const employees = getAllEmployees();
    const assignedMap = {};
    for (const emp of employees) {
      if (emp.phone_number) {
        assignedMap[emp.phone_number] = {
          employeeId: emp.id,
          employeeName: emp.name,
        };
      }
    }

    const enriched = numbers.map((num) => ({
      ...num,
      assignedTo: assignedMap[num.phoneNumber] || null,
    }));

    return Response.json({
      success: true,
      phoneNumbers: enriched,
      total: enriched.length,
    });
  } catch (error) {
    console.error('[Phone Numbers] Error:', error);
    return Response.json(
      { error: 'Failed to list phone numbers: ' + error.message },
      { status: 500 }
    );
  }
}
