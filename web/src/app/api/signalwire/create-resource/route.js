/**
 * Create Resource Route
 *
 * This route creates a new SWML Script resource in SignalWire
 * with the webhook pointing to the Python backend
 */

const AGENT_BACKEND_URL = process.env.AGENT_BACKEND_URL || 'http://localhost:3030';

export async function POST(request) {
  try {
    const { displayName, credentials, prompt } = await request.json();

    if (!displayName || !credentials) {
      return Response.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    const { spaceUrl, projectId, apiToken } = credentials;

    if (!spaceUrl || !projectId || !apiToken) {
      return Response.json(
        { error: 'Missing required credentials' },
        { status: 400 }
      );
    }

    const normalizedSpaceUrl = spaceUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const baseUrl = `https://${normalizedSpaceUrl}`;
    const basicAuth = Buffer.from(`${projectId}:${apiToken}`).toString('base64');

    // The webhook URL pointing to SWML endpoint
    // SignalWire doesn't support BasicAuth in webhook URLs, so we use unauthenticated URL
    // The Next.js proxy at /api/swml will add BasicAuth headers before forwarding to Python backend
    const webhookUrl = `https://jonnykarate.ngrok.io/api/swml`;

    console.log('Creating new SWML Script resource:', displayName);

    // If prompt is provided, update Python backend first
    if (prompt) {
      console.log('Updating Python backend with prompt...');
      try {
        const backendResponse = await fetch(`${AGENT_BACKEND_URL}/api/update-config`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ prompt })
        });

        if (!backendResponse.ok) {
          console.error('Failed to update Python backend:', await backendResponse.text());
        } else {
          console.log('Python backend updated successfully');
        }
      } catch (error) {
        console.error('Error updating Python backend:', error);
        // Continue even if backend update fails
      }
    }

    // Create SWML Webhook resource in SignalWire
    // Use fixed name "sally-sales" for consistent addressing at /public/sally-sales
    const createResponse = await fetch(`${baseUrl}/api/fabric/resources/swml_webhooks`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'sally-sales', // Fixed name for addressing
        display_name: displayName, // Human-readable name for UI
        primary_request_url: webhookUrl,
        primary_request_method: 'GET'
      })
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error('Failed to create SWML Webhook resource:', createResponse.status, errorText);
      return Response.json(
        { error: 'Failed to create SWML Webhook resource: ' + errorText },
        { status: createResponse.status }
      );
    }

    const resource = await createResponse.json();
    console.log('SWML Webhook resource created successfully:', resource.id);

    return Response.json({
      success: true,
      resource,
      webhookUrl,
      message: 'SWML Webhook resource created successfully'
    });

  } catch (error) {
    console.error('Error creating resource:', error);
    return Response.json(
      { error: 'Failed to create resource: ' + error.message },
      { status: 500 }
    );
  }
}
