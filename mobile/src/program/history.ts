import { EventParser } from '@anchor-lang/core';
import type { ConfirmedSignatureInfo, PublicKey } from '@solana/web3.js';
import type { ArgusClient } from './client.ts';
import { ARGUS_PROGRAM_ID } from './client.ts';
import { formatUnits } from '../sentinel/rules.ts';

export type HistoryEntry = { id: string; signature: string; title: string; at: number | null; done: boolean };
const cache = new Map<string, HistoryEntry[]>();
const labels: Record<string, string> = {
  vaultInitialized: 'Vault created', deposited: 'Deposited', instantWithdrawn: 'Sent instantly', trustedWithdrawn: 'Sent to a trusted address',
  withdrawalRequested: 'Withdrawal requested', withdrawalExecuted: 'Withdrawal completed', withdrawalCancelled: 'Withdrawal cancelled',
  frozen: 'Vault frozen', swept: 'Moved to the safe address', proposalCreated: 'Proposal created', proposalApproved: 'Proposal approved',
  proposalExecuted: 'Proposal applied', proposalVetoed: 'Proposal vetoed', proposalClosed: 'Proposal closed',
};

/** Anchor verifies event provenance and decodes the generated IDL; never infer actions from a signature. */
export async function loadHistory(client: ArgusClient, vault: PublicKey, signatures: ConfirmedSignatureInfo[], decimals: number, symbol: string): Promise<HistoryEntry[]> {
  const missing = signatures.filter(s => !s.err && !cache.has(`${vault}:${s.signature}`));
  if (missing.length) {
    const transactions = await client.connection.getTransactions(missing.map(s => s.signature), { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    const parser = new EventParser(ARGUS_PROGRAM_ID, client.program.coder);
    transactions.forEach((tx, i) => {
      if (!tx?.meta || tx.meta.err || !tx.meta.logMessages) return;
      const sig = missing[i]; const entries: HistoryEntry[] = [];
      try {
        for (const event of parser.parseLogs(tx.meta.logMessages)) {
          const data = event.data as { vault?: PublicKey; amount?: { toString(): string }; id?: { toString(): string } };
          if (!data.vault?.equals(vault)) continue;
          const label = labels[event.name]; if (!label) continue;
          const amount = data.amount ? ` · ${formatUnits(data.amount.toString(), decimals)} ${symbol}` : '';
          const id = data.id ? ` #${data.id.toString()}` : '';
          entries.push({ id: `${sig.signature}:${entries.length}`, signature: sig.signature, title: label + id + amount, at: tx.blockTime ?? sig.blockTime ?? null, done: true });
        }
      } catch { return; } // Incomplete logs keep the signature fallback; a later read can retry.
      cache.set(`${vault}:${sig.signature}`, entries);
      while (cache.size > 100) cache.delete(cache.keys().next().value!);
    });
  }
  return signatures.flatMap(s => cache.get(`${vault}:${s.signature}`)?.length ? cache.get(`${vault}:${s.signature}`)!
    : [{ id: s.signature, signature: s.signature, title: s.err ? 'Transaction failed' : 'Transaction confirmed', at: s.blockTime ?? null, done: !s.err }]);
}
