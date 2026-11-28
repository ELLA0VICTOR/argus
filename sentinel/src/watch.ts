// Sentinel watching real vaults (docs/SENTINEL-API.md, "Hackathon build").
//
// Every vault whose ai_guardian is Sentinel's AI key is watched. Each new
// pending withdrawal is scored into an alert from on-chain signals. A critical
// alert still open ACT_AFTER_MS after it was raised gets cancel_withdrawal and
// freeze, signed by the AI key: its own decision, never a client's request.
// Each step that leads to the AI key signing is claimed with a conditional
// UPDATE, so it happens once however many requests race for it.
import { PublicKey, type ParsedAccountData } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { waitUntil } from "@vercel/functions";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { randomUUID } from "node:crypto";
import { BN, accounts, connection, PROGRAM_ID, programFor, sendIxs } from "./chain.ts";
import { ensureSchema, sql } from "./db.ts";
import { DemoError, demoPublic, ensureMint } from "./demo.ts";
import { loadKey } from "./keys.ts";
import { lookupScamReports, type ScamReports } from './scam-reports.ts';

const ai = loadKey("ai-guardian");
export const ACT_AFTER_MS = 40_000;
const SCAN_EVERY_SECS = 8;
const DECIMALS = 6;
// Vault layout: ai_guardian sits after owner(82) + epoch + 5 guardian slots + count/threshold/epoch;
// safe_address follows it.
const AI_GUARDIAN_OFFSET = 284;
const SAFE_OFFSET = 316;

let tables: Promise<unknown> | null = null;
function ensureTables() {
  tables ??= ensureSchema()
    .then(async () => {
      await sql`create table if not exists watch_alerts (
        id text primary key,
        vault text not null,
        withdrawal text not null unique,
        wid bigint not null,
        amount text not null,
        destination text not null,
        destination_owner text not null,
        requested_at bigint not null,
        executes_at bigint not null,
        risk text not null,
        score integer not null,
        reason text not null,
        signals jsonb not null,
        status text not null default 'open',
        act_at bigint,
        resolution jsonb,
        created_at timestamptz not null default now()
      )`;
      await sql`create index if not exists watch_alerts_vault on watch_alerts (vault, created_at)`;
      await sql`alter table watch_alerts add column if not exists scam_lookup jsonb`;
      await sql`create table if not exists scam_report_cache (address text primary key, result jsonb not null, expires timestamptz not null)`;
      await sql`create table if not exists watch_log (
        id bigserial primary key,
        vault text not null,
        at bigint not null,
        type text not null,
        text text not null,
        alert_id text
      )`;
      await sql`create index if not exists watch_log_vault on watch_log (vault, id)`;
      await sql`create table if not exists watch_scans (vault text primary key, last timestamptz not null)`;
    })
    .catch((e) => {
      tables = null;
      throw e;
    });
  return tables;
}

function later(p: Promise<unknown>) {
  const guarded = p.catch((e) => console.error("[sentinel] watch task failed:", (e as Error).message));
  try {
    waitUntil(guarded);
  } catch {
    /* long-lived server */
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function log(vault: string, type: string, text: string, alertId?: string) {
  await sql`insert into watch_log (vault, at, type, text, alert_id) values (${vault}, ${Math.floor(Date.now() / 1000)}, ${type}, ${text}, ${alertId ?? null})`;
}

type VaultAcct = { owner: PublicKey; guardians: PublicKey[]; guardianCount: number; aiGuardian: PublicKey; safeAddress: PublicKey; mint: PublicKey; frozen: boolean };
type WAcct = { id: BN; destination: PublicKey; amount: BN; requestedAt: BN; executesAt: BN; rentPayer: PublicKey };

async function readVault(vault: PublicKey): Promise<VaultAcct | null> {
  return ((await accounts(ai).vault.fetch(vault).catch(() => null)) as VaultAcct | null) ?? null;
}

/**
 * Demo vaults use the same AI key but run their own call flow (demo.ts). They
 * all send emergencies to the demo safe address, which outlives the demo
 * session rows (those are deleted after a day).
 */
const isDemoVault = (v: VaultAcct) => v.safeAddress.toBase58() === demoPublic.safe;

/** Vaults that name Sentinel's AI key as their AI guardian (demo vaults excluded). */
export async function watchedVaults(): Promise<string[]> {
  await ensureTables();
  const all = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [{ memcmp: { offset: AI_GUARDIAN_OFFSET, bytes: ai.publicKey.toBase58() } }],
    dataSlice: { offset: SAFE_OFFSET, length: 32 },
  });
  const demoSafe = new PublicKey(demoPublic.safe).toBytes();
  return all.filter((a) => !demoSafe.every((b, i) => a.account.data[i] === b)).map((a) => a.pubkey.toBase58());
}

