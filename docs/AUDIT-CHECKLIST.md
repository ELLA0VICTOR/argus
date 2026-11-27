# Argus audit checklist

Claude and Codex each run this **independently** against the program, without reading each other's findings first. Then we compare and fix. Record the results in `docs/audits/<auditor>-<round>.md`, using one row per item: ✅ / ❌ (with file:line) / N/A.

The rule: **no item may be marked ✅ without pointing to the code or test that proves it.**

## A. Account validation
- [ ] A1. Every PDA has `seeds` and `bump` constraints that match the spec exactly.
- [ ] A2. Every account that belongs to a vault has `has_one = vault`, or an equivalent check.
- [ ] A3. Every program-owned account type is `Account<'info, T>`, so owner and discriminator are checked. No unchecked `AccountInfo` exists without a `/// CHECK:` justification that is actually true.
- [ ] A4. Vault ATA: `associated_token::mint = vault.mint`, `authority = vault`.
- [ ] A5. Destination token accounts: `token::mint = vault.mint`. The destination is not the vault ATA.
- [ ] A6. The safe ATA is derived from `vault.safe_address` and `vault.mint`.
- [ ] A7. TrustedAddress is looked up by the seeds `["trusted", vault, destination.owner]`.
- [ ] A8. No duplicate mutable accounts can alias each other.

## B. Signer and role checks
- [ ] B1. Every instruction's signer role matches the table in PROGRAM-SPEC §3 exactly.
- [ ] B2. The AI key is rejected by every **role-gated** instruction except `cancel_withdrawal` and `freeze`. Permissionless instructions (`deposit`, `execute_withdrawal`, `execute_proposal`) don't check roles (PROGRAM-SPEC §4, INV-5 scope).
- [ ] B3. The owner is rejected for propose, approve, veto and sweep. It can call permissionless `execute_proposal`, but that only applies approvals guardians already gave.
- [ ] B4. Guardian membership is checked against the *current* `guardians[0..guardian_count]`.
- [ ] B5. Role overlap is rejected at init, at `RotateOwner` and at `SetGuardians`.

## C. State machine and time
- [ ] C1. `executes_at = requested_at + delay`, computed with checked add.
- [ ] C2. Nothing ever reduces `executes_at` or `eta`.
- [ ] C3. Execution requires `now >= executes_at` / `eta`.
- [ ] C4. `owner_epoch` is checked on execute. `guardian_epoch` is checked on approve and execute.
- [ ] C5. Frozen blocks instant, trusted, request and execute, and allows cancel, sweep, governance and freeze.
- [ ] C6. Window rollover is correct at the boundary (exactly 86,400s), and `spent` resets.
- [ ] C7. Proposals reach the threshold exactly once, and `eta` is set only once.
- [ ] C8. Only vetoable actions can be vetoed.
- [ ] C9. Each GovAction validates its parameters (bounds, stricter or looser direction, role overlap, trusted cap).

## D. Arithmetic and tokens
- [ ] D1. No raw `+ - *` on user-influenced values. Use `checked_*` and map errors.
- [ ] D2. Every **vault outflow** checks the balance and `amount > 0` before transferring. Deposits check `amount > 0`, and SPL Token rejects an overdraw of the depositor's own account atomically.
- [ ] D3. Transfers use `transfer_checked` with the mint's decimals.
- [ ] D4. The token program is `Interface<TokenInterface>`, or pinned to SPL Token.
- [ ] D5. PDA signer seeds are correct for the vault authority.

## E. Account lifecycle
- [ ] E1. Withdrawal and Proposal are closed on execute, cancel and veto, with rent sent to `rent_payer`.
- [ ] E2. Ids come from vault counters and are never reused.
- [ ] E3. Account space is calculated with `InitSpace`. Fixed arrays and no realloc paths in v1.
- [ ] E4. No `init_if_needed` without a reentrancy and overwrite analysis.

## F. Tests (must exist and pass)
- [ ] F1. A test for every INV in PROGRAM-SPEC §5.
- [ ] F2. A test for every row in THREAT-MODEL that has a test name.
- [ ] F3. A happy path for every instruction.
- [ ] F4. Fuzz or property tests: random sequences of instructions with random signers. Assert INV-1 (vault balance changes only through the allowed paths) and INV-2 after every step.
- [ ] F5. Time travel in tests (bankrun/LiteSVM clock warp) for delays and windows.

## G. Off-chain
- [ ] G1. No secrets in client bundles. Grep the built `dist/` for key patterns.
- [ ] G2. The AI keypair is loaded only on the server, and never logged.
- [ ] G3. Supabase RLS is enabled on every table.
- [ ] G4. The "Steal my wallet" demo vault holds only valueless devnet test tokens.
