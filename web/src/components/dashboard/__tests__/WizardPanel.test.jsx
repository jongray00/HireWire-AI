import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import WizardPanel from '../WizardPanel';

describe('WizardPanel', () => {
  it('renders nothing when inactive and no created agent', () => {
    const { container } = render(<WizardPanel wizardActive={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows listening indicator when active', () => {
    render(<WizardPanel wizardActive={true} />);
    expect(screen.getByText('Listening...')).toBeDefined();
    expect(screen.getByText('Setup Wizard')).toBeDefined();
  });

  it('shows preview card on agent_preview event', () => {
    render(<WizardPanel wizardActive={true} />);

    act(() => {
      window.__wizardEventHandler({
        detail: {
          type: 'agent_preview',
          name: 'Support Bot',
          role: 'Customer Support',
          voice: 'openai.nova',
          functions: ['transfer_to_human', 'end_call'],
        },
      });
    });

    expect(screen.getByText('Support Bot')).toBeDefined();
    expect(screen.getByText('Customer Support')).toBeDefined();
    expect(screen.getByText('Preview')).toBeDefined();
    expect(screen.getByText('transfer to human')).toBeDefined();
  });

  it('shows question overlay on agent_config_question event', () => {
    render(<WizardPanel wizardActive={true} />);

    act(() => {
      window.__wizardEventHandler({
        detail: {
          type: 'agent_config_question',
          question: 'What should the agent handle?',
          options: ['Billing', 'Support', 'Sales'],
          field: 'role',
        },
      });
    });

    expect(screen.getByText('What should the agent handle?')).toBeDefined();
    expect(screen.getByText('Billing')).toBeDefined();
    expect(screen.getByText('Support')).toBeDefined();
    expect(screen.getByText('Sales')).toBeDefined();
  });

  it('shows created confirmation on agent_created event', () => {
    const onCreated = vi.fn();
    render(<WizardPanel wizardActive={true} onAgentCreated={onCreated} />);

    act(() => {
      window.__wizardEventHandler({
        detail: {
          type: 'agent_created',
          employee: { name: 'Sales Bot', role: 'Sales Rep', id: 'abc' },
        },
      });
    });

    expect(screen.getByText('Agent Created!')).toBeDefined();
    expect(screen.getByText('Sales Bot')).toBeDefined();
    expect(onCreated).toHaveBeenCalledWith({ name: 'Sales Bot', role: 'Sales Rep', id: 'abc' });
  });

  it('resets state when wizardActive goes from true to false', () => {
    const { rerender, container } = render(<WizardPanel wizardActive={true} />);

    act(() => {
      window.__wizardEventHandler({
        detail: { type: 'agent_preview', name: 'Test', role: 'Test' },
      });
    });

    expect(screen.getAllByText('Test').length).toBeGreaterThan(0);

    rerender(<WizardPanel wizardActive={false} />);
    expect(container.innerHTML).toBe('');
  });
});