const fmt = (base: bigint) => (Number(base) / 10 ** DECIMALS).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`;

async function ownerOfTokenAccount(ta: PublicKey): Promise<string> {
  const r = await connection.getParsedAccountInfo(ta).catch(() => null);
  return ((r?.value?.data as ParsedAccountData | undefined)?.parsed?.info?.owner as string | undefined) ?? ta.toBase58();
}

const AGE_LOOKBACK = 1000;

async function addressAgeSeconds(addr: string): Promise<number | null> {
  const sigs = await connection.getSignaturesForAddress(new PublicKey(addr), { limit: AGE_LOOKBACK }).catch(() => []);
  // A full page means a busy address: its first activity is further back than we looked,
  // so it isn't new (an exchange deposit address, say). Without this it would look minutes old.
  if (sigs.length >= AGE_LOOKBACK) return Number.POSITIVE_INFINITY;
  const oldest = sigs.at(-1)?.blockTime;
  return oldest ? Math.max(0, Math.floor(Date.now() / 1000) - oldest) : null;
}

type Signal = { id: string; label: string; weight: number };

/** Scores a pending withdrawal from on-chain signals. */
async function score(vault: string, v: VaultAcct, w: WAcct, destOwner: string) {
  const amount = BigInt(w.amount.toString());
  const bal = await connection.getTokenAccountBalance(getAssociatedTokenAddressSync(v.mint, new PublicKey(vault), true)).catch(() => null);
  const balance = bal ? BigInt(bal.value.amount) : 0n;
  const share = balance > 0n ? Math.min(100, Number((amount * 100n) / balance)) : 100;

  const trusted = ((await accounts(ai).trustedAddress.all([{ memcmp: { offset: 8, bytes: vault } }]).catch(() => [])) as { account: { wallet: PublicKey } }[]).map((t) => t.account.wallet.toBase58());
  const paid = ((await sql`select distinct destination_owner from watch_alerts where vault = ${vault} and status = 'executed'`) as { destination_owner: string }[]).map((r) => r.destination_owner);
  const known = [...new Set([...trusted, ...paid])];
  const age = await addressAgeSeconds(destOwner);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Africa/Lagos" }).format(new Date()));

  const signals: Signal[] = [];
  if (age !== null && age < 86_400) signals.push({ id: "new_address", label: `Destination is ${age < 120 ? `${age} seconds` : age < 7200 ? `${Math.round(age / 60)} minutes` : `${Math.round(age / 3600)} hours`} old`, weight: age < 3600 ? 35 : 25 });
  else if (age === null) signals.push({ id: "new_address", label: "Destination has no history on-chain", weight: 35 });
  signals.push({ id: "share_of_vault", label: `${share}% of the vault`, weight: share >= 50 ? 30 : Math.round(share * 0.4) });
  const look = known.find((k) => k !== destOwner && (k.slice(0, 4) === destOwner.slice(0, 4) || k.slice(-4) === destOwner.slice(-4)));
  if (look) signals.push({ id: "lookalike", label: `Looks like ${trusted.includes(look) ? "trusted " : ""}${short(look)} but isn't`, weight: 35 });
  if (!known.includes(destOwner)) signals.push({ id: "first_destination", label: "First time this vault pays this address", weight: 15 });
  const odd = hour < 6 || hour >= 23;
  signals.push({ id: "odd_hour", label: `Requested at ${String(hour).padStart(2, "0")}:00 Lagos time${odd ? ", outside usual hours" : ""}`, weight: odd ? 12 : 4 });

  let total = Math.min(100, signals.reduce((a, s) => a + s.weight, 0));
  // Floors, so a thief can't stay under "critical" just by using an older address:
  // most of the vault to somewhere it has never paid, or a lookalike, is the theft pattern.
  if ((share >= 50 && !known.includes(destOwner)) || look) total = Math.max(total, 70);
  const risk = total >= 70 ? "critical" : total >= 45 ? "high" : total >= 25 ? "medium" : "low";
  const parts = [`This sends ${share}% of the vault`, `to ${short(destOwner)}`];
  if (age === null || (age !== null && age < 86_400)) parts.push("a brand-new address");
  if (look) parts.push(`that imitates ${short(look)}`);
  const reason = `${parts[0]} ${parts[1]}${parts.length > 2 ? `, ${parts.slice(2).join(" ")}` : ""}. ${risk === "critical" ? "That's the pattern of a stolen key." : risk === "high" ? "Worth a second look." : "Looks routine."}`;
  return { total, risk, reason, signals };
}

