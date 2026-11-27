import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { BorshInstructionCoder } from '@anchor-lang/core';
import { Connection, PublicKey, SystemProgram, type AccountInfo, type TransactionInstruction } from '@solana/web3.js';
import { AccountLayout, MintLayout, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Buffer } from 'buffer';
import { ArgusClient, ARGUS_PROGRAM_ID, integer,
  type GovAction, type Proposal, type RecordAt, type Vault, type Withdrawal } from './client.ts';
import { readVault } from './read.ts';
import { DEVNET_GENESIS } from './transactions.ts';

const pk = (byte: number) => new PublicKey(Buffer.alloc(32, byte));
const client = new ArgusClient(new Connection('http://localhost:8899'));
const creator = pk(1);
const [vaultAddress, vaultBump] = client.vaultAddress(creator, (1n << 64n) - 1n);
const vault: RecordAt<Vault> = { address: vaultAddress, data: {
  version: 1, bump: vaultBump, creator, vaultId: integer((1n << 64n) - 1n), mint: pk(2), owner: pk(3), ownerEpoch: 8,
  guardians: [pk(4), pk(5), pk(6), PublicKey.default, PublicKey.default], guardianCount: 3, threshold: 2,
  guardianEpoch: 2, aiGuardian: pk(7), safeAddress: pk(8), delaySeconds: integer(86_400n, true), dailyLimit: integer(100_000_000n),
  windowStart: integer(1_800_000_000n, true), spentInWindow: integer(12_000_000n), frozen: false, trustedCount: 1,
  nextWithdrawalId: integer(9n), nextProposalId: integer(10n), reserved: Array(64).fill(0),
} };

function withdrawal(): RecordAt<Withdrawal> {
  const [address, bump] = client.withdrawalAddress(vault.address, 9n);
  return { address, data: { vault: vault.address, id: integer(9n), bump, destination: pk(9), amount: integer((1n << 64n) - 1n),
    requestedAt: integer(1_800_000_000n, true), executesAt: integer(1_800_086_400n, true), ownerEpoch: 8, rentPayer: creator } };
}

function proposal(action: GovAction): RecordAt<Proposal> {
  const [address, bump] = client.proposalAddress(vault.address, 10n);
  return { address, data: { vault: vault.address, id: integer(10n), bump, action, approvals: 3, guardianEpoch: 2,
    createdAt: integer(1_800_000_000n, true), eta: integer(1_800_086_400n, true), proposer: pk(4), rentPayer: pk(4) } };
}

async function account(name: 'vault' | 'withdrawal' | 'proposal' | 'trustedAddress', value: object): Promise<AccountInfo<Buffer>> {
  return { owner: ARGUS_PROGRAM_ID, executable: false, lamports: 1, rentEpoch: 0,
    data: await client.program.coder.accounts.encode(name, value) };
}

function verifyInstruction(ix: TransactionInstruction, name: string) {
  const schema = client.program.idl.instructions.find(i => i.name === name)!;
  assert(ix.programId.equals(ARGUS_PROGRAM_ID));
  assert.equal(ix.keys.length, schema.accounts.length);
  schema.accounts.forEach((a, index) => {
    const omitted = 'optional' in a && a.optional && ix.keys[index].pubkey.equals(ARGUS_PROGRAM_ID);
    assert.equal(ix.keys[index].isWritable, !omitted && 'writable' in a && a.writable === true);
    assert.equal(ix.keys[index].isSigner, !omitted && 'signer' in a && a.signer === true);
  });
  const decoded = new BorshInstructionCoder(client.program.idl).decode(ix.data);
  assert.equal(decoded?.name, name);
  return decoded!.data as Record<string, unknown>;
}

test('vendored JSON and TS exactly match the announced generated files', () => {
  assert.equal(ARGUS_PROGRAM_ID.toBase58(), '4LH7ikNGVVNaemB7eaLGUMbwSBHHqA2hKXTdrfhgD6nh');
  for (const extension of ['json', 'ts']) {
    assert.equal(readFileSync(new URL(`../idl/argus.${extension}`, import.meta.url), 'utf8'),
      readFileSync(new URL(`../../../app/src/idl/argus.${extension}`, import.meta.url), 'utf8'));
  }
});

test('IDL account round trips preserve full u64 values and verify address, owner, bump and discriminator', async () => {
  const info = await account('vault', vault.data);
  assert.equal(client.decodeVault(vault.address, info).data.vaultId.toString(), '18446744073709551615');
  assert.throws(() => client.decodeVault(pk(20), info), /vault PDA/);
  assert.throws(() => client.decodeVault(vault.address, { ...info, owner: SystemProgram.programId }), /account owner/);
  assert.throws(() => client.decodeVault(vault.address, { ...info, executable: true }), /data account/);
  assert.throws(() => client.decodeVault(vault.address, { ...info, data: Buffer.alloc(info.data.length) }), /discriminator/i);
  assert.throws(() => client.decodeVault(vault.address, { ...info, data: Buffer.alloc(2) }));
  const badVersion = await account('vault', { ...vault.data, version: 2 });
  assert.throws(() => client.decodeVault(vault.address, badVersion), /version/);
});

