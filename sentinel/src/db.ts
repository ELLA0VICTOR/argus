// Demo state in Postgres (Neon), so Sentinel can run on serverless hosts where
// no process lives between requests. Every step that leads to the AI key
// signing is claimed with a conditional UPDATE, so it can only happen once,
// however many requests race for it.
import { neon } from "@neondatabase/serverless";

const URL = process.env.DATABASE_URL;
if (!URL) throw new Error("DATABASE_URL is not set (a Postgres URL, e.g. from Neon)");
export const sql = neon(URL);

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
