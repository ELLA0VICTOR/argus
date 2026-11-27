// "Steal my wallet" demo. Each visitor gets a fresh devnet vault whose owner key
// is handed to them (the "stolen key"). The visitor signs attacks in their
// browser. Sentinel watches, scores, "calls", then cancels and freezes on-chain
// with the cancel/freeze-only AI guardian key. Everything is real devnet.
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createMint, createMintToInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { BN, accounts, argusError, connection, errorCodeFrom, pda, programFor, sendIxs } from "./chain.ts";
import { loadKey, ROOT } from "./keys.ts";

const DECIMALS = 6;
const UNIT = 10n ** BigInt(DECIMALS);
const VAULT_FUNDS = 12_000n * UNIT;
const DAILY_LIMIT = 100n * UNIT;
const DELAY = 86_400;
const SESSION_TTL_MS = 45 * 60_000;
const CALL_TIMEOUT_SECS = 90;

const funder = loadKey("funder");
const ai = loadKey("ai-guardian");
const demoGuardian = loadKey("demo-guardian");
const demoSafe = loadKey("demo-safe");

/* ------------------------------------------------------------ test mint */

const CONFIG = join(ROOT, "demo-config.json");
let MINT: PublicKey | null = existsSync(CONFIG) ? new PublicKey(JSON.parse(readFileSync(CONFIG, "utf8")).mint) : null;

export async function ensureMint(): Promise<PublicKey> {
  if (MINT) return MINT;
  // "dUSDC": a 6-decimal test token. No freeze authority. Funder is the mint authority.
  MINT = await createMint(connection, funder, funder.publicKey, null, DECIMALS);
  writeFileSync(CONFIG, JSON.stringify({ mint: MINT.toBase58(), symbol: "dUSDC", decimals: DECIMALS }, null, 2) + "\n");
  return MINT;
}

/* --------------------------------------------------------------- events */

export type DemoEvent = { t: number } & (
  | { type: "log"; text: string; tone?: "threat" | "safe" | "wait" }
  | { type: "tx"; label: string; sig: string; by: "you" | "argus" | "setup" }
  | { type: "attack"; kind: AttackKind; ok: boolean; sig?: string; error?: { code: number | null; name: string; msg: string } }
  | { type: "risk"; score: number; level: string; reason: string; signals: { label: string; weight: number }[] }
  | { type: "call"; who: "argus" | "owner"; text: string; status?: "ringing" | "connected" | "ended" }
  | { type: "incoming"; amount: string; reason: string; timeoutSecs: number }
  | { type: "decision"; decision: "cancel" | "allow" | "timeout"; via: "voice" | "button" | "timeout" }
  | { type: "state"; vault: string; thief: string; frozen: boolean; pending: number }
);

type Listener = (e: DemoEvent) => void;

interface Session {
  id: string;
  owner: Keypair;
  vault: PublicKey;
  vaultAta: PublicKey;
  thief: PublicKey;
  thiefAta: PublicKey;
  createdAt: number;
  ip: string;
  events: DemoEvent[];
  listeners: Set<Listener>;
  pending: Map<string, { kind: AttackKind; tx: Transaction; expires: number }>;
  handled: Set<string>;
  busy: boolean;
  /** Resolves the owner's answer on the call: "cancel" or "allow". */
  decide?: (d: "cancel" | "allow") => void;
  /** Call context for the voice agent (amount, reason). */
  callContext?: { amount: string; reason: string };
}

const sessions = new Map<string, Session>();
const perIp = new Map<string, number[]>();

function emit(s: Session, e: Omit<DemoEvent, "t"> & Record<string, unknown>) {
  const ev = { t: Date.now(), ...e } as DemoEvent;
  s.events.push(ev);
  for (const l of s.listeners) l(ev);
}

export function subscribe(id: string, l: Listener): (() => void) | null {
  const s = sessions.get(id);
  if (!s) return null;
  for (const e of s.events) l(e);
  s.listeners.add(l);
  return () => s.listeners.delete(l);
}

