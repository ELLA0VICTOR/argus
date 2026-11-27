import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { ed25519 } from '@noble/curves/ed25519.js';
import { Buffer } from 'buffer';
import bs58 from 'bs58';
import { ArgusClient } from '../program/client.ts';
import { SentinelDemoClient, DEMO_MINT, SENTINEL_AI_GUARDIAN, DemoEventDecoder, demoUrl, type DemoEvent } from './demo.ts';

test('local demo HTTP is restricted to private development hosts; full/release URLs need HTTPS', () => {
  assert.equal(demoUrl('http://127.0.0.1:8787/', true), 'http://127.0.0.1:8787');
  assert.equal(demoUrl('http://192.168.1.4:8787', true), 'http://192.168.1.4:8787');
  assert.equal(demoUrl('https://demo.argus.example'), 'https://demo.argus.example');
  for (const [url, dev] of [['http://127.0.0.1:8787', false], ['http://example.com', true], ['https://user:secret@example.com', true], ['https://example.com/?key=secret', false]] as const) assert.throws(() => demoUrl(url, dev));
});

async function fixture() {
  const owner = Keypair.generate(); const thief = Keypair.generate().publicKey;
  const codec = new ArgusClient({} as never); const mint = new PublicKey(DEMO_MINT);
  const vault = codec.vaultAddress(owner.publicKey, 0n)[0];
  const data = { session: vault.toBase58(), vault: vault.toBase58(), vaultToken: getAssociatedTokenAddressSync(mint, vault, true).toBase58(),
    owner: owner.publicKey.toBase58(), stolenKey: bs58.encode(owner.secretKey), thief: thief.toBase58(), thiefToken: getAssociatedTokenAddressSync(mint, thief).toBase58(), mint: DEMO_MINT,
    setupTx: bs58.encode(Buffer.alloc(64, 1)), rules: { dailyLimit: '100.00', delayHours: 24, funds: '12,000.00' } };
  const deposit = await codec.program.methods.withdrawInstant(new (await import('@anchor-lang/core')).BN(100_000_000)).accountsStrict({ vault, owner: owner.publicKey, mint,
    tokenProgram: (await import('@solana/spl-token')).TOKEN_PROGRAM_ID, vaultToken: new PublicKey(data.vaultToken), destination: new PublicKey(data.thiefToken) }).instruction();
  const tx = new Transaction({ feePayer: owner.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58() }).add(deposit);
  let prepareMessage = tx.serializeMessage(); let submitted = false; let healthy = true;
  const relays: { path: string; body: unknown }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === '/v1/health') return Response.json({ ok: true, cluster: healthy ? 'devnet' : 'mainnet', program_id: codec.program.programId.toBase58(), ai_guardian: SENTINEL_AI_GUARDIAN, version: '0.1.0' });
    if (path === '/v1/demo/session') return Response.json(data, { status: 201 });
    if (path.endsWith('/attack')) return Response.json({ kind: 'allowance', nonce: 'one-time-nonce', message: prepareMessage.toString('base64') });
    if (path.endsWith('/decision') || path.endsWith('/call')) { relays.push({ path, body: JSON.parse(String(init?.body)) }); return Response.json({ ok: true }); }
    const body = JSON.parse(String(init?.body)); submitted = true;
    assert.deepEqual(Object.keys(body), ['signature']);
    assert(ed25519.verify(bs58.decode(body.signature), prepareMessage, owner.publicKey.toBytes()));
    return Response.json({ ok: true, sig: bs58.encode(Buffer.alloc(64, 2)) });
  };
  const client = new SentinelDemoClient('http://127.0.0.1:8787', fetcher, true);
  return { client, tx, owner, relays, setMessage: (message: Buffer) => { prepareMessage = message; }, submitted: () => submitted, setHealthy: (value: boolean) => { healthy = value; } };
}

