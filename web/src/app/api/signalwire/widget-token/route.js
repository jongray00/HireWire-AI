export async function POST(request) {
  try {
    const { credentials, subscriberId } = await request.json();

    if (!credentials || !subscriberId) {
      return Response.json(
        { error: "Missing required parameters" },
        { status: 400 },
      );
    }

    const { spaceUrl, projectId, apiToken } = credentials;
    const normalizedSpaceUrl = spaceUrl
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");
    const baseUrl = `https://${normalizedSpaceUrl}`;

    const agentUrl = `${process.env.APP_URL || "http://localhost:3000"}/api/signalwire/agent/${subscriberId}`;

    console.log("Creating Call Fabric subscriber token for widget:", {
      subscriberId,
      destination: `/private/${subscriberId}`,
    });

    // Create a Call Fabric subscriber - this is what the call-widget needs
    const fabricResponse = await fetch(`${baseUrl}/api/fabric/subscribers`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${projectId}:${apiToken}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channels: {
          calling: {
            to: `/private/${subscriberId}`,
          },
        },
      }),
    });

    if (!fabricResponse.ok) {
      const errorText = await fabricResponse.text();
      console.error(
        "Fabric subscriber creation failed:",
        fabricResponse.status,
        errorText,
      );
      return Response.json(
        {
          error: "Failed to create widget token",
          details: errorText,
          hint: "Make sure your SignalWire credentials have Call Fabric permissions",
        },
        { status: fabricResponse.status },
      );
    }

    const fabricData = await fabricResponse.json();
    console.log("Successfully created Call Fabric subscriber token");

    return Response.json({
      token: fabricData.token,
      agentUrl,
      subscriberId,
    });
  } catch (error) {
    console.error("Error generating widget token:", error);
    return Response.json(
      { error: "Failed to generate widget token: " + error.message },
      { status: 500 },
    );
  }
}
