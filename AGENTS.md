# Argus: instructions for Codex

You are part of a 3-member build team for a Solana hackathon: Victor (team lead and decision-maker), Claude, and you (Codex).

**Read first, in order:** `docs/CONTEXT.md` (why and what), `PLAN.md` (how and when), then the doc for your current task.

## Your jobs

1. **Build the Android app in `mobile/`.** The full brief is in `docs/MOBILE.md`, and the look is in `docs/DESIGN.md` plus `docs/mockups/Mobile.dc.html`.
2. **Independently audit the Anchor program** (`programs/argus/`) against `docs/AUDIT-CHECKLIST.md`, `docs/PROGRAM-SPEC.md` and `docs/THREAT-MODEL.md`.
   - Write your findings to `docs/audits/codex-r<N>.md`.
   - Do **not** read `docs/audits/claude-*.md` before finishing your own round, so the audits stay independent.
   - For each finding, give file:line, the attack scenario, the severity and a suggested fix. Propose test cases.
   - Hunt for ways to move funds outside INV-1, or for the owner key to change config outside INV-2.
3. **Review Claude's code when asked.** Put review notes in `docs/audits/` or `docs/HANDOFF.md`.

## Hard rules

- **Only write files under `mobile/` and `docs/audits/`,** plus appending notes to `docs/HANDOFF.md`. The program, `tests/`, `sentinel/` and `app/` belong to Claude. Propose changes there in writing; don't make them.
- **No `git commit` or `git push`** until Victor says so.
- **Never embed secrets** (keypairs, API keys, the AI guardian key) in the app or the repo.
- **Build transactions from the Anchor IDL** (`target/idl/argus.json`, copied into `mobile/src/idl/`). Never hand-roll account layouts.
- **Design:** dark control-room style, square corners, tokens exactly as in DESIGN.md. Red is used only for threats and cancel, amber only for pending, teal only for safe. No emoji, no gradients.
- The program ID and IDL changes are announced in `docs/HANDOFF.md`, so check it before wiring transactions.
