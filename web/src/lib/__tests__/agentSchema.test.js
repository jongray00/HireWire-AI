import { describe, it, expect } from 'vitest';
import { validateAgentConfig, configToBackendPayload, DEFAULT_AGENT_CONFIG, AVAILABLE_FUNCTIONS } from '../agentSchema';

describe('validateAgentConfig', () => {
  it('rejects empty config', () => {
    const result = validateAgentConfig({});
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('name is required');
    expect(result.errors).toContain('prompt is required');
  });

  it('accepts valid config', () => {
    const result = validateAgentConfig({
      name: 'Support Agent',
      prompt: 'You are a helpful support agent.',
    });
    expect(result.valid).toBe(true);
  });

  it('rejects temperature out of range', () => {
    const result = validateAgentConfig({
      name: 'Agent',
      prompt: 'Test',
      temperature: 1.5,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('temperature must be between 0 and 1');
  });

  it('rejects non-array functions', () => {
    const result = validateAgentConfig({
      name: 'Agent',
      prompt: 'Test',
      functions: 'not-an-array',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('functions must be an array');
  });
});

describe('configToBackendPayload', () => {
  it('converts frontend config to Python backend format', () => {
    const config = {
      name: 'Sales Bot',
      role: 'Sales',
      prompt: 'Sell things',
      voice: 'openai.alloy',
      functions: ['transfer_to_human', 'send_email'],
      businessHours: { start: 10, end: 17, days: [1, 2, 3] },
      emailConfig: { sendgridKey: 'sg-key', fromAddress: 'a@b.com', fromName: 'Bot' },
    };

    const payload = configToBackendPayload(config, { id: 'abc', projectId: 'proj-1' });

    expect(payload.name).toBe('Sales Bot');
    expect(payload.enabled_functions).toEqual(['transfer_to_human', 'send_email']);
    expect(payload.business_hours_start).toBe(10);
    expect(payload.business_hours_end).toBe(17);
    expect(payload.business_days).toEqual([1, 2, 3]);
    expect(payload.sendgrid_api_key).toBe('sg-key');
    expect(payload.id).toBe('abc');
    expect(payload.project_id).toBe('proj-1');
  });

  it('uses defaults for missing fields', () => {
    const payload = configToBackendPayload({ name: 'X', prompt: 'Y' });
    expect(payload.voice).toBe('openai.nova');
    expect(payload.temperature).toBe(0.7);
    expect(payload.enabled_functions).toEqual([]);
  });
});

describe('AVAILABLE_FUNCTIONS', () => {
  it('has 6 functions', () => {
    expect(AVAILABLE_FUNCTIONS).toHaveLength(6);
  });

  it('each function has id, label, description', () => {
    for (const fn of AVAILABLE_FUNCTIONS) {
      expect(fn.id).toBeDefined();
      expect(fn.label).toBeDefined();
      expect(fn.description).toBeDefined();
    }
  });
});
