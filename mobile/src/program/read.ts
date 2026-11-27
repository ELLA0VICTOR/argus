import { getMint, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { ArgusClient, ARGUS_PROGRAM_ID, type RecordAt, type Withdrawal, type Proposal, type TrustedAddress } from './client.ts';
import { requireDevnet } from './transactions.ts';

export async function readVault(client: ArgusClient, address: PublicKey) {
  await requireDevnet(client.connection);
  const vault = await client.fetchVault(address);
  const [mint, balance, accounts] = await Promise.all([
    getMint(client.connection, vault.data.mint, 'confirmed', TOKEN_PROGRAM_ID),
    client.connection.getTokenAccountBalance(client.vaultToken(vault), 'confirmed'),
    client.connection.getProgramAccounts(ARGUS_PROGRAM_ID, { commitment: 'confirmed' }),
  ]);
  const withdrawals: RecordAt<Withdrawal>[] = [];
  const proposals: RecordAt<Proposal>[] = [];
  const trusted: RecordAt<TrustedAddress>[] = [];
  for (const { pubkey, account } of accounts) {
    // Anchor owns all layouts and discriminators. No byte offsets or account sizes are guessed.
    const data = client.program.coder.accounts.decodeAny<{ vault?: PublicKey }>(account.data);
    if (!data.vault?.equals(address)) continue;
    const schema = client.program.idl.accounts?.find(a => account.data.subarray(0, a.discriminator.length).equals(Buffer.from(a.discriminator)));
    if (schema?.name === 'withdrawal') withdrawals.push(client.decodeWithdrawal(pubkey, account, address));
    if (schema?.name === 'proposal') proposals.push(client.decodeProposal(pubkey, account, address));
    if (schema?.name === 'trustedAddress') trusted.push(client.decodeTrustedAddress(pubkey, account, address));
  }
  return { vault, decimals: mint.decimals, balance: balance.value.amount, withdrawals, proposals, trusted };
}

export type VaultView = Awaited<ReturnType<typeof readVault>>;
