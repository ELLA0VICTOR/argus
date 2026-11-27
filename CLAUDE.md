# Argus: instructions for Claude

You are building **Argus** for a Solana hackathon, working with the team lead (Victor) and Codex.

**Before anything else, read `docs/CONTEXT.md`.** It is the full decision log from the planning conversation: the hackathon, the prizes, rejected ideas, the chosen design, and why. Then read `PLAN.md`.

## Hard rules

- **No `git commit` or `git push` until Victor explicitly says so.** No PRs.
- **Never commit or print secrets:** keypairs, `.env*`, API keys, the AI guardian key.
- **The program follows `docs/PROGRAM-SPEC.md` exactly.** If you find a reason to deviate, change the spec first (and tell Victor), then the code.
- **Every invariant (INV-x) and every THREAT-MODEL row with a test name gets a real test.** A task isn't done until its tests pass.
- **Security over speed** for the program. For the app, demo polish matters a lot.
- **Don't edit `mobile/`.** Codex owns it. Coordinate through `docs/HANDOFF.md`.
- Use the design tokens in `app/src/index.css` and the rules in `docs/DESIGN.md`. The current direction is light and painterly (Victor, 2026-11-27). Don't use emoji or decorative red, and don't copy other products' images, text or logos.

## Your ownership

- `programs/`, `tests/`, `Anchor.toml`: the Anchor program and tests.
- `sentinel/`: the AI guardian backend.
- `app/`: the web app.
- `docs/` (shared). Keep `docs/HANDOFF.md` current with what you changed that others depend on, such as the IDL, program ID and API endpoints.

## Environment

- Windows 11. **Solana, Anchor and Rust run inside WSL (Ubuntu-24.04).** Run them with `wsl.exe -d Ubuntu-24.04 -- bash -lc "cd /mnt/c/Users/kolev/Desktop/argus && <cmd>"`. If builds are slow on `/mnt/c`, consider building from a WSL-native path. Node 24 and npm are available on Windows for `app/`.
- The machine has 7 GB RAM. Avoid running heavy things in parallel.
- The web app is in `app/`: `npm run dev`, `npm run build`.

## Workflow

1. Program: accounts → init → instructions in PROGRAM-SPEC order → tests per instruction → attack tests → deploy to devnet → copy the IDL to `app/` and `docs/HANDOFF.md`.
2. Audit: run `docs/AUDIT-CHECKLIST.md` yourself and write `docs/audits/claude-r<N>.md`. Codex does the same independently. Then reconcile.
3. Keep Victor in the loop with short status updates. He is the decision-maker.
