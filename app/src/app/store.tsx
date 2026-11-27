import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * App state. For now this is a sample vault with simulated transactions
 * (`mode: "sample"`), so every screen and interaction state can be built and
 * reviewed before the devnet wiring lands. The real source implements the same
 * shape against the deployed program.
 */

export type Risk = "low" | "medium" | "high" | "critical";
export type Role = "owner" | "guardian";

export interface Signal { id: string; label: string; weight: number }

export interface Withdrawal {
  id: number;
  pda: string;
  amount: bigint;
  destination: string;
  destinationLabel?: string;
  requestedAt: number;
  executesAt: number;
  risk: Risk;
  score: number;
  reason?: string;
  signals: Signal[];
  call?: { status: "ringing" | "in_progress" | "completed"; transcript: { who: "agent" | "user"; text: string }[] };
}

export interface Guardian { key: string; name: string; note: string; you?: boolean }
export interface Trusted { wallet: string; label: string; activeAt: number }

export type ProposalAction =
  | { kind: "AddTrusted"; wallet: string; label: string }
  | { kind: "RemoveTrusted"; wallet: string; label: string }
  | { kind: "LoosenLimits"; dailyLimit: bigint; delay: number }
  | { kind: "TightenLimits"; dailyLimit: bigint; delay: number }
  | { kind: "RotateOwner"; newOwner: string }
  | { kind: "Unfreeze" }
  | { kind: "SetSafeAddress"; wallet: string };

export interface Proposal {
  id: number;
  action: ProposalAction;
  proposer: string;
  approvals: string[]; // guardian keys
  createdAt: number;
  eta: number; // 0 until threshold
}

export interface LogEntry { at: number; kind: "chain" | "scored" | "call" | "cancel" | "freeze" | "gov" | "heartbeat" | "send"; text: string; tone?: "threat" | "wait" | "safe" | "muted"; tx?: string }

export interface Tx { id: number; label: string; state: "pending" | "confirmed" | "failed"; sig?: string; error?: string }

export interface VaultState {
  name: string;
  address: string;
  owner: string;
  symbol: string;
  decimals: number;
  balance: bigint;
  dailyLimit: bigint;
  spentInWindow: bigint;
  windowStart: number;
  delay: number;
  frozen: boolean;
  guardians: Guardian[];
  threshold: number;
  ai: string | null;
  safe: { wallet: string; label: string };
  trusted: Trusted[];
  pending: Withdrawal[];
  proposals: Proposal[];
  log: LogEntry[];
}

const now = () => Math.floor(Date.now() / 1000);
const U = 1_000_000n; // 6 decimals

