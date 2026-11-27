// Solana RPC relay for the web app. The app's reads and transaction sends go
// through Sentinel to the private RPC (RPC_URL), so the key never reaches the
// browser and visitors don't hit the public RPC's rate limits.
//
// Only an allowlist of methods is relayed, program-account scans only for the
// Argus program, and batches are capped. It can't sign anything: transactions
// arrive already signed by the user's wallet.
import { PROGRAM_ID, RPC_URL } from "./chain.ts";
import { DemoError } from "./demo.ts";

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

// Per-visitor budget, per running instance (serverless instances each keep
// their own; that's fine for a soft limit).
const WINDOW_MS = 60_000;
const PER_WINDOW = 240;
const seen = new Map<string, { start: number; n: number }>();

type Call = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };

export async function relayRpc(body: unknown, ip: string): Promise<{ status: number; json: unknown }> {
  const calls = (Array.isArray(body) ? body : [body]) as Call[];
  if (calls.length === 0 || calls.length > MAX_BATCH) throw new DemoError(400, `Send 1 to ${MAX_BATCH} calls.`);
  for (const c of calls) {
    if (!c || typeof c !== "object" || typeof c.method !== "string" || !ALLOWED.has(c.method)) throw new DemoError(403, `Method not allowed: ${String(c?.method)}`);
    if (c.method === "getProgramAccounts" && (c.params as unknown[] | undefined)?.[0] !== PROGRAM_ID.toBase58()) throw new DemoError(403, "Only the Argus program can be scanned.");
  }

  const now = Date.now();
  const s = seen.get(ip);
  if (!s || now - s.start > WINDOW_MS) seen.set(ip, { start: now, n: calls.length });
  else if ((s.n += calls.length) > PER_WINDOW) throw new DemoError(429, "Too many requests. Slow down a little.");
  if (seen.size > 5_000) for (const [k, v] of seen) if (now - v.start > WINDOW_MS) seen.delete(k);

  const r = await fetch(RPC_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await r.json().catch(() => ({ jsonrpc: "2.0", error: { code: -32603, message: "Bad response from the RPC." }, id: null }));
  // Log failures (method and error only; never the payload) to help debugging.
  for (const res of (Array.isArray(json) ? json : [json]) as { error?: { code?: number; message?: string } }[]) {
    if (res?.error) console.warn(`[sentinel] rpc ${calls.map((c) => c.method).join(",")} -> ${r.status} ${res.error.code ?? ""} ${String(res.error.message ?? "").slice(0, 160)}`);
  }
  return { status: r.status, json };
}
