# Sentinel audit, round 1 (Claude, 2026-11-27)

**Scope:** everything Sentinel runs off-chain, plus the web app code that builds and sends transactions:
- `sentinel/src/`: `handler.ts`, `demo.ts`, `watch.ts`, `faucet.ts`, `rpc.ts`, `db.ts`, `keys.ts`, `chain.ts`, `limits.ts`;
- the Vercel bundle (`scripts/build-vercel.mjs`);
- `app/src/app/live/*` (the web app's transaction builders, the alert/dismiss flow, and the in-app call).

The on-chain program was audited separately (`claude-r1.md`, `codex-r1.md`) and hasn't changed since.

**How:** a line-by-line read against six questions:
1. Can anyone make the AI key sign something it shouldn't, or sign twice?
2. Can anyone drain or abuse the funding wallet?
3. Can anyone abuse the RPC relay or burn RPC credits?
4. Can anyone fake, suppress or wave through an alert?
5. Can secrets leak?
6. Can bad input crash or degrade the service?

Every fix has a check in `sentinel/src/audit-check.ts` (`npm run check:audit`). The earlier suites were rerun for regressions.

## What holds

These properties were checked and hold:
- **The AI key can only cancel and freeze.** That's enforced on-chain (INV-5), and Sentinel builds no other instruction with it.
- **The AI key never acts on a client's request for a real vault.** It acts only when a critical alert's own deadline passes. Dismissals and voice "cancel" go through the user's own wallet signature.
- **Every step towards an AI signature is claimed once in the database** (`UPDATE … WHERE status = 'open' … RETURNING`). Tested: 5 simultaneous answers produce one cancel; the timeout fires once; a late answer is refused.
- **Dismissals:**
  - they need an ed25519 signature over `Argus: it was me. Dismiss alert {id} at {ts}` (5-minute window), from the vault's owner or a guardian;
  - **critical alerts need a guardian**, so a stolen owner key alone can't stand Argus down;
  - a replay hits an already-resolved alert (409).
- **Demo moves:** each prepared move is consumed atomically (410 on replay). The browser's signature is checked against the exact message bytes before relaying.
- **Secrets:**
  - keys, the database URL, the RPC key and the webhook secret are only in environment variables or gitignored files;
  - none is logged or returned.
- **SQL:** every query uses parameters (tagged templates). No string-built SQL.

## Findings and fixes

| # | Severity | Finding | Fix | Check |
|---|---|---|---|---|
| S-1 | **High** | A thief could dodge the AI's automatic cancel by sending to an *old* address. Without the "new address" signal, 100% of the vault to a never-paid address scored 49 (high), and only critical alerts trigger the AI. | Scoring floors: ≥ 50% of the vault to a destination the vault has never paid, or any lookalike of a trusted or paid address, is at least critical (70). Spec updated. | "…taking the whole vault to a never-paid address is still critical" + "the AI cancelled it" + "and froze the vault" |
| S-2 | **High** | The RPC relay sent and simulated *any* transaction, so it was a free devnet relay on our RPC quota. | Relayed transactions must call Argus and may only add the token-account, compute-budget, memo and Lighthouse programs. Plus a per-visitor send cap (30/min). | relay refuses a SOL transfer, a token transfer, and an Argus transaction with a transfer smuggled in; it does relay an Argus-only transaction |
| S-3 | **Medium** | The funder could be drained by rotating IP addresses (an IPv6 /64 gives billions). Per-address limits only, and each faucet claim also costs about 0.002 SOL of account rent. | Visitors are grouped by IPv6 /64. Global daily caps: 300 faucet claims, 15 SOL drips. Global cap of 30 demo sessions per hour (≈ 1.2 SOL/h worst case). The funder keeps a 1 SOL reserve. | code review; caps live in `faucet.ts` and `demo.ts` |
| S-4 | **Medium** | Two simultaneous faucet claims for one wallet could both pay (check-then-insert race). | A unique index on (wallet, 12-hour block). The losing insert is refused. | "5 simultaneous faucet claims for one wallet → one payout" |
| S-5 | **Medium** | Demo vaults are recognized by the `demo_sessions` row, which is deleted after a day. Afterwards they looked like real vaults: scanned, and their public "stolen" keys could raise alerts. | Demo vaults are recognized by their demo safe address, which is permanent. | "demo vaults are never watched (21 found, none watched)" |
| S-6 | **Medium** | Busy addresses (over 1,000 transactions) looked brand-new, because the age check only reads the last 1,000. | A full page counts as "old". | "destination is an old address (no new_address signal)" |
| S-7 | **Low** | Public routes (alerts, watch log, dismiss, demo moves) had no rate limit. Each alerts read can cost an RPC call. | Per-visitor limits: 60/min reads, 10/min dismissals, 30/min demo moves, 120/min call relay lines. At most 4 open event streams per visitor. | "public reads are rate-limited (first 429 at request 61)" |
| S-8 | **Low** | The webhook secret was compared with `!==` (timing-dependent). | `crypto.timingSafeEqual`. | "webhook rejects a wrong secret of the right length", "rejects a missing secret", "accepts the right secret" |
| S-9 | **Low** | `/v1/health?deep=1` returned the database host, and an RPC error could carry the RPC URL with its API key into the response or logs. | The host goes only to the server log. `redact()` strips database URLs, `api-key=` values and Helius URLs from the health output, error logs and relay logs. | "deep health reports db ok without the host"; redaction unit-checked |
| S-10 | **Info** | The Vercel bundle lacked `__filename` / `__dirname`. Outbound calls failed and the function crashed. Found during deployment. | Defined in the bundle banner. | the hosted run: vault creation, race and timeout checks |
| S-11 | **Info** | Wallet adapters pick the network from the RPC URL, and the relay URL didn't say "devnet", so wallets would have assumed mainnet. Found during testing. | The relay lives at `/v1/rpc/devnet`. | the full in-app devnet run (22 checks) |

## Accepted risks (devnet hackathon build)

- **Demo control routes are capabilities on a public id.** `/v1/demo/:id/decision`, `/phone` and `/call` take the session id, which is the demo vault's address and visible on-chain. Someone could answer or caption another visitor's *demo* call. The impact is limited to demo vaults with test tokens, and the routes are rate-limited. Fixing it means a session token, which is a breaking change for the mobile client. Logged for v2.
- **One hot AI key on the server.** If Sentinel is compromised, the attacker can cancel withdrawals and freeze vaults (griefing), but never move funds or vote (INV-5). Guardians can unfreeze, and can replace the AI guardian through governance (`SetAiGuardian`).
- **Watching depends on the webhook (or an open app).** On Vercel nothing polls by itself. If Helius is down and nobody has the app open, alerts wait until the next webhook or visit. The on-chain delay still protects the funds, and guardians can cancel. Use a delay well above 40 s; the 1-minute option is for testing.
- **Soft limits are per instance.** On serverless each instance keeps its own counters. Everything that spends money also has a database-backed global cap.
- **Scoring is heuristic.** False positives freeze the vault until guardians unfreeze it, which is the safe direction. Owners moving money to their own wallets should make them trusted addresses (instant, never flagged).

## Re-run

```bash
cd sentinel
WATCH_LOOP=0 node --env-file=.env src/server.ts      # in one terminal
npm run check:audit                                  # audit checks (18)
npm run check:watch                                  # real-vault watcher (13)
node --env-file=.env src/smoke.ts                    # demo smoke (9)
```
