/**
 * Get Base URL Utility
 *
 * Dynamically determines the base URL of the application from the request headers.
 * This allows the application to work seamlessly across different hosting environments
 * (localhost, ngrok, Replit, production) without hardcoding URLs.
 */

/**
 * Extracts the base URL from the incoming request
 * @param {Request} request - The incoming request object
 * @returns {string} The base URL (e.g., 'https://example.com' or 'https://example.com/demo-ivr')
 */
export function getBaseUrl(request) {
  // Check if there's an environment variable override
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }

  // Extract from request headers
  const url = new URL(request.url);

  // Check for forwarded headers (used by proxies like ngrok, Replit, etc.)
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const forwardedHost = request.headers.get('x-forwarded-host');

  if (forwardedHost) {
    const protocol = forwardedProto || 'https';
    return `${protocol}://${forwardedHost}`;
  }

  // Fallback to the request's origin
  return url.origin;
}

/**
 * Constructs the SWML webhook URL based on the current request
 * @param {Request} request - The incoming request object
 * @returns {string} The full webhook URL (e.g., 'https://example.com/api/swml')
 */
export function getSwmlWebhookUrl(request) {
  const baseUrl = getBaseUrl(request);
  return `${baseUrl}/api/swml`;
}
