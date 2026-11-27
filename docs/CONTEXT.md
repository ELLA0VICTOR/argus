# Argus: decision log and context

This file carries everything decided before the repo existed, so any new session (Claude or Codex) starts with full context. Read it before PLAN.md.

## The hackathon

- **Event:** Dev3pack Global / Solana hackathon, hybrid, roughly Nov 27–29 2026. Confirm the exact submission deadline on the hacker dashboard.
- **Team lead:** Victor (GitHub: ELLA0VICTOR). Came 3rd in Nigeria last edition with NimTopUp, and built Trove (a Sui family-investing app) in an earlier hackathon.
- **Rules:** the team lead confirmed code may be written before kickoff, but **nothing is committed or pushed to GitHub until the lead says so.**
- **Cash targets, in priority order:**
  1. **Solana Best App Overall:** $2,500 / $1,500 / $1,000 USDC.
  2. **Nigeria local track:** $500 USDC.
  3. **Best Agentic App:** $250 USDC.
  4. **Solana Mobile:** "worth $500 per team member", probably Seeker devices. Requires a native Android APK and a Solana dApp Store submission.
  5. **Best DeFi App:** $250. Weak fit, submit anyway.
- **Credit-only tracks:** ElevenLabs, Firecrawl and Supabase prizes are credits. We use those tools only where they fit naturally.
- **Best Overall qualification:**
  - A unique Solana program in Rust (Anchor is fine), deployed at least to devnet.
  - Program addresses listed in the README.
  - A public GitHub repo with README and setup instructions.
  - A demo video under 3 minutes and a live demo link.
  - Bonus points for heavy use of Solana SDKs.
- **Open questions to confirm:** can one project win several tracks? What does the Pollar track ($500) require?

## What past winners taught us

- **Afterlife** (1st overall, Dev3pack May 2026) won with:
  - A crypto-native problem (inheritance for a self-custodied wallet).
  - A custom Anchor program as the core (PDAs, timers, vault, claims).
  - A clean end-to-end devnet demo and a short explanatory video.
- **ChickenPicks** placed with a fully custom Anchor program, with sponsor tools (an ElevenLabs voice agent) as the actual interface.
- **What lost:** wrappers around existing protocols, generic AI agents, buggy demos, and no "aha" moment.

