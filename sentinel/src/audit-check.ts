// Audit checks for Sentinel (docs/audits/claude-sentinel-r1.md). Each one
// proves a fix from the audit holds. Run against a local Sentinel started
// with WATCH_LOOP=0:  node --env-file=.env src/audit-check.ts [url]
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, createTransferInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { BN, accounts, connection, pda, programFor, sendIxs } from "./chain.ts";
import { demoPublic, ensureMint } from "./demo.ts";
import { loadKey } from "./keys.ts";
import { watchedVaults } from "./watch.ts";
import { sql } from "./db.ts";

const BASE = process.argv[2] ?? "http://localhost:8787";
const funder = loadKey("funder");
const ai = loadKey("ai-guardian");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) fails++;
};
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const rpc = (method: string, params: unknown[]) => post("/v1/rpc/devnet", { jsonrpc: "2.0", id: 1, method, params });
const U = 1_000_000n;
const mint = await ensureMint();

async function signedB64(ixs: Parameters<Transaction["add"]>, payer: Keypair) {
  const tx = new Transaction().add(...ixs);
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = payer.publicKey;
  tx.sign(payer);
  return tx.serialize().toString("base64");
}

/* 1. RPC relay */
const someone = Keypair.generate();
const solTransfer = await signedB64([SystemProgram.transfer({ fromPubkey: someone.publicKey, toPubkey: funder.publicKey, lamports: 1 })], someone);
check((await rpc("sendTransaction", [solTransfer, { encoding: "base64" }])).status === 403, "relay refuses to send a plain SOL transfer");
const tokenTransfer = await signedB64([createTransferInstruction(getAssociatedTokenAddressSync(mint, someone.publicKey), getAssociatedTokenAddressSync(mint, funder.publicKey), someone.publicKey, 1)], someone);
check((await rpc("simulateTransaction", [tokenTransfer, { encoding: "base64" }])).status === 403, "relay refuses to simulate a token transfer");
const vaultX = pda.vault(someone.publicKey, 0);
const freezeIx = await programFor(someone).methods.freeze().accountsPartial({ signer: someone.publicKey, vault: vaultX }).instruction();
const mixed = await signedB64([freezeIx, SystemProgram.transfer({ fromPubkey: someone.publicKey, toPubkey: funder.publicKey, lamports: 1 })], someone);
check((await rpc("sendTransaction", [mixed, { encoding: "base64" }])).status === 403, "relay refuses an Argus transaction with a transfer smuggled in");
const argusOnly = await signedB64([freezeIx], someone);
const sim = await rpc("simulateTransaction", [argusOnly, { encoding: "base64", sigVerify: false }]);
check(sim.status === 200 && "result" in ((await sim.json()) as object), "relay does relay an Argus-only transaction");
check((await rpc("requestAirdrop", [someone.publicKey.toBase58(), 1])).status === 403, "relay refuses methods outside the allowlist");
check((await rpc("getProgramAccounts", [TOKEN_PROGRAM_ID.toBase58()])).status === 403, "relay refuses scanning other programs");

/* 2. Faucet: parallel claims for one wallet → exactly one payout */
const fw = Keypair.generate().publicKey.toBase58();
const results = await Promise.all([1, 2, 3, 4, 5].map(() => post("/v1/faucet", { wallet: fw }).then((r) => r.status)));
check(results.filter((s) => s === 200).length === 1, `5 simultaneous faucet claims for one wallet → one payout (${results.join(",")})`);
await sql`delete from faucet_claims where ip in ('::1', '127.0.0.1', '0:0:0:0::/64')`;

/* 3. Webhook secret */
const secret = process.env.HELIUS_WEBHOOK_SECRET ?? "";
const wrong = "x".repeat(secret.length);
check((await post("/internal/helius/webhook", [], { Authorization: wrong })).status === 401, "webhook rejects a wrong secret of the right length");
check((await post("/internal/helius/webhook", [])).status === 401, "webhook rejects a missing secret");
check((await post("/internal/helius/webhook", [], { Authorization: secret })).status === 200, "webhook accepts the right secret");