test('disposable demo owner stays out of public session; exact prepared message is signed and only signature submitted', async () => {
  const f = await fixture(); const session = await f.client.start();
  assert(!('stolenKey' in session));
  assert.equal((await f.client.attack('allowance')).ok, true); assert(f.submitted());
  f.client.dispose(); await assert.rejects(f.client.attack('allowance'), /Start a live demo/);
});

test('health mismatch stops demo creation', async () => {
  const f = await fixture(); f.setHealthy(false);
  await assert.rejects(f.client.start(), /announced devnet/); assert(!f.submitted());
});

test('voice decisions bind the active session, keep button fallback and relay bounded display-only captions', async () => {
  const f = await fixture();
  await assert.rejects(f.client.decide('cancel', 'voice'), /Start a live demo/);
  const session = await f.client.start();
  await f.client.decide('cancel', 'voice'); await f.client.decide('allow');
  await f.client.relayCall({ status: 'connected' }); await f.client.relayCall({ who: 'owner', text: 'a'.repeat(500) });
  assert.deepEqual(f.relays, [
    { path: `/v1/demo/${session.session}/decision`, body: { decision: 'cancel', via: 'voice' } },
    { path: `/v1/demo/${session.session}/decision`, body: { decision: 'allow', via: 'button' } },
    { path: `/v1/demo/${session.session}/call`, body: { status: 'connected' } },
    { path: `/v1/demo/${session.session}/call`, body: { who: 'owner', text: 'a'.repeat(400) } },
  ]);
  f.client.dispose(); await assert.rejects(f.client.relayCall({ status: 'ended' }), /Start a live demo/);
  await assert.rejects(f.client.decide('allow', 'voice'), /Start a live demo/);
});

test('demo rejects another program, substituted recipient, extra instructions and changed amount before signing', async () => {
  for (const type of ['program', 'recipient', 'extra', 'amount']) {
    const f = await fixture(); await f.client.start();
    if (type === 'program') f.tx.instructions[0].programId = PublicKey.default;
    if (type === 'recipient') f.tx.instructions[0].keys.at(-1)!.pubkey = Keypair.generate().publicKey;
    if (type === 'extra') f.tx.add(new TransactionInstruction({ programId: PublicKey.default, keys: [], data: Buffer.alloc(0) }));
    if (type === 'amount') f.tx.instructions[0].data = Buffer.alloc(f.tx.instructions[0].data.length);
    f.setMessage(f.tx.serializeMessage());
    await assert.rejects(f.client.attack('allowance')); assert(!f.submitted());
  }
});

test('SSE decoder handles split frames, CRLF, keepalives and rejects malformed/unknown event shapes', () => {
  const received: DemoEvent[] = []; const decoder = new DemoEventDecoder(event => received.push(event));
  const frame = `data: ${JSON.stringify({ t: 1, type: 'state', vault: '12000', thief: '0', frozen: false, pending: 0 })}\r\n\r\n`;
  decoder.feed(': ping\n\n' + frame.slice(0, 20)); assert.equal(received.length, 0);
  decoder.feed(frame.slice(20)); assert.equal(received.length, 1);
  decoder.feed('data: {bad}\n\ndata: {"t":2,"type":"future"}\n\ndata: {"t":3,"type":"log","text":{}}\n\n');
  assert.equal(received.length, 1);
  decoder.feed('data: {"t":4,"type":"log",\ndata: "text":"Watching"}\n\n'); assert.equal(received.length, 2);
  decoder.feed('data: {"t":5,"type":"incoming","amount":"12,000 dUSDC","reason":"New destination","timeoutSecs":90}\n\n');
  decoder.feed('data: {"t":6,"type":"decision","decision":"cancel","via":"button"}\n\n');
  assert.equal(received.length, 4); assert.equal(received[2].type, 'incoming'); assert.equal(received[3].type, 'decision');
  decoder.feed('data: {"t":7,"type":"phone","status":"ready"}\n\ndata: {"t":8,"type":"call","who":"argus","text":"","status":"connected"}\n\n');
  assert.equal(received.length, 6); assert.equal(received[4].type, 'phone'); assert.equal(received[5].type, 'call');
});
