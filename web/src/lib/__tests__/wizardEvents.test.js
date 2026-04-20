import { describe, it, expect } from 'vitest';
import { WIZARD_EVENTS, parseWizardEvent } from '../wizardEvents';

describe('WIZARD_EVENTS', () => {
  it('has all expected event types', () => {
    expect(WIZARD_EVENTS.AGENT_PREVIEW).toBe('agent_preview');
    expect(WIZARD_EVENTS.AGENT_CREATED).toBe('agent_created');
    expect(WIZARD_EVENTS.AGENT_UPDATED).toBe('agent_updated');
    expect(WIZARD_EVENTS.AGENT_CONFIG_QUESTION).toBe('agent_config_question');
    expect(WIZARD_EVENTS.AGENT_READY).toBe('agent_ready');
  });
});

describe('parseWizardEvent', () => {
  it('parses agent_preview event from detail', () => {
    const event = {
      detail: { type: 'agent_preview', name: 'Support Bot', role: 'Support' },
    };
    const parsed = parseWizardEvent(event);
    expect(parsed.type).toBe('agent_preview');
    expect(parsed.data.name).toBe('Support Bot');
  });

  it('parses agent_config_question event', () => {
    const event = {
      detail: { type: 'agent_config_question', question: 'Pick a voice', options: ['Nova', 'Alloy'] },
    };
    const parsed = parseWizardEvent(event);
    expect(parsed.type).toBe('agent_config_question');
    expect(parsed.data.options).toEqual(['Nova', 'Alloy']);
  });

  it('returns null for unknown event types', () => {
    const event = { detail: { type: 'unknown_event' } };
    expect(parseWizardEvent(event)).toBeNull();
  });

  it('returns null for events without type', () => {
    expect(parseWizardEvent({})).toBeNull();
    expect(parseWizardEvent(null)).toBeNull();
    expect(parseWizardEvent({ detail: {} })).toBeNull();
  });

  it('handles flat event objects (no detail wrapper)', () => {
    const event = { type: 'agent_ready', employee_id: 'abc123' };
    const parsed = parseWizardEvent(event);
    expect(parsed.type).toBe('agent_ready');
    expect(parsed.data.employee_id).toBe('abc123');
  });
});
