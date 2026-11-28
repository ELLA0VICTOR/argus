import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import bs58 from 'bs58';
import { Buffer } from 'buffer';
import { DEVNET_GENESIS, confirmSignedTransaction, checkTransaction, parseAmount, restorePendingTransaction, runTransaction, saveTransaction, transactionBusy, type TransactionState } from './transactions.ts';
import { ARGUS_PROGRAM_ID } from './client.ts';
import { ARGUS_ERRORS } from './errors.ts';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { formatTypedAmount } from '../domain/amountInput.ts';
import { createRpcFetch } from './rpcFetch.ts';

test('the required genesis matches the independently queried deployment cluster', () => {
  const observed = JSON.parse(readFileSync(new URL('../../../docs/audits/devnet-2026-11-27/deployment.json', import.meta.url), 'utf8'));
  assert.equal(DEVNET_GENESIS, observed.genesisHash);
});

function fixture() {
  const signer = Keypair.generate(); // Ephemeral test wallet. Never written to disk.
  const connection = new Connection('http://localhost:8899');
  const states: TransactionState[] = [];
  const recent = { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 };
  let broadcasts = 0; let persisted = false;
  connection.getGenesisHash = async () => DEVNET_GENESIS;
  connection.getLatestBlockhash = async () => recent;
  connection.simulateTransaction = async () => ({ context: { slot: 1 }, value: { err: null, logs: [], accounts: null, unitsConsumed: 1, returnData: null, innerInstructions: [] } });
  connection.sendRawTransaction = async (bytes, options) => {
    assert(persisted, 'signature must survive an app restart before broadcast');
    assert.equal(options?.skipPreflight, false); assert.equal(options?.maxRetries, 0);
    broadcasts++;
    const signed = Transaction.from(bytes); assert(signed.verifySignatures());
    return bs58.encode(signed.signature!);
  };
  connection.getSignatureStatuses = async () => ({ context: { slot: 1 }, value: [{ slot: 1, confirmations: 1, err: null, confirmationStatus: 'confirmed' }] });
  connection.getBlockHeight = async () => 90;
  const ix = new TransactionInstruction({ programId: ARGUS_PROGRAM_ID, keys: [{ pubkey: signer.publicKey, isSigner: true, isWritable: false }], data: Buffer.alloc(0) });
  const sign = async (tx: Transaction) => { tx.partialSign(signer); return tx; };
  const persist = async (state: TransactionState) => { assert(state.signature); persisted = true; };
  return { connection, signer, ix, sign, persist, states, emit: (state: TransactionState) => states.push(state), broadcasts: () => broadcasts };
}

test('MWA signing pipeline persists the signature before one preflight-checked send and confirms', async () => {
  const f = fixture(); const result = await runTransaction(f.connection, f.signer.publicKey, [f.ix], f.sign, f.emit, f.persist);
  assert.equal(result.phase, 'confirmed'); assert.equal(f.broadcasts(), 1); assert(result.signature);
  assert.deepEqual(f.states.map(s => s.phase), ['preparing', 'wallet', 'sending', 'confirming', 'confirmed']);
  assert(!transactionBusy(result));
});

test('native SecureStore can persist a signed transaction and restore its retry block after restart', async () => {
  const values = new Map<string, string>();
  const validKey = (key: string) => { if (!/^[\w.-]+$/.test(key)) throw new Error('Invalid key provided to SecureStore'); };
  const store = {
    getItemAsync: async (key: string) => { validKey(key); return values.get(key) ?? null; },
    setItemAsync: async (key: string, value: string) => { validKey(key); values.set(key, value); },
  };
  assert.equal(await restorePendingTransaction(store), null);
  const f = fixture();
  f.connection.getSignatureStatuses = async () => { throw new Error('lost connection'); };
  const result = await runTransaction(f.connection, f.signer.publicKey, [f.ix], f.sign, f.emit,
    async state => { await saveTransaction(store, state); await f.persist(state); });
  assert.equal(result.phase, 'unknown');
  const restored = await restorePendingTransaction(store);
  assert(restored); assert.equal(restored.signature, result.signature); assert(transactionBusy(restored));
  await saveTransaction(store, { ...result, phase: 'confirmed' });
  assert.equal(await restorePendingTransaction(store), null);
});

test('a non-devnet RPC is rejected before a wallet prompt or broadcast', async () => {
  const f = fixture(); f.connection.getGenesisHash = async () => 'mainnet';
  const result = await runTransaction(f.connection, f.signer.publicKey, [f.ix], async () => { throw new Error('must not reach wallet'); }, f.emit);
  assert.equal(result.phase, 'failed'); assert.match(result.message!, /devnet RPC/); assert.equal(f.broadcasts(), 0);
});

