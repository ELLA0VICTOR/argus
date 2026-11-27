// "Steal my wallet" demo. Each visitor gets a fresh devnet vault whose owner key
// is handed to them (the "stolen key"). The visitor signs attacks in their
// browser. Sentinel watches, scores, calls the owner, then cancels and freezes
// on-chain with the cancel/freeze-only AI guardian key. Everything is real devnet.
//
// State lives in Postgres (db.ts), not in memory, so this runs the same on a
// long-lived server and on serverless functions. Nothing here waits in memory:
// the 90-second call is a deadline in the database, settled by whichever comes
// first, the owner's answer or a later tick() that sees the deadline passed.
import { Keypair, PublicKey, SystemProgram, Transaction, VersionedMessage, VersionedTransaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createMint, createMintToInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { waitUntil } from "@vercel/functions";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { randomUUID } from "node:crypto";
import { BN, accounts, argusError, connection, errorCodeFrom, pda, programFor, sendIxs } from "./chain.ts";
import { loadKey } from "./keys.ts";
import { ensureSchema, sql, type CallState, type SessionRow } from "./db.ts";
import demoConfig from "../demo-config.json" with { type: "json" };

const DECIMALS = 6;
const UNIT = 10n ** BigInt(DECIMALS);
const VAULT_FUNDS = 12_000n * UNIT;
const DAILY_LIMIT = 100n * UNIT;
const DELAY = 86_400;
const SESSION_TTL_MIN = 45;
const CALL_TIMEOUT_SECS = 90;
const MAX_PER_IP_PER_HOUR = 6;
const MAX_LIVE_SESSIONS = 60;
const MAX_CALL_LINES = 80;
const MAX_LINE = 400;

const funder = loadKey("funder");
const ai = loadKey("ai-guardian");
const demoGuardian = loadKey("demo-guardian");
const demoSafe = loadKey("demo-safe");

/** Runs work after the response is sent (kept alive on Vercel; plain background locally). */
function later(p: Promise<unknown>) {
  const guarded = p.catch((e) => console.error("[sentinel] background task failed:", (e as Error).message));
  try {
    waitUntil(guarded);
  } catch {
    /* not on Vercel: the process stays up anyway */
  }
}

/* ------------------------------------------------------------ test mint */

let MINT: PublicKey | null = process.env.DEMO_MINT ? new PublicKey(process.env.DEMO_MINT) : demoConfig?.mint ? new PublicKey(demoConfig.mint) : null;

export async function ensureMint(): Promise<PublicKey> {
  if (MINT) return MINT;
  // "dUSDC": a 6-decimal test token. No freeze authority. Funder is the mint
  // authority. Only for a brand-new deployment: set DEMO_MINT afterwards.
  MINT = await createMint(connection, funder, funder.publicKey, null, DECIMALS);
  console.log(`[sentinel] created test mint ${MINT.toBase58()}. Set DEMO_MINT to keep it.`);
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
  | { type: "phone"; status: "ready" }
);

async function emit(id: string, e: Record<string, unknown>) {
  await sql`insert into demo_events (session, data) values (${id}, ${JSON.stringify({ t: Date.now(), ...e })}::jsonb)`;
}

/** Events after a cursor, oldest first. The cursor is the last event id the client saw. */
export async function eventsAfter(id: string, after: number): Promise<{ id: number; event: DemoEvent }[]> {
  const rows = (await sql`select id, data from demo_events where session = ${id} and id > ${after} order by id limit 200`) as { id: string; data: DemoEvent }[];
  return rows.map((r) => ({ id: Number(r.id), event: r.data }));
}

const fmt = (base: bigint) => (Number(base) / Number(UNIT)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* -------------------------------------------------------------- session */

export class DemoError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** A live session (under 45 minutes old), or a 404. */
export async function load(id: string): Promise<SessionRow> {
  await ensureSchema();
  const rows = (await sql`select * from demo_sessions where id = ${id} and created_at > now() - make_interval(mins => ${SESSION_TTL_MIN})`) as SessionRow[];
  if (!rows[0]) throw new DemoError(404, "This demo has expired. Start a new one.");
  return rows[0];
}

const ownerOf = (r: SessionRow) => Keypair.fromSecretKey(bs58.decode(r.owner_secret));

async function snapshot(r: SessionRow) {
  const vault = new PublicKey(r.vault);
  const [v, t, acct, pending] = await Promise.all([
    connection.getTokenAccountBalance(new PublicKey(r.vault_ata)).catch(() => null),
    connection.getTokenAccountBalance(new PublicKey(r.thief_ata)).catch(() => null),
    accounts(funder).vault.fetch(vault).catch(() => null) as Promise<{ frozen: boolean } | null>,
    pendingWithdrawals(vault),
  ]);
  await emit(r.id, { type: "state", vault: v?.value.uiAmountString ?? "0", thief: t?.value.uiAmountString ?? "0", frozen: !!acct?.frozen, pending: pending.length });
}

export async function createSession(ip: string) {
  await ensureSchema();
  // Housekeeping: day-old demos and their events go.
  await sql`delete from demo_sessions where created_at < now() - interval '1 day'`;
  const [{ n }] = (await sql`select count(*)::int as n from demo_sessions where ip = ${ip} and created_at > now() - interval '1 hour'`) as { n: number }[];
  if (n >= MAX_PER_IP_PER_HOUR) throw new DemoError(429, "You've started a lot of demos this hour. Try again a little later.");
  const [{ live }] = (await sql`select count(*)::int as live from demo_sessions where created_at > now() - make_interval(mins => ${SESSION_TTL_MIN})`) as { live: number }[];
  if (live >= MAX_LIVE_SESSIONS) throw new DemoError(503, "The demo is busy right now. Try again in a few minutes.");
  if ((await connection.getBalance(funder.publicKey)) < 0.1e9) throw new DemoError(503, "The demo wallet needs a top-up. Please try again later.");

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

  const id = vault.toBase58();
  // The owner key is stored because it's the demo's "stolen key": it is handed
  // to the visitor anyway. Devnet only, test tokens only.
  const rows = (await sql`insert into demo_sessions (id, owner_secret, vault, vault_ata, thief, thief_ata, ip)
    values (${id}, ${bs58.encode(owner.secretKey)}, ${id}, ${vaultAta.toBase58()}, ${thief.toBase58()}, ${thiefAta.toBase58()}, ${ip})
    returning *`) as SessionRow[];
  await emit(id, { type: "tx", label: "Vault created and funded with 12,000.00 dUSDC", sig, by: "setup" });
  await emit(id, { type: "log", text: "Argus is watching this vault." });
  await snapshot(rows[0]);

  return {
    session: id,
    vault: id,
    vaultToken: vaultAta.toBase58(),
    owner: owner.publicKey.toBase58(),
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

async function vaultBalance(vaultAta: PublicKey): Promise<bigint> {
  const b = await connection.getTokenAccountBalance(vaultAta);
  return BigInt(b.value.amount);
}

/** Builds the attack transaction. The fee payer and only signer is the stolen owner key. */
export async function prepareAttack(id: string, kind: AttackKind) {
  if (!Object.hasOwn(ATTACK_LABEL, kind)) throw new DemoError(400, "Unknown move.");
  const r = await load(id);
  const owner = ownerOf(r);
  const vault = new PublicKey(r.vault);
  const vaultAta = new PublicKey(r.vault_ata);
  const thief = new PublicKey(r.thief);
  const mint = await ensureMint();
  const program = programFor(owner);
  const balance = await vaultBalance(vaultAta);
  const all = balance > 0n ? balance : 1n;
  const common = { vault, owner: owner.publicKey, mint, tokenProgram: TOKEN_PROGRAM_ID, vaultToken: vaultAta, destination: new PublicKey(r.thief_ata) };

  let ix;
  if (kind === "drain") ix = await program.methods.withdrawInstant(new BN(all.toString())).accountsPartial(common).instruction();
  else if (kind === "allowance") ix = await program.methods.withdrawInstant(new BN(DAILY_LIMIT.toString())).accountsPartial(common).instruction();
  else if (kind === "trusted") ix = await program.methods.withdrawTrusted(new BN(all.toString())).accountsPartial({ ...common, trusted: pda.trusted(vault, thief) }).instruction();
  else {
    const v = (await accounts(funder).vault.fetch(vault)) as { nextWithdrawalId: BN };
    ix = await program.methods
      .requestWithdrawal(new BN(all.toString()))
      .accountsPartial({ ...common, withdrawal: pda.withdrawal(vault, BigInt(v.nextWithdrawalId.toString())), systemProgram: SystemProgram.programId })
      .instruction();
  }

  const tx = new Transaction().add(ix);
  tx.feePayer = owner.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  const message = Buffer.from(tx.serializeMessage()).toString("base64");
  const nonce = randomUUID();
  await sql`insert into demo_moves (nonce, session, kind, message, expires) values (${nonce}, ${id}, ${kind}, ${message}, now() + interval '60 seconds')`;
  return { nonce, kind, label: ATTACK_LABEL[kind], message };
}

/** Attaches the browser's signature (made with the stolen key), then relays the transaction. */
export async function submitAttack(id: string, nonce: string, signatureB58: string) {
  const r = await load(id);
  // Consuming the nonce is atomic: a prepared move can be submitted once.
  const moves = (await sql`delete from demo_moves where nonce = ${nonce} and session = ${id} and expires > now() returning kind, message`) as { kind: AttackKind; message: string }[];
  const p = moves[0];
  if (!p) throw new DemoError(410, "That move expired. Try it again.");

  let sigBytes: Uint8Array;
  try {
    sigBytes = bs58.decode(signatureB58);
  } catch {
    throw new DemoError(400, "Bad signature.");
  }
  const owner = ownerOf(r);
  const message = Buffer.from(p.message, "base64");
  if (sigBytes.length !== 64 || !nacl.sign.detached.verify(message, sigBytes, owner.publicKey.toBytes())) {
    throw new DemoError(400, "That signature doesn't match the stolen key.");
  }
  // The exact message bytes that were signed, plus the signature. Nothing is re-encoded.
  const tx = new VersionedTransaction(VersionedMessage.deserialize(message), [sigBytes]);

  // Simulate first, so the program's refusal comes back with its real error.
  const sim = await connection.simulateTransaction(tx, { sigVerify: true });
  if (sim.value.err) {
    const code = errorCodeFrom(sim.value.err, sim.value.logs);
    const known = code !== null ? argusError(code) : null;
    const error = known ?? { code, name: "Rejected", msg: "The program rejected this transaction." };
    await emit(id, { type: "attack", kind: p.kind, ok: false, error });
    await emit(id, { type: "log", text: `Blocked by the program: ${error.msg}`, tone: "safe" });
    return { ok: false, error };
  }

  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 5 });
  await connection.confirmTransaction(sig, "confirmed");
  await emit(id, { type: "attack", kind: p.kind, ok: true, sig });
  await emit(id, { type: "tx", label: ATTACK_LABEL[p.kind], sig, by: "you" });
  await snapshot(r);
  if (p.kind === "request") later(react(id));
  return { ok: true, sig };
}

/* ------------------------------------------------------- Argus reacts */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type PendingW = { publicKey: PublicKey; account: { amount: BN; destination: PublicKey; rentPayer: PublicKey; executesAt: BN; id: BN } };

async function pendingWithdrawals(vault: PublicKey): Promise<PendingW[]> {
  return (await accounts(funder).withdrawal.all([{ memcmp: { offset: 8, bytes: vault.toBase58() } }]).catch(() => [])) as PendingW[];
}

async function addressAgeSeconds(addr: PublicKey): Promise<number | null> {
  const sigs = await connection.getSignaturesForAddress(addr, { limit: 1000 }).catch(() => []);
  const oldest = sigs.at(-1)?.blockTime;
  return oldest ? Math.max(0, Math.floor(Date.now() / 1000) - oldest) : null;
}

/**
 * Sentinel's response to a new pending withdrawal: score it and, if it looks
 * like theft, ring the owner. Each withdrawal is claimed in the database first,
 * so it is handled once even if the page and the watcher both notice it.
 */
async function react(id: string) {
  try {
    const r = await load(id);
    const vault = new PublicKey(r.vault);
    const w = (await pendingWithdrawals(vault)).find((x) => !r.handled.includes(x.publicKey.toBase58()));
    if (!w) return;
    const key = w.publicKey.toBase58();
    const claimed = await sql`update demo_sessions set handled = array_append(handled, ${key}) where id = ${id} and not (${key} = any(handled)) returning id`;
    if (claimed.length === 0) return;
    const amount = BigInt(w.account.amount.toString());

    await emit(id, { type: "log", text: `Withdrawal request seen: ${fmt(amount)} dUSDC, waiting 24h.`, tone: "wait" });
    await sleep(1200);

    // Real signals, read from chain.
    // A pending withdrawal hasn't moved funds yet, so its share is of the current balance.
    const balance = await vaultBalance(new PublicKey(r.vault_ata));
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
      await emit(id, { type: "log", text: sg.label, tone: sg.weight >= 15 ? "threat" : undefined });
      await sleep(650);
    }
    const score = Math.min(100, signals.reduce((a, x) => a + x.weight, 0));
    const level = score >= 70 ? "critical" : score >= 45 ? "high" : score >= 25 ? "medium" : "low";
    const reason = `This would move ${share}% of the vault to an address${age !== null && age < 86_400 ? " created moments ago" : ""} that this vault has never paid before. That's the pattern of a stolen key.`;
    await emit(id, { type: "risk", score, level, reason, signals });
    if (score < 45) return;

    // The call. The page (or the visitor's phone) rings and connects them to
    // the Argus voice agent. The answer arrives through decide(). With no
    // answer by the deadline, tick() cancels anyway. One call at a time.
    const call: CallState = { withdrawal: key, rentPayer: w.account.rentPayer.toBase58(), amount: `${fmt(amount)} dUSDC`, reason, deadline: Date.now() + CALL_TIMEOUT_SECS * 1000, status: "awaiting" };
    const set = await sql`update demo_sessions set call = ${JSON.stringify(call)}::jsonb where id = ${id} and (call is null or call->>'status' = 'done') returning id`;
    if (set.length === 0) return;
    await emit(id, { type: "incoming", amount: call.amount, reason, timeoutSecs: CALL_TIMEOUT_SECS });
  } catch (e) {
    await emit(id, { type: "log", text: `Argus hit a problem reacting: ${(e as Error).message.slice(0, 160)}`, tone: "threat" }).catch(() => {});
  }
}

/**
 * Moves the call from "awaiting" to "deciding" if it is still awaiting (and,
 * for the timeout, past its deadline). Exactly one caller wins; everyone else
 * gets null. This is what keeps the AI key from acting twice.
 */
async function claimCall(id: string, onlyIfExpired: boolean): Promise<CallState | null> {
  const rows = (onlyIfExpired
    ? await sql`update demo_sessions set call = jsonb_set(call, '{status}', '"deciding"') where id = ${id} and call->>'status' = 'awaiting' and (call->>'deadline')::bigint < ${Date.now()} returning call`
    : await sql`update demo_sessions set call = jsonb_set(call, '{status}', '"deciding"') where id = ${id} and call->>'status' = 'awaiting' returning call`) as { call: CallState }[];
  return rows[0]?.call ?? null;
}

async function finishCall(id: string) {
  await sql`update demo_sessions set call = jsonb_set(call, '{status}', '"done"') where id = ${id}`;
}

/** Cancel and freeze, signed only by the AI guardian key (it can do nothing else). */
async function cancelAndFreeze(id: string, call: CallState) {
  try {
    const r = await load(id);
    const vault = new PublicKey(r.vault);
    const program = programFor(ai);
    const cancelIx = await program.methods
      .cancelWithdrawal()
      .accountsPartial({ canceller: ai.publicKey, vault, withdrawal: new PublicKey(call.withdrawal), rentPayer: new PublicKey(call.rentPayer) })
      .instruction();
    const cancelSig = await sendIxs([cancelIx], [ai]);
    await emit(id, { type: "tx", label: "Withdrawal cancelled by the AI guardian", sig: cancelSig, by: "argus" });

    const freezeIx = await program.methods.freeze().accountsPartial({ signer: ai.publicKey, vault }).instruction();
    const freezeSig = await sendIxs([freezeIx], [ai]);
    await emit(id, { type: "tx", label: "Vault frozen by the AI guardian", sig: freezeSig, by: "argus" });
    await emit(id, { type: "log", text: "Funds never left the vault. Guardians can now replace the stolen key.", tone: "safe" });
    await snapshot(r);
  } catch (e) {
    await emit(id, { type: "log", text: `Argus hit a problem cancelling: ${(e as Error).message.slice(0, 160)}`, tone: "threat" }).catch(() => {});
  } finally {
    await finishCall(id).catch(() => {});
  }
}

/**
 * The owner's answer on the call, from the voice agent's tool call or a
 * button. Only meaningful while the call is awaiting an answer.
 */
export async function decide(id: string, decision: "cancel" | "allow", via: "voice" | "button") {
  await load(id);
  const call = await claimCall(id, false);
  if (!call) throw new DemoError(409, "There's no call waiting for an answer.");
  await emit(id, { type: "decision", decision, via });
  if (decision === "allow") {
    await emit(id, { type: "log", text: "The owner confirmed the withdrawal was theirs. It will go through after the 24-hour wait, unless a guardian cancels it.", tone: "wait" });
    await finishCall(id);
  } else {
    later(cancelAndFreeze(id, call));
  }
  return { ok: true };
}

/**
 * Periodic work for one session, run while someone is watching it (the event
 * stream calls this about once a second):
 *  - no answer by the deadline: cancel anyway (critical risk);
 *  - backup watcher, at most every 8s: the stolen key really is public, so
 *    someone could request a withdrawal with their own tools instead of this
 *    page. React to any withdrawal the page didn't relay.
 */
export async function tick(id: string) {
  const expired = await claimCall(id, true);
  if (expired) {
    await emit(id, { type: "log", text: "No answer. The risk is critical, so Argus is cancelling anyway.", tone: "threat" });
    later(cancelAndFreeze(id, expired));
  }
  const due = (await sql`update demo_sessions set last_watch = now() where id = ${id} and last_watch < now() - interval '8 seconds' returning vault, handled`) as { vault: string; handled: string[] }[];
  if (due[0]) {
    const fresh = (await pendingWithdrawals(new PublicKey(due[0].vault))).some((w) => !due[0].handled.includes(w.publicKey.toBase58()));
    if (fresh) later(react(id));
  }
}

/** A phone scanned the QR code and is standing by as the owner's phone. */
export async function phoneReady(id: string) {
  await load(id);
  const first = await sql`update demo_sessions set phone_ready = true where id = ${id} and not phone_ready returning id`;
  if (first.length) {
    await emit(id, { type: "phone", status: "ready" });
    await emit(id, { type: "log", text: "The owner's phone is connected. Argus will ring it." });
  }
  return { ok: true };
}

/**
 * Relays the call from the device that answered it (status and transcript),
 * so the other screen can follow along. Display only: it changes nothing
 * on-chain, and the decision still goes through decide().
 */
export async function relayCall(id: string, body: Record<string, unknown>) {
  await load(id);
  const status = body.status === "connected" || body.status === "ended" ? body.status : undefined;
  const who = body.who === "argus" ? "argus" : "owner";
  const text = typeof body.text === "string" ? body.text.slice(0, MAX_LINE) : "";
  if (!status && !text) throw new DemoError(400, "Send a status or a line of text.");
  const ok = await sql`update demo_sessions set call_lines = call_lines + 1 where id = ${id} and call is not null and call_lines < ${MAX_CALL_LINES} returning id`;
  if (ok.length === 0) throw new DemoError(409, "There's no call to follow on this demo, or it's already long enough.");
  await emit(id, { type: "call", who, text, ...(status ? { status } : {}) });
  return { ok: true };
}

export const demoPublic = {
  ai: ai.publicKey.toBase58(),
  guardian: demoGuardian.publicKey.toBase58(),
  safe: demoSafe.publicKey.toBase58(),
  funder: funder.publicKey.toBase58(),
};
