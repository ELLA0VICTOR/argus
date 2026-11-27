// Solana RPC relay for the web app. The app's reads and transaction sends go
// through Sentinel to the private RPC (RPC_URL), so the key never reaches the
// browser and visitors don't hit the public RPC's rate limits.
//
// Only an allowlist of methods is relayed, program-account scans only for the
// Argus program, and batches are capped. It can't sign anything: transactions
// arrive already signed by the user's wallet.
import { VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { PROGRAM_ID, RPC_URL } from "./chain.ts";
import { DemoError } from "./demo.ts";
import { limit } from "./limits.ts";
import { redact } from "./db.ts";

/**
 * Transactions sent or simulated through the relay must call Argus, and may
 * only include these helper programs besides: token-account creation (paying
 * a recipient's first account), compute budget, memo, and Lighthouse (the
 * guard instructions Phantom adds). So the relay can't be used to push
 * arbitrary transfers on our RPC quota.
 */
const TX_PROGRAMS = new Set([
  PROGRAM_ID.toBase58(),
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", // associated token account
  "ComputeBudget111111111111111111111111111111",
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95", // Lighthouse
]);

function checkTx(params: unknown): void {
  const [raw, opts] = (Array.isArray(params) ? params : []) as [unknown, { encoding?: string } | undefined];
  if (typeof raw !== "string" || raw.length > 4000) throw new DemoError(400, "Bad transaction.");
  let tx: VersionedTransaction;
  try {
    const bytes = opts?.encoding === "base64" ? Uint8Array.from(Buffer.from(raw, "base64")) : bs58.decode(raw);
    tx = VersionedTransaction.deserialize(bytes);
  } catch {
    throw new DemoError(400, "Bad transaction.");
  }
  const keys = tx.message.staticAccountKeys;
  const programs = tx.message.compiledInstructions.map((i) => keys[i.programIdIndex]?.toBase58());
  if (!programs.includes(PROGRAM_ID.toBase58())) throw new DemoError(403, "Only Argus transactions can be sent through Argus.");
  const other = programs.find((p) => !p || !TX_PROGRAMS.has(p));
  if (other) throw new DemoError(403, `Program not allowed in relayed transactions: ${other}`);
}

const ALLOWED = new Set([
  "getAccountInfo",
  "getMultipleAccounts",
  "getProgramAccounts",
  "getBalance",
  "getTokenAccountBalance",
  "getLatestBlockhash",
  "isBlockhashValid",
  "getBlockHeight",
  "getSlot",
  "getEpochInfo",
  "getMinimumBalanceForRentExemption",
  "getFeeForMessage",
  "getSignatureStatuses",
  "getSignaturesForAddress",
  "getTransaction",
  "simulateTransaction",
  "sendTransaction",
  "getHealth",
  "getVersion",
  "getGenesisHash",
]);

const MAX_BATCH = 25;

// Per-visitor budget (limits.ts: per instance, IPv6 grouped by /64).
const WINDOW_MS = 60_000;
const PER_WINDOW = 240;

type Call = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };

export async function relayRpc(body: unknown, ip: string): Promise<{ status: number; json: unknown }> {
  const calls = (Array.isArray(body) ? body : [body]) as Call[];
  if (calls.length === 0 || calls.length > MAX_BATCH) throw new DemoError(400, `Send 1 to ${MAX_BATCH} calls.`);
  for (const c of calls) {
    if (!c || typeof c !== "object" || typeof c.method !== "string" || !ALLOWED.has(c.method)) throw new DemoError(403, `Method not allowed: ${String(c?.method)}`);
    if (c.method === "getProgramAccounts" && (c.params as unknown[] | undefined)?.[0] !== PROGRAM_ID.toBase58()) throw new DemoError(403, "Only the Argus program can be scanned.");
    if (c.method === "sendTransaction" || c.method === "simulateTransaction") checkTx(c.params);
  }

  for (let i = 0; i < calls.length; i++) limit("rpc", ip, PER_WINDOW, WINDOW_MS);
  if (calls.some((c) => c.method === "sendTransaction")) limit("rpc-send", ip, 30, WINDOW_MS);

  const r = await fetch(RPC_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await r.json().catch(() => ({ jsonrpc: "2.0", error: { code: -32603, message: "Bad response from the RPC." }, id: null }));
  // Log failures (method and error only; never the payload) to help debugging.
  for (const res of (Array.isArray(json) ? json : [json]) as { error?: { code?: number; message?: string } }[]) {
    if (res?.error) console.warn(`[sentinel] rpc ${calls.map((c) => c.method).join(",")} -> ${r.status} ${res.error.code ?? ""} ${redact(String(res.error.message ?? "")).slice(0, 160)}`);
  }
  return { status: r.status, json };
}
