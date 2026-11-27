import { BN, Program, type IdlAccounts, type IdlTypes } from '@anchor-lang/core';
import { getAccount, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Connection, PublicKey, SystemProgram, type AccountInfo } from '@solana/web3.js';
import { Buffer } from 'buffer';
import rawIdl from '../idl/argus.json' with { type: 'json' };
import type { Argus } from '../idl/argus.ts';

export type Vault = IdlAccounts<Argus>['vault'];
export type Withdrawal = IdlAccounts<Argus>['withdrawal'];
export type Proposal = IdlAccounts<Argus>['proposal'];
export type TrustedAddress = IdlAccounts<Argus>['trustedAddress'];
export type GovAction = IdlTypes<Argus>['govAction'];
export type RecordAt<T> = Readonly<{ address: PublicKey; data: T }>;
export const ARGUS_PROGRAM_ID = new PublicKey(rawIdl.address);

export function integer(value: bigint, signed = false): BN {
  const min = signed ? -(1n << 63n) : 0n;
  const max = signed ? (1n << 63n) - 1n : (1n << 64n) - 1n;
  if (typeof value !== 'bigint' || value < min || value > max) throw new Error(`Expected ${signed ? 'i64' : 'u64'} bigint.`);
  return new BN(value.toString());
}

function positive(value: bigint): BN {
  if (value === 0n) throw new Error('Enter an amount greater than zero.');
  return integer(value);
}

function equal(actual: PublicKey, expected: PublicKey, label: string): void {
  if (!actual.equals(expected)) throw new Error(`Invalid ${label}.`);
}

