import { Connection, PublicKey, Transaction, VersionedTransaction, type TransactionInstruction, type RpcResponseAndContext, type SignatureResult } from '@solana/web3.js';
import bs58 from 'bs58';
import { transactionErrorMessage, UNKNOWN_TRANSACTION_MESSAGE } from './errors.ts';

export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
// SecureStore permits only letters, numbers, dots, underscores and hyphens.
export const PENDING_TRANSACTION_KEY = 'argus.pending-devnet-transaction';
export type TransactionState = {
  phase: 'idle' | 'preparing' | 'wallet' | 'sending' | 'confirming' | 'confirmed' | 'failed' | 'unknown';
  signature?: string; message?: string; blockhash?: string; lastValidBlockHeight?: number;
  programs?: string[];
};
type TransactionStore = { getItemAsync: (key: string) => Promise<string | null>; setItemAsync: (key: string, value: string) => Promise<void> };
export async function restorePendingTransaction(store: TransactionStore): Promise<TransactionState | null> {
  const raw = await store.getItemAsync(PENDING_TRANSACTION_KEY);
  if (!raw) return null;
  const state = JSON.parse(raw) as TransactionState;
  if (!state || typeof state !== 'object' || !['idle', 'preparing', 'wallet', 'sending', 'confirming', 'confirmed', 'failed', 'unknown'].includes(state.phase)) throw new Error('Stored transaction status is unreadable.');
  if (['sending', 'confirming', 'unknown'].includes(state.phase)) {
    try {
      if (typeof state.signature !== 'string' || bs58.decode(state.signature).length !== 64 ||
        typeof state.blockhash !== 'string' || bs58.decode(state.blockhash).length !== 32 ||
        !Number.isSafeInteger(state.lastValidBlockHeight) || state.lastValidBlockHeight! <= 0 ||
        (state.programs !== undefined && (!Array.isArray(state.programs) || state.programs.some(p => bs58.decode(p).length !== 32)))) throw new Error();
    } catch { throw new Error('Stored transaction status is unreadable.'); }
    return { ...state, phase: 'unknown' };
  }
  return null;
}
export const saveTransaction = (store: TransactionStore, state: TransactionState) => store.setItemAsync(PENDING_TRANSACTION_KEY, JSON.stringify(state));
export const transactionUrl = (signature: string) => `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`;
export const transactionBusy = (state: TransactionState) => ['preparing', 'wallet', 'sending', 'confirming', 'unknown'].includes(state.phase);

export async function requireDevnet(connection: Connection): Promise<void> {
  if (await connection.getGenesisHash() !== DEVNET_GENESIS) throw new Error('Choose a Solana devnet RPC connection.');
}

/** The hosted relay is HTTP-only. Poll confirmation with a deadline, without a WebSocket dependency. */
export async function confirmSignedTransaction(connection: Connection, signature: string, lastValidBlockHeight: number,
  options: { now?: () => number; sleep?: (ms: number) => Promise<void>; timeoutMs?: number } = {}): Promise<RpcResponseAndContext<SignatureResult>> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const deadline = now() + (options.timeoutMs ?? 45_000);
  while (now() < deadline) {
    const result = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const status = result.value[0];
    if (status && ['confirmed', 'finalized'].includes(status.confirmationStatus ?? '')) return { context: result.context, value: { err: status.err } };
    if (!status && await connection.getBlockHeight('confirmed') > lastValidBlockHeight) throw new Error('Confirmation is uncertain after blockhash expiry.');
    await sleep(1500);
  }
  throw new Error('Confirmation timed out.');
}

