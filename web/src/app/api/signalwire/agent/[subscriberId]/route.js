export async function GET(request, { params }) {
  try {
    const { subscriberId } = params;

    // Retrieve stored SWML configuration
    const config = getSWMLConfig(subscriberId);

    if (!config) {
      return Response.json(
        { error: 'Agent configuration not found' },
        { status: 404 }
      );
    }

    // Return SWML as plain text with correct content type
    return new Response(config.swml, {
      headers: {
        'Content-Type': 'application/x-yaml',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    console.error('Error serving SWML:', error);
    return Response.json(
      { error: 'Failed to serve agent configuration' },
      { status: 500 }
    );
  }
}

export async function POST(request, { params }) {
  try {
    const { subscriberId } = params;
    const body = await request.json();

    console.log('SWAIG function call received:', body);

    const { function: functionName, argument: args } = body;

    // Route to appropriate function handler
    switch (functionName) {
      case 'transfer_to_human':
        return handleTransfer(args, subscriberId);

      case 'take_message':
        return handleTakeMessage(args, subscriberId);

      case 'send_summary_sms':
        return handleSendSms(args, subscriberId);

      case 'schedule_callback':
        return handleScheduleCallback(args, subscriberId);

      case 'check_business_hours':
        return handleCheckBusinessHours(subscriberId);

      default:
        return Response.json({
          response: `I'm sorry, I don't have access to that function right now. Is there anything else I can help with?`,
        });
    }

  } catch (error) {
    console.error('Error handling SWAIG function:', error);
    return Response.json({
      response: "I apologize, but I'm experiencing a technical issue. Let me try to help you another way.",
    });
  }
}

function getSWMLConfig(subscriberId) {
  global.swmlConfigs = global.swmlConfigs || new Map();
  return global.swmlConfigs.get(subscriberId);
}

function handleTransfer(args, subscriberId) {
  const department = args?.department || 'general';
  const reason = args?.reason || 'Requested human assistance';

  console.log(`Transfer requested - Department: ${department}, Reason: ${reason}`);

  // The actual transfer is handled by the Python backend via SwaigFunctionResult.connect()
  // This frontend handler is a fallback for demo-ivr SWML agents only
  return Response.json({
    response: `I'll connect you with a representative from our ${department} team. Please hold while I transfer your call.`,
  });
}

function handleTakeMessage(args, subscriberId) {
  const callerName = args?.caller_name || 'Unknown';
  const callbackNumber = args?.callback_number || 'not provided';
  const message = args?.message || '';

  console.log(`Message taken from ${callerName}: ${message}`);

  return Response.json({
    response: `I've taken your message, ${callerName}. Someone from our team will get back to you shortly.`,
  });
}

function handleSendSms(args, subscriberId) {
  const phoneNumber = args?.phone_number || '';
  const summary = args?.summary || '';

  console.log(`SMS summary requested to ${phoneNumber}`);

  // The actual SMS is handled by the Python backend via SwaigFunctionResult.send_sms()
  return Response.json({
    response: phoneNumber
      ? `I've sent a text summary to ${phoneNumber}.`
      : `I need your phone number to send the summary. Could you please provide it?`,
  });
}

function handleScheduleCallback(args, subscriberId) {
  const callerName = args?.caller_name || '';
  const preferredTime = args?.preferred_time || '';

  console.log(`Callback scheduled for ${callerName} at ${preferredTime}`);

  return Response.json({
    response: `I've scheduled a callback for ${callerName} at ${preferredTime}. Someone from our team will reach out to you then.`,
  });
}

function handleCheckBusinessHours(subscriberId) {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0=Sunday, 6=Saturday

  const isOpen = day >= 1 && day <= 5 && hour >= 9 && hour < 18;

  return Response.json({
    response: isOpen
      ? "We are currently open. Our business hours are Monday through Friday, 9 AM to 6 PM."
      : "We are currently closed. Our business hours are Monday through Friday, 9 AM to 6 PM. I can take a message or schedule a callback for when we reopen.",
  });
}

// Handle CORS preflight requests
export async function OPTIONS(request) {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
