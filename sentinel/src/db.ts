// Demo state in Postgres (Neon), so Sentinel can run on serverless hosts where
// no process lives between requests. Every step that leads to the AI key
// signing is claimed with a conditional UPDATE, so it can only happen once,
// however many requests race for it.
import { neon } from "@neondatabase/serverless";

/**
 * Accepts the connection string the way people tend to paste it: with a
 * `DATABASE_URL=` prefix, inside quotes, or as Neon's `psql '…'` snippet.
 */
export function cleanDatabaseUrl(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("DATABASE_URL=")) s = s.slice("DATABASE_URL=".length).trim();
  if (s.startsWith("psql ")) s = s.slice(5).trim();
  s = s.replace(/^['"]+|['"]+$/g, "").trim();
  return s;
}

const URL_RAW = process.env.DATABASE_URL;
if (!URL_RAW) throw new Error("DATABASE_URL is not set (a Postgres URL, e.g. from Neon)");
const DB_URL = cleanDatabaseUrl(URL_RAW);

/** Host only, for diagnostics. Never the user or password. */
export const dbHost = (() => {
  try {
    const u = new URL(DB_URL);
    return /^postgres(ql)?:$/.test(u.protocol) ? u.hostname : `not a postgres URL (${u.protocol})`;
  } catch {
    return "not a valid URL";
  }
})();

export const sql = neon(DB_URL);

/** For /v1/health?deep=1: can we reach the database? */
export async function checkDb(): Promise<{ ok: boolean; host: string; error?: string }> {
  try {
    await sql`select 1`;
    return { ok: true, host: dbHost };
  } catch (e) {
    const err = e as Error & { cause?: { code?: string; message?: string } };
    const why = err.cause?.code ?? err.cause?.message ?? err.message;
    // Strip anything that looks like a connection string before returning it.
    return { ok: false, host: dbHost, error: String(why).replace(/postgres(ql)?:\/\/\S+/g, "<url>").slice(0, 200) };
  }
}

let ready: Promise<void> | null = null;

/** Creates the tables on first use. Safe to run any number of times. */
export function ensureSchema(): Promise<void> {
  ready ??= (async () => {
    await sql`create table if not exists demo_sessions (
      id text primary key,
      owner_secret text not null,
      vault text not null,
      vault_ata text not null,
      thief text not null,
      thief_ata text not null,
      ip text not null,
      created_at timestamptz not null default now(),
      phone_ready boolean not null default false,
      call_lines integer not null default 0,
      handled text[] not null default '{}',
      call jsonb,
      last_watch timestamptz not null default now()
    )`;
    await sql`create index if not exists demo_sessions_ip on demo_sessions (ip, created_at)`;
    await sql`create table if not exists demo_events (
      id bigserial primary key,
      session text not null references demo_sessions (id) on delete cascade,
      data jsonb not null
    )`;
    await sql`create index if not exists demo_events_session on demo_events (session, id)`;
    await sql`create table if not exists demo_moves (
      nonce text primary key,
      session text not null references demo_sessions (id) on delete cascade,
      kind text not null,
      message text not null,
      expires timestamptz not null
    )`;
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

export interface SessionRow {
  id: string;
  owner_secret: string;
  vault: string;
  vault_ata: string;
  thief: string;
  thief_ata: string;
  ip: string;
  created_at: string;
  phone_ready: boolean;
  call_lines: number;
  handled: string[];
  call: CallState | null;
  last_watch: string;
}

/** The pending call: which withdrawal it's about and where it stands. */
export interface CallState {
  withdrawal: string;
  rentPayer: string;
  amount: string;
  reason: string;
  /** ms since epoch. After this, no answer means cancel. */
  deadline: number;
  /** awaiting → deciding (claimed by an answer or the timeout) → done */
  status: "awaiting" | "deciding" | "done";
}
