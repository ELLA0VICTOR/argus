# Argus program audit: Claude, round 1

- **Date:** 2026-11-26
- **Scope:** `programs/argus/src/**` (13 instructions, 4 account types) against `docs/PROGRAM-SPEC.md`, `docs/THREAT-MODEL.md` and `docs/AUDIT-CHECKLIST.md`.
- **Toolchain:** Anchor 1.2.2, Solana CLI 4.4.1 (Agave), platform-tools v1.57, Rust 1.89.0. Tests run on LiteSVM 0.15.
- **Result:** 3 findings fixed in this round (1 Medium, 2 Low). 8 informational notes, 3 of which need a decision. **148/148 tests pass** (after the I-2/I-3 change), including a 6,000-step property fuzz. Before Codex reviewed it, the fuzz was mutation-checked against a planted bug.

Codex has not read this file. Its round 1 is independent (`docs/audits/codex-r1.md`). We reconcile afterwards.

## Method

1. I re-read every source file with line numbers rather than from memory, and checked each item below against the actual code.
2. I tried attacks against each instruction: every role (owner, each guardian, the AI, a stranger, old owners and old AIs) and every account substitution. I looked for aliasing, PDA pre-funding, revival, re-validation gaps between propose and execute, and rollback after a failed CPI.
3. I added a **property fuzz** (`tests/fuzz.rs`, 20 seeds × 300 steps). It runs random instructions with weighted random signers and asserts INV-1 through INV-7 after every step. It also asserts that every operation succeeded at least once; the first version failed this, see the note below. **Mutation check:** removing the `frozen` constraint from `withdraw_instant` makes the fuzz fail at `seed 3 step 259: Instant succeeded while frozen`. The constraint was then restored.
4. I scanned the repo for secrets and keypairs (section G).

## Findings

### F-1 [Medium] Fixed: the proposer could not execute their own proposal

- **Location:** `instructions/execute_proposal.rs:44` (`rent_payer`).
- **Problem:** both `executor` (mut, the payer) and `rent_payer` (mut, the refund target) are writable. Anchor 1.x rejects duplicate writable accounts with `ConstraintDuplicateMutableAccount` (2040). The proposer *is* `rent_payer`, so the most natural flow, where the proposing guardian executes their own proposal, always failed. Recovery actions like `RotateOwner` and `Unfreeze` would fail when a guardian tried to execute them in the app. Funds were never at risk, but it was a real denial of service on recovery.
- **Fix:** `#[account(mut, dup)]` on `rent_payer`. This is safe because `rent_payer` is an unchecked system account that only receives lamports, and both fields resolve to the same underlying account.
- **Test:** `governance::proposer_can_execute_own_proposal`, covering an immediate action, and AddTrusted, where the executor also pays for the record.
- **Swept for other instances:** `cancel_withdrawal`, `veto` and `execute_withdrawal` take the signer as non-mut, so they're unaffected. Tests: `protective::owner_can_execute_own_withdrawal` and `cancel_by_owner_refunds_rent_to_rent_payer`. `emergency_sweep` with `guardian == safe_address` works because `safe_wallet` is non-mut (`protective::sweep_when_safe_address_is_the_sweeping_guardian`).

### F-2 [Low] Fixed: SetAiGuardian could make a trusted wallet the AI key

- **Location:** `governance.rs:64` (`trusted_wallet`) and `instructions/execute_proposal.rs:176`.
- **Problem:** the approved PROGRAM-SPEC §4 rule "trusted wallets never hold another role" was enforced for `AddTrusted` and `RotateOwner`, but not for `SetAiGuardian`. The impact is small, because the AI can't move funds, but the code didn't match the spec.
- **Fix:** `trusted_wallet()` now returns the new AI key, so `execute_proposal` requires that the key's trusted record isn't live (`RoleOverlap`).
- **Test:** `governance::set_ai_rejects_trusted_wallet`.

### F-3 [Low] Fixed: `TrustedAddress` missing from the IDL