const fmt = (base: bigint) => (Number(base) / Number(UNIT)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function snapshot(s: Session) {
  const [v, t, acct] = await Promise.all([
    connection.getTokenAccountBalance(s.vaultAta).catch(() => null),
    connection.getTokenAccountBalance(s.thiefAta).catch(() => null),
    accounts(funder).vault.fetch(s.vault).catch(() => null) as Promise<{ frozen: boolean; nextWithdrawalId: BN } | null>,
  ]);
  const pending = await pendingWithdrawals(s);
  emit(s, { type: "state", vault: v?.value.uiAmountString ?? "0", thief: t?.value.uiAmountString ?? "0", frozen: !!acct?.frozen, pending: pending.length });
}

/* -------------------------------------------------------------- session */

export class DemoError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function createSession(ip: string) {
  const now = Date.now();
  const recent = (perIp.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= 6) throw new DemoError(429, "You've started a lot of demos this hour. Try again a little later.");
  if ([...sessions.values()].filter((s) => now - s.createdAt < SESSION_TTL_MS).length >= 60) throw new DemoError(503, "The demo is busy right now. Try again in a few minutes.");
  if ((await connection.getBalance(funder.publicKey)) < 0.1e9) throw new DemoError(503, "The demo wallet needs a top-up. Please try again later.");
  perIp.set(ip, [...recent, now]);

  const mint = await ensureMint();
  const owner = Keypair.generate();
  const thief = Keypair.generate().publicKey;
  const vault = pda.vault(owner.publicKey, 0);
  const vaultAta = getAssociatedTokenAddressSync(mint, vault, true);
  const thiefAta = getAssociatedTokenAddressSync(mint, thief);
  const program = programFor(owner);

  const init = await program.methods
    .initializeVault(new BN(0), [demoGuardian.publicKey], 1, ai.publicKey, demoSafe.publicKey, new BN(DELAY), new BN(DAILY_LIMIT.toString()))
    .accountsPartial({
      creator: owner.publicKey,
      vault,
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
      vaultToken: vaultAta,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  // One transaction: fund the owner for fees and rent, create the thief's
  // token account, create the vault, fill it with 12,000 dUSDC.
  const sig = await sendIxs(
    [
      SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: owner.publicKey, lamports: 30_000_000 }),
      createAssociatedTokenAccountIdempotentInstruction(funder.publicKey, thiefAta, thief, mint),
      init,
      createMintToInstruction(mint, vaultAta, funder.publicKey, VAULT_FUNDS),
    ],
    [funder, owner],
  );

  const s: Session = {
    id: vault.toBase58(),
    owner,
    vault,
    vaultAta,
    thief,
    thiefAta,
    createdAt: now,
    ip,
    events: [],
    listeners: new Set(),
    pending: new Map(),
    handled: new Set(),
    busy: false,
  };
  sessions.set(s.id, s);
  emit(s, { type: "tx", label: "Vault created and funded with 12,000.00 dUSDC", sig, by: "setup" });
  emit(s, { type: "log", text: "Argus is watching this vault." });
  await snapshot(s);

  return {
    session: s.id,
    vault: vault.toBase58(),
    vaultToken: vaultAta.toBase58(),
    owner: owner.publicKey.toBase58(),
    // The "stolen" key. It's handed over on purpose. Devnet only, test tokens only.
    stolenKey: bs58.encode(owner.secretKey),
    thief: thief.toBase58(),
    thiefToken: thiefAta.toBase58(),
    mint: mint.toBase58(),
    setupTx: sig,
    rules: { dailyLimit: fmt(DAILY_LIMIT), delayHours: DELAY / 3600, funds: fmt(VAULT_FUNDS) },
  };
}

/* -------------------------------------------------------------- attacks */

export type AttackKind = "drain" | "trusted" | "allowance" | "request";

const ATTACK_LABEL: Record<AttackKind, string> = {
  drain: "Withdraw everything instantly",
  trusted: "Send everything to a trusted address",
  allowance: "Take the daily allowance",
  request: "Request a withdrawal of everything",
};

async function vaultBalance(s: Session): Promise<bigint> {
  const b = await connection.getTokenAccountBalance(s.vaultAta);
  return BigInt(b.value.amount);
}

/** Builds the attack transaction. The fee payer and only signer is the stolen owner key. */
export async function prepareAttack(id: string, kind: AttackKind) {
  const s = sessions.get(id);
  if (!s) throw new DemoError(404, "This demo has expired. Start a new one.");
  if (!(kind in ATTACK_LABEL)) throw new DemoError(400, "Unknown move.");
  const mint = await ensureMint();
  const program = programFor(s.owner);
  const balance = await vaultBalance(s);
  const all = balance > 0n ? balance : 1n;
  const common = { vault: s.vault, owner: s.owner.publicKey, mint, tokenProgram: TOKEN_PROGRAM_ID, vaultToken: s.vaultAta, destination: s.thiefAta };

  let ix;
  if (kind === "drain") ix = await program.methods.withdrawInstant(new BN(all.toString())).accountsPartial(common).instruction();
  else if (kind === "allowance") ix = await program.methods.withdrawInstant(new BN(DAILY_LIMIT.toString())).accountsPartial(common).instruction();
  else if (kind === "trusted") ix = await program.methods.withdrawTrusted(new BN(all.toString())).accountsPartial({ ...common, trusted: pda.trusted(s.vault, s.thief) }).instruction();
  else {
    const v = (await accounts(funder).vault.fetch(s.vault)) as { nextWithdrawalId: BN };
    ix = await program.methods
      .requestWithdrawal(new BN(all.toString()))
      .accountsPartial({ ...common, withdrawal: pda.withdrawal(s.vault, BigInt(v.nextWithdrawalId.toString())), systemProgram: SystemProgram.programId })
      .instruction();
  }

  const tx = new Transaction().add(ix);
  tx.feePayer = s.owner.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  const nonce = randomUUID();
  s.pending.set(nonce, { kind, tx, expires: Date.now() + 60_000 });
  return { nonce, kind, label: ATTACK_LABEL[kind], message: Buffer.from(tx.serializeMessage()).toString("base64") };
}

/** Attaches the browser's signature (made with the stolen key), then relays the transaction. */
export async function submitAttack(id: string, nonce: string, signatureB58: string) {
  const s = sessions.get(id);
  if (!s) throw new DemoError(404, "This demo has expired. Start a new one.");
  const p = s.pending.get(nonce);
  if (!p || p.expires < Date.now()) throw new DemoError(410, "That move expired. Try it again.");
  s.pending.delete(nonce);

  let sigBytes: Uint8Array;
  try {
    sigBytes = bs58.decode(signatureB58);
  } catch {
    throw new DemoError(400, "Bad signature.");
  }
  const message = p.tx.serializeMessage();
  if (sigBytes.length !== 64 || !nacl.sign.detached.verify(message, sigBytes, s.owner.publicKey.toBytes())) {
    throw new DemoError(400, "That signature doesn't match the stolen key.");
  }
  p.tx.addSignature(s.owner.publicKey, Buffer.from(sigBytes));

  // Simulate first, so the program's refusal comes back with its real error.
  const sim = await connection.simulateTransaction(p.tx);
  if (sim.value.err) {
    const code = errorCodeFrom(sim.value.err, sim.value.logs);
    const known = code !== null ? argusError(code) : null;
    const error = known ?? { code, name: "Rejected", msg: "The program rejected this transaction." };
    emit(s, { type: "attack", kind: p.kind, ok: false, error });
    emit(s, { type: "log", text: `Blocked by the program: ${error.msg}`, tone: "safe" });
    return { ok: false, error };
  }

  const sig = await connection.sendRawTransaction(p.tx.serialize(), { skipPreflight: true, maxRetries: 5 });
  await connection.confirmTransaction(sig, "confirmed");
  emit(s, { type: "attack", kind: p.kind, ok: true, sig });
  emit(s, { type: "tx", label: ATTACK_LABEL[p.kind], sig, by: "you" });
  await snapshot(s);
  if (p.kind === "request") void react(s);
  return { ok: true, sig };
}

/* ------------------------------------------------------- Argus reacts */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pendingWithdrawals(s: Session) {
  const all = (await accounts(funder).withdrawal.all([{ memcmp: { offset: 8, bytes: s.vault.toBase58() } }]).catch(() => [])) as {
    publicKey: PublicKey;
    account: { amount: BN; destination: PublicKey; rentPayer: PublicKey; executesAt: BN; id: BN };
  }[];
  return all;
}

async function addressAgeSeconds(addr: PublicKey): Promise<number | null> {
  const sigs = await connection.getSignaturesForAddress(addr, { limit: 1000 }).catch(() => []);
  const oldest = sigs.at(-1)?.blockTime;
  return oldest ? Math.max(0, Math.floor(Date.now() / 1000) - oldest) : null;
}

/** Sentinel's response to a pending withdrawal: score, call, cancel, freeze. */
async function react(s: Session) {
  if (s.busy) return;
  s.busy = true;
  try {
    const pending = (await pendingWithdrawals(s)).filter((w) => !s.handled.has(w.publicKey.toBase58()));
    if (pending.length === 0) return;
    const w = pending[0];
    s.handled.add(w.publicKey.toBase58());
    const amount = BigInt(w.account.amount.toString());

    emit(s, { type: "log", text: `Withdrawal request seen: ${fmt(amount)} dUSDC, waiting 24h.`, tone: "wait" });
    await sleep(1200);

    // Real signals, read from chain.
    // A pending withdrawal hasn't moved funds yet, so its share is of the current balance.
    const balance = await vaultBalance(s);
    const share = balance > 0n ? Math.min(100, Number((amount * 100n) / balance)) : 100;
    const age = await addressAgeSeconds(w.account.destination);
    const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Africa/Lagos" }).format(new Date()));
    const signals: { label: string; weight: number }[] = [];
    if (age !== null && age < 86_400) signals.push({ label: `Destination address is ${age < 120 ? `${age} seconds` : `${Math.round(age / 60)} minutes`} old`, weight: 35 });
    signals.push({ label: `Takes ${share}% of the vault`, weight: share >= 50 ? 30 : Math.round(share * 0.4) });
    signals.push({ label: "First time this vault has paid this address", weight: 15 });
    const odd = hour < 6 || hour >= 23;
    signals.push({ label: `Requested at ${String(hour).padStart(2, "0")}:00 Lagos time${odd ? ", outside usual hours" : ""}`, weight: odd ? 12 : 4 });
    for (const sg of signals) {
      emit(s, { type: "log", text: sg.label, tone: sg.weight >= 15 ? "threat" : undefined });
      await sleep(650);
    }
    const score = Math.min(100, signals.reduce((a, x) => a + x.weight, 0));
    const level = score >= 70 ? "critical" : score >= 45 ? "high" : score >= 25 ? "medium" : "low";
    const reason = `This would move ${share}% of the vault to an address${age !== null && age < 86_400 ? " created moments ago" : ""} that this vault has never paid before. That's the pattern of a stolen key.`;
    emit(s, { type: "risk", score, level, reason, signals });
    if (score < 45) return;

    // The call. The page rings the visitor, who now plays the real owner, and
    // connects them to the Argus voice agent (ElevenLabs). The owner's answer
    // comes back through `decide`. With no answer, critical risk means Argus
    // cancels anyway.
    s.callContext = { amount: `${fmt(amount)} dUSDC`, reason };
    emit(s, { type: "incoming", amount: s.callContext.amount, reason, timeoutSecs: CALL_TIMEOUT_SECS });
    const decision = await new Promise<"cancel" | "allow" | "timeout">((resolve) => {
      const t = setTimeout(() => resolve("timeout"), CALL_TIMEOUT_SECS * 1000);
      s.decide = (d) => {
        clearTimeout(t);
        resolve(d);
      };
    });
    s.decide = undefined;
    if (decision === "allow") {
      emit(s, { type: "log", text: "The owner confirmed the withdrawal was theirs. It will go through after the 24-hour wait, unless a guardian cancels it.", tone: "wait" });
      return;
    }
    if (decision === "timeout") emit(s, { type: "log", text: "No answer. The risk is critical, so Argus is cancelling anyway.", tone: "threat" });

    // Cancel and freeze, signed only by the AI guardian key (it can do nothing else).
    const program = programFor(ai);
    const cancelIx = await program.methods
      .cancelWithdrawal()
      .accountsPartial({ canceller: ai.publicKey, vault: s.vault, withdrawal: w.publicKey, rentPayer: w.account.rentPayer })
      .instruction();
    const cancelSig = await sendIxs([cancelIx], [ai]);
    emit(s, { type: "tx", label: "Withdrawal cancelled by the AI guardian", sig: cancelSig, by: "argus" });

    const freezeIx = await program.methods.freeze().accountsPartial({ signer: ai.publicKey, vault: s.vault }).instruction();
    const freezeSig = await sendIxs([freezeIx], [ai]);
    emit(s, { type: "tx", label: "Vault frozen by the AI guardian", sig: freezeSig, by: "argus" });
    emit(s, { type: "log", text: "Funds never left the vault. Guardians can now replace the stolen key.", tone: "safe" });
    await snapshot(s);
  } catch (e) {
    emit(s, { type: "log", text: `Argus hit a problem reacting: ${(e as Error).message.slice(0, 160)}`, tone: "threat" });
  } finally {
    s.busy = false;
  }
}

/**
 * The owner's answer on the call, from the voice agent's tool call or the
 * Cancel button. Only meaningful while Argus is waiting on this session's call.
 */
export function decide(id: string, decision: "cancel" | "allow", via: "voice" | "button") {
  const s = sessions.get(id);
  if (!s) throw new DemoError(404, "This demo has expired. Start a new one.");
  if (!s.decide) throw new DemoError(409, "There's no call waiting for an answer.");
  emit(s, { type: "decision", decision, via });
  s.decide(decision);
  return { ok: true };
}

/**
 * Backup watcher. The stolen key really is public, so someone could request a
 * withdrawal with their own tools instead of this page. Poll each live
 * session's withdrawals and react to any the page didn't relay.
 */
export function startWatcher() {
  setInterval(async () => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      if (now - s.createdAt > SESSION_TTL_MS) {
        sessions.delete(id);
        continue;
      }
      if (s.busy) continue;
      const fresh = (await pendingWithdrawals(s)).some((w) => !s.handled.has(w.publicKey.toBase58()));
      if (fresh) void react(s);
    }
  }, 8_000);
}

export const demoPublic = {
  ai: ai.publicKey.toBase58(),
  guardian: demoGuardian.publicKey.toBase58(),
  safe: demoSafe.publicKey.toBase58(),
  funder: funder.publicKey.toBase58(),
};