/** Wallet signs; this app broadcasts to its verified devnet RPC. Never automatically retries a send. */
export async function runTransaction(connection: Connection, signer: PublicKey, instructions: TransactionInstruction[],
  sign: (transaction: Transaction) => Promise<Transaction>, emit: (state: TransactionState) => void,
  persistPending?: (state: TransactionState) => Promise<void>): Promise<TransactionState> {
  let state: TransactionState = { phase: 'preparing' };
  const update = (next: TransactionState) => { state = next; emit(next); return next; };
  update(state);
  try {
    await requireDevnet(connection);
    const recent = await connection.getLatestBlockhash('confirmed');
    const tx = new Transaction({ feePayer: signer, ...recent }).add(...instructions);
    const programs = instructions.map(ix => ix.programId.toBase58());
    const simulation = await connection.simulateTransaction(new VersionedTransaction(tx.compileMessage()), { commitment: 'confirmed', sigVerify: false });
    if (simulation.value.err) return update({ phase: 'failed', message: transactionErrorMessage({ err: simulation.value.err, logs: simulation.value.logs }, programs) });
    const message = tx.serializeMessage();
    update({ phase: 'wallet', ...recent, programs });
    const signed = await sign(tx);
    if (!signed.serializeMessage().equals(message) || !signed.verifySignatures()) throw new Error('The wallet returned a changed or invalid transaction.');
    if (!signed.signature) throw new Error('The wallet did not sign the transaction.');
    const signature = bs58.encode(signed.signature);
    update({ phase: 'sending', signature, ...recent, programs });
    await persistPending?.(state); // Keep the signature before broadcast, including across an app restart.
    const returned = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0 });
    if (returned !== signature) return update({ ...state, phase: 'unknown', message: 'The RPC returned an unexpected signature. Check status before retrying.' });
    update({ ...state, phase: 'confirming' });
    const result = await confirmSignedTransaction(connection, signature, recent.lastValidBlockHeight);
    if (result.value.err) return update({ ...state, phase: 'failed', message: transactionErrorMessage(result.value.err, instructions.map(ix => ix.programId.toBase58())) });
    return update({ ...state, phase: 'confirmed', message: 'Confirmed on Solana devnet.' });
  } catch (error) {
    const mapped = transactionErrorMessage(error, instructions.map(ix => ix.programId.toBase58()));
    if (state.signature && mapped === UNKNOWN_TRANSACTION_MESSAGE) {
      return update({ ...state, phase: 'unknown', message: 'Confirmation is uncertain. Check this transaction before sending another.' });
    }
    const raw = error instanceof Error ? error.message : '';
    const message = mapped !== UNKNOWN_TRANSACTION_MESSAGE ? mapped
      : /changed|invalid transaction|devnet RPC|did not sign/.test(raw) ? raw
      : state.phase === 'wallet' ? 'The wallet request was declined or interrupted. You can try again.'
      : 'Could not prepare the transaction. Check your connection and retry.';
    return update({ ...state, phase: 'failed', message });
  }
}

export async function checkTransaction(connection: Connection, current: TransactionState): Promise<TransactionState> {
  if (!current.signature) return current;
  await requireDevnet(connection);
  const { value: [status] } = await connection.getSignatureStatuses([current.signature], { searchTransactionHistory: true });
  if (status && ['confirmed', 'finalized'].includes(status.confirmationStatus ?? '')) return status.err
    ? { ...current, phase: 'failed', message: transactionErrorMessage(status.err, current.programs ?? []) }
    : { ...current, phase: 'confirmed', message: 'Confirmed on Solana devnet.' };
  if (!status && current.lastValidBlockHeight && await connection.getBlockHeight('confirmed') > current.lastValidBlockHeight) {
    return { ...current, phase: 'failed', message: 'This transaction expired without a confirmed signature. Refresh before retrying.' };
  }
  return { ...current, phase: 'unknown', message: 'Still waiting for a confirmed result. Check again before retrying.' };
}

export function parseAmount(text: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255 || !/^\d+(?:\.\d+)?$/.test(text.trim())) throw new Error('Enter a positive token amount using digits and a decimal point.');
  const [whole, fractional = ''] = text.trim().split('.');
  if (fractional.length > decimals) throw new Error(`This token supports ${decimals} decimal places.`);
  const value = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fractional.padEnd(decimals, '0') || '0');
  if (value <= 0n || value > (1n << 64n) - 1n) throw new Error('Enter an amount within the token’s supported range.');
  return value;
}
