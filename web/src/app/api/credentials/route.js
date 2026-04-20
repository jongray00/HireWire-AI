/**
 * Agent Credentials API Route
 *
 * Returns the current agent credentials with dynamically constructed SWML URL
 * based on the current request domain (not hardcoded).
 * Falls back to agent-credentials.json for the Python backend's BasicAuth creds.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { getSwmlWebhookUrl } from '@/app/api/utils/getBaseUrl.js';
import { getSetting } from '@/lib/db';

export async function GET(request) {
  try {
    const credentialsPath = join(process.cwd(), 'agent-credentials.json');
    const credentialsData = await readFile(credentialsPath, 'utf8');
    const credentials = JSON.parse(credentialsData);

    // Dynamically construct SWML URL from current request
    const swmlUrl = getSwmlWebhookUrl(request);

    console.log('[Credentials API] Dynamically constructed SWML URL:', swmlUrl);

    return new Response(JSON.stringify({
      success: true,
      username: credentials.username,
      password: credentials.password,
      timestamp: credentials.timestamp,
      swml_url: swmlUrl
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('[Credentials API] Error reading credentials:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Failed to read credentials',
      message: error.message
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
}
