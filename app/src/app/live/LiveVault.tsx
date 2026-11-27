import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { VaultCtx, type Ctx, type Tx } from "../store";
import { claimFaucet } from "../../lib/sentinel";
import { idl, ix, loadLog, loadVault, nextIds, type Live } from "./program";
import type { LogEntry } from "../store";

/**
 * Your vault, live from devnet. Same shape as the sample store, so every screen
 * works unchanged. Each action: build → simulate (so the program's refusal is
 * shown before the wallet opens) → sign in the wallet → confirm → refresh.
 */

const ERRORS = new Map<number, string>(((idl.errors ?? []) as { code: number; name: string; msg?: string }[]).map((e) => [e.code, e.msg ?? e.name]));

/** A readable reason for a failed transaction. */
export function explain(e: unknown, logs?: string[] | null): string {
  const text = [String((e as Error)?.message ?? e), ...(logs ?? [])].join("\n");
  const m = text.match(/custom program error: 0x([0-9a-f]+)/i) ?? text.match(/Error Number: (\d+)/);
  if (m) {
    const code = m[0].startsWith("custom") ? parseInt(m[1], 16) : Number(m[1]);
    const msg = ERRORS.get(code);
    if (msg) return msg;
  }
  if (/reject|denied|cancel/i.test(text)) return "You cancelled it in your wallet.";
  if (/insufficient (lamports|funds)|0x1\b/i.test(text)) return "Not enough SOL for fees. Get devnet SOL from the wallet menu.";
  if (/blockhash|expired/i.test(text)) return "It took too long to confirm. Try again.";
  return "That didn't go through. Try again.";
}

