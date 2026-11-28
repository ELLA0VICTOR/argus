// Real devnet integration check. Keys exist only in memory; receipts contain public data only.
import { strict as assert } from 'node:assert';
import { writeFileSync, mkdirSync } from 'node:fs';
import { Connection, Keypair, PublicKey, type TransactionInstruction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { ed25519 } from '@noble/curves/ed25519.js';
import { ArgusClient } from '../src/program/client.ts';
import { runTransaction, saveTransaction, type TransactionState } from '../src/program/transactions.ts';
import { loadHistory } from '../src/program/history.ts';
import { readVault } from '../src/program/read.ts';
import { ARGUS_ERRORS } from '../src/program/errors.ts';
import { LiveSentinel, HOSTED_SENTINEL_URL } from '../src/sentinel/live.ts';

const api = new LiveSentinel();
const connection = new Connection(`${HOSTED_SENTINEL_URL}/v1/rpc/devnet`, { commitment: 'confirmed', disableRetryOnRateLimit: true,
  fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20_000) }) });
const client = new ArgusClient(connection);
const owner = Keypair.generate(); const guardian = Keypair.generate(); const safe = Keypair.generate().publicKey; const recipient = Keypair.generate().publicKey;
const receipts: { label: string; signature?: string; message?: string }[] = [];
const stored = new Map<string, string>();
const store = { getItemAsync: async (key: string) => stored.get(key) ?? null, setItemAsync: async (key: string, value: string) => { stored.set(key, value); } };
const check = (label: string, signature?: string, message?: string) => { receipts.push({ label, signature, message }); console.log(`PASS ${receipts.length}: ${label}`); };
async function send(label: string, signer: Keypair, instructions: TransactionInstruction[], expectedCode?: keyof typeof ARGUS_ERRORS) {
  let signatures = 0;
  const result = await runTransaction(connection, signer.publicKey, instructions, async tx => { signatures++; tx.partialSign(signer); return tx; }, () => {}, pending => saveTransaction(store, pending));
  await saveTransaction(store, result);
  if (expectedCode) { assert.equal(result.phase, 'failed'); assert.equal(result.message, ARGUS_ERRORS[expectedCode].message); assert.equal(signatures, 0); }
  else assert.equal(result.phase, 'confirmed', `${label}: ${result.message} (${result.signature ?? 'not signed'})`);
  check(label, result.signature, result.message);
  return result;
}
const signMessage = (signer: Keypair) => async (message: Uint8Array) => new Uint8Array([...message, ...ed25519.sign(message, signer.secretKey.subarray(0, 32))]);
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const info = await api.health(); check('Hosted health identity');
  await api.faucet(owner.publicKey.toBase58()); check('Owner faucet');
  await api.faucet(guardian.publicKey.toBase58()); check('Guardian faucet');
  const mint = new PublicKey(info.test_mint); const ownerToken = getAssociatedTokenAddressSync(mint, owner.publicKey);
  const destination = getAssociatedTokenAddressSync(mint, recipient);
  const id = BigInt(Date.now()); const vaultA = client.vaultAddress(owner.publicKey, id)[0]; const vaultB = client.vaultAddress(owner.publicKey, id + 1n)[0];
  await send('Create vault', owner, [await client.initializeVault(owner.publicKey, mint, { vaultId: id, guardians: [guardian.publicKey], threshold: 1, aiGuardian: PublicKey.default, safeAddress: safe, delaySeconds: 60n, dailyLimit: 100_000_000n })]);
  let v = await client.fetchVault(vaultA);
  await send('Deposit 500 dUSDC', owner, [await client.deposit(v, owner.publicKey, ownerToken, 500_000_000n)]);
  const createDestination = createAssociatedTokenAccountIdempotentInstruction(owner.publicKey, destination, recipient, mint);
  await send('Reject an oversized instant send before signing', owner, [createDestination, await client.withdrawInstant(v, owner.publicKey, destination, 101_000_000n)], 6004);
  await send('Instant send 50 dUSDC', owner, [createDestination, await client.withdrawInstant(v, owner.publicKey, destination, 50_000_000n)]);
  v = await client.fetchVault(vaultA); const requestAddress = client.withdrawalAddress(vaultA, BigInt(v.data.nextWithdrawalId.toString()))[0];
  await send('Request 100 dUSDC', owner, [await client.requestWithdrawal(v, owner.publicKey, destination, 100_000_000n)]);
  const withdrawal = await client.fetchWithdrawal(requestAddress, vaultA);
  await send('Reject early release', owner, [await client.executeWithdrawal(v, owner.publicKey, withdrawal)], 6007);
  v = await client.fetchVault(vaultA); const proposalAddress = client.proposalAddress(vaultA, BigInt(v.data.nextProposalId.toString()))[0];
  await send('Guardian proposes trusted address', guardian, [await client.propose(v, guardian.publicKey, { addTrusted: { wallet: recipient } })]);
  const proposal = await client.fetchProposal(proposalAddress, vaultA);
  const ready = Math.max(Number(withdrawal.data.executesAt.toString()), Number(proposal.data.eta.toString())) * 1000 + 20_000;
  while (Date.now() < ready) { console.log(`Waiting for on-chain delay: ${Math.ceil((ready - Date.now()) / 1000)}s`); await pause(Math.min(15_000, ready - Date.now())); }
  v = await client.fetchVault(vaultA);
  await send('Release after the delay', owner, [await client.executeWithdrawal(v, owner.publicKey, withdrawal)]);
  await send('Apply approved trusted address', guardian, [await client.executeProposal(guardian.publicKey, proposal)]);
  v = await client.fetchVault(vaultA);
  await send('Trusted send beyond remaining allowance', owner, [await client.withdrawTrusted(v, owner.publicKey, destination, 70_000_000n)]);
  await send('Freeze with owner key', owner, [await client.freeze(vaultA, owner.publicKey)]);
  v = await client.fetchVault(vaultA); const unfreezeAddress = client.proposalAddress(vaultA, BigInt(v.data.nextProposalId.toString()))[0];
  await send('Guardian proposes unfreeze', guardian, [await client.propose(v, guardian.publicKey, { unfreeze: {} })]);
  await send('Apply approved unfreeze', owner, [await client.executeProposal(owner.publicKey, await client.fetchProposal(unfreezeAddress, vaultA))]);
  await send('Guardian sweeps only to preset safe address and freezes', guardian, [await client.emergencySweep(await client.fetchVault(vaultA), guardian.publicKey, true)]);
  const a = await readVault(client, vaultA); assert.equal(a.balance, '0'); assert(a.vault.data.frozen); check('Sweep balance and frozen state verified');
  const history = await loadHistory(client, vaultA, a.history ?? [], a.decimals, 'dUSDC'); assert(history.some(e => /safe address|Vault frozen|Proposal/.test(e.title))); check('IDL-decoded live history');
  await send('Create monitored vault', owner, [await client.initializeVault(owner.publicKey, mint, { vaultId: id + 1n, guardians: [guardian.publicKey], threshold: 1, aiGuardian: new PublicKey(info.ai_guardian), safeAddress: safe, delaySeconds: 60n, dailyLimit: 100_000_000n })]);
  v = await client.fetchVault(vaultB);
  await send('Deposit 200 into monitored vault', owner, [await client.deposit(v, owner.publicKey, ownerToken, 200_000_000n)]);
  const monitoredRequest = client.withdrawalAddress(vaultB, BigInt(v.data.nextWithdrawalId.toString()))[0];
  await send('Request suspicious 75% withdrawal', owner, [await client.requestWithdrawal(v, owner.publicKey, destination, 150_000_000n)]);
  const alerts = await api.alerts(vaultB.toBase58()); const alert = alerts.find(a => a.withdrawal?.pda === monitoredRequest.toBase58());
  assert(alert); assert.equal(alert.risk, 'critical'); check('Real critical Sentinel alert');
  await assert.rejects(api.dismiss(vaultB.toBase58(), alert.id, owner.publicKey.toBase58(), signMessage(owner)), /guardian/); check('Owner cannot dismiss critical alert');
  await api.dismiss(vaultB.toBase58(), alert.id, guardian.publicKey.toBase58(), signMessage(guardian)); check('Guardian signs exact dismissal message');
  const stillPending = await client.fetchWithdrawal(monitoredRequest, vaultB); check('Dismissal preserves withdrawal delay and does not execute');
  await send('Owner cancels monitored withdrawal', owner, [await client.cancelWithdrawal(owner.publicKey, stillPending)]);
  await send('Guardian freezes monitored vault', guardian, [await client.freeze(vaultB, guardian.publicKey)]);
  assert.equal((await readVault(client, vaultB)).balance, '200000000'); check('Monitored vault funds stayed put');
  mkdirSync('.program-check', { recursive: true });
  writeFileSync('.program-check/live-smoke.json', JSON.stringify({ at: new Date().toISOString(), cluster: 'devnet', vaults: [vaultA.toBase58(), vaultB.toBase58()], owner: owner.publicKey.toBase58(), guardian: guardian.publicKey.toBase58(), receipts }, null, 2));
  console.log(`All ${receipts.length} live checks passed. This uses ephemeral local signers, not a physical MWA wallet.`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Live smoke failed'); process.exitCode = 1; });
