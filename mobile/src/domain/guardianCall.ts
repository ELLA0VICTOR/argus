import type { Role, SentinelAlert } from '../sentinel/types.ts';
import { formatTokenAmount } from '../sentinel/rules.ts';

export const ARGUS_VOICE_AGENT = 'agent_3001m8ebdd1ee1yrp9ga4kcn2436';
export type CallDecision = 'cancel' | 'allow';
export type DecisionVia = 'voice' | 'button';
export type CallLine = { who: 'argus' | 'owner'; text: string };
export type CallRelay = { status: 'connected' | 'ended' } | CallLine;
export type GuardianCallRequest = {
  id: string; ownerName: string; vaultName: string; amount: string; destination: string; reason: string;
  expiresAt: number; demo: boolean; canAllow?: boolean; autoActAt?: number;
};

export function voiceVariables(request: GuardianCallRequest) {
  return { owner_name: request.ownerName, vault_name: request.vaultName, amount: request.amount,
    destination: request.destination, reason: request.reason };
}

/** A push is just an ID. Only an authenticated, open owner alert supplies voice context. */
export function callFromAlert(alert: SentinelAlert, role: Role, now: number): GuardianCallRequest | null {
  const w = alert.withdrawal;
  if (role !== 'owner' || alert.kind !== 'withdrawal' || alert.status !== 'open' || !w ||
    !['high', 'critical'].includes(alert.risk) || w.executes_at * 1000 <= now) return null;
  return { id: `alert:${alert.id}`, ownerName: 'there', vaultName: 'Your vault',
    amount: formatTokenAmount(w.amount, alert.token), destination: w.destination_owner,
    reason: alert.reason, expiresAt: w.executes_at * 1000, demo: false };
}

/** Voice tools and buttons share one gate. Tool arguments never select an alert or destination. */
export class CallDecisionGate {
  private closed = false;
  private pending: { decision: CallDecision; promise: Promise<string> } | null = null;
  private accepted: { decision: CallDecision; message: string } | null = null;
  private readonly expiresAt: number;
  private readonly deliver: (decision: CallDecision, via: DecisionVia) => Promise<string>;
  private readonly now: () => number;
  constructor(expiresAt: number, deliver: (decision: CallDecision, via: DecisionVia) => Promise<string>, now: () => number = Date.now) {
    this.expiresAt = expiresAt; this.deliver = deliver; this.now = now;
  }

  submit(decision: CallDecision, via: DecisionVia): Promise<string> {
    if (this.closed) return Promise.reject(new Error('This call has ended. Check the withdrawal status.'));
    if (this.accepted) return this.accepted.decision === decision ? Promise.resolve(this.accepted.message)
      : Promise.reject(new Error('A decision was already recorded. Check the withdrawal status.'));
    if (this.pending) return this.pending.decision === decision ? this.pending.promise
      : Promise.reject(new Error('A decision is being sent. Wait for its result.'));
    if (this.now() >= this.expiresAt) return Promise.reject(new Error('The response window ended. Check the withdrawal status.'));
    const promise = Promise.resolve().then(() => {
      if (this.closed || this.now() >= this.expiresAt) throw new Error('This call has ended. Check the withdrawal status.');
      return this.deliver(decision, via);
    }).then(message => { this.accepted = { decision, message }; return message; })
      .finally(() => { this.pending = null; });
    this.pending = { decision, promise };
    return promise;
  }
  close() { this.closed = true; }
}

export type VoiceConnection = { endSession(): Promise<void>; setMicMuted(muted: boolean): void };
/** Closing during SDK setup must also close a connection that resolves later. */
export class VoiceAttempt {
  private closed = false;
  private connection: VoiceConnection | null = null;
  private started = false;
  get active() { return !this.closed; }
  async start(factory: () => Promise<VoiceConnection>) {
    if (this.started || this.closed) return;
    this.started = true;
    const connection = await factory();
    if (this.closed) { await connection.endSession(); return; }
    this.connection = connection;
  }
  mute(muted: boolean) { if (!this.closed) this.connection?.setMicMuted(muted); }
  async close() { this.closed = true; const connection = this.connection; this.connection = null; await connection?.endSession(); }
}
