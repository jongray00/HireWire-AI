/**
 * List Resources Route
 *
 * This route fetches all dialable resources from SignalWire Fabric API
 * and categorizes them by type (SWML Scripts, AI Agents, Conference Rooms, etc.)
 */

export async function POST(request) {
  try {
    const { credentials } = await request.json();

    if (!credentials) {
      return Response.json(
        { error: 'Missing credentials' },
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

    console.log('Fetching resources from SignalWire...');

    // Fetch resources from SignalWire Fabric API
    const resourcesResponse = await fetch(`${baseUrl}/api/fabric/resources`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/json'
      }
    });

    if (!resourcesResponse.ok) {
      const errorText = await resourcesResponse.text();
      console.error('Failed to fetch resources:', resourcesResponse.status, errorText);
      return Response.json(
        { error: 'Failed to fetch resources from SignalWire' },
        { status: resourcesResponse.status }
      );
    }

    const resourcesData = await resourcesResponse.json();
    console.log('Resources fetched:', resourcesData.data?.length || 0);

    // Categorize resources by type
    const categorized = {
      swml_webhooks: [],
      swml_scripts: [],
      ai_agents: [],
      conference_rooms: [],
      subscribers: [],
      sip_endpoints: [],
      other: []
    };

    // Define dialable resource types based on the API spec
    const dialableTypes = [
      'swml_webhook',
      'swml_script',
      'ai_agent',
      'conference_room',
      'subscriber',
      'sip_endpoint',
      'call_flow',
      'relay_application'
    ];

    const resources = resourcesData.data || [];

    resources.forEach(resource => {
      if (!dialableTypes.includes(resource.type)) {
        return; // Skip non-dialable resources
      }

      const resourceInfo = {
        id: resource.id,
        display_name: resource.display_name,
        type: resource.type,
        created_at: resource.created_at,
        updated_at: resource.updated_at,
        // Include type-specific data
        details: resource[resource.type] || null
      };

      switch (resource.type) {
        case 'swml_webhook':
          categorized.swml_webhooks.push(resourceInfo);
          break;
        case 'swml_script':
          categorized.swml_scripts.push(resourceInfo);
          break;
        case 'ai_agent':
          categorized.ai_agents.push(resourceInfo);
          break;
        case 'conference_room':
          categorized.conference_rooms.push(resourceInfo);
          break;
        case 'subscriber':
          categorized.subscribers.push(resourceInfo);
          break;
        case 'sip_endpoint':
          categorized.sip_endpoints.push(resourceInfo);
          break;
        default:
          categorized.other.push(resourceInfo);
      }
    });

    // Sort each category by updated_at (most recent first)
    Object.keys(categorized).forEach(key => {
      categorized[key].sort((a, b) =>
        new Date(b.updated_at) - new Date(a.updated_at)
      );
    });

    return Response.json({
      success: true,
      total: resources.length,
      categorized,
      all: resources.filter(r => dialableTypes.includes(r.type))
    });

  } catch (error) {
    console.error('Error listing resources:', error);
    return Response.json(
      { error: 'Failed to list resources: ' + error.message },
      { status: 500 }
    );
  }
}
