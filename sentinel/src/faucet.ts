// Test-money faucet for the web app: 1,000 dUSDC, plus a little devnet SOL for
// fees when the wallet has almost none. Devnet only, rate-limited per wallet
// and per visitor address, and it never drains the funder.
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { connection, sendIxs } from "./chain.ts";
import { ensureSchema, sql } from "./db.ts";
import { DemoError, ensureMint } from "./demo.ts";
import { loadKey } from "./keys.ts";

const funder = loadKey("funder");
const DUSDC = 1_000n * 1_000_000n;
const SOL_DRIP = 0.1 * LAMPORTS_PER_SOL;
const SOL_IF_BELOW = 0.05 * LAMPORTS_PER_SOL;
const FUNDER_RESERVE = 1 * LAMPORTS_PER_SOL;

let ready: Promise<unknown> | null = null;
function ensureTable() {
  ready ??= ensureSchema().then(
    () => sql`create table if not exists faucet_claims (
      wallet text not null,
      ip text not null,
      at timestamptz not null default now()
    )`,
  );
  return ready;
}

export async function faucet(walletB58: string, ip: string) {
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
  // Record first, so parallel requests can't double-claim.
  await sql`insert into faucet_claims (wallet, ip) values (${wallet.toBase58()}, ${ip})`;

  const mint = await ensureMint();
  const ata = getAssociatedTokenAddressSync(mint, wallet, true);
  const [walletSol, funderSol] = await Promise.all([connection.getBalance(wallet), connection.getBalance(funder.publicKey)]);
  const giveSol = walletSol < SOL_IF_BELOW && funderSol > FUNDER_RESERVE + SOL_DRIP;
  const ixs = [createAssociatedTokenAccountIdempotentInstruction(funder.publicKey, ata, wallet, mint), createMintToInstruction(mint, ata, funder.publicKey, DUSDC)];
  if (giveSol) ixs.push(SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: wallet, lamports: SOL_DRIP }));
  try {
    const sig = await sendIxs(ixs, [funder]);
    return { ok: true, sig, mint: mint.toBase58(), dusdc: "1,000.00", sol: giveSol ? SOL_DRIP / LAMPORTS_PER_SOL : 0 };
  } catch (e) {
    // Didn't land: give the claim back.
    await sql`delete from faucet_claims where wallet = ${wallet.toBase58()} and at > now() - interval '1 minute'`.catch(() => {});
    throw e;
  }
}