/**
 * Scans one vault: raises alerts for new pending withdrawals, resolves alerts
 * whose withdrawal is gone, and schedules the AI's action on critical ones.
 * At most every SCAN_EVERY_SECS per vault, unless forced (webhook).
 */
export async function scanVault(vault: string, force = false) {
  await ensureTables();
  const claimed = force
    ? [1]
    : await sql`insert into watch_scans (vault, last) values (${vault}, now())
        on conflict (vault) do update set last = now() where watch_scans.last < now() - make_interval(secs => ${SCAN_EVERY_SECS})
        returning vault`;
  if (claimed.length === 0) return;
  const pk = new PublicKey(vault);
  const v = await readVault(pk);
  if (!v || !v.aiGuardian.equals(ai.publicKey) || isDemoVault(v)) return;

  const ws = (await accounts(ai).withdrawal.all([{ memcmp: { offset: 8, bytes: vault } }]).catch(() => [])) as { publicKey: PublicKey; account: WAcct }[];
  const open = (await sql`select id, withdrawal from watch_alerts where vault = ${vault} and status in ('open', 'dismissed', 'acting')`) as { id: string; withdrawal: string }[];
  const pending = new Set(ws.map((w) => w.publicKey.toBase58()));
  for (const a of open) if (!pending.has(a.withdrawal)) await resolveGone(vault, v, a.id, a.withdrawal);

  const known = new Set(((await sql`select withdrawal from watch_alerts where vault = ${vault}`) as { withdrawal: string }[]).map((r) => r.withdrawal));
  for (const w of ws) {
    const key = w.publicKey.toBase58();
    if (known.has(key)) continue;
    const destOwner = await ownerOfTokenAccount(w.account.destination);
    const s = await score(vault, v, w.account, destOwner);
    const id = `al_${randomUUID().slice(0, 8)}`;
    const actAt = s.risk === "critical" ? Date.now() + ACT_AFTER_MS : null;
    const ins = await sql`insert into watch_alerts (id, vault, withdrawal, wid, amount, destination, destination_owner, requested_at, executes_at, risk, score, reason, signals, act_at)
      values (${id}, ${vault}, ${key}, ${w.account.id.toString()}, ${w.account.amount.toString()}, ${w.account.destination.toBase58()}, ${destOwner},
              ${w.account.requestedAt.toString()}, ${w.account.executesAt.toString()}, ${s.risk}, ${s.total}, ${s.reason}, ${JSON.stringify(s.signals)}::jsonb, ${actAt})
      on conflict (withdrawal) do nothing returning id`;
    if (ins.length === 0) continue;
    await log(vault, "scored", `Withdrawal #${w.account.id.toString()} of ${fmt(BigInt(w.account.amount.toString()))} scored ${s.risk.toUpperCase()} (${s.total})`, id);
    if (actAt) {
      await log(vault, "calling", "Argus is calling the owner. No answer in 40 seconds and it cancels.", id);
      later(sleep(ACT_AFTER_MS + 500).then(() => act(id)));
    }
    // Enrichment runs independently after the protective deadline is scheduled.
    later(enrichReports(id, vault, destOwner));
  }
  // Anything overdue (e.g. raised by an earlier request that didn't live long enough).
  const due = (await sql`select id from watch_alerts where vault = ${vault} and status = 'open' and risk = 'critical' and act_at <= ${Date.now()}`) as { id: string }[];
  for (const d of due) later(act(d.id));
}

