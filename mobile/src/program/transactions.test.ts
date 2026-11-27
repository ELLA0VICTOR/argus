import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import bs58 from 'bs58';
import { Buffer } from 'buffer';
import { DEVNET_GENESIS, checkTransaction, parseAmount, runTransaction, transactionBusy, type TransactionState } from './transactions.ts';
import { ARGUS_PROGRAM_ID } from './client.ts';
import { ARGUS_ERRORS } from './errors.ts';
import { readFileSync } from 'node:fs';

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
  connection.confirmTransaction = async () => ({ context: { slot: 1 }, value: { err: null } });
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
  f.connection.confirmTransaction = async () => ({ context: { slot: 1 }, value: { err: { InstructionError: [0, { Custom: 6032 }] } } });
  const result = await runTransaction(f.connection, f.signer.publicKey, [f.ix], f.sign, f.emit, f.persist);
  assert.equal(result.phase, 'failed'); assert.equal(result.message, ARGUS_ERRORS[6032].message);
});

test('unknown confirmation can recover without broadcasting again', async () => {
  const f = fixture(); f.connection.confirmTransaction = async () => { throw new Error('timeout'); };
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

test('token parsing never rounds or silently accepts more precision than the mint', () => {
  assert.equal(parseAmount('12.000001', 6), 12_000_001n);
  assert.equal(parseAmount('18446744073709551615', 0), (1n << 64n) - 1n);
  for (const text of ['0', '-1', '1e3', '1,000', '0.0000001', '18446744073709551616']) assert.throws(() => parseAmount(text, text.includes('.') ? 6 : 0));
});
