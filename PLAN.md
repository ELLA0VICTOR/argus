# Argus build plan

Read `docs/CONTEXT.md` first for why we are building this and every decision already made.

## Repo layout

```
argus/
├── Anchor.toml, Cargo.toml   Anchor workspace (Claude)
├── programs/argus/           the Rust program (Claude)
├── programs/argus/tests/     program tests and attack tests, Rust + LiteSVM (Claude; Codex reviews)
├── sentinel/                 AI guardian backend, Node + TS (Claude)
├── app/                      web app: React 19 + Vite + Tailwind v4 (Claude)
├── mobile/                   Android app: Expo + MWA (Codex)
└── docs/                     CONTEXT, PROGRAM-SPEC, THREAT-MODEL, AUDIT-CHECKLIST,
                              DESIGN, MOBILE, DEMO-SCRIPT, HANDOFF, audits/
```

## Components

1. **Program** (`programs/argus`): see PROGRAM-SPEC.md. This is the heart of the product and the security boundary.
2. **Sentinel** (`sentinel/`): an AI guardian service.
   - **Watch:** subscribe to program events (Helius websocket or webhook), plus poll for pending Withdrawal accounts every N seconds as a backup.
   - **Score each request:**
     - Age of the destination address (its earliest signature).
     - Lookalike or address poisoning against the vault's trusted and past destinations (prefix/suffix match).
     - Amount as a % of the vault.
     - Time of day.
     - Firecrawl search for the address in public scam and drainer reports.
   - **Explain:** an LLM (Claude API) turns the signals into a one-paragraph reason and a risk level.
   - **Act:** on high risk, place an ElevenLabs conversational phone call. The agent has one tool, `cancel_withdrawal`. On "cancel", Sentinel signs `cancel_withdrawal` with the AI guardian key. Optional auto-freeze on critical risk. Also sends a push to mobile.
   - **Store:** watch-log entries, alerts and call transcripts in Supabase (with RLS).
   - **Hosting:** Render (or similar), with the AI keypair in a secret env var.
3. **Web app** (`app/`): see DESIGN.md. Landing, dashboard, send, guardians, create wizard and the **"Steal my wallet"** demo. Hosted on Vercel.
4. **Mobile** (`mobile/`): see MOBILE.md (Codex).

## External accounts and keys (owner: Victor)

- **Helius:** devnet RPC and webhooks.
- **Firecrawl:** API key.
- **ElevenLabs:**
  - API key.
  - A Conversational AI agent.
  - A phone number (Twilio or ElevenLabs telephony) for outbound calls. **Check the cost and setup time early.** Fallback: an in-browser voice call through the ElevenLabs widget for the live demo, with a recorded real phone call for the video.
- **Claude API key**, for the Sentinel explanations.
- **Supabase:** project URL and keys.
- **Vercel** (web) and **Render** (Sentinel).
- **Expo/EAS** account, and the **Solana dApp Store** publisher setup.

## Timeline

Confirm the exact submission deadline and update this section.

| When | Claude | Codex | Victor |
|---|---|---|---|
| **Tonight** | Toolchain in WSL. Anchor workspace. Program accounts and init. Test harness | Read the docs. Scaffold `mobile/` with static screens from the mockup | Create the accounts above. Attack the spec and threat model. Confirm the track and deadline rules |
| **Day 1** | All instructions. INV and attack tests green. Deploy to devnet | Static screens done. MWA connect. Start dApp Store publisher setup | Supabase schema. ElevenLabs agent and phone setup |
| **Day 2** | Sentinel: watch, score, Firecrawl, LLM, call, cancel. Web dashboard wired to devnet | Read vault. Cancel, freeze, approve. Push notifications | Test as the attacker. Draft the demo script |
| **Day 3** | Guardians UI, create wizard, "Steal my wallet" demo. **Audit round 1** (Claude and Codex independently), then fixes | Audit round 1 of the program. EAS APK. dApp Store submit | Record the call. Write the README |
| **Day 4** | **Audit round 2** and fuzz run. Polish. README with the program address | APK final | Record and edit the video (<3 min). **Submit** to every eligible track |

## Definition of done (submission)

- [ ] Program deployed to devnet, with its address in the README.
- [ ] Every INV and THREAT-MODEL test passing. Both audit rounds recorded in `docs/audits/`.
- [ ] Live web link, including a working "Steal my wallet" demo with no sign-up.
- [ ] Sentinel live and placing a real call (or the widget fallback).
- [ ] APK built and dApp Store submission made.
- [ ] Public repo with README (problem, how it works, architecture, setup, addresses, "devnet only, unaudited by third parties").
- [ ] Video under 3 minutes (see DEMO-SCRIPT.md).
- [ ] Submitted to Overall, Nigeria, Agentic, Mobile, DeFi, ElevenLabs, Firecrawl and Supabase (as the rules allow).
