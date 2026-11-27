import "../../lib/polyfills";
import { AnchorProvider, BN, BorshCoder, EventParser, Program, type Idl } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, type Connection, type TransactionInstruction } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import idlJson from "../../idl/argus.json";
import type { Argus } from "../../idl/argus";
import type { LogEntry, Proposal, ProposalAction, Trusted, VaultState, Withdrawal } from "../store";

/**
 * The Argus program from the browser: discovery, reads and instruction
 * builders. Signing happens in the wallet; nothing here holds a key.
 */

export const idl = idlJson as unknown as Argus & Idl;
export const PROGRAM_ID = new PublicKey(idl.address);
export const DECIMALS = 6;
export const SYMBOL = "dUSDC";

/** Read-only provider: the wallet signs separately through the adapter. */
export function programFor(connection: Connection, owner?: PublicKey): Program<Argus> {
  const wallet = {
    publicKey: owner ?? PublicKey.default,
    signTransaction: async <T,>(t: T) => t,
    signAllTransactions: async <T,>(t: T[]) => t,
  };
  return new Program<Argus>(idl, new AnchorProvider(connection, wallet as never, { commitment: "confirmed" }));
}

const u64 = (n: number | bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return b;
};
const seed = (s: string) => new TextEncoder().encode(s);

export const pda = {
  vault: (creator: PublicKey, id: number | bigint) => PublicKey.findProgramAddressSync([seed("vault"), creator.toBytes(), u64(id)], PROGRAM_ID)[0],
  withdrawal: (vault: PublicKey, id: number | bigint) => PublicKey.findProgramAddressSync([seed("withdrawal"), vault.toBytes(), u64(id)], PROGRAM_ID)[0],
  proposal: (vault: PublicKey, id: number | bigint) => PublicKey.findProgramAddressSync([seed("proposal"), vault.toBytes(), u64(id)], PROGRAM_ID)[0],
  trusted: (vault: PublicKey, wallet: PublicKey) => PublicKey.findProgramAddressSync([seed("trusted"), vault.toBytes(), wallet.toBytes()], PROGRAM_ID)[0],
};

/* ------------------------------------------------------------- discovery */

// Byte offsets in the Vault account (8-byte discriminator first):
// version u8 @8, bump u8 @9, creator @10, vault_id u64 @42, mint @50, owner @82,
// owner_epoch u32 @114, guardians [Pubkey; 5] @118.
const OWNER_OFFSET = 82;
const GUARDIANS_OFFSET = 118;
const MAX_GUARDIANS = 5;

export type Found = { address: string; role: "owner" | "guardian" };

const disc = (name: string) => Uint8Array.from((idl.accounts ?? []).find((a) => a.name === name)!.discriminator);
const bs58Of = (b: Uint8Array) => new PublicKey(b.length === 32 ? b : new Uint8Array(32)).toBase58();

/**
 * Vaults this wallet owns or guards. One RPC call: every Vault account, but
 * only the 196 bytes holding the owner and guardian slots, filtered here.
 * (Public RPCs rate-limit program-account scans, so fewer calls matter.)
 */
export async function findVaults(connection: Connection, wallet: PublicKey): Promise<Found[]> {
  const key = wallet.toBase58();
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [{ memcmp: { offset: 0, bytes: encodeB58(disc("Vault")) } }],
    dataSlice: { offset: OWNER_OFFSET, length: GUARDIANS_OFFSET - OWNER_OFFSET + 32 * MAX_GUARDIANS },
  });
  const out: Found[] = [];
  for (const a of accounts) {
    const d = a.account.data;
    if (bs58Of(d.subarray(0, 32)) === key) out.push({ address: a.pubkey.toBase58(), role: "owner" });
    else
      for (let i = 0; i < MAX_GUARDIANS; i++) {
        const off = GUARDIANS_OFFSET - OWNER_OFFSET + 32 * i;
        if (bs58Of(d.subarray(off, off + 32)) === key) {
          out.push({ address: a.pubkey.toBase58(), role: "guardian" });
          break;
        }
      }
  }
  // Owned first, then oldest-looking address order for stability.
  return out.sort((x, y) => (x.role === y.role ? x.address.localeCompare(y.address) : x.role === "owner" ? -1 : 1));
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function encodeB58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) + BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

/** The first free vault id for this creator (vaults are PDAs of creator + id). */
export async function nextVaultId(connection: Connection, creator: PublicKey): Promise<number> {
  for (let id = 0; id < 32; id++) {
    if (!(await connection.getAccountInfo(pda.vault(creator, id)))) return id;
  }
  throw new Error("Too many vaults for this wallet.");
}