export function LiveVaultProvider({ address, children, onGone, frame }: { address: string; children: ReactNode; onGone: () => void; frame: (n: ReactNode) => ReactNode }) {
  const { connection } = useConnection();
  const { publicKey: walletKey, sendTransaction } = useWallet();
  // Stable across renders: the adapter may hand out a new PublicKey object each time.
  const key = walletKey?.toBase58() ?? null;
  const publicKey = useMemo(() => (key ? new PublicKey(key) : null), [key]);
  const [live, setLive] = useState<Live | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState<bigint | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [txs, setTxs] = useState<Tx[]>([]);
  const txId = useRef(1);

  const refresh = useCallback(async () => {
    try {
      const l = await loadVault(connection, address);
      setLive(l);
      setFailed(null);
      if (publicKey) {
        const b = await connection.getTokenAccountBalance(getAssociatedTokenAddressSync(l.mint, publicKey, true)).catch(() => null);
        setWalletBalance(b ? BigInt(b.value.amount) : 0n);
      }
    } catch (e) {
      if (/Account does not exist|could not find/i.test(String((e as Error).message))) onGone();
      else setFailed("Couldn't read your vault from devnet. Retrying…");
    }
  }, [connection, address, publicKey, onGone]);

  // Activity history: heavier, so it loads on its own and less often.
  const refreshLog = useCallback(() => {
    loadLog(connection, address)
      .then(setLog)
      .catch(() => {});
  }, [connection, address]);
  useEffect(() => {
    refreshLog();
    const id = setInterval(refreshLog, 30_000);
    return () => clearInterval(id);
  }, [refreshLog]);

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 12_000);
    return () => clearInterval(id);
  }, [refresh]);

  const run = useCallback(
    async (label: string, build: () => Promise<TransactionInstruction[]>) => {
      const id = txId.current++;
      setTxs((t) => [...t, { id, label, state: "pending" }]);
      const fail = (error: string) => {
        setTxs((t) => t.map((x) => (x.id === id ? { ...x, state: "failed", error } : x)));
        setTimeout(() => setTxs((t) => t.filter((x) => x.id !== id)), 9000);
      };
      try {
        if (!publicKey) throw new Error("Connect a wallet first.");
        const tx = new Transaction().add(...(await build()));
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
        tx.feePayer = publicKey;
        tx.recentBlockhash = blockhash;
        const sim = await connection.simulateTransaction(tx);
        if (sim.value.err) return fail(explain(sim.value.err, sim.value.logs));
        const sig = await sendTransaction(tx, connection, { preflightCommitment: "confirmed" });
        const res = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
        if (res.value.err) return fail(explain(res.value.err));
        setTxs((t) => t.map((x) => (x.id === id ? { ...x, state: "confirmed", sig } : x)));
        setTimeout(() => setTxs((t) => t.filter((x) => x.id !== id)), 6000);
        await refresh();
        refreshLog();
      } catch (e) {
        console.error(`[argus] ${label} failed:`, (e as Error).message, String((e as { error?: Error }).error?.message ?? ""));
        fail(explain(e));
      }
    },
    [connection, publicKey, sendTransaction, refresh],
  );

  const value = useMemo<Ctx | null>(() => {
    if (!live || !publicKey) return null;
    const me = publicKey.toBase58();
    const c = { connection, me: publicKey, live };
    const v = { ...live.state, log };
    return {
      mode: "live",
      vault: v,
      role: v.owner === me ? "owner" : "guardian",
      setRole: () => {},
      me,
      txs,
      walletBalance,
      dismissTx: (id) => setTxs((t) => t.filter((x) => x.id !== id)),
      cancel: (w) => run(`Cancel #${w.id}`, () => ix.cancel(c, w.id)),
      execute: (w) => run(`Release #${w.id}`, () => ix.execute(c, w.id)),
      freeze: () => run("Freeze vault", () => ix.freeze(c)),
      send: ({ amount, destination, path }) =>
        run(path === "delayed" ? "Request withdrawal" : "Send", async () => ix.send(c, { amount, destination: new PublicKey(destination), path, nextWithdrawalId: (await nextIds(connection, live.vault)).withdrawal })),
      deposit: (amount) => run("Deposit", () => ix.deposit(c, amount)),
      propose: (a) => run("Propose change", async () => ix.propose(c, a, (await nextIds(connection, live.vault)).proposal)),
      approve: (p) => run(`Approve #${p.id}`, () => ix.approve(c, p.id)),
      veto: (p) => run(`Veto #${p.id}`, () => ix.veto(c, p.id)),
      executeProposal: (p) => run(`Apply #${p.id}`, () => ix.executeProposal(c, p.id, p.action)),
      faucet: async () => {
        const id = txId.current++;
        setTxs((t) => [...t, { id, label: "Get test dUSDC", state: "pending" }]);
        try {
          const r = await claimFaucet(me);
          setTxs((t) => t.map((x) => (x.id === id ? { ...x, state: "confirmed", sig: r.sig, label: `Got ${r.dusdc} dUSDC${r.sol ? ` and ${r.sol} SOL` : ""}` } : x)));
          setTimeout(() => setTxs((t) => t.filter((x) => x.id !== id)), 6000);
          await refresh();
        } catch (e) {
          setTxs((t) => t.map((x) => (x.id === id ? { ...x, state: "failed", error: (e as Error).message } : x)));
          setTimeout(() => setTxs((t) => t.filter((x) => x.id !== id)), 9000);
        }
      },
    };
  }, [live, log, publicKey, connection, txs, walletBalance, run, refresh]);

  if (!value) return <>{frame(<VaultLoading message={failed} />)}</>;
  return <VaultCtx.Provider value={value}>{children}</VaultCtx.Provider>;
}

export function VaultLoading({ message }: { message?: string | null }) {
  return (
    <div className="mx-auto max-w-[880px] px-5 pt-24 sm:px-8 lg:pt-28">
      <div className="h-[280px] animate-pulse rounded-[28px] border border-line bg-white" />
      <div className="mt-10 h-[120px] animate-pulse rounded-[20px] border border-line bg-white" />
      <p className="mt-6 text-center text-[14px] text-muted">{message ?? "Reading your vault from devnet…"}</p>
    </div>
  );
}
