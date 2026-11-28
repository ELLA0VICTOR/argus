import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Keypair } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { LiveSentinel, type LiveAlert } from './live.ts';
import { RESERVED_PROGRAM_ID } from './rules.ts';
import { boundWithdrawal, canDismissLiveAlert, liveAlertReason } from '../domain/liveProtection.ts';
import type { VaultView } from '../program/read.ts';

const address = () => Keypair.generate().publicKey;
const vault = address(); const mint = address(); const destination = address(); const request = address();
const alert: LiveAlert = { id: 'alert-1', vault: vault.toBase58(), kind: 'withdrawal', token: { mint: mint.toBase58(), symbol: 'TEST', decimals: 6 },
  withdrawal: { pda: request.toBase58(), id: '9007199254740993', amount: '12000000000', decimals: 6, destination: destination.toBase58(), destination_owner: address().toBase58(), requested_at: 100, executes_at: 200 },
  risk: 'critical', score: 90, reason: 'Unusual withdrawal', signals: [{ id: 'new_address', label: 'New address', weight: 30 }], status: 'open',
  act_at: 150_000, created_at: 100, resolution: null, actions: [], call: { status: 'none', outcome: 'none', transcript: [] } };
const w = { address: request, data: { id: { toString: () => '9007199254740993' }, amount: { toString: () => '12000000000' }, destination,
  ownerEpoch: 2, requestedAt: { toString: () => '100' }, executesAt: { toString: () => '200' } } };
const view = { vault: { address: vault, data: { mint, ownerEpoch: 2 } }, decimals: 6, withdrawals: [w] } as unknown as VaultView;
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

test('live reads bind the requested vault and reject malformed or cross-vault payloads', async () => {
  const client = new LiveSentinel('https://sentinel.example', async (url, init) => {
    assert.equal(String(url), `https://sentinel.example/v1/vaults/${vault}/alerts?status=open`);
    assert.equal(init?.method, 'GET'); assert.equal(init?.redirect, 'error');
    return response({ alerts: [alert] });
  });
  assert.equal((await client.alerts(vault.toBase58()))[0].withdrawal!.id, '9007199254740993');
  for (const change of [
    { vault: address().toBase58() }, { id: '../injected' }, { act_at: 'tomorrow' }, { score: 200 },
    { withdrawal: { ...alert.withdrawal, amount: '1e9' } }, { withdrawal: { ...alert.withdrawal, amount: (1n << 64n).toString() } },
  ]) {
    const bad = new LiveSentinel('https://sentinel.example', async () => response({ alerts: [{ ...alert, ...change }] }));
    await assert.rejects(bad.alerts(vault.toBase58()), /invalid alert/);
  }
  for (const url of ['http://sentinel.example', 'https://user:password@sentinel.example', 'https://sentinel.example?key=secret']) assert.throws(() => new LiveSentinel(url));
});

test('an alert can only choose its exact, current on-chain withdrawal; server token labels cannot change it', () => {
  assert.equal(boundWithdrawal(view, alert), w);
  for (const change of [{ pda: address().toBase58() }, { amount: '1' }, { destination: address().toBase58() }, { id: '9007199254740992' }, { executes_at: 199 }]) {
    assert.equal(boundWithdrawal(view, { ...alert, withdrawal: { ...alert.withdrawal!, ...change } }), null);
  }
  assert.equal(boundWithdrawal({ ...view, vault: { ...view.vault, data: { ...view.vault.data, ownerEpoch: 3 } } }, alert), null);
  const wrongMetadata = { ...alert, token: { ...alert.token, mint: address().toBase58(), decimals: 9 } };
  assert.equal(boundWithdrawal(view, wrongMetadata), w);
  assert(!liveAlertReason(view, wrongMetadata).includes(alert.reason));
  assert.equal(canDismissLiveAlert(alert, 'owner'), false);
  assert.equal(canDismissLiveAlert(alert, 'guardian'), true);
  assert.equal(canDismissLiveAlert({ ...alert, risk: 'high' }, 'owner'), true);
  assert.equal(canDismissLiveAlert(alert, null), false);
});

test('dismissal signs the exact alert message and verifies the connected wallet before posting', async () => {
  const signer = Keypair.generate(); let posts = 0;
  const client = new LiveSentinel('https://sentinel.example', async (url, init) => {
    if (init?.method === 'GET') return response({ alerts: [alert] });
    posts++; assert.equal(String(url), 'https://sentinel.example/v1/alerts/alert-1/dismiss');
    const body = JSON.parse(String(init?.body)); assert.equal(body.wallet, signer.publicKey.toBase58()); assert.equal(body.ts, 123);
    return response({ ...alert, status: 'dismissed' });
  });
  const sign = async (message: Uint8Array) => {
    assert.equal(new TextDecoder().decode(message), 'Argus: it was me. Dismiss alert alert-1 at 123');
    const signature = ed25519.sign(message, signer.secretKey.subarray(0, 32));
    return new Uint8Array([...message, ...signature]);
  };
  await client.dismiss(vault.toBase58(), alert.id, signer.publicKey.toBase58(), sign, 123_000, candidate => !!boundWithdrawal(view, candidate));
  assert.equal(posts, 1);
  await assert.rejects(client.dismiss(vault.toBase58(), alert.id, address().toBase58(), sign, 123_000), /signature/);
  await assert.rejects(client.dismiss(vault.toBase58(), alert.id, signer.publicKey.toBase58(), sign, 123_000, () => false), /changed/);
  assert.equal(posts, 1);
});

test('faucet health mismatch stops funding and no request exposes signing material', async () => {
  let posts = 0;
  const client = new LiveSentinel('https://sentinel.example', async (_, init) => {
    if (init?.method === 'POST') posts++;
    return response({ ok: true, cluster: 'mainnet-beta', program_id: RESERVED_PROGRAM_ID, ai_guardian: address().toBase58(), test_mint: mint.toBase58() });
  });
  await assert.rejects(client.faucet(address().toBase58()), /devnet/); assert.equal(posts, 0);
});