/* ------------------------------------------------------------------ reads */

const n = (b: BN | number) => (typeof b === "number" ? b : b.toNumber());
const big = (b: BN) => BigInt(b.toString());
const isDefault = (k: PublicKey) => k.equals(PublicKey.default);

/** Local, per-browser names for addresses (the chain stores none). */
export const labels = {
  get(vault: string): Record<string, string> {
    try {
      return JSON.parse(localStorage.getItem(`argus:labels:${vault}`) ?? "{}");
    } catch {
      return {};
    }
  },
  set(vault: string, address: string, label: string) {
    try {
      const all = labels.get(vault);
      all[address] = label;
      localStorage.setItem(`argus:labels:${vault}`, JSON.stringify(all));
    } catch {
      /* storage unavailable */
    }
  },
};

type GovRaw = Record<string, Record<string, unknown> | undefined>;

export function actionFromChain(raw: GovRaw, names: Record<string, string>): ProposalAction {
  const [kind] = Object.keys(raw);
  const f = raw[kind] ?? {};
  const pk = (x: unknown) => (x as PublicKey).toBase58();
  switch (kind) {
    case "rotateOwner":
      return { kind: "RotateOwner", newOwner: pk(f.newOwner) };
    case "unfreeze":
      return { kind: "Unfreeze" };
    case "removeTrusted":
      return { kind: "RemoveTrusted", wallet: pk(f.wallet), label: names[pk(f.wallet)] ?? "Trusted address" };
    case "addTrusted":
      return { kind: "AddTrusted", wallet: pk(f.wallet), label: names[pk(f.wallet)] ?? "Trusted address" };
    case "tightenLimits":
      return { kind: "TightenLimits", dailyLimit: big(f.dailyLimit as BN), delay: n(f.delaySeconds as BN) };
    case "loosenLimits":
      return { kind: "LoosenLimits", dailyLimit: big(f.dailyLimit as BN), delay: n(f.delaySeconds as BN) };
    case "setSafeAddress":
      return { kind: "SetSafeAddress", wallet: pk(f.wallet) };
    case "setGuardians":
      return { kind: "SetGuardians", guardians: (f.guardians as PublicKey[]).map((g) => g.toBase58()), threshold: f.threshold as number };
    default:
      return { kind: "SetAiGuardian", key: pk(f.key) };
  }
}

export function actionToChain(a: ProposalAction): GovRaw {
  const pk = (s: string) => new PublicKey(s);
  switch (a.kind) {
    case "RotateOwner":
      return { rotateOwner: { newOwner: pk(a.newOwner) } };
    case "Unfreeze":
      return { unfreeze: {} };
    case "RemoveTrusted":
      return { removeTrusted: { wallet: pk(a.wallet) } };
    case "AddTrusted":
      return { addTrusted: { wallet: pk(a.wallet) } };
    case "TightenLimits":
      return { tightenLimits: { dailyLimit: new BN(a.dailyLimit.toString()), delaySeconds: new BN(a.delay) } };
    case "LoosenLimits":
      return { loosenLimits: { dailyLimit: new BN(a.dailyLimit.toString()), delaySeconds: new BN(a.delay) } };
    case "SetSafeAddress":
      return { setSafeAddress: { wallet: pk(a.wallet) } };
    case "SetGuardians":
      return { setGuardians: { guardians: a.guardians.map(pk), threshold: a.threshold } };
    case "SetAiGuardian":
      return { setAiGuardian: { key: pk(a.key) } };
  }
}

/** The wallet a proposal's TrustedAddress account is about, if any. */
export function trustedWalletOf(a: ProposalAction): string | null {
  return a.kind === "AddTrusted" || a.kind === "RemoveTrusted" ? a.wallet : null;
}

export interface Live {
  state: VaultState;
  mint: PublicKey;
  vault: PublicKey;
  /** withdrawal id → its rent payer and destination token account */
  raw: Map<number, { pda: PublicKey; rentPayer: PublicKey; destination: PublicKey }>;
  proposals: Map<number, { pda: PublicKey; rentPayer: PublicKey }>;
}

