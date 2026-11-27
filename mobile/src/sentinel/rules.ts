import bs58 from 'bs58';
import { ed25519 } from '@noble/curves/ed25519.js';
import type { AlertToken, Challenge, SignalId } from './types.ts';

export const RESERVED_PROGRAM_ID = '4LH7ikNGVVNaemB7eaLGUMbwSBHHqA2hKXTdrfhgD6nh';
export const ALERT_CHANNEL = 'argus-alerts';
export const SIGN_IN_STATEMENT = 'Sign in to Argus Sentinel. This does not move funds or approve any transaction.';
export const signalIcons: Record<SignalId, 'clock' | 'copy' | 'share' | 'moon' | 'report' | 'destination'> = {
  new_address: 'clock', lookalike: 'copy', share_of_vault: 'share', odd_hour: 'moon',
  scam_report: 'report', first_destination: 'destination',
};
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);

export function alertIdFromUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^argus:\/\/alert\/([a-zA-Z0-9_-]{1,128})$/.exec(value);
  return match?.[1] ?? null;
}

export function alertIdFromPush(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (!['withdrawal_alert', 'vault_frozen', 'contact_added', 'alert_resolved'].includes(String(data.type)) || !validId(data.alert_id)) return null;
  if (typeof data.vault !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(data.vault)) return null;
  if (data.url !== undefined && alertIdFromUrl(data.url) !== data.alert_id) return null;
  return data.alert_id;
}

export function formatUnits(amount: string, decimals: number): string {
  if (!/^\d+$/.test(amount) || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('Invalid token amount.');
  const digits = BigInt(amount).toString().padStart(decimals + 1, '0');
  const whole = decimals === 0 ? digits : digits.slice(0, -decimals);
  const fraction = decimals === 0 ? '' : digits.slice(-decimals).replace(/0+$/, '').padEnd(Math.min(2, decimals), '0');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? `.${fraction}` : '');
}

export function formatTokenAmount(amount: string, token: AlertToken): string {
  const formatted = formatUnits(amount, token.decimals);
  const symbol = token.symbol?.trim();
  // Trim only display zeroes; never round away base units or use JS floating-point amounts.
  return `${formatted.replace(/\.0+$/, '')} ${symbol || 'tokens'}`;
}

export function validatePhone(phone: string): string {
  const value = phone.trim();
  if (!/^\+[1-9]\d{7,14}$/.test(value)) throw new Error('Use international format, for example +2348012345621.');
  return value;
}

export function validateChallenge(challenge: Challenge, wallet: string, now: number): void {
  const lines = challenge.message.replace(/\n$/, '').split('\n');
  if (!/^[a-fA-F0-9]{64}$/.test(challenge.nonce) || !Number.isInteger(challenge.expires_at) ||
    challenge.expires_at <= now || challenge.expires_at > now + 300 ||
    lines.length !== 11 || lines[0] !== 'argus.app wants you to sign in with your Solana account:' ||
    lines[1] !== wallet || lines[2] !== '' || lines[3] !== SIGN_IN_STATEMENT || lines[4] !== '' ||
    lines[5] !== 'URI: https://argus.app' || lines[6] !== 'Version: 1' || lines[7] !== 'Chain ID: devnet' ||
    lines[8] !== `Nonce: ${challenge.nonce}` || !lines[9].startsWith('Issued At: ') ||
    !lines[10].startsWith('Expiration Time: ')) {
    throw new Error('Sentinel returned an invalid or expired sign-in challenge.');
  }
  const issued = Date.parse(lines[9]?.slice('Issued At: '.length));
  const expires = Date.parse(lines[10]?.slice('Expiration Time: '.length));
  if (!lines[9]?.startsWith('Issued At: ') || !lines[10]?.startsWith('Expiration Time: ') ||
    !Number.isFinite(issued) || issued / 1000 > now + 30 || issued / 1000 < now - 300 ||
    expires / 1000 !== challenge.expires_at) throw new Error('Sentinel returned invalid sign-in timestamps.');
}

export function signatureFromSignedPayload(payload: Uint8Array, message: Uint8Array, wallet: string): string {
  if (payload.length !== message.length + 64 || !message.every((byte, i) => payload[i] === byte)) throw new Error('The wallet signed different message bytes.');
  const signature = payload.slice(message.length);
  if (!ed25519.verify(signature, message, bs58.decode(wallet))) throw new Error('The sign-in signature does not match the connected wallet.');
  return bs58.encode(signature);
}