test('a wallet cannot change transaction contents or return an unsigned payload', async () => {
  for (const mutate of [true, false]) {
    const f = fixture();
    const result = await runTransaction(f.connection, f.signer.publicKey, [f.ix], async tx => {
      if (mutate) { tx.add(new TransactionInstruction({ programId: PublicKey.default, keys: [], data: Buffer.from([9]) })); tx.partialSign(f.signer); }
      return tx;
    }, f.emit, f.persist);
    assert.equal(result.phase, 'failed'); assert.equal(f.broadcasts(), 0);
  }
});

test('wallet rejection never broadcasts and offers a retry', async () => {
  const f = fixture(); const result = await runTransaction(f.connection, f.signer.publicKey, [f.ix], async () => { throw new Error('user refused'); }, f.emit, f.persist);
  assert.equal(result.phase, 'failed'); assert.match(result.message!, /declined/); assert.equal(f.broadcasts(), 0);
});

test('a failing live simulation shows the program message before opening the wallet', async () => {
  const f = fixture();
  f.connection.simulateTransaction = async () => ({ context: { slot: 1 }, value: { err: { InstructionError: [0, { Custom: 6000 }] }, logs: [], accounts: null, unitsConsumed: 1, returnData: null, innerInstructions: [] } });
  const result = await runTransaction(f.connection, f.signer.publicKey, [f.ix], async () => { throw new Error('wallet must not open'); }, f.emit, f.persist);
  assert.equal(result.phase, 'failed'); assert.equal(result.message, ARGUS_ERRORS[6000].message); assert.equal(f.broadcasts(), 0);
});

test('ambiguous transport failure keeps the signed signature and blocks a second action', async () => {
  const f = fixture(); let attempted = 0;
  f.connection.sendRawTransaction = async () => { attempted++; throw new Error('connection closed after submit'); };
  const result = await runTransaction(f.connection, f.signer.publicKey, [f.ix], f.sign, f.emit, f.persist);
  assert.equal(result.phase, 'unknown'); assert(result.signature); assert(transactionBusy(result)); assert.equal(attempted, 1);
});

test('confirmation failure maps the failing Argus instruction including its new expiry error', async () => {
  const f = fixture();
  f.connection.getSignatureStatuses = async () => ({ context: { slot: 1 }, value: [{ slot: 1, confirmations: 1, err: { InstructionError: [0, { Custom: 6032 }] }, confirmationStatus: 'confirmed' }] });
  const result = await runTransaction(f.connection, f.signer.publicKey, [f.ix], f.sign, f.emit, f.persist);
  assert.equal(result.phase, 'failed'); assert.equal(result.message, ARGUS_ERRORS[6032].message);
});

test('unknown confirmation can recover without broadcasting again', async () => {
  const f = fixture(); f.connection.getSignatureStatuses = async () => { throw new Error('timeout'); };
  const pending = await runTransaction(f.connection, f.signer.publicKey, [f.ix], f.sign, f.emit, f.persist);
  f.connection.getSignatureStatuses = async () => ({ context: { slot: 1 }, value: [{ slot: 1, confirmations: 1, err: null, confirmationStatus: 'confirmed' }] });
  const recovered = await checkTransaction(f.connection, pending);
  assert.equal(recovered.phase, 'confirmed'); assert.equal(f.broadcasts(), 1);
});

test('an absent signature remains blocked until its blockhash expires', async () => {
  const f = fixture(); const pending: TransactionState = { phase: 'unknown', signature: 'test', lastValidBlockHeight: 100 };
  f.connection.getSignatureStatuses = async () => ({ context: { slot: 1 }, value: [null] });
  f.connection.getBlockHeight = async () => 99;
  assert.equal((await checkTransaction(f.connection, pending)).phase, 'unknown');
  f.connection.getBlockHeight = async () => 101;
  assert.equal((await checkTransaction(f.connection, pending)).phase, 'failed');
});

