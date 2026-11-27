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