test('withdrawal and proposal decoding reject mismatched parent and bump', async () => {
  const w = withdrawal();
  const info = await account('withdrawal', w.data);
  assert.equal(client.decodeWithdrawal(w.address, info, vault.address).data.amount.toString(), '18446744073709551615');
  assert.throws(() => client.decodeWithdrawal(w.address, info, pk(21)), /withdrawal vault/);
  const bad = await account('withdrawal', { ...w.data, bump: (w.data.bump + 1) % 256 });
  assert.throws(() => client.decodeWithdrawal(w.address, bad), /bump/);
  const p = proposal({ unfreeze: {} });
  const pInfo = await account('proposal', p.data);
  assert('unfreeze' in client.decodeProposal(p.address, pInfo, vault.address).data.action);
  assert.throws(() => client.decodeProposal(pk(22), pInfo), /proposal PDA/);
  assert.throws(() => client.decodeProposal(p.address, pInfo, pk(21)), /proposal vault/);
});

test('trusted decoder uses the corrected IDL and verifies both parent and wallet', async () => {
  const wallet = pk(31);
  const [address, bump] = client.trustedAddress(vault.address, wallet);
  const data = { vault: vault.address, wallet, bump, activeAt: integer(1_800_000_000n, true) };
  const info = await account('trustedAddress', data);
  assert.equal(client.decodeTrustedAddress(address, info, vault.address, wallet).data.activeAt.toString(), '1800000000');
  assert.throws(() => client.decodeTrustedAddress(address, info, pk(20), wallet), /trusted vault/);
  assert.throws(() => client.decodeTrustedAddress(address, info, vault.address, pk(20)), /trusted wallet/);
  assert.throws(() => client.decodeTrustedAddress(pk(20), info), /trusted PDA/);
  assert.throws(() => client.decodeTrustedAddress(address, { ...info, owner: SystemProgram.programId }), /account owner/);
  const bad = await account('trustedAddress', { ...data, bump: (bump + 1) % 256 });
  assert.throws(() => client.decodeTrustedAddress(address, bad), /bump/);
});

test('offline builders use the IDL account order, flags and instruction data', async () => {
  const w = withdrawal();
  const p = proposal({ unfreeze: {} });
  const instructions = await Promise.all([
    client.initializeVault(creator, vault.data.mint, { vaultId: 1n, guardians: [pk(4), pk(5)], threshold: 2,
      aiGuardian: pk(7), safeAddress: pk(8), delaySeconds: 86_400n, dailyLimit: (1n << 64n) - 1n }),
    client.deposit(vault, pk(3), pk(9), 1n), client.withdrawInstant(vault, pk(3), pk(9), 1n),
    client.requestWithdrawal(vault, pk(3), pk(9), 1n), client.executeWithdrawal(vault, pk(20), w),
    client.cancelWithdrawal(pk(7), w), client.freeze(vault.address, pk(7)), client.emergencySweep(vault, pk(4), true),
    client.propose(vault, pk(4), { loosenLimits: { dailyLimit: integer(123n), delaySeconds: integer(60n, true) } }),
    client.approve(pk(5), p), client.veto(pk(5), p), client.executeProposal(pk(4), p), client.closeProposal(pk(20), p),
  ]);
  const names = ['initializeVault', 'deposit', 'withdrawInstant', 'requestWithdrawal', 'executeWithdrawal',
    'cancelWithdrawal', 'freeze', 'emergencySweep', 'propose', 'approve', 'veto', 'executeProposal', 'closeProposal'];
  instructions.forEach((ix, i) => verifyInstruction(ix, names[i]));
  assert(instructions[4].keys[3].pubkey.equals(creator)); // stored rent payer, not cranker
  assert(instructions[5].keys[3].pubkey.equals(creator));
  assert(instructions[11].keys[4].pubkey.equals(ARGUS_PROGRAM_ID)); // Anchor optional-account sentinel
  assert(instructions[12].keys[3].pubkey.equals(p.data.rentPayer)); // cleanup refunds the stored payer
  assert.equal((verifyInstruction(instructions[0], names[0]).dailyLimit as { toString(): string }).toString(), '18446744073709551615');
});

