import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import bs58 from 'bs58';
import { ed25519 } from '@noble/curves/ed25519.js';
import { SentinelClient, SentinelError, httpTransport } from './client.ts';
import { createMockSentinel, MOCK_VAULT, MOCK_WALLET } from './mock.ts';
import { alertIdFromPush, alertIdFromUrl, formatTokenAmount, formatUnits, signatureFromSignedPayload, signalIcons, validateChallenge, validatePhone } from './rules.ts';
import type { Challenge, CredentialStore, Transport } from './types.ts';

function setup() {
  let clock = 1_795_687_200;
  const storage = new Map<string, string>();
  const store: CredentialStore = {
    get: async key => storage.get(key) ?? null,
    set: async (key, value) => { storage.set(key, value); }, remove: async key => { storage.delete(key); },
  };
  const mock = createMockSentinel(() => clock);
  const requests: { path: string; init: Parameters<Transport>[1] }[] = [];
  const transport: Transport = (path, init) => { requests.push({ path, init }); return mock.transport(path, init); };
  const client = new SentinelClient('mock:v1', true, transport, store, () => clock);
  const key = ed25519.utils.randomSecretKey();
  const wallet = bs58.encode(ed25519.getPublicKey(key));
  const sign = async (challenge: Challenge) => {
    const message = new TextEncoder().encode(challenge.message);
    return signatureFromSignedPayload(new Uint8Array([...message, ...ed25519.sign(message, key)]), message, wallet);
  };
  return { client, mock, storage, store, transport, requests, wallet, sign, now: () => clock, advance: (seconds: number) => { clock += seconds; } };
}
const hasCode = (code: string) => (error: unknown) => error instanceof SentinelError && error.code === code;

test('exact MWA signed payload is verified; altered bytes and wrong signers are rejected', () => {
  const message = new TextEncoder().encode('Argus sign-in: café\n');
  const key = ed25519.utils.randomSecretKey();
  const wallet = bs58.encode(ed25519.getPublicKey(key));
  const signature = ed25519.sign(message, key);
  const payload = new Uint8Array([...message, ...signature]);
  assert.equal(signatureFromSignedPayload(payload, message, wallet), bs58.encode(signature));
  assert.throws(() => signatureFromSignedPayload(payload, new TextEncoder().encode('other'), wallet));
  assert.throws(() => signatureFromSignedPayload(payload, message, MOCK_WALLET));
  assert.throws(() => signatureFromSignedPayload(signature, message, wallet));
});

test('wallet challenge sign-in persists the token, restores it, and revokes it on logout', async () => {
  const f = setup();
  await f.client.signIn(f.wallet, f.sign);
  const stored = JSON.parse(f.storage.get('argus.sentinel.session')!);
  assert.equal(stored.wallet, f.wallet); assert.equal(stored.token, f.client.session?.token);
  assert.ok(f.requests[0].init.headers.Authorization === undefined);
  assert.ok(f.requests[1].init.headers.Authorization === undefined);
  const restored = new SentinelClient('mock:v1', true, f.transport, f.store, f.now);
  await restored.restore();
  assert.equal(restored.session?.wallet, f.wallet);
  assert.equal(f.requests.at(-1)?.init.headers.Authorization, `Bearer ${stored.token}`);
  await restored.logout();
  assert.equal(restored.session, null); assert.equal(f.storage.has('argus.sentinel.session'), false);
  await assert.rejects(() => f.client.vaults(), hasCode('UNAUTHENTICATED'));
});

test('expired nonces and nonce reuse fail without creating another session', async () => {
  const f = setup();
  await f.client.signIn(f.wallet, f.sign);
  const verify = f.requests.find(r => r.path.endsWith('/verify'))!;
  const replay = await f.mock.transport(verify.path, verify.init);
  assert.equal((replay.data as { error: { code: string } }).error.code, 'NONCE_USED');
  const challenge = await f.mock.transport('/v1/auth/challenge', { method: 'POST', headers: {}, body: JSON.stringify({ wallet: f.wallet }) });
  const body = challenge.data as Challenge;
  const signature = await f.sign(body); f.advance(301);
  assert.throws(() => validateChallenge(body, f.wallet, f.now()));
  const expired = await f.mock.transport('/v1/auth/verify', { method: 'POST', headers: {}, body: JSON.stringify({ wallet: f.wallet, nonce: body.nonce, signature }) });
  assert.equal((expired.data as { error: { code: string } }).error.code, 'NONCE_EXPIRED');
});

