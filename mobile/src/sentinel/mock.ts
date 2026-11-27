import bs58 from 'bs58';
import { ed25519 } from '@noble/curves/ed25519.js';
import { RESERVED_PROGRAM_ID, SIGN_IN_STATEMENT } from './rules.ts';
import type { Challenge, Contacts, Role, SentinelAlert, Transport, VaultSummary, WatchLog } from './types.ts';

const fixtureAddress = (n: number) => bs58.encode(new Uint8Array(32).fill(n));
export const MOCK_VAULT = fixtureAddress(21);
export const MOCK_WALLET = fixtureAddress(22);
const nowSeconds = () => Math.floor(Date.now() / 1000);
const randomHex = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');

export function createMockSentinel(now = nowSeconds, random = randomHex) {
  const tokens = new Map<string, { wallet: string; role: Role; expires_at: number }>();
  const nonces = new Map<string, Challenge & { wallet: string; used: boolean }>();
  const deviceSecrets = new Map<string, string>();
  const pushTokens = new Map<string, string>();
  let contacts: Contacts = { phones: [], devices: [] };
  let sequence = 0;
  let frozen = false;
  let started = now();
  const makeAlert = (id: string, amount: string, seconds: number, risk: SentinelAlert['risk']): SentinelAlert => ({
    id, vault: MOCK_VAULT, kind: 'withdrawal', token: { mint: fixtureAddress(28), symbol: 'USDC', decimals: 6 },
    withdrawal: { pda: fixtureAddress(id === 'al_9' ? 23 : 24), id: id === 'al_9' ? '42' : '41', amount, decimals: 6,
      destination: fixtureAddress(25), destination_owner: fixtureAddress(26), requested_at: started - 60, executes_at: started + seconds },
    risk, score: risk === 'critical' ? 92 : 18,
    reason: risk === 'critical' ? 'This withdrawal sends funds to a newly created address named in public drainer reports.' : 'This withdrawal exceeds the instant allowance and is waiting through its delay.',
    signals: risk === 'critical' ? [
      { id: 'new_address', label: 'Destination created 3 minutes ago', weight: 30 },
      { id: 'scam_report', label: 'Named in 2 public drainer reports', weight: 35 },
      { id: 'lookalike', label: 'Similar to a trusted destination', weight: 15 },
      { id: 'share_of_vault', label: '28% of the sample vault balance', weight: 5 },
      { id: 'odd_hour', label: 'Outside usual activity hours', weight: 7 },
    ] : [{ id: 'first_destination', label: 'First transfer to this destination', weight: 18 }],
    status: 'open', actions: [{ at: started, type: 'push_sent' }],
    call: { status: 'none', outcome: 'none', transcript: [] }, resolution: null, created_at: started - (id === 'al_9' ? 0 : 60),
  });
  let alerts = [makeAlert('al_9', '680000000', 85_267, 'critical'), makeAlert('al_8', '125000000', 7_320, 'low')];
  const watchlog: WatchLog['entries'] = [{ at: started, type: 'scored', text: 'Sample withdrawal scored CRITICAL (92).', alert_id: 'al_9', risk: 'critical' }];
  const log = (type: string, text: string, alert_id?: string) => watchlog.unshift({ at: now(), type, text, ...(alert_id ? { alert_id } : {}) });
  const error = (status: number, code: string, message: string) => ({ status, data: { error: { code, message } } });
  const ok = (data?: unknown, status = 200) => ({ status, data: data === undefined ? undefined : JSON.parse(JSON.stringify(data)) as unknown });
  const startPreview = (wallet = MOCK_WALLET, role: Role = 'owner') => {
    const token = random(); const expires_at = now() + 86_400;
    tokens.set(token, { wallet, role, expires_at }); return { token, expires_at };
  };

  const transport: Transport = async (path, init) => {
    const url = new URL(path, 'https://mock.argus.invalid');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const body = init.body ? JSON.parse(init.body) as Record<string, string> : {};
    if (url.pathname === '/v1/health') return ok({ ok: true, cluster: 'devnet', program_id: RESERVED_PROGRAM_ID, ai_guardian: fixtureAddress(27), last_scan_at: now(), version: '0.1.0-mock' });
    if (url.pathname === '/v1/auth/challenge' && init.method === 'POST') {
      try { if (bs58.decode(body.wallet).length !== 32) throw new Error(); }
      catch { return error(400, 'BAD_SIGNATURE', 'Invalid wallet address.'); }
      const nonce = random();
      const challenge: Challenge = { nonce, expires_at: now() + 300,
        message: `argus.app wants you to sign in with your Solana account:\n${body.wallet}\n\n${SIGN_IN_STATEMENT}\n\nURI: https://argus.app\nVersion: 1\nChain ID: devnet\nNonce: ${nonce}\nIssued At: ${new Date(now() * 1000).toISOString()}\nExpiration Time: ${new Date((now() + 300) * 1000).toISOString()}` };
      nonces.set(nonce, { ...challenge, wallet: body.wallet, used: false }); return ok(challenge);
    }
    if (url.pathname === '/v1/auth/verify' && init.method === 'POST') {
      const challenge = nonces.get(body.nonce);
      if (!challenge || challenge.expires_at <= now()) return error(400, 'NONCE_EXPIRED', 'Sign-in expired. Please try again.');
      if (challenge.used) return error(400, 'NONCE_USED', 'This sign-in was already used.');
      try {
        if (body.wallet !== challenge.wallet || !ed25519.verify(bs58.decode(body.signature), new TextEncoder().encode(challenge.message), bs58.decode(body.wallet))) throw new Error();
      } catch { return error(400, 'BAD_SIGNATURE', 'Signature does not match this wallet and challenge.'); }
      challenge.used = true; return ok(startPreview(body.wallet));
    }
    const token = init.headers.Authorization?.replace(/^Bearer /, '');
    const session = token ? tokens.get(token) : undefined;
    // A device can unregister using its secret even after its wallet token expires.
    if (parts[1] === 'vaults' && parts[2] === MOCK_VAULT && parts[3] === 'devices' && parts[4] && init.method === 'DELETE' &&
      init.headers['X-Device-Secret'] && (!deviceSecrets.has(parts[4]) || deviceSecrets.get(parts[4]) === init.headers['X-Device-Secret'])) {
      contacts.devices = contacts.devices.filter(d => d.id !== parts[4]); deviceSecrets.delete(parts[4]);
      for (const [pushToken, id] of pushTokens) if (id === parts[4]) pushTokens.delete(pushToken);
      log('contact_removed', 'This sample push device was removed.'); return ok(undefined, 204);
    }
    if (!session) return error(401, 'UNAUTHENTICATED', 'Sign in with your wallet to continue.');
    if (session.expires_at <= now()) return error(401, 'TOKEN_EXPIRED', 'Your session expired. Sign in again.');
    if (url.pathname === '/v1/auth/logout') { tokens.delete(token!); return ok(undefined, 204); }
    if (url.pathname === '/v1/vaults') return ok({ vaults: [{ vault: MOCK_VAULT, role: session.role, watched: true }] });
    if (parts[1] === 'alerts') {
      const alert = alerts.find(a => a.id === parts[2]);
      if (!alert) return error(404, 'ALERT_NOT_FOUND', 'This alert could not be found.');
      if (parts[3] === 'dismiss' && init.method === 'POST') {
        if (alert.status === 'open') { alert.status = 'dismissed'; alert.call.outcome = 'user_approved'; log('dismissed', 'A member dismissed the sample alert. The withdrawal delay still applies.', alert.id); }
      }
      return ok(alert);
    }
    if (parts[1] !== 'vaults' || parts[2] !== MOCK_VAULT) return error(403, 'NOT_VAULT_MEMBER', 'Wallet is not the owner or a guardian of this vault.');
    const route = parts[3];
    if (!route) return ok({ vault: MOCK_VAULT, role: session.role, watched: true, frozen, balance: '2450000000', decimals: 6,
      mint: fixtureAddress(28), pending_withdrawals: alerts.filter(a => ['open', 'dismissed'].includes(a.status) && a.withdrawal).length,
      open_alerts: alerts.filter(a => a.status === 'open').length, last_scan_at: now() } satisfies VaultSummary);
    if (route === 'contacts') return ok(contacts);
    if (route === 'watchlog') return ok({ entries: watchlog, next_before: null });
    if (route === 'alerts') {
      const before = Number(url.searchParams.get('before') ?? Infinity);
      const limit = Math.max(1, Math.min(20, Number(url.searchParams.get('limit') ?? 20)));
      const rows = alerts.filter(a => a.created_at < before && (!url.searchParams.has('status') || a.status === url.searchParams.get('status')));
      const page = rows.slice(0, limit);
      return ok({ alerts: page, next_before: rows.length > limit ? page.at(-1)!.created_at : null });
    }
    if (route === 'phones' && init.method === 'POST') {
      if (!/^\+[1-9]\d{7,14}$/.test(body.e164 ?? '')) return error(400, 'INVALID_PHONE', 'Use international phone format.');
      const id = `ph_${++sequence}`;
      contacts.phones.push({ id, e164: `${body.e164.slice(0, 6)}******${body.e164.slice(-2)}`, label: body.label,
        added_by_role: session.role, added_at: now(), verified: true });
      log('contact_added', 'A sample phone contact was added. All existing contacts are retained.');
      return ok({ id, verified: true, verification: 'none' }, 201);
    }
    if (route === 'devices' && init.method === 'POST') {
      const existing = pushTokens.get(body.expo_push_token);
      if (existing) {
        const device = contacts.devices.find(d => d.id === existing); if (device) device.label = body.label;
        return ok({ id: existing }); // HTTP 200; the secret is only revealed on first registration.
      }
      const id = `dv_${++sequence}`; const secret = random();
      pushTokens.set(body.expo_push_token, id); deviceSecrets.set(id, secret);
      contacts.devices.push({ id, platform: 'android', label: body.label, added_by_role: session.role, added_at: now() });
      log('contact_added', 'A sample push device was added.'); return ok({ id, device_secret: secret }, 201);
    }
    if ((route === 'phones' || route === 'devices') && parts[4] && init.method === 'DELETE') {
      if (session.role !== 'guardian') return error(403, 'GUARDIAN_REQUIRED', 'Only a guardian can remove this contact.');
      if (route === 'phones') contacts.phones = contacts.phones.filter(p => p.id !== parts[4]);
      else {
        contacts.devices = contacts.devices.filter(d => d.id !== parts[4]); deviceSecrets.delete(parts[4]);
        for (const [pushToken, id] of pushTokens) if (id === parts[4]) pushTokens.delete(pushToken);
      }
      log('contact_removed', 'A guardian removed a sample contact.'); return ok(undefined, 204);
    }
    return error(404, 'INTERNAL', 'This endpoint is not part of the mobile contract.');
  };

  return { transport, startPreview,
    reset() {
      started = now();
      alerts = [makeAlert('al_9', '680000000', 85_267, 'critical'), makeAlert('al_8', '125000000', 7_320, 'low')];
      frozen = false; watchlog.splice(0); log('heartbeat', 'Sample vault reset. No pending actions have been signed.');
    },
    simulateCancel(id: string) { const alert = alerts.find(a => a.id === id); if (alert && ['open', 'dismissed'].includes(alert.status)) {
      alert.status = 'cancelled'; log('chain_event', 'Demo cancellation. No transaction was sent.', id);
    } },
    simulateFreeze() {
      if (frozen) return;
      frozen = true;
      alerts.unshift({ ...makeAlert(`al_freeze_${++sequence}`, '0', 0, 'medium'), kind: 'freeze', withdrawal: null,
        reason: 'The sample vault was frozen. Outgoing transfers are paused.', signals: [], created_at: now() });
      log('chain_event', 'Demo freeze. No transaction was sent.');
    },
  };
}
