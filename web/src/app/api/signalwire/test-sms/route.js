/**
 * Test SMS API
 *
 * Sends a test SMS via SignalWire to verify SMS capability for a phone number.
 *
 * POST body: { fromNumber, toNumber, message? }
 */

import { requireAuth } from '@/app/api/middleware/auth';
import { insertSmsLog } from '@/lib/db';

export async function POST(request) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  try {
    const { fromNumber, toNumber, message } = await request.json();

    if (!fromNumber || !toNumber) {
      return Response.json(
        { error: 'Missing fromNumber or toNumber' },
        { status: 400 }
      );
    }

    const { spaceUrl, projectId, apiToken } = auth;
    const baseUrl = `https://${spaceUrl}`;
    const basicAuth = Buffer.from(`${projectId}:${apiToken}`).toString('base64');

    const smsBody = message || `Test SMS from Sally Sales. Your SMS integration is working! (${new Date().toLocaleTimeString()})`;

    // Send SMS via SignalWire LAML API
    const response = await fetch(
      `${baseUrl}/api/laml/2010-04-01/Accounts/${projectId}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          From: fromNumber,
          To: toNumber,
          Body: smsBody,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Test SMS] Failed:', response.status, errorText);
      return Response.json(
        { error: 'Failed to send SMS: ' + errorText },
        { status: response.status }
      );
    }

    const result = await response.json();

    // Log the SMS
    insertSmsLog({
      fromNumber,
      toNumber,
      body: smsBody,
      status: result.status || 'sent',
      signalwireSid: result.sid,
    });

    console.log(`[Test SMS] Sent from ${fromNumber} to ${toNumber}, SID: ${result.sid}`);

    return Response.json({
      success: true,
      sid: result.sid,
      status: result.status,
      message: `Test SMS sent to ${toNumber}`,
    });
  } catch (error) {
    console.error('[Test SMS] Error:', error);
    return Response.json(
      { error: 'Failed to send test SMS: ' + error.message },
      { status: 500 }
    );
  }
}