const fmt = (base: bigint) => (Number(base) / 10 ** DECIMALS).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Reads everything the screens need, straight from devnet. */
export async function loadVault(connection: Connection, address: string): Promise<Live> {
  const program = programFor(connection);
  const vaultPk = new PublicKey(address);
  const v = await program.account.vault.fetch(vaultPk);
  const vaultAta = getAssociatedTokenAddressSync(v.mint, vaultPk, true);
  // Withdrawal, TrustedAddress and Proposal all start with the vault key at
  // (Program's coder knows accounts by camelCase name: "withdrawal", "trustedAddress".)
  // byte 8, so one scan returns all three; sort them by discriminator.
  const [bal, related] = await Promise.all([
    connection.getTokenAccountBalance(vaultAta).catch(() => null),
    connection.getProgramAccounts(PROGRAM_ID, { filters: [{ memcmp: { offset: 8, bytes: address } }] }),
  ]);
  const coder = program.coder.accounts;
  const of = (name: string) => related.filter((r) => disc(name).every((b, i) => r.account.data[i] === b));
  const decode = <T,>(name: string) => of(name).map((r) => ({ publicKey: r.pubkey, account: coder.decode(name[0].toLowerCase() + name.slice(1), r.account.data) as T }));
  type W = Awaited<ReturnType<typeof program.account.withdrawal.fetch>>;
  type Tr = Awaited<ReturnType<typeof program.account.trustedAddress.fetch>>;
  type Pr = Awaited<ReturnType<typeof program.account.proposal.fetch>>;
  const ws = decode<W>("Withdrawal");
  const ts = decode<Tr>("TrustedAddress");
  const ps = decode<Pr>("Proposal");
  const names = labels.get(address);
  const guardians = v.guardians.slice(0, v.guardianCount).filter((g) => !isDefault(g));

  // Withdrawals pay out to token accounts; show the wallet that owns each one.
  const destOwners = await Promise.all(
    ws.map((w) =>
      connection
        .getParsedAccountInfo(w.account.destination)
        .then((r) => ((r.value?.data as { parsed?: { info?: { owner?: string } } })?.parsed?.info?.owner ?? w.account.destination.toBase58()))
        .catch(() => w.account.destination.toBase58()),
    ),
  );

  const raw: Live["raw"] = new Map();
  const pending: Withdrawal[] = ws
    .map((w, i) => {
      const id = n(w.account.id);
      raw.set(id, { pda: w.publicKey, rentPayer: w.account.rentPayer, destination: w.account.destination });
      const dest = destOwners[i];
      return {
        id,
        pda: w.publicKey.toBase58(),
        amount: big(w.account.amount),
        destination: dest,
        destinationLabel: names[dest],
        requestedAt: n(w.account.requestedAt),
        executesAt: n(w.account.executesAt),
        risk: "low" as const,
        score: 0,
        signals: [],
      };
    })
    .sort((a, b) => a.executesAt - b.executesAt);

  const proposalsRaw: Live["proposals"] = new Map();
  const proposals: Proposal[] = ps
    .map((p) => {
      const id = n(p.account.id);
      proposalsRaw.set(id, { pda: p.publicKey, rentPayer: p.account.rentPayer });
      return {
        id,
        action: actionFromChain(p.account.action as unknown as GovRaw, names),
        proposer: p.account.proposer.toBase58(),
        approvals: guardians.filter((_, slot) => (p.account.approvals >> slot) & 1).map((g) => g.toBase58()),
        createdAt: n(p.account.createdAt),
        eta: n(p.account.eta),
      };
    })
    .sort((a, b) => a.id - b.id);

  const trusted: Trusted[] = ts.map((t) => ({ wallet: t.account.wallet.toBase58(), label: names[t.account.wallet.toBase58()] ?? "Trusted address", activeAt: n(t.account.activeAt) }));

  const state: VaultState = {
    name: names[address] ?? "Your vault",
    address,
    owner: v.owner.toBase58(),
    symbol: SYMBOL,
    decimals: DECIMALS,
    balance: bal ? BigInt(bal.value.amount) : 0n,
    dailyLimit: big(v.dailyLimit),
    // The window resets after a day; show what's spent in the current one.
    spentInWindow: Date.now() / 1000 - n(v.windowStart) >= 86_400 ? 0n : big(v.spentInWindow),
    windowStart: n(v.windowStart),
    delay: n(v.delaySeconds),
    frozen: v.frozen,
    guardians: guardians.map((g, i) => ({ key: g.toBase58(), name: names[g.toBase58()] ?? `Guardian ${i + 1}`, note: "Guardian key" })),
    threshold: v.threshold,
    ai: isDefault(v.aiGuardian) ? null : v.aiGuardian.toBase58(),
    safe: { wallet: v.safeAddress.toBase58(), label: names[v.safeAddress.toBase58()] ?? "Safe address" },
    trusted,
    pending,
    proposals,
    // Filled in separately (loadLog): it's the heaviest read, and the vault shouldn't wait for it.
    log: [],
  };
  return { state, mint: v.mint, vault: vaultPk, raw, proposals: proposalsRaw };
}