/** IDL coding only. No wallet, signing, sending, or global Anchor provider. */
export class ArgusClient {
  readonly program: Program<Argus>;
  readonly connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
    // Anchor converts the generated snake_case JSON to the generated TS type's camelCase names.
    this.program = new Program(rawIdl, { connection }) as unknown as Program<Argus>;
  }

  private seed(instruction: string, account: string): Buffer {
    const ix = this.program.idl.instructions.find(i => i.name === instruction);
    const meta = ix?.accounts.find(a => a.name === account);
    const seed = meta && 'pda' in meta ? meta.pda?.seeds[0] : undefined;
    if (!seed || seed.kind !== 'const') throw new Error(`IDL PDA seed missing: ${instruction}.${account}`);
    return Buffer.from(seed.value);
  }

  vaultAddress(creator: PublicKey, id: bigint): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([
      this.seed('initializeVault', 'vault'), creator.toBuffer(), integer(id).toArrayLike(Buffer, 'le', 8),
    ], ARGUS_PROGRAM_ID);
  }

  withdrawalAddress(vault: PublicKey, id: bigint): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([
      this.seed('requestWithdrawal', 'withdrawal'), vault.toBuffer(), integer(id).toArrayLike(Buffer, 'le', 8),
    ], ARGUS_PROGRAM_ID);
  }

  proposalAddress(vault: PublicKey, id: bigint): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([
      this.seed('propose', 'proposal'), vault.toBuffer(), integer(id).toArrayLike(Buffer, 'le', 8),
    ], ARGUS_PROGRAM_ID);
  }

  trustedAddress(vault: PublicKey, wallet: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([
      this.seed('withdrawTrusted', 'trusted'), vault.toBuffer(), wallet.toBuffer(),
    ], ARGUS_PROGRAM_ID);
  }

  vaultToken(vault: RecordAt<Vault>): PublicKey {
    return getAssociatedTokenAddressSync(vault.data.mint, vault.address, true, TOKEN_PROGRAM_ID);
  }

  private decode<T>(name: 'vault' | 'withdrawal' | 'proposal' | 'trustedAddress', address: PublicKey, info: AccountInfo<Buffer>): RecordAt<T> {
    equal(info.owner, ARGUS_PROGRAM_ID, 'account owner');
    if (info.executable) throw new Error('Expected a data account.');
    return { address, data: this.program.coder.accounts.decode<T>(name, info.data) };
  }

  decodeVault(address: PublicKey, info: AccountInfo<Buffer>): RecordAt<Vault> {
    const record = this.decode<Vault>('vault', address, info);
    const [expected, bump] = this.vaultAddress(record.data.creator, BigInt(record.data.vaultId.toString()));
    equal(address, expected, 'vault PDA');
    if (record.data.bump !== bump || record.data.version !== 1) throw new Error('Unsupported vault version or bump.');
    return record;
  }

  decodeWithdrawal(address: PublicKey, info: AccountInfo<Buffer>, vault?: PublicKey): RecordAt<Withdrawal> {
    const record = this.decode<Withdrawal>('withdrawal', address, info);
    const [expected, bump] = this.withdrawalAddress(record.data.vault, BigInt(record.data.id.toString()));
    equal(address, expected, 'withdrawal PDA');
    if (record.data.bump !== bump) throw new Error('Invalid withdrawal bump.');
    if (vault) equal(record.data.vault, vault, 'withdrawal vault');
    return record;
  }

  decodeProposal(address: PublicKey, info: AccountInfo<Buffer>, vault?: PublicKey): RecordAt<Proposal> {
    const record = this.decode<Proposal>('proposal', address, info);
    const [expected, bump] = this.proposalAddress(record.data.vault, BigInt(record.data.id.toString()));
    equal(address, expected, 'proposal PDA');
    if (record.data.bump !== bump) throw new Error('Invalid proposal bump.');
    if (vault) equal(record.data.vault, vault, 'proposal vault');
    return record;
  }

  decodeTrustedAddress(address: PublicKey, info: AccountInfo<Buffer>, vault?: PublicKey, wallet?: PublicKey): RecordAt<TrustedAddress> {
    const record = this.decode<TrustedAddress>('trustedAddress', address, info);
    const [expected, bump] = this.trustedAddress(record.data.vault, record.data.wallet);
    equal(address, expected, 'trusted PDA');
    if (record.data.bump !== bump) throw new Error('Invalid trusted bump.');
    if (vault) equal(record.data.vault, vault, 'trusted vault');
    if (wallet) equal(record.data.wallet, wallet, 'trusted wallet');
    return record;
  }

  private async fetch(address: PublicKey): Promise<AccountInfo<Buffer>> {
    const info = await this.connection.getAccountInfo(address, 'confirmed');
    if (!info) throw new Error('Program account not found.');
    return info;
  }

  async fetchVault(address: PublicKey): Promise<RecordAt<Vault>> {
    return this.decodeVault(address, await this.fetch(address));
  }

  async fetchWithdrawal(address: PublicKey, vault?: PublicKey): Promise<RecordAt<Withdrawal>> {
    return this.decodeWithdrawal(address, await this.fetch(address), vault);
  }

  async fetchProposal(address: PublicKey, vault?: PublicKey): Promise<RecordAt<Proposal>> {
    return this.decodeProposal(address, await this.fetch(address), vault);
  }

  async fetchTrustedAddress(vault: PublicKey, wallet: PublicKey): Promise<RecordAt<TrustedAddress>> {
    const address = this.trustedAddress(vault, wallet)[0];
    return this.decodeTrustedAddress(address, await this.fetch(address), vault, wallet);
  }

  private tokens(vault: RecordAt<Vault>) {
    return { vault: vault.address, mint: vault.data.mint, tokenProgram: TOKEN_PROGRAM_ID, vaultToken: this.vaultToken(vault) };
  }

  initializeVault(creator: PublicKey, mint: PublicKey, args: {
    vaultId: bigint; guardians: PublicKey[]; threshold: number; aiGuardian: PublicKey;
    safeAddress: PublicKey; delaySeconds: bigint; dailyLimit: bigint;
  }) {
    const vault = this.vaultAddress(creator, args.vaultId)[0];
    return this.program.methods.initializeVault(integer(args.vaultId), args.guardians, args.threshold,
      args.aiGuardian, args.safeAddress, integer(args.delaySeconds, true), integer(args.dailyLimit))
      .accountsStrict({ creator, vault, mint, tokenProgram: TOKEN_PROGRAM_ID,
        vaultToken: getAssociatedTokenAddressSync(mint, vault, true, TOKEN_PROGRAM_ID),
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).instruction();
  }

  deposit(vault: RecordAt<Vault>, depositor: PublicKey, from: PublicKey, amount: bigint) {
    return this.program.methods.deposit(positive(amount))
      .accountsStrict({ ...this.tokens(vault), depositor, from }).instruction();
  }

  withdrawInstant(vault: RecordAt<Vault>, owner: PublicKey, destination: PublicKey, amount: bigint) {
    return this.program.methods.withdrawInstant(positive(amount))
      .accountsStrict({ ...this.tokens(vault), owner, destination }).instruction();
  }

  async withdrawTrusted(vault: RecordAt<Vault>, owner: PublicKey, destination: PublicKey, amount: bigint) {
    const encoded = positive(amount);
    // Read the SPL token account's authority; it need not be the signer's wallet or an ATA.
    const token = await getAccount(this.connection, destination, 'confirmed', TOKEN_PROGRAM_ID);
    equal(token.mint, vault.data.mint, 'destination mint');
    if (destination.equals(this.vaultToken(vault))) throw new Error('Invalid destination.');
    return this.program.methods.withdrawTrusted(encoded)
      .accountsStrict({ ...this.tokens(vault), owner, destination,
        trusted: this.trustedAddress(vault.address, token.owner)[0] }).instruction();
  }

  requestWithdrawal(vault: RecordAt<Vault>, owner: PublicKey, destination: PublicKey, amount: bigint) {
    const withdrawal = this.withdrawalAddress(vault.address, BigInt(vault.data.nextWithdrawalId.toString()))[0];
    return this.program.methods.requestWithdrawal(positive(amount))
      .accountsStrict({ ...this.tokens(vault), owner, destination, withdrawal, systemProgram: SystemProgram.programId }).instruction();
  }

  executeWithdrawal(vault: RecordAt<Vault>, cranker: PublicKey, withdrawal: RecordAt<Withdrawal>) {
    equal(withdrawal.data.vault, vault.address, 'withdrawal vault');
    return this.program.methods.executeWithdrawal().accountsStrict({ ...this.tokens(vault), cranker,
      withdrawal: withdrawal.address, destination: withdrawal.data.destination, rentPayer: withdrawal.data.rentPayer }).instruction();
  }

  cancelWithdrawal(canceller: PublicKey, withdrawal: RecordAt<Withdrawal>) {
    return this.program.methods.cancelWithdrawal().accountsStrict({ canceller, vault: withdrawal.data.vault,
      withdrawal: withdrawal.address, rentPayer: withdrawal.data.rentPayer }).instruction();
  }

  freeze(vault: PublicKey, signer: PublicKey) {
    return this.program.methods.freeze().accountsStrict({ signer, vault }).instruction();
  }

  emergencySweep(vault: RecordAt<Vault>, guardian: PublicKey, freeze: boolean) {
    return this.program.methods.emergencySweep(freeze).accountsStrict({ ...this.tokens(vault), guardian,
      safeWallet: vault.data.safeAddress,
      safeToken: getAssociatedTokenAddressSync(vault.data.mint, vault.data.safeAddress, true, TOKEN_PROGRAM_ID),
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).instruction();
  }

  propose(vault: RecordAt<Vault>, guardian: PublicKey, action: GovAction) {
    return this.program.methods.propose(action).accountsStrict({ guardian, vault: vault.address,
      proposal: this.proposalAddress(vault.address, BigInt(vault.data.nextProposalId.toString()))[0],
      systemProgram: SystemProgram.programId }).instruction();
  }

  approve(guardian: PublicKey, proposal: RecordAt<Proposal>) {
    return this.program.methods.approve().accountsStrict({ guardian, vault: proposal.data.vault, proposal: proposal.address }).instruction();
  }

  veto(guardian: PublicKey, proposal: RecordAt<Proposal>) {
    return this.program.methods.veto().accountsStrict({ guardian, vault: proposal.data.vault,
      proposal: proposal.address, rentPayer: proposal.data.rentPayer }).instruction();
  }

  closeProposal(closer: PublicKey, proposal: RecordAt<Proposal>) {
    return this.program.methods.closeProposal().accountsStrict({ closer, vault: proposal.data.vault,
      proposal: proposal.address, rentPayer: proposal.data.rentPayer }).instruction();
  }

  executeProposal(executor: PublicKey, proposal: RecordAt<Proposal>) {
    const a = proposal.data.action;
    const wallet = 'addTrusted' in a ? a.addTrusted.wallet
      : 'removeTrusted' in a ? a.removeTrusted.wallet
      : 'rotateOwner' in a ? a.rotateOwner.newOwner
      : 'setAiGuardian' in a && !a.setAiGuardian.key.equals(PublicKey.default) ? a.setAiGuardian.key : null;
    return this.program.methods.executeProposal().accountsStrict({ executor, vault: proposal.data.vault,
      proposal: proposal.address, rentPayer: proposal.data.rentPayer,
      trusted: wallet ? this.trustedAddress(proposal.data.vault, wallet)[0] : null,
      systemProgram: SystemProgram.programId }).instruction();
  }
}