test('HTTP confirmation waits for commitment and has a bounded deadline without WebSockets', async () => {
  const f = fixture(); let calls = 0; let clock = 0;
  f.connection.confirmTransaction = async () => { throw new Error('WebSocket confirmation must not run'); };
  f.connection.getSignatureStatuses = async () => ({ context: { slot: 1 }, value: [{ slot: 1, confirmations: calls++ ? 1 : 0, err: null, confirmationStatus: calls > 1 ? 'confirmed' : 'processed' }] });
  const result = await confirmSignedTransaction(f.connection, 'test', 100, { now: () => clock, sleep: async ms => { clock += ms; } });
  assert.equal(result.value.err, null); assert.equal(calls, 2);
  f.connection.getSignatureStatuses = async () => ({ context: { slot: 1 }, value: [null] });
  await assert.rejects(confirmSignedTransaction(f.connection, 'test', 100, { now: () => clock, sleep: async ms => { clock += ms; }, timeoutMs: 3000 }), /timed out/);
});

test('a processed fork error cannot unlock another send before it is confirmed', async () => {
  const f = fixture(); const pending: TransactionState = { phase: 'unknown', signature: 'test', lastValidBlockHeight: 100 };
  f.connection.getSignatureStatuses = async () => ({ context: { slot: 1 }, value: [{ slot: 1, confirmations: 0, err: { InstructionError: [0, { Custom: 6000 }] }, confirmationStatus: 'processed' }] });
  f.connection.getBlockHeight = async () => 101;
  assert.equal((await checkTransaction(f.connection, pending)).phase, 'unknown');
});

test('unreadable secure transaction state fails closed instead of being treated as no pending transaction', async () => {
  for (const raw of ['not-json', '{}', 'null', '{"phase":"unknown","signature":"broken"}']) {
    await assert.rejects(restorePendingTransaction({ getItemAsync: async () => raw, setItemAsync: async () => {} }));
  }
  await assert.rejects(restorePendingTransaction({ getItemAsync: async () => { throw new Error('storage unavailable'); }, setItemAsync: async () => {} }), /storage unavailable/);
});

test('relay failures fall back for reads, but never resend a transaction after an ambiguous submit', async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push(`${String(input)}:${JSON.parse(String(init?.body)).method}`);
    if (String(input).includes('relay')) throw new Error('Relay connection lost');
    return new Response('{"jsonrpc":"2.0","id":1,"result":true}');
  };
  const reads = createRpcFetch(true, fetcher);
  await reads('https://relay.example', { body: JSON.stringify({ method: 'getGenesisHash' }) });
  assert.deepEqual(calls, ['https://relay.example:getGenesisHash', 'https://api.devnet.solana.com:getGenesisHash']);
  calls.length = 0;
  const sends = createRpcFetch(true, fetcher);
  await assert.rejects(sends('https://relay.example', { body: JSON.stringify({ method: 'sendTransaction' }) }), /lost/);
  assert.deepEqual(calls, ['https://relay.example:sendTransaction']);
  await sends('https://relay.example', { body: JSON.stringify({ method: 'getSignatureStatuses' }) });
  assert.equal(calls.at(-1), 'https://api.devnet.solana.com:getSignatureStatuses');
  calls.length = 0;
  await assert.rejects(createRpcFetch(false, fetcher)('https://relay.example', { body: JSON.stringify({ method: 'getGenesisHash' }) }));
  assert.equal(calls.length, 1);
});

test('token parsing never rounds or silently accepts more precision than the mint', () => {
  assert.equal(parseAmount('12.000001', 6), 12_000_001n);
  assert.equal(parseAmount('18446744073709551615', 0), (1n << 64n) - 1n);
  for (const text of ['0', '-1', '1e3', '1,000', '0.0000001', '18446744073709551616']) assert.throws(() => parseAmount(text, text.includes('.') ? 6 : 0));
});

test('Send groups typed and pasted amounts while preserving the exact transaction value', () => {
  for (const [input, displayed, units] of [
    ['12000.50', '12,000.50', 12_000_500_000n],
    ['1,2345.00', '12,345.00', 12_345_000_000n],
    ['.25', '0.25', 250_000n],
    ['00012000.500000', '12,000.500000', 12_000_500_000n],
    ['18446744073709.551615', '18,446,744,073,709.551615', (1n << 64n) - 1n],
  ] as const) {
    const formatted = formatTypedAmount(input);
    assert.equal(formatted, displayed);
    assert.equal(parseAmount(formatted.replace(/,/g, ''), 6), units);
  }
  assert.equal(formatTypedAmount(''), '');
  assert.equal(formatTypedAmount('12000.'), '12,000.');
  assert.equal(formatTypedAmount('12000.00'), '12,000.00');
  for (const invalid of ['-1', '1e3', '1.2.3', '0.0000001']) {
    assert.equal(formatTypedAmount(invalid), invalid);
    assert.throws(() => parseAmount(formatTypedAmount(invalid).replace(/,/g, ''), 6));
  }
});
