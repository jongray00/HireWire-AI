/**
 * Domain Settings API
 *
 * GET: Read current app_domain from database (falls back to agent-credentials.json)
 * POST: Update app_domain in database
 */

import { getSetting, setSetting } from '@/lib/db';
import { readFile } from 'fs/promises';
import { join } from 'path';

export async function GET() {
  try {
    // Try database first
    let domain = getSetting('app_domain');

    // Fall back to agent-credentials.json for migration period
    if (!domain) {
      try {
        const credentialsPath = join(process.cwd(), 'agent-credentials.json');
        const data = await readFile(credentialsPath, 'utf8');
        const credentials = JSON.parse(data);
        if (credentials.app_domain) {
          domain = credentials.app_domain;
          // Migrate to DB
          setSetting('app_domain', domain);
        }
      } catch {
        // No fallback file either
      }
    }

    return Response.json({
      success: true,
      domain: domain || null,
    });
  } catch (error) {
    console.error('[Domain Settings] Error reading domain:', error.message);
    return Response.json(
      { error: 'Failed to read domain settings: ' + error.message },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const { domain } = await request.json();

    if (!domain) {
      return Response.json(
        { error: 'Missing domain parameter' },
        { status: 400 }
      );
    }

    // Validate URL format
    try {
      const url = new URL(domain);
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('URL must use http or https protocol');
      }
    } catch (e) {
      return Response.json(
        { error: 'Invalid URL format: ' + e.message },
        { status: 400 }
      );
    }

    const cleanDomain = domain.replace(/\/+$/, '');

    setSetting('app_domain', cleanDomain);

    // Also update agent-credentials.json to keep backward compatibility
    try {
      const credentialsPath = join(process.cwd(), 'agent-credentials.json');
      let credentials = {};
      try {
        const data = await readFile(credentialsPath, 'utf8');
        credentials = JSON.parse(data);
      } catch { /* File doesn't exist yet */ }

      credentials.app_domain = cleanDomain;
      credentials.timestamp = new Date().toISOString();
      if (credentials.username && credentials.password) {
        credentials.swml_url = `${cleanDomain}/api/swml`;
      }

      const { writeFile } = await import('fs/promises');
      await writeFile(credentialsPath, JSON.stringify(credentials, null, 2));
    } catch {
      // Non-critical — DB is the source of truth now
    }

    console.log('[Domain Settings] Updated app_domain to:', cleanDomain);

    return Response.json({
      success: true,
      domain: cleanDomain,
    });
  } catch (error) {
    console.error('[Domain Settings] Error updating domain:', error.message);
    return Response.json(
      { error: 'Failed to update domain: ' + error.message },
      { status: 500 }
    );
  }
}