/* 4. Health doesn't leak the database host */
const deep = await (await fetch(BASE + "/v1/health?deep=1")).text();
check(!/neon\.tech|host/i.test(deep) && /"db":\{"ok":true\}/.test(deep), "deep health reports db ok without the host");

/* 5. Demo vaults are excluded from watching; real ones are included */
const owner = Keypair.generate();
const guardian = Keypair.generate();
const vault = pda.vault(owner.publicKey, 0);
const vaultAta = getAssociatedTokenAddressSync(mint, vault, true);
const program = programFor(owner);
const init = await program.methods
  .initializeVault(new BN(0), [guardian.publicKey], 1, ai.publicKey, Keypair.generate().publicKey, new BN(60), new BN((100n * U).toString()))
  .accountsPartial({ creator: owner.publicKey, vault, mint, tokenProgram: TOKEN_PROGRAM_ID, vaultToken: vaultAta, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
  .instruction();
await sendIxs([SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: owner.publicKey, lamports: 30_000_000 }), init, createMintToInstruction(mint, vaultAta, funder.publicKey, 1_000n * U)], [funder, owner]);
const watched = await watchedVaults();
check(watched.includes(vault.toBase58()), "a real vault with Sentinel's AI key is watched");
const demoVaults = (await connection.getProgramAccounts(new PublicKey((await import("./chain.ts")).PROGRAM_ID), {
  filters: [{ memcmp: { offset: 316, bytes: demoPublic.safe } }],
  dataSlice: { offset: 0, length: 0 },
})).map((a) => a.pubkey.toBase58());
check(demoVaults.length > 0 && demoVaults.every((d) => !watched.includes(d)), `demo vaults are never watched (${demoVaults.length} found, none watched)`);

/* 6. Scoring floor: theft to an OLD address is still critical, and the AI acts */
// The dev wallet: active on devnet since before the program was deployed.
const oldAddr = new PublicKey("6X8MNjeSazjbCexkizQMwn8L2TuKLMz7NNkb8czdXhBR");
const dest = getAssociatedTokenAddressSync(mint, oldAddr);
const w = pda.withdrawal(vault, 0);
const req = await program.methods
  .requestWithdrawal(new BN((1_000n * U).toString()))
  .accountsPartial({ vault, owner: owner.publicKey, mint, tokenProgram: TOKEN_PROGRAM_ID, vaultToken: vaultAta, destination: dest, withdrawal: w, systemProgram: SystemProgram.programId })
  .instruction();
await sendIxs([createAssociatedTokenAccountIdempotentInstruction(owner.publicKey, dest, oldAddr, mint), req], [owner]);
type A = { risk: string; score: number; status: string; signals: { id: string }[]; resolution: { by_role?: string } | null; withdrawal: { pda: string } };
const get = async (): Promise<A[]> => ((await (await fetch(`${BASE}/v1/vaults/${vault.toBase58()}/alerts?status=all`)).json()) as { alerts: A[] }).alerts;
let a: A | undefined;
for (let i = 0; i < 10 && !a; i++) {
  a = (await get()).find((x) => x.withdrawal.pda === w.toBase58());
  if (!a) await sleep(3000);
}
check(!!a && !a.signals.some((s) => s.id === "new_address"), "destination is an old address (no new_address signal)");
check(a?.risk === "critical", `…but taking the whole vault to a never-paid address is still critical (${a?.risk} ${a?.score})`);
let done: A | undefined;
for (let i = 0; i < 25 && !done; i++) {
  await sleep(4000);
  done = (await get()).find((x) => x.withdrawal.pda === w.toBase58() && x.status !== "open");
}
check(done?.status === "cancelled" && done?.resolution?.by_role === "ai", "the AI cancelled it");
check(((await accounts(owner).vault.fetch(vault)) as { frozen: boolean }).frozen, "and froze the vault");

/* 7. Rate limit on public reads */
const statuses: number[] = [];
for (let i = 0; i < 70; i++) statuses.push((await fetch(`${BASE}/v1/vaults/${vault.toBase58()}/watchlog`)).status);
check(statuses.includes(429), `public reads are rate-limited (first 429 at request ${statuses.indexOf(429) + 1})`);

console.log(fails ? `${fails} FAILED` : "ALL PASSED");
process.exit(fails ? 1 : 0);
