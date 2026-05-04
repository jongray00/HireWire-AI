/**
 * Get Base URL Utility
 *
 * Dynamically determines the base URL of the application from the request headers.
 * This allows the application to work seamlessly across different hosting environments
 * (localhost, ngrok, Replit, production) without hardcoding URLs.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Read agent credentials from the file written by Python backend
 * @returns {{username: string, password: string, app_domain: string} | null}
 */
function getAgentCredentials() {
  try {
    const credentialsPath = join(process.cwd(), 'agent-credentials.json');
    const credentialsData = readFileSync(credentialsPath, 'utf-8');
    return JSON.parse(credentialsData);
  } catch (error) {
    console.error('[getBaseUrl] Error reading agent credentials:', error.message);
    return null;
  }
}

/**
 * Extracts the base URL from the incoming request
 * @param {Request} request - The incoming request object
 * @returns {string} The base URL (e.g., 'https://example.com' or 'https://example.com/demo-ivr')
 */
export function getBaseUrl(request) {
  // 1. Forwarded headers are the live truth — prefer them over any stored value.
  //    Proxies like ngrok, Cloudflare, Replit, etc. set these on every request.
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const forwardedHost = request.headers.get('x-forwarded-host');

  if (forwardedHost) {
    const protocol = forwardedProto || 'https';
    return `${protocol}://${forwardedHost}`;
  }

  // 2. Environment variable override
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }

  // 3. Stored app_domain from agent-credentials.json (may be stale)
  const credentials = getAgentCredentials();
  if (credentials && credentials.app_domain) {
    return credentials.app_domain;
  }

  // 4. Fallback to the request's origin
  const url = new URL(request.url);
  return url.origin;
}

/**
 * Constructs the SWML webhook URL with embedded credentials
 * @param {Request} request - The incoming request object
 * @param {string} [path=''] - Optional path to append (e.g., '/swml/employee_id/')
 * @returns {string} The full webhook URL (e.g., 'https://username:password@example.com/api/swml')
 */
export function getSwmlWebhookUrl(request, path = '') {
  const credentials = getAgentCredentials();
  const baseUrl = getBaseUrl(request);

  // Construct the full path
  const fullPath = path ? `/api${path}` : '/api/swml';

  // If we have credentials, embed them in the URL
  if (credentials && credentials.username && credentials.password) {
    // Parse the base URL to insert credentials
    const url = new URL(baseUrl);

    // Construct URL with embedded credentials
    // Format: https://username:password@domain/api/swml or /api/swml/{employee_id}
    const authenticatedUrl = `${url.protocol}//${credentials.username}:${credentials.password}@${url.host}${fullPath}`;

    console.log('[getSwmlWebhookUrl] Constructed authenticated webhook URL for host:', url.host);
    return authenticatedUrl;
  }

  // Fallback to URL without credentials
  console.warn('[getSwmlWebhookUrl] No credentials found, using URL without authentication');
  return `${baseUrl}${fullPath}`;
}