**Judge feedback on Trove** (the lead's earlier project):
- Judges could not get in to try it. → Argus gets a one-click "Steal my wallet" demo, with no sign-up.
- The experience was not exciting. → Argus has a live theft attempt, a live phone call and a live cancel.
- The value was not visible. → Argus has countdowns and a watch log.
- Users did not truly own their data. → Each user's vault and history live in their own on-chain accounts.

## Ideas rejected, and why (do not revisit)

| Idea | Why it was rejected |
|---|---|
| **PayWhen** (web-verified conditional escrow) | Near-identical projects exist: Aqoryn (Frontier 2026), x402Resolve, Chainfluence, Tunnl |
| **Toll** (AI callers must pay a refundable deposit) | Callers outside our platform just keep calling, and screening already exists for free (Pixel, Truecaller) |
| **Timbre** (voice licensing / guard dog) | Doesn't stop theft, YouTube takedowns already work without it, and ElevenLabs runs its own voice marketplace |
| **Keyhole** (rental-scam escrow) | Already solved off-chain, and rental escrow exists on other chains |
| **AgentLeash / agent firewall** | AgentGuard already built it at Colosseum's Agent Hackathon |

**Rule we adopted:** the problem must be **crypto-native**. It exists only because assets are on-chain, so banks and web2 apps cannot solve it.

## The chosen idea: Argus

**Elevator pitch:** a self-custodial savings vault on Solana. Large withdrawals wait through a delay, 24 hours by default, and can be cancelled during it. An AI guardian watches every pending withdrawal. If it looks like theft, it **phones the owner**. The owner says "cancel", and the AI cancels on-chain using a key that can **only cancel or freeze, never move funds**.

**The problem:** a stolen key means instant, irreversible loss. Ansem was drained of about $2.57M in this way. Grok's research ranked key loss, drains and irreversible sends as the top on-chain pains.

**Positioning:**
- Coinbase offers a 48h cancellable vault, but only custodially.
- Bitcoin vaults (BIP-345 OP_VAULT) need a soft fork that has not happened.
- On Solana, a Rust program can do it today, and the user keeps their keys.

**Fit with Solana's Request for Startups:**
- #7 "Security for the agentic age".
- #1 "Stablecoins", which names operational security as a problem.

**Name:** Argus, the 100-eyed Greek giant who never slept.
- **Tagline:** "Argus never sleeps, so you can."
- Note: an unrelated Korean geopolitics app is also called ARGUS. **Never copy its logo.** Our mark is a triangle "A" containing an eye with a red pupil.

## Key design decisions (all settled)

1. **Three roles.** These are enforced on-chain, not in the UI:
   - **Owner** (main/hot key): deposit, spend within the daily allowance, send to *already trusted* addresses, request delayed withdrawals, cancel, freeze. It **cannot** change any rule, key or trusted address.
   - **Guardians** (backup, an M-of-N set): individuals default to 1-of-1, families 2-of-3, companies 3-of-5.
     - **Any single guardian** can cancel a withdrawal, freeze the vault, sweep everything to the pre-set safe address, or veto a pending governance change.
     - **A threshold of guardians** is needed to rotate the owner, add or remove trusted addresses, change limits or the delay, change the safe address, change guardians, or unfreeze.
   - **AI guardian** (a key held by the Sentinel server): **cancel and freeze only.** If it is compromised, the worst case is delaying a withdrawal.
2. **Rotating the owner** does not change any private key. The vault stores *who its owner is*, and guardians replace that pubkey. Rotation also invalidates every pending withdrawal made by the old key.
3. **Trusted-address additions** are themselves delayed and vetoable, so a thief can never "trust" their own address.
4. **Protective actions take one signature. Risky actions take the threshold.** This removes any 24-hour coordination pressure: one person cancels or freezes, then the group recovers calmly.
5. **Lost guardian key:** the remaining threshold replaces it, through a delayed change that any guardian can veto. We recommend 3-of-5 for companies.
6. **Business positioning** is one slide only. Squads already serves company treasuries. The main pitch is everyday people and families.
7. **Known limit, stated openly:** if both the owner key and the guardian threshold are stolen, funds can be lost. That is true of every system. Mitigations: keys on separate devices or with separate people, and the AI guardian can still freeze.

## Track mapping

| Track | How Argus fits |
|---|---|
| Best Overall | The custom Anchor program is the product |
| Nigeria | Local team and local story |
| Agentic | AI with cancel-only power: "AI and Solana each do real work" |
| Solana Mobile | Native Expo Android app, MWA, dApp Store (built by Codex) |
| DeFi | Weak fit |
| ElevenLabs | The phone call |
| Firecrawl | Checking addresses against scam and drainer reports |
| Supabase | App data |

## Design direction (approved by the lead)

- **Look:** a dark "control room". Near-black, thin 1px grey lines, square corners.
- **Fonts:** Syncopate for the wordmark and headings (wide, spaced), Inter for body text, JetBrains Mono for numbers and addresses.
- **Colours, one meaning each:** red is threat, amber is waiting, teal is safe.
- **Mockup:** https://claude.ai/artifact/UcMhSy4UGBFYo9g9mC3GNx (web dashboard plus Android alert). Source copies are in `docs/mockups/`.

## Work split

- **Victor (lead):**
  - Product decisions, the pitch and the demo video.
  - Accounts and API keys (Supabase, ElevenLabs, Firecrawl, Helius, hosting).
  - Playing the attacker during testing.
  - Final say on every decision.
- **Claude:** the Anchor program and its tests, the Sentinel backend, and the web app.
- **Codex:**
  - The Android app (`mobile/`).
  - An independent audit of the program.
  - Reviewing Claude's code.