async function enrichReports(id: string, vault: string, address: string) {
  const cached = await sql`select result from scam_report_cache where address = ${address} and expires > now()` as { result: ScamReports }[];
  const result = cached[0]?.result ?? await lookupScamReports(address);
  if (!cached.length) {
    const ttl = result.status === 'unavailable' || result.status === 'unconfigured' ? 300 : result.status === 'matches' ? 21600 : 3600;
    await sql`insert into scam_report_cache (address, result, expires) values (${address}, ${JSON.stringify(result)}::jsonb, now() + ${ttl} * interval '1 second')
      on conflict (address) do update set result = excluded.result, expires = excluded.expires`;
  }
  await sql`update watch_alerts set scam_lookup = ${JSON.stringify(result)}::jsonb where id = ${id}`;
  if (result.status === 'matches') {
    await log(vault, 'scam_reports', `Exact address mentioned in ${result.sources.length} public security report(s). A mention is not proof of wrongdoing.`, id);
  }
}

/** The AI key's own decision: cancel and freeze a critical alert nobody resolved. Runs once. */
export async function act(id: string) {
  const rows = (await sql`update watch_alerts set status = 'acting' where id = ${id} and status = 'open' and risk = 'critical' and act_at <= ${Date.now()} returning *`) as {
    vault: string;
    withdrawal: string;
  }[];
  const a = rows[0];
  if (!a) return;
  try {
    const vault = new PublicKey(a.vault);
    const wpk = new PublicKey(a.withdrawal);
    const w = (await accounts(ai).withdrawal.fetch(wpk).catch(() => null)) as WAcct | null;
    const v = await readVault(vault);
    if (!w || !v) {
      await sql`update watch_alerts set status = 'open' where id = ${id}`;
      if (v) await resolveGone(a.vault, v, id, a.withdrawal);
      return;
    }
    const program = programFor(ai);
    const cancelIx = await program.methods.cancelWithdrawal().accountsPartial({ canceller: ai.publicKey, vault, withdrawal: wpk, rentPayer: w.rentPayer }).instruction();
    const cancelSig = await sendIxs([cancelIx], [ai]);
    let freezeSig: string | null = null;
    if (!v.frozen) {
      const freezeIx = await program.methods.freeze().accountsPartial({ signer: ai.publicKey, vault }).instruction();
      freezeSig = await sendIxs([freezeIx], [ai]);
    }
    await sql`update watch_alerts set status = 'cancelled', resolution = ${JSON.stringify({ by_role: "ai", tx: cancelSig, freeze_tx: freezeSig, at: Math.floor(Date.now() / 1000) })}::jsonb where id = ${id}`;
    await log(a.vault, "cancelled", `Argus cancelled withdrawal and ${freezeSig ? "froze the vault" : "the vault stays frozen"}. Nobody answered.`, id);
  } catch (e) {
    // Try again shortly rather than leave the alert stuck.
    await sql`update watch_alerts set status = 'open', act_at = ${Date.now() + 15_000} where id = ${id} and status = 'acting'`;
    await log(a.vault, "error", `Argus couldn't cancel yet: ${(e as Error).message.slice(0, 120)}. Retrying.`, id);
  }
}

