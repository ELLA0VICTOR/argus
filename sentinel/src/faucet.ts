// Test-money faucet for the web app: 1,000 dUSDC, plus a little devnet SOL for
// fees when the wallet has almost none. Devnet only, rate-limited per wallet
// and per visitor address, and it never drains the funder.
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { connection, sendIxs } from "./chain.ts";
import { ensureSchema, sql } from "./db.ts";
import { DemoError, ensureMint } from "./demo.ts";
import { loadKey } from "./keys.ts";
import { limit, visitorKey } from "./limits.ts";

const funder = loadKey("funder");
const DUSDC = 1_000n * 1_000_000n;
const SOL_DRIP = 0.2 * LAMPORTS_PER_SOL;
const SOL_IF_BELOW = 0.1 * LAMPORTS_PER_SOL;
const FUNDER_RESERVE = 1 * LAMPORTS_PER_SOL;
// Global caps per day, whatever the number of visitors or addresses: they
// bound what the funder can lose (each claim also pays ~0.002 SOL account rent).
const MAX_CLAIMS_PER_DAY = 300;
const MAX_SOL_DRIPS_PER_DAY = 15;

let ready: Promise<unknown> | null = null;
function ensureTable() {
  ready ??= ensureSchema().then(
    async () => {
      await sql`create table if not exists faucet_claims (
        wallet text not null,
        ip text not null,
        at timestamptz not null default now()
      )`;
      // One claim per wallet per 12-hour block, enforced by the database.
      await sql`alter table faucet_claims add column if not exists bucket text`;
      await sql`alter table faucet_claims add column if not exists sol boolean not null default false`;
      await sql`create unique index if not exists faucet_claims_wallet_bucket on faucet_claims (wallet, bucket)`;
    },
  );
  return ready;
}

export async function faucet(walletB58: string, rawIp: string) {
  limit("faucet", rawIp, 10, 60_000);
  const ip = visitorKey(rawIp);
  let wallet: PublicKey;
  try {
    wallet = new PublicKey(walletB58);
  } catch {
    throw new DemoError(400, "That isn't a Solana address.");
  }
  await ensureTable();
  const [{ w }] = (await sql`select count(*)::int as w from faucet_claims where wallet = ${wallet.toBase58()} and at > now() - interval '12 hours'`) as { w: number }[];
  if (w > 0) throw new DemoError(429, "This wallet already got test dUSDC recently. Try again in a few hours.");
  const [{ n }] = (await sql`select count(*)::int as n from faucet_claims where ip = ${ip} and at > now() - interval '1 day'`) as { n: number }[];
  if (n >= 5) throw new DemoError(429, "That's enough test money for today. Try again tomorrow.");
  const [{ total, drips }] = (await sql`select count(*)::int as total, count(*) filter (where sol)::int as drips from faucet_claims where at > now() - interval '1 day'`) as { total: number; drips: number }[];
  if (total >= MAX_CLAIMS_PER_DAY) throw new DemoError(503, "The faucet has given out all its test money for today. Try again tomorrow.");
  // Record first; the unique (wallet, 12-hour block) index makes parallel claims lose.
  const bucket = new Date(Math.floor(Date.now() / 43_200_000) * 43_200_000).toISOString();
  const claimed = await sql`insert into faucet_claims (wallet, ip, bucket) values (${wallet.toBase58()}, ${ip}, ${bucket}) on conflict (wallet, bucket) do nothing returning wallet`;
  if (claimed.length === 0) throw new DemoError(429, "This wallet already got test dUSDC recently. Try again in a few hours.");

  const mint = await ensureMint();
  const ata = getAssociatedTokenAddressSync(mint, wallet, true);
  const [walletSol, funderSol] = await Promise.all([connection.getBalance(wallet), connection.getBalance(funder.publicKey)]);
  const giveSol = walletSol < SOL_IF_BELOW && funderSol > FUNDER_RESERVE + SOL_DRIP && drips < MAX_SOL_DRIPS_PER_DAY;
  if (giveSol) await sql`update faucet_claims set sol = true where wallet = ${wallet.toBase58()} and bucket = ${bucket}`;
  const ixs = [createAssociatedTokenAccountIdempotentInstruction(funder.publicKey, ata, wallet, mint), createMintToInstruction(mint, ata, funder.publicKey, DUSDC)];
  if (giveSol) ixs.push(SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: wallet, lamports: SOL_DRIP }));
  try {
    const sig = await sendIxs(ixs, [funder]);
    return { ok: true, sig, mint: mint.toBase58(), dusdc: "1,000.00", sol: giveSol ? SOL_DRIP / LAMPORTS_PER_SOL : 0 };
  } catch (e) {
    // Didn't land: give the claim back.
    await sql`delete from faucet_claims where wallet = ${wallet.toBase58()} and bucket = ${bucket}`.catch(() => {});
    throw e;
  }
}
