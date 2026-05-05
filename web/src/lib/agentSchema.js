/**
 * Agent Configuration Schema
 *
 * Shared contract between the wizard agent, employee form UI,
 * unified /api/agents endpoints, and the Python backend.
 */

/** All available SWAIG functions an agent can use */
export const AVAILABLE_FUNCTIONS = [
  { id: 'transfer_to_human', label: 'Transfer to Human', description: 'Transfer the call to a live agent' },
  { id: 'send_summary_sms', label: 'Send SMS Summary', description: 'Text the caller a summary after the call' },
  { id: 'schedule_callback', label: 'Schedule Callback', description: 'Schedule a callback for the caller' },
  { id: 'check_business_hours', label: 'Check Business Hours', description: 'Check if the business is currently open' },
  { id: 'collect_customer_info', label: 'Collect Customer Info', description: 'Gather contact details from the caller' },
  { id: 'send_email', label: 'Send Email', description: 'Send a follow-up email via SendGrid' },
];

/** Default agent configuration */
export const DEFAULT_AGENT_CONFIG = {
  name: '',
  role: 'Assistant',
  greeting: 'Hello, how can I help you today?',
  prompt: '',
  voice: 'openai.nova',
  language: 'en-US',
  temperature: 0.7,
  functions: [],
  transferNumber: '',
  smsFromNumber: '',
  businessHours: { start: 9, end: 18, days: [0, 1, 2, 3, 4] },
  knowledgeDocs: [],
  emailConfig: { sendgridKey: '', fromAddress: '', fromName: '' },
};

/**
 * Validate an agent config object. Returns { valid: true } or { valid: false, errors: string[] }.
 */
export function validateAgentConfig(config) {
  const errors = [];
  if (!config.name || typeof config.name !== 'string' || config.name.trim().length === 0) {
    errors.push('name is required');
  }
  if (!config.prompt || typeof config.prompt !== 'string' || config.prompt.trim().length === 0) {
    errors.push('prompt is required');
  }
  if (config.temperature !== undefined && (config.temperature < 0 || config.temperature > 1)) {
    errors.push('temperature must be between 0 and 1');
  }
  if (config.functions && !Array.isArray(config.functions)) {
    errors.push('functions must be an array');
  }
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/**
 * Convert a frontend agent config to the Python backend's expected format.
 */
export function configToBackendPayload(config, extra = {}) {
  return {
    id: extra.id || undefined,
    name: config.name,
    role: config.role || 'Assistant',
    greeting: config.greeting || 'Hello, how can I help you today?',
    prompt: config.prompt,
    voice: config.voice || 'openai.nova',
    language: config.language || 'en-US',
    temperature: config.temperature ?? 0.7,
    enabled_functions: config.functions || [],
    transfer_number: config.transferNumber || '',
    sms_from_number: config.smsFromNumber || '',
    business_hours_start: config.businessHours?.start ?? 9,
    business_hours_end: config.businessHours?.end ?? 18,
    business_days: config.businessHours?.days ?? [0, 1, 2, 3, 4],
    documents: config.knowledgeDocs || [],
    sendgrid_api_key: config.emailConfig?.sendgridKey || '',
    email_from_address: config.emailConfig?.fromAddress || '',
    email_from_name: config.emailConfig?.fromName || '',
    space_name: extra.spaceName || '',
    project_id: extra.projectId || '',
    token: extra.token || '',
  };
}