/** Recent activity, decoded from the program's events in each transaction's logs. */
export async function loadLog(connection: Connection, vaultAddress: string): Promise<LogEntry[]> {
  const vault = new PublicKey(vaultAddress);
  const names = labels.get(vaultAddress);
  const sigs = await connection.getSignaturesForAddress(vault, { limit: 15 }).catch(() => []);
  if (!sigs.length) return [];
  const txs = await connection.getTransactions(sigs.map((s) => s.signature), { maxSupportedTransactionVersion: 0, commitment: "confirmed" }).catch(() => []);
  const parser = new EventParser(PROGRAM_ID, new BorshCoder(idl));
  const short = (k: PublicKey) => names[k.toBase58()] ?? `${k.toBase58().slice(0, 4)}…${k.toBase58().slice(-4)}`;
  const out: LogEntry[] = [];
  txs.forEach((tx, i) => {
    if (!tx?.meta?.logMessages || tx.meta.err) return;
    const at = tx.blockTime ?? sigs[i].blockTime ?? Math.floor(Date.now() / 1000);
    const sig = sigs[i].signature;
    for (const ev of parser.parseLogs(tx.meta.logMessages)) {
      const d = ev.data as Record<string, unknown>;
      // The parser reports IDL names ("VaultInitialized"); match them in camelCase.
      const name = ev.name[0].toLowerCase() + ev.name.slice(1);
      const amt = d.amount ? `${fmt(big(d.amount as BN))} ${SYMBOL}` : "";
      const e = ((): Omit<LogEntry, "at" | "tx"> | null => {
        switch (name) {
          case "vaultInitialized":
            return { kind: "gov", text: "Vault created" };
          case "deposited":
            return { kind: "chain", text: `Deposited ${amt}` };
          case "instantWithdrawn":
            return { kind: "send", text: `Sent ${amt} instantly`, tone: "safe" };
          case "trustedWithdrawn":
            return { kind: "send", text: `Sent ${amt} to ${short(d.wallet as PublicKey)}`, tone: "safe" };
          case "withdrawalRequested":
            return { kind: "chain", text: `Withdrawal of ${amt} requested` };
          case "withdrawalExecuted":
            return { kind: "send", text: `Withdrawal of ${amt} completed`, tone: "safe" };
          case "withdrawalCancelled":
            return { kind: "cancel", text: `Withdrawal of ${amt} cancelled`, tone: "safe" };
          case "frozen":
            return { kind: "freeze", text: "Vault frozen", tone: "safe" };
          case "swept":
            return { kind: "freeze", text: `Everything moved to the safe address (${amt})`, tone: "safe" };
          case "proposalCreated":
            return { kind: "gov", text: `Proposal #${n(d.id as BN)} created` };
          case "proposalApproved":
            return { kind: "gov", text: `Proposal #${n(d.id as BN)} approved by ${short(d.by as PublicKey)}` };
          case "proposalExecuted":
            return { kind: "gov", text: `Proposal #${n(d.id as BN)} applied`, tone: "safe" };
          case "proposalVetoed":
            return { kind: "gov", text: `Proposal #${n(d.id as BN)} vetoed`, tone: "safe" };
          case "proposalClosed":
            return { kind: "gov", text: `Proposal #${n(d.id as BN)} closed` };
          default:
            return null;
        }
      })();
      if (e) out.push({ ...e, at, tx: sig });
    }
  });
  return out;
}

/* ------------------------------------------------------------ instructions */

export interface IxCtx {
  connection: Connection;
  me: PublicKey;
  live: Live;
}

const tokenAccounts = (live: Live) => ({ mint: live.mint, tokenProgram: TOKEN_PROGRAM_ID, vaultToken: getAssociatedTokenAddressSync(live.mint, live.vault, true) });

/** The recipient's token account, created first if it doesn't exist yet (paid by the signer). */
function destinationFor(c: IxCtx, wallet: PublicKey): { ata: PublicKey; create: TransactionInstruction } {
  const ata = getAssociatedTokenAddressSync(c.live.mint, wallet, true);
  return { ata, create: createAssociatedTokenAccountIdempotentInstruction(c.me, ata, wallet, c.live.mint) };
}