test('challenge validation rejects wrong domains, wallets, network, and changed nonce', async () => {
  const f = setup();
  const response = await f.mock.transport('/v1/auth/challenge', { method: 'POST', headers: {}, body: JSON.stringify({ wallet: f.wallet }) });
  const challenge = response.data as Challenge;
  validateChallenge(challenge, f.wallet, f.now());
  for (const message of [challenge.message.replace('argus.app wants', 'evil.app wants'), challenge.message.replace('Chain ID: devnet', 'Chain ID: mainnet'), challenge.message.replace(f.wallet, MOCK_WALLET)]) {
    assert.throws(() => validateChallenge({ ...challenge, message }, f.wallet, f.now()));
  }
  assert.throws(() => validateChallenge({ ...challenge, nonce: '0'.repeat(64) }, f.wallet, f.now()));
});

test('token expiry clears secure credentials and backend scopes cannot share tokens', async () => {
  const f = setup(); await f.client.signIn(f.wallet, f.sign); f.advance(86_401);
  await assert.rejects(() => f.client.contacts(MOCK_VAULT), hasCode('TOKEN_EXPIRED'));
  assert.equal(f.client.session, null); assert.equal(f.storage.size, 0);
  await f.client.signIn(f.wallet, f.sign);
  const otherBackend = new SentinelClient('https://live.example', false, f.transport, f.store, f.now);
  await otherBackend.restore(); assert.equal(otherBackend.session, null);
  assert.equal(f.storage.has('argus.sentinel.session'), false);
});

test('owner can add active phones with masked responses but cannot remove or replace them', async () => {
  const f = setup(); f.client.enterDemo(MOCK_WALLET, f.mock.startPreview());
  const first = await f.client.addPhone(MOCK_VAULT, '+2348012345621', 'Owner');
  assert.deepEqual(first, { id: first.id, verified: true, verification: 'none' });
  await f.client.addPhone(MOCK_VAULT, '+2348012345622', 'Backup');
  const contacts = await f.client.contacts(MOCK_VAULT);
  assert.equal(contacts.phones.length, 2); assert.ok(contacts.phones.every(p => p.e164.includes('*')));
  assert.ok(!JSON.stringify(contacts).includes('+2348012345621'));
  await assert.rejects(() => f.client.removePhone(MOCK_VAULT, first.id), hasCode('GUARDIAN_REQUIRED'));
  assert.equal((await f.client.contacts(MOCK_VAULT)).phones.length, 2);
  f.client.enterDemo(MOCK_WALLET, f.mock.startPreview(MOCK_WALLET, 'guardian'));
  await f.client.removePhone(MOCK_VAULT, first.id);
  assert.equal((await f.client.contacts(MOCK_VAULT)).phones.length, 1);
});

test('push registration is idempotent and retains the one-time SecureStore removal secret', async () => {
  const f = setup(); f.client.enterDemo(MOCK_WALLET, f.mock.startPreview());
  const id = await f.client.addDevice(MOCK_VAULT, 'ExponentPushToken[test]', 'Seeker');
  const secret = (await f.client.localDevice(MOCK_VAULT))?.secret;
  assert.ok(secret);
  assert.equal(await f.client.addDevice(MOCK_VAULT, 'ExponentPushToken[test]', 'Renamed Seeker'), id);
  assert.equal((await f.client.localDevice(MOCK_VAULT))?.secret, secret);
  assert.equal((await f.client.contacts(MOCK_VAULT)).devices.length, 1);
  const repeatRequest = f.requests.findLast(r => r.init.method === 'POST' && r.path.endsWith('/devices'))!;
  const repeated = await f.mock.transport(repeatRequest.path, repeatRequest.init);
  assert.equal(repeated.status, 200); assert.deepEqual(repeated.data, { id });
  f.advance(86_401);
  await f.client.removeOwnDevice(MOCK_VAULT);
  const removal = f.requests.at(-1)!;
  assert.equal(removal.init.headers['X-Device-Secret'], secret);
  assert.equal(removal.init.headers.Authorization, undefined);
  assert.equal(await f.client.localDevice(MOCK_VAULT), null);
});