/** A watched withdrawal left the pending set: find out whether it was cancelled or executed, and by whom. */
async function resolveGone(vault: string, v: VaultAcct, id: string, withdrawal: string) {
  const sigs = await connection.getSignaturesForAddress(new PublicKey(withdrawal), { limit: 5 }).catch(() => []);
  let status = "executed";
  let resolution: Record<string, unknown> = {};
  for (const s of sigs) {
    if (s.err) continue;
    const tx = await connection.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }).catch(() => null);
    const logs = tx?.meta?.logMessages ?? [];
    const signer = tx?.transaction.message.getAccountKeys().get(0)?.toBase58();
    if (logs.some((l) => l.includes("Instruction: CancelWithdrawal"))) {
      status = "cancelled";
      const role = signer === ai.publicKey.toBase58() ? "ai" : signer === v.owner.toBase58() ? "owner" : "guardian";
      resolution = { by_role: role, tx: s.signature, at: s.blockTime };
      break;
    }
    if (logs.some((l) => l.includes("Instruction: ExecuteWithdrawal"))) {
      resolution = { tx: s.signature, at: s.blockTime };
      break;
    }
  }
  const upd = await sql`update watch_alerts set status = ${status}, resolution = coalesce(resolution, ${JSON.stringify(resolution)}::jsonb) where id = ${id} and status in ('open', 'dismissed') returning id`;
  if (upd.length) await log(vault, status, status === "cancelled" ? `Withdrawal cancelled by the ${resolution.by_role ?? "vault"}.` : "Withdrawal went through.", id);
}

/* ------------------------------------------------------------------ reads */

type Row = {
  id: string;
  vault: string;
  withdrawal: string;
  wid: string;
  amount: string;
  destination: string;
  destination_owner: string;
  requested_at: string;
  executes_at: string;
  risk: string;
  score: number;
  reason: string;
  signals: Signal[];
  status: string;
  act_at: string | null;
  resolution: Record<string, unknown> | null;
  created_at: string;
  scam_lookup?: ScamReports | null;
};

async function toAlert(r: Row) {
  const mint = (await ensureMint()).toBase58();
  return {
    id: r.id,
    vault: r.vault,
    kind: "withdrawal",
    token: { mint, symbol: "dUSDC", decimals: DECIMALS },
    withdrawal: {
      pda: r.withdrawal,
      id: String(r.wid),
      amount: r.amount,
      decimals: DECIMALS,
      destination: r.destination,
      destination_owner: r.destination_owner,
      requested_at: Number(r.requested_at),
      executes_at: Number(r.executes_at),
    },
    risk: r.risk,
    score: r.score,
    reason: r.reason,
    signals: r.signals,
    scam_lookup: r.scam_lookup ?? null,
    status: r.status === "acting" ? "open" : r.status,
    // Extension: when the AI acts if nobody resolves it (critical only), ms since epoch.
    act_at: r.act_at ? Number(r.act_at) : null,
    resolution: r.resolution,
    created_at: Math.floor(new Date(r.created_at).getTime() / 1000),
  };
}

export async function listAlerts(vault: string, status: string) {
  try {
    new PublicKey(vault);
  } catch {
    throw new DemoError(400, "That isn't a vault address.");
  }
  await ensureTables();
  await scanVault(vault).catch((e) => console.error("[sentinel] scan:", (e as Error).message));
  const rows = (status === "all"
    ? await sql`select * from watch_alerts where vault = ${vault} order by created_at desc limit 20`
    : await sql`select * from watch_alerts where vault = ${vault} and status in ('open', 'acting') order by created_at desc limit 20`) as Row[];
  return { alerts: await Promise.all(rows.map(toAlert)) };
}