test('trusted builder derives the record from the destination token authority', async () => {
  const data = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode({ mint: vault.data.mint, owner: pk(31), amount: 0n, delegateOption: 0, delegate: PublicKey.default,
    state: 1, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default }, data);
  const connection = new Connection('http://localhost:8899');
  connection.getAccountInfo = async () => ({ data, owner: TOKEN_PROGRAM_ID, executable: false, lamports: 1, rentEpoch: 0 });
  const local = new ArgusClient(connection);
  const ix = await local.withdrawTrusted(vault, pk(3), pk(9), 2n);
  verifyInstruction(ix, 'withdrawTrusted');
  assert(ix.keys.at(-1)!.pubkey.equals(local.trustedAddress(vault.address, pk(31))[0]));
  AccountLayout.encode({ ...AccountLayout.decode(data), mint: pk(32) }, data);
  await assert.rejects(local.withdrawTrusted(vault, pk(3), pk(9), 2n), /destination mint/);
});

test('governance optional record includes non-default AI and rotation; removal of AI omits it', async () => {
  const cases: [GovAction, PublicKey | null][] = [
    [{ addTrusted: { wallet: pk(30) } }, pk(30)], [{ removeTrusted: { wallet: pk(30) } }, pk(30)],
    [{ rotateOwner: { newOwner: pk(30) } }, pk(30)], [{ setAiGuardian: { key: pk(30) } }, pk(30)],
    [{ setAiGuardian: { key: PublicKey.default } }, null], [{ unfreeze: {} }, null],
    [{ tightenLimits: { dailyLimit: integer(1n), delaySeconds: integer(100n, true) } }, null],
    [{ loosenLimits: { dailyLimit: integer(1n), delaySeconds: integer(60n, true) } }, null],
    [{ setSafeAddress: { wallet: pk(30) } }, null], [{ setGuardians: { guardians: [pk(4)], threshold: 1 } }, null],
  ];
  for (const [action, wallet] of cases) {
    const p = proposal(action);
    const ix = await client.executeProposal(pk(4), p);
    assert(ix.keys[4].pubkey.equals(wallet ? client.trustedAddress(vault.address, wallet)[0] : ARGUS_PROGRAM_ID));
    const propose = await client.propose(vault, pk(4), action);
    const decoded = verifyInstruction(propose, 'propose');
    assert.equal(JSON.stringify(decoded.action), JSON.stringify(action));
  }
});

test('numeric limits reject lossy or invalid amounts and preserve signed i64', () => {
  assert.equal(integer(-(1n << 63n), true).toString(), '-9223372036854775808');
  for (const value of [-1n, 1n << 64n]) assert.throws(() => integer(value), /u64/);
  assert.throws(() => integer(1n << 63n, true), /i64/);
  assert.throws(() => client.deposit(vault, pk(3), pk(9), 0n), /greater than zero/);
  assert.throws(() => client.withdrawInstant(vault, pk(3), pk(9), -1n), /u64/);
  assert.throws(() => client.executeWithdrawal(vault, pk(20), { ...withdrawal(), data: { ...withdrawal().data, vault: pk(99) } }), /withdrawal vault/);
});

test('recent activity keeps RPC history distinct from empty history and does not block vault reads on failure', async t => {
  const connection = new Connection('http://localhost:8899');
  const local = new ArgusClient(connection);
  const vaultAccount = await account('vault', vault.data);
  const request = withdrawal(); const requestAccount = await account('withdrawal', request.data);
  const mintData = Buffer.alloc(MintLayout.span);
  MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: PublicKey.default, supply: 1_000_000n,
    decimals: 6, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, mintData);
  connection.getGenesisHash = async () => DEVNET_GENESIS;
  connection.getAccountInfo = async address => address.equals(vault.address) ? vaultAccount
    : { data: mintData, owner: TOKEN_PROGRAM_ID, executable: false, lamports: 1, rentEpoch: 0 };
  connection.getTokenAccountBalance = async () => ({ context: { slot: 1 }, value: { amount: '123456789', decimals: 6, uiAmount: 123.456789 } });
  t.mock.method(connection, 'getProgramAccounts', async () => [{ pubkey: request.address, account: requestAccount }]);
  const history = [{ signature: 'observed-signature', slot: 123, err: null, memo: null, blockTime: null, confirmationStatus: 'confirmed' as const }];
  connection.getSignaturesForAddress = async (address, options, commitment) => {
    assert(address.equals(vault.address)); assert.equal(options?.limit, 10); assert.equal(commitment, 'confirmed');
    return history;
  };
  assert.deepEqual((await readVault(local, vault.address)).history, history);
  connection.getSignaturesForAddress = async () => [];
  assert.deepEqual((await readVault(local, vault.address)).history, []);
  connection.getSignaturesForAddress = async () => { throw new Error('History is unavailable'); };
  const result = await readVault(local, vault.address);
  assert.equal(result.history, null); assert.equal(result.balance, '123456789'); assert.equal(result.decimals, 6);
  assert.equal(result.withdrawals[0].data.requestedAt.toString(), request.data.requestedAt.toString());
  assert.equal(result.vault.address.toBase58(), vault.address.toBase58());
});
