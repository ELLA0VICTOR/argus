import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ARGUS_VOICE_AGENT, CallDecisionGate, VoiceAttempt, callFromAlert, voiceVariables, type VoiceConnection } from './guardianCall.ts';
import type { SentinelAlert } from '../sentinel/types.ts';

const alert: SentinelAlert = { id: 'al_1', vault: 'vault', kind: 'withdrawal',
  token: { mint: 'mint', symbol: 'USDC', decimals: 6 },
  withdrawal: { pda: 'request', id: '1', amount: '12000000000', decimals: 6, destination: 'token-account', destination_owner: 'recipient-wallet', requested_at: 1, executes_at: 100 },
  risk: 'critical', score: 90, reason: 'New destination', signals: [], status: 'open', actions: [],
  call: { status: 'ringing', outcome: 'none', transcript: [] }, resolution: null, created_at: 1 };

test('voice context comes from an open, flagged owner alert and preserves exact amount and destination', () => {
  const request = callFromAlert(alert, 'owner', 2_000)!;
  assert.equal(ARGUS_VOICE_AGENT, 'agent_3001m8ebdd1ee1yrp9ga4kcn2436');
  assert.deepEqual(voiceVariables(request), { owner_name: 'there', vault_name: 'Your vault', amount: '12,000 USDC', destination: 'recipient-wallet', reason: 'New destination' });
  assert.equal(callFromAlert(alert, 'guardian', 2_000), null);
  assert.equal(callFromAlert(alert, 'owner', 100_000), null);
  assert.equal(callFromAlert({ ...alert, status: 'dismissed' }, 'owner', 2_000), null);
  assert.equal(callFromAlert({ ...alert, risk: 'low' }, 'owner', 2_000), null);
  assert.equal(callFromAlert({ ...alert, withdrawal: null }, 'owner', 2_000), null);
  assert.equal(callFromAlert({ ...alert, kind: 'freeze' }, 'owner', 2_000), null);
});

test('voice and button races submit one decision, reject contradictory answers and retain voice provenance', async () => {
  let delivered = 0; let finish!: (message: string) => void;
  const gate = new CallDecisionGate(100, async (decision, via) => {
    delivered++; assert.equal(decision, 'cancel'); assert.equal(via, 'voice');
    return new Promise<string>(resolve => { finish = resolve; });
  }, () => 1);
  const first = gate.submit('cancel', 'voice');
  assert.equal(gate.submit('cancel', 'button'), first);
  await assert.rejects(gate.submit('allow', 'button'), /being sent/);
  assert.equal(delivered, 1); finish('Cancellation requested, not yet confirmed.');
  assert.equal(await first, 'Cancellation requested, not yet confirmed.');
  assert.equal(await gate.submit('cancel', 'button'), 'Cancellation requested, not yet confirmed.');
  await assert.rejects(gate.submit('allow', 'voice'), /already recorded/); assert.equal(delivered, 1);
});

test('failed delivery can be retried; expiry and closing block new tools before any request', async () => {
  let now = 1; let calls = 0;
  const gate = new CallDecisionGate(100, async () => { if (++calls === 1) throw new Error('Offline'); return 'Received'; }, () => now);
  await assert.rejects(gate.submit('cancel', 'voice'), /Offline/);
  assert.equal(await gate.submit('cancel', 'button'), 'Received'); assert.equal(calls, 2);
  const expiring = new CallDecisionGate(100, async () => { calls++; return 'Unexpected'; }, () => now);
  now = 100; await assert.rejects(expiring.submit('allow', 'voice'), /window ended/);
  now = 1; const closing = expiring.submit('cancel', 'voice'); expiring.close();
  await assert.rejects(closing, /call has ended/); assert.equal(calls, 2);
  await assert.rejects(expiring.submit('allow', 'voice'), /call has ended/);
});

test('late voice connections close after hangup and cannot restart or change microphone state', async () => {
  let finish!: (connection: VoiceConnection) => void; let ended = 0; let starts = 0; let mutes = 0;
  const attempt = new VoiceAttempt();
  const starting = attempt.start(() => { starts++; return new Promise(resolve => { finish = resolve; }); });
  await attempt.start(async () => { starts++; throw new Error('Duplicate start'); });
  await attempt.close();
  finish({ endSession: async () => { ended++; }, setMicMuted: () => { mutes++; } }); await starting;
  attempt.mute(true); await attempt.close(); await attempt.start(async () => { throw new Error('Started after close'); });
  assert.equal(starts, 1); assert.equal(ended, 1); assert.equal(mutes, 0); assert.equal(attempt.active, false);
});

test('live voice controls mute and release the owned connection once', async () => {
  let ended = 0; const changes: boolean[] = []; const attempt = new VoiceAttempt();
  await attempt.start(async () => ({ endSession: async () => { ended++; }, setMicMuted: value => changes.push(value) }));
  attempt.mute(true); attempt.mute(false); await attempt.close(); await attempt.close();
  assert.deepEqual(changes, [true, false]); assert.equal(ended, 1);
});
