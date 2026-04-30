/**
 * Wizard Agent Real-Time Event Protocol
 *
 * These event types are sent by the Python wizard agent via swml_user_event()
 * and received in the browser on the client.on('user_event', ...) channel.
 */

export const WIZARD_EVENTS = {
  AGENT_PREVIEW: 'agent_preview',
  AGENT_CREATED: 'agent_created',
  AGENT_UPDATED: 'agent_updated',
  AGENT_CONFIG_QUESTION: 'agent_config_question',
  AGENT_READY: 'agent_ready',
  WIZARD_CHECKPOINT: 'wizard_checkpoint',
  WIZARD_SAID: 'wizard_said',
};

/**
 * Parse a user_event payload and extract wizard event data if present.
 * @param {object} event - The raw event from SignalWire
 * @returns {{ type: string, data: object } | null}
 */
export function parseWizardEvent(event) {
  const detail = event?.detail || event?.call_state?.user_input || event;
  if (!detail?.type) return null;

  const knownTypes = Object.values(WIZARD_EVENTS);
  if (!knownTypes.includes(detail.type)) return null;

  return { type: detail.type, data: detail };
}
