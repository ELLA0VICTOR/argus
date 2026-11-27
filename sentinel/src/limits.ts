// Soft per-visitor rate limits, kept in memory per running instance. On
// serverless each instance keeps its own counts, so these bound abuse rather
// than meter it exactly; anything that spends money also has a global cap in
// the database (faucet, demo sessions).
import { DemoError } from "./demo.ts";

const buckets = new Map<string, { start: number; n: number }>();

/**
 * One key per visitor. IPv6 users usually get a whole /64, so rotating
 * addresses inside it must not reset their limits.
 */
export function visitorKey(ip: string): string {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (!v4.includes(":")) return v4;
  const full = expandV6(v4);
  return full ? `${full.slice(0, 4).join(":")}::/64` : v4;
}

function expandV6(ip: string): string[] | null {
  const [head, tail] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  if (tail === undefined && h.length !== 8) return null;
  const fill = Array(8 - h.length - t.length).fill("0");
  const parts = [...h, ...fill, ...t];
  return parts.length === 8 ? parts.map((p) => p.toLowerCase().replace(/^0+(?=.)/, "")) : null;
}

/** Throws 429 once `name` has been used `max` times by this visitor within `windowMs`. */
export function limit(name: string, ip: string, max: number, windowMs: number, message = "Too many requests. Slow down a little.") {
  const key = `${name}|${visitorKey(ip)}`;
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.start > windowMs) buckets.set(key, { start: now, n: 1 });
  else if (++b.n > max) throw new DemoError(429, message);
  if (buckets.size > 20_000) for (const [k, v] of buckets) if (now - v.start > 3_600_000) buckets.delete(k);
}

const open = new Map<string, number>();

/** Caps how many long-lived requests (event streams) one visitor holds at once. */
export function holdSlot(name: string, ip: string, max: number): () => void {
  const key = `${name}|${visitorKey(ip)}`;
  const n = open.get(key) ?? 0;
  if (n >= max) throw new DemoError(429, "Too many open connections from you. Close a tab and try again.");
  open.set(key, n + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const m = (open.get(key) ?? 1) - 1;
    if (m <= 0) open.delete(key);
    else open.set(key, m);
  };
}
