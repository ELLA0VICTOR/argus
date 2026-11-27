// Client for the Sentinel demo API. The "stolen" key signs in the browser:
// Sentinel prepares each transaction, the page signs its message with the key,
// and only the signature goes back.
import nacl from "tweetnacl";
import bs58 from "bs58";

export const SENTINEL_URL: string = (import.meta.env.VITE_SENTINEL_URL as string | undefined) ?? "http://localhost:8787";

export type AttackKind = "drain" | "trusted" | "allowance" | "request";

export interface DemoSession {
  session: string;
  vault: string;
  vaultToken: string;
  owner: string;
  stolenKey: string;
  thief: string;
  thiefToken: string;
  mint: string;
  setupTx: string;
  rules: { dailyLimit: string; delayHours: number; funds: string };
}

export type DemoEvent = { t: number } & (
  | { type: "log"; text: string; tone?: "threat" | "safe" | "wait" }
  | { type: "tx"; label: string; sig: string; by: "you" | "argus" | "setup" }
  | { type: "attack"; kind: AttackKind; ok: boolean; sig?: string; error?: { code: number | null; name: string; msg: string } }
  | { type: "risk"; score: number; level: string; reason: string; signals: { label: string; weight: number }[] }
  | { type: "call"; who: "argus" | "owner"; text: string; status?: "ringing" | "connected" | "ended" }
  | { type: "state"; vault: string; thief: string; frozen: boolean; pending: number }
  | { type: "incoming"; amount: string; reason: string; timeoutSecs: number }
  | { type: "decision"; decision: "cancel" | "allow" | "timeout"; via: "voice" | "button" | "timeout" }
  | { type: "phone"; status: "ready" }
);

export type AttackResult = { ok: true; sig: string } | { ok: false; error: { code: number | null; name: string; msg: string } };

async function call<T>(path: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(SENTINEL_URL + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new Error("Can't reach Argus right now. Check your connection and try again.");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message ?? "Something went wrong. Please try again.");
  return j as T;
}

export const startDemo = () => call<DemoSession>("/v1/demo/session");

export interface SentinelInfo {
  ai_guardian: string;
  test_mint?: string;
  program_id: string;
}

let info: Promise<SentinelInfo> | null = null;
/** Sentinel's public details: the AI guardian address and the test token. Cached. */
export function sentinelInfo(): Promise<SentinelInfo> {
  info ??= fetch(SENTINEL_URL + "/v1/health")
    .then((r) => r.json() as Promise<SentinelInfo>)
    .catch((e) => {
      info = null;
      throw e;
    });
  return info;
}

/** 1,000 test dUSDC (and a little SOL for fees if the wallet has almost none). */
export const claimFaucet = (wallet: string) => call<{ ok: true; sig: string; dusdc: string; sol: number }>("/v1/faucet", { wallet });

/** Prepares the attack, signs it locally with the stolen key, and submits it. */
export async function attack(session: DemoSession, kind: AttackKind): Promise<AttackResult> {
  const p = await call<{ nonce: string; message: string }>(`/v1/demo/${session.session}/attack`, { kind });
  const message = Uint8Array.from(atob(p.message), (c) => c.charCodeAt(0));
  const signature = nacl.sign.detached(message, bs58.decode(session.stolenKey));
  return call<AttackResult>(`/v1/demo/${session.session}/attack/${p.nonce}`, { signature: bs58.encode(signature) });
}

/** The owner's answer to Argus's call: from the voice agent's tool, or a button. */
export const decide = (session: string, decision: "cancel" | "allow", via: "voice" | "button") =>
  call<{ ok: true }>(`/v1/demo/${session}/decision`, { decision, via });

/** A phone joined as the owner's device (QR handoff). */
export const phoneReady = (session: string) => call<{ ok: true }>(`/v1/demo/${session}/phone`);

/** Mirrors the call to the other screen. Best effort: display only. */
export function relayCall(session: string, line: { status?: "connected" | "ended"; who?: "argus" | "owner"; text?: string }) {
  call(`/v1/demo/${session}/call`, line).catch(() => {});
}

export function streamEvents(session: string, onEvent: (e: DemoEvent) => void): () => void {
  const es = new EventSource(`${SENTINEL_URL}/v1/demo/${session}/events`);
  es.onmessage = (m) => {
    try {
      onEvent(JSON.parse(m.data));
    } catch {
      /* ignore */
    }
  };
  return () => es.close();
}

/* ------------------------------------------------- watching real vaults */

export interface WatchAlert {
  id: string;
  vault: string;
  withdrawal: { pda: string; id: string; amount: string; destination: string; destination_owner: string; requested_at: number; executes_at: number };
  risk: "low" | "medium" | "high" | "critical";
  score: number;
  reason: string;
  signals: { id: string; label: string; weight: number }[];
  status: "open" | "cancelled" | "executed" | "dismissed" | "voided";
  /** When the AI cancels on its own if nobody resolves it (critical only), ms since epoch. */
  act_at: number | null;
  resolution: { by_role?: string; tx?: string } | null;
  created_at: number;
}

/** Open alerts for a vault. Sentinel scans the vault first (at most every 8 s). */
export async function vaultAlerts(vault: string): Promise<WatchAlert[]> {
  const r = await fetch(`${SENTINEL_URL}/v1/vaults/${vault}/alerts?status=open`);
  if (!r.ok) throw new Error("alerts unavailable");
  return ((await r.json()) as { alerts: WatchAlert[] }).alerts;
}

/** The exact text a member signs to say "it was me". */
export const dismissMessage = (id: string, ts: number) => `Argus: it was me. Dismiss alert ${id} at ${ts}`;

export const dismissAlert = (id: string, body: { wallet: string; signature: string; ts: number }) => call<WatchAlert>(`/v1/alerts/${id}/dismiss`, body);
