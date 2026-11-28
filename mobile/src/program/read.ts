import { getMint, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import bs58 from 'bs58';
import { ArgusClient, ARGUS_PROGRAM_ID, type RecordAt, type Withdrawal, type Proposal, type TrustedAddress } from './client.ts';
import { requireDevnet } from './transactions.ts';

export async function readVault(client: ArgusClient, address: PublicKey) {
  await requireDevnet(client.connection);
  const vault = await client.fetchVault(address);
  const [mint, balance, accounts, history] = await Promise.all([
    getMint(client.connection, vault.data.mint, 'confirmed', TOKEN_PROGRAM_ID),
    client.connection.getTokenAccountBalance(client.vaultToken(vault), 'confirmed'),
    client.connection.getProgramAccounts(ARGUS_PROGRAM_ID, { commitment: 'confirmed' }),
    // History is optional: an RPC history outage must not hide balances or protective actions.
    client.connection.getSignaturesForAddress(address, { limit: 10 }, 'confirmed').catch(() => null),
  ]);
  const withdrawals: RecordAt<Withdrawal>[] = [];
  const proposals: RecordAt<Proposal>[] = [];
  const trusted: RecordAt<TrustedAddress>[] = [];
  for (const { pubkey, account } of accounts) {
    // Anchor owns all layouts and discriminators. No byte offsets or account sizes are guessed.
    const schema = client.program.idl.accounts?.find(a => account.data.subarray(0, a.discriminator.length).equals(Buffer.from(a.discriminator)));
    if (!schema) throw new Error('Unknown Argus account type. Refresh the generated IDL.');
    const data = client.program.coder.accounts.decode<{ vault?: PublicKey }>(schema.name, account.data);
    if (!data.vault?.equals(address)) continue;
    if (schema?.name === 'withdrawal') withdrawals.push(client.decodeWithdrawal(pubkey, account, address));
    if (schema?.name === 'proposal') proposals.push(client.decodeProposal(pubkey, account, address));
    if (schema?.name === 'trustedAddress') trusted.push(client.decodeTrustedAddress(pubkey, account, address));
  }
  return { vault, decimals: mint.decimals, balance: balance.value.amount, withdrawals, proposals, trusted, history };
}

export type VaultView = Awaited<ReturnType<typeof readVault>>;

export async function readWalletVaults(client: ArgusClient, wallet: PublicKey) {
  await requireDevnet(client.connection);
  const schema = client.program.idl.accounts!.find(a => a.name === 'vault')!;
  const accounts = await client.connection.getProgramAccounts(ARGUS_PROGRAM_ID, { commitment: 'confirmed',
    filters: [{ memcmp: { offset: 0, bytes: bs58.encode(Uint8Array.from(schema.discriminator)) } }],
  });
  return accounts.filter(({ account }) => account.data.subarray(0, schema.discriminator.length).equals(Buffer.from(schema.discriminator)))
    .map(({ pubkey, account }) => client.decodeVault(pubkey, account))
    .filter(({ data }) => data.owner.equals(wallet) || data.aiGuardian.equals(wallet) || data.guardians.slice(0, data.guardianCount).some(g => g.equals(wallet)));
}
