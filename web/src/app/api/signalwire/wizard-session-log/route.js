/**
 * Wizard Session Log Endpoint
 *
 * Receives the full lifecycle of a wizard call from the WizardBanner once the
 * call ends — events, transcript, debug log, errors, timing — and persists it
 * to the call_logs table so every wizard call shows up in the Call Logs page,
 * regardless of whether SignalWire fired its own post-prompt webhook.
 *
 * The call_logs row uses the per-project wizard pseudo-employee
 * (wizard-${projectId}) as the FK target.
 */

import { insertCallLog } from '@/lib/db';
import { requireAuth } from '@/app/api/middleware/auth';

function summarizeSession(payload) {
  const events = payload.events || [];
  const created = events.find((e) => e?.data?.type === 'agent_created');
  const ready = events.find((e) => e?.data?.type === 'agent_ready');
  const previews = events.filter((e) => e?.data?.type === 'agent_preview').length;
  const questions = events.filter((e) => e?.data?.type === 'agent_config_question').length;
  const checkpoints = events
    .filter((e) => e?.data?.type === 'wizard_checkpoint')
    .map((e) => e.data.stage);

  if (created) {
    const name = created.data?.employee?.name || 'an agent';
    return `Wizard built ${name} (${checkpoints.length}/4 checkpoints; ${previews} preview updates).`;
  }
  if (questions > 0 || previews > 0) {
    return `Wizard call ended before agent was created (${previews} preview updates, ${questions} questions, ${checkpoints.length}/4 checkpoints).`;
  }
  if (payload.error) {
    return `Wizard call failed: ${payload.error}`;
  }
  return `Wizard call ended without any wizard activity (likely connection or audio issue).`;
}

function determineOutcome(payload) {
  const events = payload.events || [];
  if (events.some((e) => e?.data?.type === 'agent_created')) return 'resolved';
  if (payload.error) return 'follow_up_needed';
  return 'abandoned';
}

export async function POST(request) {
  try {
    const payload = await request.json();
    const auth = await requireAuth(request);
    if (auth.error) {
      return Response.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const projectId = auth.projectId;

    const startedAt = payload.startedAt || new Date().toISOString();
    const endedAt = payload.endedAt || new Date().toISOString();
    const durationSec = Math.max(
      0,
      Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000),
    );

    const events = payload.events || [];
    const transcript = payload.transcript || [];
    const wizardLines = transcript.filter((l) => l?.role === 'wizard').length;
    const userLines = transcript.filter((l) => l?.role === 'user').length;
    const swaigCalls = events.filter((e) => {
      const t = e?.data?.type;
      return t === 'agent_preview' || t === 'agent_config_question'
        || t === 'agent_created' || t === 'agent_ready' || t === 'wizard_checkpoint';
    }).length;

    const summary = summarizeSession(payload);
    const outcome = determineOutcome(payload);

    insertCallLog({
      id: payload.sessionId || `wizard-${Date.now()}`,
      projectId,
      employeeId: `wizard-${projectId}`,
      employeeName: 'Setup Wizard',
      employeeRole: 'Agent Builder',
      timestamp: startedAt,
      durationSec,
      summary,
      callerIntent: 'Build an agent via wizard',
      outcome,
      sentiment: payload.error ? 'negative' : 'neutral',
      topics: ['wizard', 'agent-creation'],
      followUp: payload.error || null,
      userMessages: userLines,
      assistantMessages: wizardLines,
      totalMessages: transcript.length,
      swaigCalls,
      avgLatencyMs: null,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      builtAgentId: payload.builtAgentId || null,
      rawPayload: payload, // full session: events, transcript, debugLog, finalConnectionState, error
    });

    return Response.json({ success: true, id: payload.sessionId });
  } catch (error) {
    console.error('[wizard-session-log] error:', error);
    return Response.json(
      { error: 'Failed to persist wizard session: ' + error.message },
      { status: 500 },
    );
  }
}