test('rotating a push token removes the old device before replacing its stored secret', async () => {
  const f = setup(); f.client.enterDemo(MOCK_WALLET, f.mock.startPreview());
  const previous = await f.client.addDevice(MOCK_VAULT, 'ExponentPushToken[old]', 'Seeker');
  const updated = await f.client.addDevice(MOCK_VAULT, 'ExponentPushToken[new]', 'Seeker');
  assert.notEqual(updated, previous);
  const contacts = await f.client.contacts(MOCK_VAULT);
  assert.equal(contacts.devices.length, 1); assert.equal(contacts.devices[0].id, updated);
  assert.ok(f.requests.some(r => r.path.endsWith(`/devices/${previous}`) && r.init.method === 'DELETE'));
  await f.client.logout(MOCK_VAULT);
  assert.equal(f.client.session, null);
  assert.equal(Array.from(f.storage.keys()).some(key => key.endsWith(MOCK_VAULT)), false);
});

test('logout keeps a usable session when device removal fails, allowing a retry', async () => {
  const f = setup();
  let failRemoval = false;
  const transport: Transport = (path, init) => failRemoval && init.method === 'DELETE'
    ? Promise.resolve({ status: 503, data: { error: { code: 'INTERNAL', message: 'Retry device removal.' } } })
    : f.transport(path, init);
  const client = new SentinelClient('mock:v1', true, transport, f.store, f.now);
  client.enterDemo(MOCK_WALLET, f.mock.startPreview());
  await client.addDevice(MOCK_VAULT, 'ExponentPushToken[test]', 'Seeker');
  failRemoval = true;
  await assert.rejects(() => client.logout(MOCK_VAULT), hasCode('INTERNAL'));
  assert.ok(client.session); assert.ok(await client.localDevice(MOCK_VAULT));
  failRemoval = false; await client.logout(); assert.equal(client.session, null);
});

test('a delayed response from a previous token cannot populate the next wallet session', async () => {
  const f = setup(); let release: (() => void) | undefined;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const transport: Transport = async (path, init) => { const result = await f.transport(path, init); await wait; return result; };
  const client = new SentinelClient('mock:v1', true, transport, f.store, f.now);
  client.enterDemo(MOCK_WALLET, f.mock.startPreview());
  const request = client.vaults();
  client.enterDemo(f.wallet, f.mock.startPreview(f.wallet));
  release!();
  await assert.rejects(() => request, hasCode('SESSION_CHANGED'));
  assert.equal(client.session?.wallet, f.wallet);
});

test('dismiss changes display status while preserving the delayed withdrawal; freeze events have no withdrawal', async () => {
  const f = setup(); f.client.enterDemo(MOCK_WALLET, f.mock.startPreview());
  const original = await f.client.alert('al_9');
  const dismissed = await f.client.dismiss('al_9');
  assert.equal(dismissed.status, 'dismissed'); assert.deepEqual(dismissed.withdrawal, original.withdrawal);
  assert.equal(dismissed.resolution, null);
  assert.equal((await f.client.alerts(MOCK_VAULT, undefined, 'open')).alerts.some(a => a.id === 'al_9'), false);
  assert.equal(f.requests.some(r => /cancel|freeze/.test(r.path)), false);
  f.mock.simulateFreeze();
  const page = await f.client.alerts(MOCK_VAULT);
  assert.equal(page.alerts[0].kind, 'freeze'); assert.equal(page.alerts[0].withdrawal, null);
  assert.equal((await f.client.vault(MOCK_VAULT)).frozen, true);
});

test('alert pagination uses unix before cursors and access failures stay explicit', async () => {
  const f = setup(); f.client.enterDemo(MOCK_WALLET, f.mock.startPreview());
  const first = await f.client.request<{ alerts: { id: string; created_at: number }[]; next_before: number }>(`/v1/vaults/${MOCK_VAULT}/alerts?limit=1`);
  assert.equal(first.alerts.length, 1); assert.equal(first.next_before, first.alerts[0].created_at);
  const second = await f.client.alerts(MOCK_VAULT, first.next_before);
  assert.equal(second.alerts.length, 1); assert.notEqual(first.alerts[0].id, second.alerts[0].id);
  await assert.rejects(() => f.client.alert('not_an_alert'), hasCode('ALERT_NOT_FOUND'));
  await assert.rejects(() => f.client.contacts(MOCK_WALLET), hasCode('NOT_VAULT_MEMBER'));
});

