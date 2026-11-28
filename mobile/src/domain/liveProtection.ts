import type { LiveAlert } from '../sentinel/live.ts';
import type { VaultView } from '../program/read.ts';

/** A server alert supplies risk text, never transaction accounts or amounts. */
export function boundWithdrawal(view: VaultView, alert: LiveAlert) {
  const w = alert.withdrawal;
  if (!w || alert.status !== 'open' || alert.vault !== view.vault.address.toBase58()) return null;
  return view.withdrawals.find(record => record.address.toBase58() === w.pda &&
    record.data.id.toString() === w.id && record.data.amount.toString() === w.amount &&
    record.data.destination.toBase58() === w.destination && record.data.ownerEpoch === view.vault.data.ownerEpoch &&
    record.data.requestedAt.toString() === String(w.requested_at) && record.data.executesAt.toString() === String(w.executes_at)) ?? null;
}

export function liveAlertReason(view: VaultView, alert: LiveAlert): string {
  return alert.token.mint === view.vault.data.mint.toBase58() && alert.token.decimals === view.decimals ? alert.reason
    : 'Argus flagged an unusual withdrawal. Review the on-chain amount and destination below.';
}

export const canDismissLiveAlert = (alert: LiveAlert, role: 'owner' | 'guardian' | null) =>
  alert.status === 'open' && (role === 'guardian' || (role === 'owner' && alert.risk !== 'critical'));