export const ix = {
  async initialize(connection: Connection, p: { creator: PublicKey; vaultId: number; mint: PublicKey; guardians: PublicKey[]; threshold: number; ai: PublicKey; safe: PublicKey; delay: number; dailyLimit: bigint }) {
    const vault = pda.vault(p.creator, p.vaultId);
    const i = await programFor(connection, p.creator)
      .methods.initializeVault(new BN(p.vaultId), p.guardians, p.threshold, p.ai, p.safe, new BN(p.delay), new BN(p.dailyLimit.toString()))
      .accountsPartial({
        creator: p.creator,
        vault,
        mint: p.mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        vaultToken: getAssociatedTokenAddressSync(p.mint, vault, true),
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    return { vault, ixs: [i] };
  },

  async deposit(c: IxCtx, amount: bigint) {
    const from = getAssociatedTokenAddressSync(c.live.mint, c.me, true);
    return [
      await programFor(c.connection, c.me)
        .methods.deposit(new BN(amount.toString()))
        .accountsPartial({ depositor: c.me, vault: c.live.vault, ...tokenAccounts(c.live), from })
        .instruction(),
    ];
  },

  async send(c: IxCtx, p: { amount: bigint; destination: PublicKey; path: "instant" | "trusted" | "delayed"; nextWithdrawalId: number }) {
    const program = programFor(c.connection, c.me);
    const dest = destinationFor(c, p.destination);
    const base = { vault: c.live.vault, owner: c.me, ...tokenAccounts(c.live), destination: dest.ata };
    const amount = new BN(p.amount.toString());
    let main: TransactionInstruction;
    if (p.path === "instant") main = await program.methods.withdrawInstant(amount).accountsPartial(base).instruction();
    else if (p.path === "trusted") main = await program.methods.withdrawTrusted(amount).accountsPartial({ ...base, trusted: pda.trusted(c.live.vault, p.destination) }).instruction();
    else
      main = await program.methods
        .requestWithdrawal(amount)
        .accountsPartial({ ...base, withdrawal: pda.withdrawal(c.live.vault, p.nextWithdrawalId), systemProgram: SystemProgram.programId })
        .instruction();
    return [dest.create, main];
  },

  async cancel(c: IxCtx, id: number) {
    const w = c.live.raw.get(id)!;
    return [
      await programFor(c.connection, c.me)
        .methods.cancelWithdrawal()
        .accountsPartial({ canceller: c.me, vault: c.live.vault, withdrawal: w.pda, rentPayer: w.rentPayer })
        .instruction(),
    ];
  },

  async execute(c: IxCtx, id: number) {
    const w = c.live.raw.get(id)!;
    return [
      await programFor(c.connection, c.me)
        .methods.executeWithdrawal()
        .accountsPartial({ cranker: c.me, vault: c.live.vault, withdrawal: w.pda, rentPayer: w.rentPayer, ...tokenAccounts(c.live), destination: w.destination })
        .instruction(),
    ];
  },

  async freeze(c: IxCtx) {
    return [await programFor(c.connection, c.me).methods.freeze().accountsPartial({ signer: c.me, vault: c.live.vault }).instruction()];
  },

  async propose(c: IxCtx, a: ProposalAction, nextProposalId: number) {
    return [
      await programFor(c.connection, c.me)
        .methods.propose(actionToChain(a) as never)
        .accountsPartial({ guardian: c.me, vault: c.live.vault, proposal: pda.proposal(c.live.vault, nextProposalId), systemProgram: SystemProgram.programId })
        .instruction(),
    ];
  },

  async approve(c: IxCtx, id: number) {
    const p = c.live.proposals.get(id)!;
    return [await programFor(c.connection, c.me).methods.approve().accountsPartial({ guardian: c.me, vault: c.live.vault, proposal: p.pda }).instruction()];
  },

  async veto(c: IxCtx, id: number) {
    const p = c.live.proposals.get(id)!;
    return [await programFor(c.connection, c.me).methods.veto().accountsPartial({ guardian: c.me, vault: c.live.vault, proposal: p.pda, rentPayer: p.rentPayer }).instruction()];
  },

  async executeProposal(c: IxCtx, id: number, action: ProposalAction) {
    const p = c.live.proposals.get(id)!;
    const tw = trustedWalletOf(action);
    return [
      await programFor(c.connection, c.me)
        .methods.executeProposal()
        .accountsPartial({
          executor: c.me,
          vault: c.live.vault,
          proposal: p.pda,
          rentPayer: p.rentPayer,
          trusted: tw ? pda.trusted(c.live.vault, new PublicKey(tw)) : null,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    ];
  },
};

/** Next ids, read fresh just before building a request or proposal. */
export async function nextIds(connection: Connection, vault: PublicKey) {
  const v = await programFor(connection).account.vault.fetch(vault);
  return { withdrawal: n(v.nextWithdrawalId), proposal: n(v.nextProposalId) };
}
