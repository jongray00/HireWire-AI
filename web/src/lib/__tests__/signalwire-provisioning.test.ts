// @vitest-environment node
import { describe, expect, it, beforeAll, afterEach, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

import {
  ensureWizardAgent,
  ensureHireWireAgent,
  ProvisioningError,
} from '../signalwire-provisioning';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('signalwire-provisioning', () => {
  it('creates wizard-agent when none exists', async () => {
    let createPayload: any;
    server.use(
      http.get('https://acme.signalwire.com/api/fabric/resources', () =>
        HttpResponse.json({ data: [] }),
      ),
      http.post(
        'https://acme.signalwire.com/api/fabric/resources/swml_webhooks',
        async ({ request }) => {
          createPayload = await request.json();
          return HttpResponse.json(
            { id: 'wizard-resource-id', name: 'wizard-agent' },
            { status: 201 },
          );
        },
      ),
    );
    const result = await ensureWizardAgent({
      spaceUrl: 'acme.signalwire.com',
      signalwireProjectId: 'sw-proj-1',
      apiToken: 'PT_real',
      appDomain: 'https://app.hirewire.test',
      basicAuthUser: 'proj_aaaa1111',
      basicAuthPassword: 'pw-aaaa',
    });
    expect(result.resourceId).toBe('wizard-resource-id');
    expect(result.action).toBe('created');
    expect(createPayload.primary_request_url).toContain('https://app.hirewire.test/swml/wizard-agent');
    expect(createPayload.username).toBe('proj_aaaa1111');
    expect(createPayload.password).toBe('pw-aaaa');
  });

  it('reuses existing wizard-agent when URL matches', async () => {
    server.use(
      http.get('https://acme.signalwire.com/api/fabric/resources', () =>
        HttpResponse.json({
          data: [
            {
              id: 'existing-id',
              name: 'wizard-agent',
              swml_webhook: {
                primary_request_url: 'https://app.hirewire.test/swml/wizard-agent',
              },
            },
          ],
        }),
      ),
      http.patch(
        'https://acme.signalwire.com/api/fabric/resources/swml_webhooks/existing-id',
        () => HttpResponse.json({ id: 'existing-id' }),
      ),
    );
    const result = await ensureWizardAgent({
      spaceUrl: 'acme.signalwire.com',
      signalwireProjectId: 'sw-proj-1',
      apiToken: 'PT_real',
      appDomain: 'https://app.hirewire.test',
      basicAuthUser: 'proj_aaaa1111',
      basicAuthPassword: 'pw-aaaa',
    });
    expect(result.resourceId).toBe('existing-id');
    expect(result.action).toBe('rotated');
  });

  it('PATCHes when URL is stale', async () => {
    let patched: any;
    server.use(
      http.get('https://acme.signalwire.com/api/fabric/resources', () =>
        HttpResponse.json({
          data: [
            {
              id: 'stale-id',
              name: 'wizard-agent',
              swml_webhook: {
                primary_request_url: 'https://old-host/swml/wizard-agent',
              },
            },
          ],
        }),
      ),
      http.patch(
        'https://acme.signalwire.com/api/fabric/resources/swml_webhooks/stale-id',
        async ({ request }) => {
          patched = await request.json();
          return HttpResponse.json({ id: 'stale-id' });
        },
      ),
    );
    const result = await ensureWizardAgent({
      spaceUrl: 'acme.signalwire.com',
      signalwireProjectId: 'sw-proj-1',
      apiToken: 'PT_real',
      appDomain: 'https://app.hirewire.test',
      basicAuthUser: 'proj_aaaa1111',
      basicAuthPassword: 'pw-rotated',
    });
    expect(result.resourceId).toBe('stale-id');
    expect(result.action).toBe('patched');
    expect(patched.primary_request_url).toContain('https://app.hirewire.test/swml/wizard-agent');
  });

  it('propagates 5xx errors as ProvisioningError', async () => {
    server.use(
      http.get('https://acme.signalwire.com/api/fabric/resources', () =>
        HttpResponse.json({ error: 'boom' }, { status: 503 }),
      ),
    );
    await expect(
      ensureWizardAgent({
        spaceUrl: 'acme.signalwire.com',
        signalwireProjectId: 'sw-proj-1',
        apiToken: 'PT_real',
        appDomain: 'https://app.hirewire.test',
        basicAuthUser: 'proj_aaaa1111',
        basicAuthPassword: 'pw',
      }),
    ).rejects.toThrow(ProvisioningError);
  }, 15000);  // allow time for retry backoff

  it('ensureHireWireAgent creates a Call Fabric address pointing at /swml/{employee}', async () => {
    let createPayload: any;
    server.use(
      http.get('https://acme.signalwire.com/api/fabric/resources', () =>
        HttpResponse.json({ data: [] }),
      ),
      http.post(
        'https://acme.signalwire.com/api/fabric/resources/swml_webhooks',
        async ({ request }) => {
          createPayload = await request.json();
          return HttpResponse.json(
            { id: 'hirewire-resource-id', name: 'hirewire-agent' },
            { status: 201 },
          );
        },
      ),
    );
    const result = await ensureHireWireAgent({
      spaceUrl: 'acme.signalwire.com',
      signalwireProjectId: 'sw-proj-1',
      apiToken: 'PT_real',
      appDomain: 'https://app.hirewire.test',
      basicAuthUser: 'proj_aaaa1111',
      basicAuthPassword: 'pw-aaaa',
    });
    expect(result.resourceId).toBe('hirewire-resource-id');
    expect(createPayload.name).toBe('hirewire-agent');
    expect(createPayload.primary_request_url).toContain('/swml/');
  });
});