test('deep links and push payloads accept only the alert route and never trust payload amounts or destinations', () => {
  assert.equal(alertIdFromUrl('argus://alert/al_9'), 'al_9');
  for (const link of ['https://evil.example/alert/al_9', 'argus://alert/../settings', 'argus://alert/al_9?token=oops', 'argus://alert/%2e%2e', 'argus://alert/al_9/extra']) assert.equal(alertIdFromUrl(link), null);
  const data = { type: 'withdrawal_alert', alert_id: 'al_9', vault: MOCK_VAULT, url: 'argus://alert/al_9', amount: 'evil', destination: 'evil' };
  assert.equal(alertIdFromPush(data), 'al_9');
  assert.equal(alertIdFromPush({ ...data, url: 'argus://alert/another' }), null);
  assert.equal(alertIdFromPush({ ...data, type: 'sign_transaction' }), null);
  assert.equal(alertIdFromPush({ ...data, vault: 'invalid' }), null);
  assert.equal(alertIdFromPush(null), null);
});

test('amounts above JS integer precision remain exact; signal identity does not depend on labels', () => {
  assert.equal(formatUnits('9007199254740993123456', 6), '9,007,199,254,740,993.123456');
  assert.equal(formatUnits('680000000', 6), '680.00'); assert.equal(formatUnits('1', 6), '0.000001');
  assert.equal(formatUnits('0', 0), '0'); assert.throws(() => formatUnits('1.1', 6));
  assert.equal(Object.keys(signalIcons).length, 6); assert.equal(signalIcons.lookalike, 'copy');
  assert.equal(validatePhone('+2348012345621'), '+2348012345621'); assert.throws(() => validatePhone('08012345621'));
});

test('alert token metadata supplies the symbol and decimals, with exact units and a nullable-symbol fallback', async () => {
  const token = { mint: MOCK_VAULT, symbol: 'USDC', decimals: 6 };
  assert.equal(formatTokenAmount('12000000000', token), '12,000 USDC');
  assert.equal(formatTokenAmount('12000123456', token), '12,000.123456 USDC');
  assert.equal(formatTokenAmount('1', token), '0.000001 USDC');
  assert.equal(formatTokenAmount('9007199254740993123456', token), '9,007,199,254,740,993.123456 USDC');
  assert.equal(formatTokenAmount('12000000000', { ...token, symbol: null }), '12,000 tokens');
  assert.equal(formatTokenAmount('12000000000', { ...token, symbol: '  ' }), '12,000 tokens');
  assert.equal(formatTokenAmount('0', { ...token, decimals: 0 }), '0 USDC');
  const f = setup(); f.client.enterDemo(MOCK_WALLET, f.mock.startPreview());
  const alert = await f.client.alert('al_9');
  assert.equal(alert.token.symbol, 'USDC'); assert.equal(alert.token.decimals, alert.withdrawal!.decimals);
  assert.equal(alert.token.mint, (await f.client.vault(MOCK_VAULT)).mint);
  assert.equal((await f.client.alerts(MOCK_VAULT)).alerts[0].token.symbol, 'USDC');
  f.mock.simulateFreeze();
  assert.deepEqual((await f.client.alerts(MOCK_VAULT)).alerts[0].token, alert.token);
});

test('HTTP has no mock fallback, rejects unsafe origins, and preserves structured errors', async () => {
  const f = setup();
  assert.throws(() => httpTransport('http://unsafe.example'));
  assert.throws(() => httpTransport('https://token@unsafe.example'));
  const unavailable = new SentinelClient('https://live.example', false, async () => { throw new Error('offline'); }, f.store, f.now);
  await assert.rejects(() => unavailable.signIn(f.wallet, f.sign), hasCode('NETWORK'));
  assert.equal(unavailable.session, null);
  assert.throws(() => unavailable.enterDemo(MOCK_WALLET, f.mock.startPreview()));
  const rateLimited = new SentinelClient('mock:v1', true, async () => ({ status: 429, data: { error: { code: 'RATE_LIMITED', message: 'Try again later.' } } }), f.store, f.now);
  rateLimited.enterDemo(MOCK_WALLET, f.mock.startPreview());
  await assert.rejects(() => rateLimited.vaults(), error => hasCode('RATE_LIMITED')(error) && (error as Error).message === 'Try again later.');
});