function sampleVault(): VaultState {
  const t = now();
  return {
    name: "Savings",
    address: "Vt7xKXq2mN9cR4pLsW8eHfJ3dYbG6aTzQ1uVnE5kR9fQ2",
    owner: "7xKXq2mN9cR4pLsW8eHfJ3dYbG6aTzQ1uVnE5kR9fQ2",
    symbol: "USDC",
    decimals: 6,
    balance: 12_480n * U + 500_000n,
    dailyLimit: 100n * U,
    spentInWindow: 18n * U + 500_000n,
    windowStart: t - 6 * 3600,
    delay: 86_400,
    frozen: false,
    guardians: [
      { key: "8qQw3LmX5nB7vR2tY9pK4sD6fH1jG3aZcE8uN2oP4wL", name: "You", note: "Backup key · Seeker", you: true },
      { key: "3Fh9KpL2mQ7wE4rT6yU8iO1aS5dF3gH9jK2lZ4xC6vB", name: "Ada", note: "Family" },
      { key: "9LmN4bV7cX2zQ8wE5rT1yU6iO3pA9sD4fG7hJ2kL5mN", name: "Tunde", note: "Family" },
    ],
    threshold: 2,
    ai: "AiG3uArDk2Lm9QwE7rT4yU1iO6pS8dF5gH2jK9lZ3xC",
    safe: { wallet: "5HdCoLd7vR2tY9pK4sD6fH1jG3aZcE8uN2oP4wLq3mX", label: "Cold wallet (Ledger)" },
    trusted: [
      { wallet: "EfK2xChG7vR4tY9pK1sD6fH3jG8aZcE5uN2oP4wLq9mX", label: "Exchange account", activeAt: t - 30 * 86_400 },
      { wallet: "Hk2vT9qW4eR7tY1uI6oP3aS8dF5gH2jK9lZ4xC7vBQ8", label: "Tunde (rent)", activeAt: t - 12 * 86_400 },
    ],
    pending: [
      {
        id: 41,
        pda: "Wd41pQ7wE2rT9yU4iO1pA6sD3fG8hJ5kL2zX7cV4bN9m",
        amount: 12_000n * U,
        destination: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAwfM",
        requestedAt: t - 1_120,
        executesAt: t - 1_120 + 86_400,
        risk: "critical",
        score: 92,
        reason:
          "This sends 96% of the vault to an address created 14 minutes ago that imitates your trusted address Hk2v…Q8 but isn't it. It was requested at 03:12, outside your usual hours.",
        signals: [
          { id: "new_address", label: "Destination created 14 min ago", weight: 30 },
          { id: "lookalike", label: "Imitates trusted Hk2v…Q8", weight: 35 },
          { id: "share_of_vault", label: "96% of vault balance", weight: 20 },
          { id: "odd_hour", label: "Requested at 03:12", weight: 7 },
        ],
        call: {
          status: "ringing",
          transcript: [{ who: "agent", text: "This is Argus. 12,000 USDC is waiting to leave your vault. Was this you?" }],
        },
      },
      {
        id: 40,
        pda: "Wd40mN3bV8cX1zQ6wE4rT9yU2iO7pA5sD1fG3hJ8kL6z",
        amount: 200n * U,
        destination: "Bq4nT7yU2iO9pA3sD6fG1hJ8kL5zX2cV7bN4mQ9wE3rT",
        destinationLabel: "New recipient",
        requestedAt: t - 47_000,
        executesAt: t - 47_000 + 86_400,
        risk: "low",
        score: 12,
        signals: [{ id: "first_destination", label: "First time sending here", weight: 12 }],
      },
    ],
    proposals: [
      {
        id: 7,
        action: { kind: "AddTrusted", wallet: "Sv8aT3yU6iO1pA9sD4fG2hJ7kL5zX3cV8bN6mQ1wE4rT", label: "Savings account" },
        proposer: "3Fh9KpL2mQ7wE4rT6yU8iO1aS5dF3gH9jK2lZ4xC6vB",
        approvals: ["3Fh9KpL2mQ7wE4rT6yU8iO1aS5dF3gH9jK2lZ4xC6vB"],
        createdAt: t - 7_200,
        eta: 0,
      },
    ],
    log: [
      { at: t - 47_000, kind: "chain", text: "Withdrawal of 200.00 USDC requested" },
      { at: t - 46_990, kind: "scored", text: "Argus checked it: low risk, a new recipient" },
      { at: t - 7_200, kind: "gov", text: "Ada proposed trusting “Savings account”" },
      { at: t - 1_120, kind: "chain", text: "Withdrawal of 12,000.00 USDC requested" },
      { at: t - 1_118, kind: "scored", text: "The destination was created 14 minutes ago" },
      { at: t - 1_117, kind: "scored", text: "It imitates one of your trusted addresses" },
      { at: t - 1_115, kind: "scored", text: "Argus rated it critical risk" },
      { at: t - 1_110, kind: "call", text: "Calling you on +234 ••• 21" },
    ],
  };
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const fakeSig = () => Array.from({ length: 88 }, () => B58[Math.floor(Math.random() * B58.length)]).join("");

interface Ctx {
  mode: "sample";
  vault: VaultState;
  role: Role;
  setRole: (r: Role) => void;
  me: string;
  txs: Tx[];
  dismissTx: (id: number) => void;
  cancel: (w: Withdrawal) => Promise<void>;
  freeze: () => Promise<void>;
  send: (p: { amount: bigint; destination: string; path: SendPath }) => Promise<void>;
  approve: (p: Proposal) => Promise<void>;
  veto: (p: Proposal) => Promise<void>;
  executeProposal: (p: Proposal) => Promise<void>;
  propose: (a: ProposalAction) => Promise<void>;
}

export type SendPath = "instant" | "trusted" | "delayed";

const VaultCtx = createContext<Ctx | null>(null);

export function VaultProvider({ children }: { children: ReactNode }) {
  const [vault, setVault] = useState<VaultState>(sampleVault);
  const [role, setRole] = useState<Role>("owner");
  const [txs, setTxs] = useState<Tx[]>([]);
  const txId = useRef(1);

  const me = role === "owner" ? vault.owner : vault.guardians[0].key;

  /** Simulates a signed transaction: pending → confirmed, then applies `effect`. */
  const run = useCallback(async (label: string, effect: (v: VaultState, sig: string) => VaultState) => {
    const id = txId.current++;
    setTxs((t) => [...t, { id, label, state: "pending" }]);
    await new Promise((r) => setTimeout(r, 1100 + Math.random() * 500));
    const sig = fakeSig();
    setVault((v) => effect(v, sig));
    setTxs((t) => t.map((x) => (x.id === id ? { ...x, state: "confirmed", sig } : x)));
    setTimeout(() => setTxs((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  const log = (v: VaultState, e: Omit<LogEntry, "at">): VaultState => ({ ...v, log: [...v.log, { at: now(), ...e }] });

  const value = useMemo<Ctx>(
    () => ({
      mode: "sample",
      vault,
      role,
      setRole,
      me,
      txs,
      dismissTx: (id) => setTxs((t) => t.filter((x) => x.id !== id)),
      cancel: (w) =>
        run(`Cancelling #${w.id}`, (v, sig) =>
          log({ ...v, pending: v.pending.filter((p) => p.id !== w.id) }, { kind: "cancel", text: `Withdrawal of ${(Number(w.amount) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2 })} USDC cancelled`, tone: "safe", tx: sig }),
        ),
      freeze: () => run("Freeze vault", (v, sig) => log({ ...v, frozen: true }, { kind: "freeze", text: "Vault frozen", tone: "safe", tx: sig })),
      send: ({ amount, destination, path }) =>
        run(path === "delayed" ? "Request withdrawal" : "Send", (v, sig) => {
          if (path === "delayed") {
            const id = Math.max(0, ...v.pending.map((p) => p.id)) + 1;
            const t = now();
            return log(
              {
                ...v,
                pending: [
                  ...v.pending,
                  { id, pda: fakeSig().slice(0, 44), amount, destination, requestedAt: t, executesAt: t + v.delay, risk: "low", score: 8, signals: [] },
                ],
              },
              { kind: "chain", text: `Withdrawal of ${(Number(amount) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2 })} USDC requested`, tx: sig },
            );
          }
          return log(
            { ...v, balance: v.balance - amount, spentInWindow: path === "instant" ? v.spentInWindow + amount : v.spentInWindow },
            { kind: "send", text: `Sent ${(Number(amount) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2 })} USDC`, tone: "safe", tx: sig },
          );
        }),
      approve: (p) =>
        run(`Approve proposal #${p.id}`, (v, sig) => {
          const proposals = v.proposals.map((x) => {
            if (x.id !== p.id) return x;
            const approvals = [...x.approvals, me];
            const eta = x.eta === 0 && approvals.length >= v.threshold ? now() + timelock(x.action, v) : x.eta;
            return { ...x, approvals, eta };
          });
          return log({ ...v, proposals }, { kind: "gov", text: `You approved “${describeAction(p.action)}”`, tx: sig });
        }),
      veto: (p) => run(`Veto proposal #${p.id}`, (v, sig) => log({ ...v, proposals: v.proposals.filter((x) => x.id !== p.id) }, { kind: "gov", text: `You vetoed “${describeAction(p.action)}”`, tone: "safe", tx: sig })),
      executeProposal: (p) =>
        run(`Execute proposal #${p.id}`, (v, sig) => {
          let next: VaultState = { ...v, proposals: v.proposals.filter((x) => x.id !== p.id) };
          const a = p.action;
          if (a.kind === "AddTrusted") next = { ...next, trusted: [...next.trusted, { wallet: a.wallet, label: a.label, activeAt: now() }] };
          if (a.kind === "RemoveTrusted") next = { ...next, trusted: next.trusted.filter((x) => x.wallet !== a.wallet) };
          if (a.kind === "Unfreeze") next = { ...next, frozen: false };
          if (a.kind === "LoosenLimits" || a.kind === "TightenLimits") next = { ...next, dailyLimit: a.dailyLimit, delay: a.delay };
          if (a.kind === "SetSafeAddress") next = { ...next, safe: { wallet: a.wallet, label: "New safe address" } };
          if (a.kind === "RotateOwner") next = { ...next, owner: a.newOwner, pending: [] };
          return log(next, { kind: "gov", text: `Done: ${describeAction(p.action)}`, tone: "safe", tx: sig });
        }),
      propose: (a) =>
        run("Propose change", (v, sig) => {
          const id = Math.max(0, ...v.proposals.map((p) => p.id)) + 1;
          const approvals = [me];
          const eta = approvals.length >= v.threshold ? now() + timelock(a, v) : 0;
          return log({ ...v, proposals: [...v.proposals, { id, action: a, proposer: me, approvals, createdAt: now(), eta }] }, { kind: "gov", text: `You proposed: ${describeAction(a)}`, tx: sig });
        }),
    }),
    [vault, role, me, txs, run],
  );

  return <VaultCtx.Provider value={value}>{children}</VaultCtx.Provider>;
}

export function useVault() {
  const c = useContext(VaultCtx);
  if (!c) throw new Error("useVault outside VaultProvider");
  return c;
}

/** Mirrors GovAction::timelock in the program. */
export function timelock(a: ProposalAction, v: VaultState): number {
  switch (a.kind) {
    case "RotateOwner":
    case "Unfreeze":
    case "RemoveTrusted":
    case "TightenLimits":
      return 0;
    default:
      return v.delay;
  }
}

export function isVetoable(a: ProposalAction): boolean {
  return a.kind === "AddTrusted" || a.kind === "LoosenLimits" || a.kind === "SetSafeAddress";
}

export function describeAction(a: ProposalAction): string {
  switch (a.kind) {
    case "AddTrusted":
      return `Trust “${a.label}”`;
    case "RemoveTrusted":
      return `Stop trusting “${a.label}”`;
    case "LoosenLimits":
      return "Loosen limits";
    case "TightenLimits":
      return "Tighten limits";
    case "RotateOwner":
      return "Replace the owner key";
    case "Unfreeze":
      return "Unfreeze the vault";
    case "SetSafeAddress":
      return "Change the safe address";
  }
}

export const PROPOSAL_TTL = 7 * 86_400;
