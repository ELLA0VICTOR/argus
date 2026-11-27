// End-to-end check of Sentinel watching a real (non-demo) vault on devnet.
// Run: node --env-file=.env src/watch-check.ts [sentinel-url]
// A: critical alert → owner can't dismiss, guardian can → AI stands down.
// B: critical alert, nobody answers → AI cancels and freezes on its own, once.
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { BN, accounts, connection, pda, programFor, sendIxs } from "./chain.ts";
import { ensureMint } from "./demo.ts";
import { loadKey } from "./keys.ts";

const BASE = process.argv[2] ?? "http://localhost:8787";
const funder = loadKey("funder");
const ai = loadKey("ai-guardian");
const owner = Keypair.generate();
const guardian = Keypair.generate();
const safe = Keypair.generate().publicKey;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) fails++;
};
const U = 1_000_000n;

const mint = await ensureMint();
const vault = pda.vault(owner.publicKey, 0);
const vaultAta = getAssociatedTokenAddressSync(mint, vault, true);
const ownerAta = getAssociatedTokenAddressSync(mint, owner.publicKey);
const program = programFor(owner);

// Vault: 1 guardian, AI = Sentinel, 60 s delay, 100/day; fund owner and the vault.
const init = await program.methods
  .initializeVault(new BN(0), [guardian.publicKey], 1, ai.publicKey, safe, new BN(60), new BN((100n * U).toString()))
  .accountsPartial({ creator: owner.publicKey, vault, mint, tokenProgram: TOKEN_PROGRAM_ID, vaultToken: vaultAta, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
  .instruction();
await sendIxs([SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: owner.publicKey, lamports: 40_000_000 }), init, createMintToInstruction(mint, vaultAta, funder.publicKey, 1_000n * U)], [funder, owner]);
console.log("vault", vault.toBase58());

async function requestAll(): Promise<PublicKey> {
  const thief = Keypair.generate().publicKey;
  const dest = getAssociatedTokenAddressSync(mint, thief);
  const v = (await accounts(owner).vault.fetch(vault)) as { nextWithdrawalId: BN };
  const bal = BigInt((await connection.getTokenAccountBalance(vaultAta)).value.amount);
  const w = pda.withdrawal(vault, BigInt(v.nextWithdrawalId.toString()));
  const ix = await program.methods
    .requestWithdrawal(new BN(bal.toString()))
    .accountsPartial({ vault, owner: owner.publicKey, mint, tokenProgram: TOKEN_PROGRAM_ID, vaultToken: vaultAta, destination: dest, withdrawal: w, systemProgram: SystemProgram.programId })
    .instruction();
  await sendIxs([createAssociatedTokenAccountIdempotentInstruction(owner.publicKey, dest, thief, mint), ix], [owner]);
  return w;
}

type Alert = { id: string; risk: string; score: number; status: string; act_at: number | null; withdrawal: { pda: string }; resolution: { by_role?: string } | null; signals: { id: string }[] };
const alerts = async (status = "open"): Promise<Alert[]> => ((await (await fetch(`${BASE}/v1/vaults/${vault.toBase58()}/alerts?status=${status}`)).json()) as { alerts: Alert[] }).alerts;
async function waitAlert(pdaKey: string, ms = 40_000): Promise<Alert | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const a = (await alerts("all")).find((x) => x.withdrawal.pda === pdaKey);
    if (a) return a;
    await sleep(3000);
  }
}
async function dismissAs(kp: Keypair, id: string) {
  const ts = Math.floor(Date.now() / 1000);
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(`Argus: it was me. Dismiss alert ${id} at ${ts}`), kp.secretKey));
  const r = await fetch(`${BASE}/v1/alerts/${id}/dismiss`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: kp.publicKey.toBase58(), signature, ts }) });
  return r.status;
}

// A
const w1 = await requestAll();
const a1 = await waitAlert(w1.toBase58());
check(!!a1, "Sentinel raised an alert for the new withdrawal");
check(a1?.risk === "critical", `it's critical (${a1?.risk} ${a1?.score}; signals ${a1?.signals.map((s) => s.id).join(",")})`);
check(!!a1?.act_at, "critical alert has a time when the AI will act");
check((await dismissAs(Keypair.generate(), a1!.id)) === 403, "a stranger can't dismiss it");
check((await dismissAs(owner, a1!.id)) === 403, "the owner key alone can't dismiss a critical alert");
check((await dismissAs(guardian, a1!.id)) === 200, "a guardian can");
console.log("  waiting past the AI's deadline…");
await sleep(48_000);
const stillPending = !!(await connection.getAccountInfo(w1));
check(stillPending, "after a guardian's dismissal, the AI does not cancel");
// Clear it the normal way: the owner cancels with their own key.
const wAcct = (await accounts(owner).withdrawal.fetch(w1)) as { rentPayer: PublicKey };
await sendIxs([await program.methods.cancelWithdrawal().accountsPartial({ canceller: owner.publicKey, vault, withdrawal: w1, rentPayer: wAcct.rentPayer }).instruction()], [owner]);

// B
const w2 = await requestAll();
const a2 = await waitAlert(w2.toBase58());
check(a2?.risk === "critical", "second theft attempt is critical too");
console.log("  nobody answers…");
const end = Date.now() + 90_000;
let resolved: Alert | undefined;
while (Date.now() < end) {
  await sleep(4000);
  resolved = (await alerts("all")).find((x) => x.withdrawal.pda === w2.toBase58() && x.status !== "open");
  if (resolved) break;
}
check(resolved?.status === "cancelled" && resolved?.resolution?.by_role === "ai", `the AI cancelled it on its own (${resolved?.status} by ${resolved?.resolution?.by_role})`);
check(!(await connection.getAccountInfo(w2)), "the withdrawal is gone on-chain");
const vv = (await accounts(owner).vault.fetch(vault)) as { frozen: boolean };
check(vv.frozen, "the vault is frozen");
const bal = (await connection.getTokenAccountBalance(vaultAta)).value.uiAmountString;
check(bal === "1000", `funds never left (vault holds ${bal})`);
const log = ((await (await fetch(`${BASE}/v1/vaults/${vault.toBase58()}/watchlog`)).json()) as { entries: { type: string }[] }).entries;
check(log.filter((e) => e.type === "cancelled").length === 2, "watch log: one owner cancel, one AI cancel, no duplicates");
console.log(fails ? `${fails} FAILED` : "ALL PASSED");
process.exit(fails ? 1 : 0);