export async function watchlog(vault: string) {
  await ensureTables();
  const rows = (await sql`select at, type, text, alert_id from watch_log where vault = ${vault} order by id desc limit 50`) as { at: string; type: string; text: string; alert_id: string | null }[];
  return { entries: rows.map((r) => ({ at: Number(r.at), type: r.type, text: r.text, alert_id: r.alert_id })) };
}

/**
 * "It was me": a vault member signs `Argus: it was me. Dismiss alert {id} at {ts}`.
 * Critical alerts need a guardian: a stolen owner key is exactly the threat.
 */
export async function dismiss(id: string, body: Record<string, unknown>) {
  await ensureTables();
  const wallet = String(body.wallet ?? "");
  const ts = Number(body.ts);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) throw new DemoError(400, "That confirmation expired. Try again.");
  let walletPk: PublicKey;
  let sig: Uint8Array;
  try {
    walletPk = new PublicKey(wallet);
    sig = bs58.decode(String(body.signature ?? ""));
  } catch {
    throw new DemoError(400, "Bad wallet or signature.");
  }
  const rows = (await sql`select * from watch_alerts where id = ${id}`) as Row[];
  const a = rows[0];
  if (!a) throw new DemoError(404, "No such alert.");
  const message = new TextEncoder().encode(`Argus: it was me. Dismiss alert ${id} at ${ts}`);
  if (sig.length !== 64 || !nacl.sign.detached.verify(message, sig, walletPk.toBytes())) throw new DemoError(401, "That signature doesn't match the wallet.");
  const v = await readVault(new PublicKey(a.vault));
  if (!v) throw new DemoError(404, "Vault not found.");
  const guardians = v.guardians.slice(0, v.guardianCount).map((g) => g.toBase58());
  const isOwner = v.owner.equals(walletPk);
  const isGuardian = guardians.includes(wallet);
  if (!isOwner && !isGuardian) throw new DemoError(403, "Only the vault's owner or a guardian can do that.");
  if (a.risk === "critical" && !isGuardian) throw new DemoError(403, "This one looks like theft, so a guardian has to confirm it. The owner key alone can't, in case it's the stolen key.");
  const upd = await sql`update watch_alerts set status = 'dismissed', resolution = ${JSON.stringify({ dismissed_by: wallet, role: isGuardian ? "guardian" : "owner", at: Math.floor(Date.now() / 1000) })}::jsonb where id = ${id} and status = 'open' returning *`;
  if (!upd.length) throw new DemoError(409, "This alert is already resolved.");
  await log(a.vault, "dismissed", `A ${isGuardian ? "guardian" : "the owner"} said it was them. Argus stands down for this withdrawal.`, id);
  return toAlert(upd[0] as Row);
}

/** Helius raw webhook: scan every watched vault an Argus transaction touched. */
export async function heliusWebhook(body: unknown) {
  const txs = (Array.isArray(body) ? body : [body]) as { transaction?: { message?: { accountKeys?: string[] } } }[];
  const keys = new Set<string>();
  for (const t of txs.slice(0, 50)) for (const k of t?.transaction?.message?.accountKeys ?? []) keys.add(k);
  if (keys.size === 0) return { scanned: 0 };
  // Which of these are Argus vaults?
  const list = [...keys].slice(0, 100).map((k) => new PublicKey(k));
  const infos = await connection.getMultipleAccountsInfo(list).catch(() => []);
  const disc = Uint8Array.from((await import("./chain.ts")).idl.accounts!.find((a) => a.name === "Vault")!.discriminator);
  const vaults = list.filter((_, i) => infos[i]?.owner.equals(PROGRAM_ID) && disc.every((b, j) => infos[i]!.data[j] === b)).map((k) => k.toBase58());
  for (const v of vaults) await scanVault(v, true);
  return { scanned: vaults.length };
}
