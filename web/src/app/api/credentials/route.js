/**
 * Agent Credentials API Route
 *
 * Returns the current agent credentials including the authenticated SWML URL
 */

import { readFile } from 'fs/promises';
import { join } from 'path';

export async function GET() {
  try {
    const credentialsPath = join(process.cwd(), 'agent-credentials.json');
    const credentialsData = await readFile(credentialsPath, 'utf8');
    const credentials = JSON.parse(credentialsData);

    return new Response(JSON.stringify({
      success: true,
      ...credentials
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