- **Problem:** no instruction takes it as a typed `Account<>`. It's deliberately unchecked so that a missing record returns `NotTrusted`. Because of that, Anchor left it out of the IDL, so clients couldn't decode trusted records.
- **Fix:** `scripts/export-idl.mjs` adds the account and its type to `app/src/idl/argus.{json,ts}`. The script first re-derives Vault's discriminator and refuses to patch if it doesn't match Anchor's.

### Test-suite weakness found and fixed (not a program bug)

The first fuzz passed while never exercising a successful `withdraw_instant` or `withdraw_trusted`. Freeze was too likely, and the first sweep emptied the vault. The fuzz now uses weighted operations and signers and includes a guardian unfreeze flow, and it **asserts that every operation succeeds at least once**. Across the 20 seeds, successes include 179 instant, 167 trusted, 145 request, 52 execute, 87 cancel, 12 sweep, 169 propose, 87 approve, 16 veto and 165 governance executions.

## Informational notes (no change made)

| # | Note | Recommendation |
|---|---|---|
| I-1 | **Decision (Victor, 2026-11-26):** keep the dev wallet as upgrade authority for the hackathon, and state it in the README. Move to a multisig or make the program immutable before any real funds. Original note: **Upgrade authority.** The program is upgradeable by the single dev wallet in WSL (`6X8M…hBR`). Whoever holds it can replace the program and take every vault's funds. This matters more than anything above. | For the hackathon, state it in the README. Before any real funds, transfer authority to a multisig or make the program immutable. **Decision: Victor** |
| I-2 | **Resolved 2026-11-26 (approved by Victor):** `PROPOSAL_TTL` = 7 days, `ProposalExpired` and the permissionless `close_proposal`. Tests: `governance::attack_dormant_rotate_owner_expires`, `approve_at_exact_ttl_boundary_succeeds`, `passed_proposal_does_not_expire`, `expired_proposal_closed_by_anyone_refunds_rent`, `close_proposal_rejects_substituted_rent_payer`. ~~Approvals never expire.~~ Original note: A rogue guardian's proposal can sit with one approval indefinitely, waiting for a second guardian to be tricked into approving it. An open sub-threshold `RotateOwner` can't be vetoed, because immediate actions aren't vetoable. | Add a proposal TTL, e.g. it must reach the threshold within 7 days, after which anyone can close it. The app should show who proposed what. **Decision: Victor** (spec change) |
| I-3 | **Resolved:** `close_proposal` closes stale or expired proposals (`governance::stale_proposal_closed_immediately`). ~~Rent can get stuck.~~ Original note: Stale proposals (old guardian epoch) and sub-threshold immediate proposals can never be closed. | Allow `veto` of stale proposals regardless of the vetoable flag. Harmless, since they can't execute. Can be folded into I-2. **Decision: Victor** |
| I-4 | **Colluding rogue guardians.** A guardian who stays in a proposed `SetGuardians` set can veto it. If two rogues collude, the honest guardians must remove **both in one** `SetGuardians`, because a proposal that removes only one can be vetoed by the other. | Document this in the guardian UI. |
| I-5 | **Mint freeze authority.** Devnet USDC, like mainnet USDC, has a freeze authority. The issuer can freeze the vault ATA or the safe ATA, and Argus can't prevent that. | Note in the README. Our own test mint has no freeze authority. |
| I-6 | **Window edge.** The allowance window rolls at `elapsed >= 86,400` and restarts at the spend time. Spends at `t` and `t + 86,400` both succeed, so at most 2 × limit can leave within one closed 24 h interval. | Acceptable as "per day". Documented here. |
| I-7 | **Self-locking values are allowed.** `RotateOwner` to the vault PDA or to the current owner is allowed. The first locks owner functions (the PDA can't sign). The second just voids pending withdrawals, which is arguably useful. Only the guardian threshold can do either. | Optionally reject `new_owner == vault`. Low priority. |
| I-8 | **`MIN_DELAY = 60 s`** exists for the demo. With a 60 s delay the AI has one minute to react. | For mainnet, raise `MIN_DELAY` (e.g. 1 h). The UI default stays 24 h. |

## Checklist

**Legend:** ✅ verified, with the evidence named. Paths are relative to `programs/argus/`, and tests are named `file::test`.

### A. Account validation

| # | Status | Evidence |
|---|---|---|
| A1 | ✅ | Every PDA uses spec seeds plus a stored or canonical bump. Vault: `initialize_vault.rs:20`, and `seeds… bump = vault.bump` in every other instruction (e.g. `withdraw_instant.rs:14-15`). Withdrawal: `request_withdrawal.rs:54`, `execute_withdrawal.rs:26-27`, `cancel_withdrawal.rs:27-28`. Proposal: `propose.rs:34`, `approve.rs:29-30`, `veto.rs:29-30`, `execute_proposal.rs` (seeds on `proposal`). Trusted: `withdraw_trusted.rs:50`, `execute_proposal.rs:75-85`. Tests: `initialize_vault::init_happy_path_sets_every_field` (bump), `init_rejects_vault_pda_of_another_creator` |
| A2 | ✅ | `has_one = vault` on Withdrawal (`execute_withdrawal.rs:28`, `cancel_withdrawal.rs:29`) and Proposal (`approve.rs:31`, `veto.rs:31`, `execute_proposal.rs`). TrustedAddress body binding: `withdraw_trusted.rs:69-70`, `execute_proposal.rs:110-111`. Tests: `withdrawals::execute_rejects_withdrawal_of_another_vault`, `protective::cancel_rejects_withdrawal_of_another_vault`, `withdraw_trusted::trusted_rejects_canonical_pda_with_mismatched_vault_field` |
| A3 | ✅ | All program accounts are `Account<T>`. Unchecked accounts, each with a true `/// CHECK:`: `vault_token` at init (address-pinned ATA, `initialize_vault.rs:45`), `trusted` (seed-pinned, with owner, discriminator and body checked in the handler), `rent_payer` (`has_one`), `safe_wallet`/`safe_token` (address-pinned, `emergency_sweep.rs:44,53`). Tests: `withdraw_trusted::trusted_rejects_wrong_account_type_at_trusted_address`, `…_with_foreign_owner`, `…_with_truncated_data` |
| A4 | ✅ | `associated_token::mint = mint, authority = vault, token_program` on every `vault_token` (e.g. `withdraw_instant.rs:32-34`). At init, address = canonical ATA (`initialize_vault.rs:45`). Test: `initialize_vault::init_rejects_non_ata_vault_token_account` |
| A5 | ✅ | `destination.mint == vault.mint` (`withdraw_instant.rs:40`, `request_withdrawal.rs:44`, `execute_withdrawal.rs:56`, `withdraw_trusted`) and `destination != vault_token` (`withdraw_instant.rs:41`, `request_withdrawal.rs:45`, `shared.rs:22`). Tests: `withdraw_instant::instant_rejects_destination_of_another_mint`, `instant_rejects_vault_ata_as_destination`, `withdrawals::request_rejects_zero_overdraw_bad_mint_and_vault_ata` |
| A6 | ✅ | `safe_token` address = `get_associated_token_address(vault.safe_address, vault.mint)` (`emergency_sweep.rs:53`). Tests: `protective::sweep_rejects_substituted_safe_token_account`, `sweep_rejects_substituted_safe_wallet`, `sweep_moves_everything_to_safe_and_freezes` (owner == safe) |
| A7 | ✅ | `["trusted", vault, destination.owner]` (`withdraw_trusted.rs:50`). Test: `withdraw_trusted::trusted_record_of_other_wallet_is_rejected` |
| A8 | ✅ | Anchor's duplicate-mutable guard plus explicit `!= vault_token`. Intentional alias only via `dup` on `execute_proposal.rs:44` (F-1). Tests: `withdraw_instant::instant_rejects_vault_ata_as_destination` (2040), `governance::proposer_can_execute_own_proposal` |

### B. Signer and role checks

| # | Status | Evidence |
|---|---|---|
| B1 | ✅ | Matches the §3 table. Owner: `withdraw_instant.rs:21`, `withdraw_trusted`, `request_withdrawal.rs:26`. O/G/AI: `cancel_withdrawal.rs:15`, `freeze.rs:11` via `protective_role` (`state.rs:81`). G: `emergency_sweep.rs:18`, `propose.rs:19`, `approve.rs:17`, `veto.rs:17`. Any: `deposit`, `execute_withdrawal`, `execute_proposal`. Fuzz role matrix: `fuzz.rs` (asserts on every success) |
| B2 | ✅ | The AI is rejected by every owner and guardian gate. Tests: `withdraw_instant::instant_rejects_guardian_ai_and_stranger`, `withdrawals::request_rejects_guardian_ai_and_stranger`, `withdraw_trusted::trusted_rejects_non_owner_and_frozen`, `protective::sweep_rejects_owner_ai_and_stranger`, `governance::ai_cannot_propose_approve_or_veto`, plus the fuzz. INV-5 scope (permissionless instructions) is per PROGRAM-SPEC §4 |
| B3 | ✅ | The owner is never a guardian (`state.rs:142`), so the owner fails all guardian gates. Tests: `governance::attack_owner_cannot_*`, `non_guardian_cannot_approve_or_veto`, `protective::sweep_rejects_owner_ai_and_stranger` |
| B4 | ✅ | `guardian_index` searches `guardians[..guardian_count]` (`state.rs:94-101`). Tests: `state::tests::guardian_index_ignores_unused_default_slots`, `governance::set_guardians_kills_old_proposals_and_removed_guardians` |
| B5 | ✅ | `validate_roles` (`state.rs:134-159`) at init, RotateOwner, SetGuardians, SetAiGuardian and SetSafeAddress (`governance.rs:77+`), re-run at execute. The trusted record is checked for RotateOwner and SetAiGuardian (`execute_proposal.rs:95,176`). Tests: `initialize_vault::init_rejects_owner_as_guardian`, `…ai_*`, `governance::rotate_owner_rejects_role_overlap`, `rotate_owner_rejects_trusted_wallet`, `set_ai_rejects_trusted_wallet`, `set_guardians_validated_like_init` |

### C. State machine and time

| # | Status | Evidence |
|---|---|---|
| C1 | ✅ | `now.checked_add(delay_seconds)` (`request_withdrawal.rs:72`). Test: `withdrawals::request_creates_pending_withdrawal` |
| C2 | ✅ | No instruction writes `executes_at`. `eta` is only written when `eta == 0` (`governance.rs:169`). Tests: `governance::eta_set_once_and_never_moves`, `loosen_delay_does_not_shorten_pending_withdrawal`, plus the fuzz INV-3 check after every step |
| C3 | ✅ | `execute_withdrawal.rs:65`, `execute_proposal.rs:63`. Tests: `withdrawals::execute_one_second_early_fails`, `governance::add_trusted_end_to_end_then_remove` (eta − 1) |
| C4 | ✅ | Owner epoch: `execute_withdrawal.rs:67`. Guardian epoch: `approve.rs` constraint and `execute_proposal.rs:64-65`. Tests: `governance::attack_request_voided_by_rotation`, `attack_spam_requests_voided`, `set_guardians_kills_old_proposals_and_removed_guardians` |
| C5 | ✅ | `!vault.frozen` on instant, trusted, request and execute. Absent on cancel, sweep, governance, freeze and deposit. Tests: `protective::frozen_blocks_all_outflows_except_sweep`, `cancel_allowed_while_frozen`, `governance::governance_allowed_while_frozen`, `deposit::deposit_allowed_while_frozen` |
| C6 | ✅ | `elapsed >= WINDOW_SECONDS` (`withdraw_instant.rs:52-56`). Test: `withdraw_instant::attack_window_rollover` (86,399 blocked, 86,400 resets). See I-6 |
| C7 | ✅ | `maybe_set_eta` only when `eta == 0` (`governance.rs:169-176`). Tests: `governance::eta_set_once_and_never_moves`, `one_of_one_propose_sets_eta_immediately` |
| C8 | ✅ | `is_vetoable` (`governance.rs:52`) and `CannotVetoOwnRemoval` (`veto.rs:45-47`). Tests: `governance::tighten_is_not_vetoable`, `remove_ai_is_immediate_and_revokes_it`, `attack_rogue_guardian_cannot_block_removal`, `kept_guardian_can_veto_set_guardians`, unit `timelocks_match_spec_table` |
| C9 | ✅ | `GovAction::validate` at propose and again at execute (`execute_proposal.rs:69`). Trusted cap and existence: `execute_proposal.rs:132-136`. Tests: `governance::actions_revalidated_at_execute`, `tighten_limits_is_immediate_and_stricter_only`, `add_trusted_capped_at_max`, `add_trusted_twice_fails_already_trusted`, `add_trusted_rejects_owner_ai_default_and_vault` |

### D. Arithmetic and tokens

| # | Status | Evidence |
|---|---|---|
| D1 | ✅ | Every user-influenced operation is `checked_*`: `withdraw_instant.rs:52,61`, `request_withdrawal.rs:72,75`, `propose.rs:56`, `governance.rs:171`, `execute_proposal.rs:98,116,157,171,196`. The only `+` and `-` in program code are on constants. `1u8 << slot` has slot < 5. Overflow profile: `overflow-checks = true` (`Cargo.toml`). Test: `withdraw_instant::instant_spend_overflow_is_rejected` |
| D2 | ✅ | `shared.rs:20-21` (amount > 0, balance ≥ amount) on every outflow. Deposit: `deposit.rs:44`. Request: `request_withdrawal.rs:63-64`. Tests: `instant_rejects_zero_and_overdraw`, `withdrawals::execute_rechecks_balance_and_stays_pending`, `protective::sweep_of_empty_vault_fails` |
| D3 | ✅ | `transfer_checked` with `mint.decimals` (`shared.rs:33`, `deposit.rs:46`) |
| D4 | ✅ | Pinned to classic SPL Token: `address = anchor_spl::token::ID` in every instruction. The mint owner is checked at init. Tests: `initialize_vault::init_rejects_token_2022_*` (all three combinations) |
| D5 | ✅ | `[VAULT_SEED, creator, vault_id_le, bump]` (`shared.rs:29-31`). Exercised by every successful outflow test |

### E. Account lifecycle

| # | Status | Evidence |
|---|---|---|
| E1 | ✅ | `close = rent_payer` on execute and cancel (Withdrawal) and on execute and veto (Proposal). TrustedAddress goes through `close_account` (`execute_proposal.rs:114,190-204`): lamports out, data zeroed, assigned to system, resized to 0. Tests: `withdrawals::execute_after_delay_by_any_cranker_and_refunds_rent`, `protective::cancel_by_owner_refunds_rent_to_rent_payer`, `cancel_rejects_substituted_rent_payer`, `withdrawals::execute_rejects_substituted_rent_payer`, `governance::add_trusted_vetoed_by_single_guardian`, `rollback::execute_cpi_failure_keeps_withdrawal_pending_and_rent_in_place` |
| E2 | ✅ | Ids come from `next_withdrawal_id` and `next_proposal_id`, checked increment. Tests: `withdrawals::withdrawal_ids_never_reused`, `governance::proposal_executes_once_and_ids_increment` |
| E3 | ✅ | `InitSpace` everywhere. Fixed arrays, plus `#[max_len(5)]` on SetGuardians, plus 64 reserved bytes. No realloc paths. Test: `governance::set_guardians_with_five_guardians_fits` (largest action) |
| E4 | ✅ | No `init_if_needed`. The two idempotent creations are handled deliberately: the ATA via `create_idempotent` (`initialize_vault.rs:78`, `emergency_sweep.rs:64`) and the TrustedAddress via `create_pda`, which handles a pre-funded address (`execute_proposal.rs:214+`). Tests: `initialize_vault::init_succeeds_when_ata_precreated_and_funded_by_third_party`, `governance::add_trusted_succeeds_when_pda_prefunded_by_griefer` |

### F. Tests

| # | Status | Evidence |
|---|---|---|
| F1 | ✅ | **INV-1:** `protective::inv1_balances_conserved_across_all_paths`, plus the fuzz (every outflow attributed, total conserved). **INV-2:** `governance::attack_owner_cannot_*`, plus the fuzz (config changes only via execute_proposal). **INV-3:** `governance::eta_set_once_and_never_moves`, `loosen_delay_does_not_shorten_pending_withdrawal`, plus the fuzz. **INV-4:** `protective::frozen_blocks_all_outflows_except_sweep`, plus the fuzz. **INV-5:** `governance::ai_cannot_propose_approve_or_veto`, `instant_rejects_guardian_ai_and_stranger`, plus the fuzz. **INV-6:** `governance::attack_request_voided_by_rotation`, plus the fuzz. **INV-7:** `governance::set_guardians_kills_old_proposals_and_removed_guardians`, plus the fuzz. **INV-8:** `governance::approve_twice_is_rejected_never_double_counted`. **INV-9:** `protective::sweep_moves_everything_to_safe_and_freezes` (safe ATA owner), the `*_mint` tests. **INV-10:** `instant_spend_overflow_is_rejected`, the overdraw tests. **INV-11:** the A1/A4/D3 evidence above. **INV-12:** `execute_twice_fails`, `cancel_twice_fails`, `withdrawal_ids_never_reused` |
| F2 | ✅ | Every named THREAT-MODEL test exists and passes: `attack_owner_request_then_cancel`, `attack_request_voided_by_rotation`, `attack_owner_cannot_add_trusted`, `attack_owner_cannot_loosen`, `attack_owner_cannot_rotate`, `attack_owner_cannot_set_guardians`, `attack_instant_capped`, `attack_window_rollover`, `trusted_send_goes_to_owner_address`, `attack_spam_requests_voided`, `owner_freeze_needs_threshold_unfreeze`, `attack_owner_cannot_unfreeze`, `attack_rogue_guardian_cannot_block_removal`. Still pending: **O6 `sentinel_owner_cannot_remove_phone`** (a Sentinel test, written with Sentinel) |
| F3 | ✅ | A happy path for all 13 instructions, in `initialize_vault`, `deposit`, `withdraw_instant`, `withdraw_trusted`, `withdrawals`, `protective` and `governance` |
| F4 | ✅ | `fuzz::fuzz_random_sequences_preserve_invariants`: 20 seeds × 300 steps with weighted random signers, assertions after every step, a minimum-coverage assert, and the mutation check passing (see Method) |
| F5 | ✅ | LiteSVM clock warp: `Env::warp` (`tests/common/mod.rs`), used throughout |

### G. Off-chain

| # | Status | Evidence |
|---|---|---|
| G1 | ✅ (so far) | Repo scan found no keypair arrays, `.env` files (only `mobile/.env.example`) or API keys. `app/` has no secrets. Re-check `dist/` once the app ships keys to the client |
| G2 | N/A | Sentinel isn't built yet |
| G3 | N/A | Supabase isn't set up yet |
| G4 | N/A | Demo vault not created yet. It'll use a test mint we create, with no freeze authority |

## Additional attack notes (checked, no issue)

- **SPL `SetAuthority` games on destination token accounts.** A thief creates a token account, sets a delegate, then hands ownership to a trusted wallet. SPL clears the delegate on an owner change, and a close authority can't remove a non-zero balance. Trusted sends land with the trusted wallet.
- **Destination owned by the vault PDA, but not its ATA.** Funds would be stranded, not stolen, and only via owner-limited paths, so a thief gains nothing. A trusted record for the vault PDA is impossible (`InvalidTrustedWallet`).
- **Same-transaction revival of a closed TrustedAddress.** The data is zeroed and the account goes back to the system program, so `is_live_record` is false and `withdraw_trusted` returns `NotTrusted`.
- **Token-2022 substitution.** A Token-2022 account can't hold a classic mint, and every token program is pinned.
- **CPI reentrancy.** The only CPIs are to the system, SPL Token and ATA programs. There are no callbacks.
