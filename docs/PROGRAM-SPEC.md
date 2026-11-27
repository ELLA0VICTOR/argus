# Argus program specification (Anchor)

This is the source of truth for on-chain behaviour. **Code follows this spec. If the code must differ, update the spec first.** Every rule marked **INV-x** must have at least one test proving it, including an attack test.

## 1. Scope (v1, hackathon)

- One vault holds **one SPL mint**. The demo uses devnet USDC (or a test mint we create). The code uses the `token_interface` module, but **v1 accepts classic SPL Token mints only.** `initialize_vault` rejects a Token-2022 mint with `UnsupportedMint`. Reason: Token-2022 extensions break INV-1. A `PermanentDelegate` lets the issuer move vault funds outside our four paths, and `TransferHook` / `TransferFee` change what a transfer does or delivers. Supporting Token-2022 later needs an extension allowlist plus tests. _(Added 2026-11-25 by Claude, approved by Victor.)_
- Native SOL is not held in the vault in v1; users wrap it, or we skip it.
- Program name: `argus`. Framework: Anchor (latest stable at build time; pin the exact version in `Anchor.toml`).

## 2. Accounts

### Vault: PDA `["vault", creator, vault_id_le_u64]`

The seeds use `creator`, which never changes, **not** `owner`, because `owner` can be rotated.

| Field | Type | Notes |
|---|---|---|
| `version` | u8 | Starts at 1 |
| `bump` | u8 | |
| `creator` | Pubkey | Immutable |
| `vault_id` | u64 | Immutable |
| `mint` | Pubkey | Immutable |
| `owner` | Pubkey | Main key. Rotatable only by a guardian threshold |
| `owner_epoch` | u32 | Incremented on owner rotation. Pending withdrawals store it, and execution requires a match (**INV-6**) |
| `guardians` | [Pubkey; 5] | Unused slots are `Pubkey::default()` |
| `guardian_count` | u8 | 1..=5 |
| `threshold` | u8 | 1..=guardian_count |
| `guardian_epoch` | u32 | Incremented whenever the guardian set or threshold changes. Proposals store it (**INV-7**) |
| `ai_guardian` | Pubkey | `Pubkey::default()` means none |
| `safe_address` | Pubkey | Wallet that receives an emergency sweep. Its token account is derived as the ATA |
| `delay_seconds` | i64 | Withdrawal and governance timelock. Bounds: `MIN_DELAY = 60` (devnet demo) to `MAX_DELAY = 30 days`. The UI defaults to 86,400 |
| `daily_limit` | u64 | Instant allowance, in base units of `mint` |
| `window_start` | i64 | Start of the current 24h window |
| `spent_in_window` | u64 | |
| `frozen` | bool | |
| `trusted_count` | u8 | Cap `MAX_TRUSTED = 10` |
| `next_withdrawal_id` | u64 | |
| `next_proposal_id` | u64 | |

- **Vault token account:** the ATA of (vault PDA, mint), created at `initialize_vault` with the ATA program's **idempotent** create, after all validation passes. All funds sit there. Anyone can create an ATA, so a third party could create this one before the vault exists. That must not block initialization, and any tokens already in it belong to the vault (Codex review CR-INIT-1).
- **Rent:** allocate the space with fixed-size arrays, and leave a reserved padding of 64 bytes for future fields.

### Withdrawal: PDA `["withdrawal", vault, id_le_u64]`

| Field | Notes |
|---|---|
| `vault`, `id`, `bump` | |
| `destination` | The destination **token account** (validated as mint == vault.mint at request) |
| `amount` | |
| `requested_at`, `executes_at` | `executes_at = requested_at + vault.delay_seconds` |
| `owner_epoch` | Copied from the vault when requested |
| `rent_payer` | Rent is refunded to this account when the withdrawal is closed |

The account exists only while the withdrawal is pending. Executing or cancelling it **closes** it.

### TrustedAddress: PDA `["trusted", vault, wallet]`

| Field | Notes |
|---|---|
| `vault`, `wallet`, `bump` | |
| `active_at` | An instant transfer to this wallet is allowed only when `now >= active_at` |

It is created by an executed `AddTrusted` proposal with `active_at = now`, because the proposal timelock (`delay_seconds`) already provided the wait (see §4). Removed by an executed `RemoveTrusted` proposal, which closes it.

### Proposal: PDA `["proposal", vault, id_le_u64]`

| Field | Notes |
|---|---|
| `vault`, `id`, `bump` | |
| `action` | `GovAction` enum (section 4) |
| `approvals` | u8 bitmap, indexed by guardian slot |
| `guardian_epoch` | Copied from the vault when created. Approve and execute require a match |
| `created_at` | |
| `eta` | 0 until the threshold is reached. Then it is set to `now + timelock(action)` |
| `proposer`, `rent_payer` | |

The proposal is closed on execute or veto.

## 3. Instructions and who may call them

Legend: **O** = owner, **G** = any one guardian, **G×T** = guardian threshold, **AI** = ai_guardian, **Any** = permissionless.

| Instruction | Signer | Frozen allowed? | Effect |
|---|---|---|---|
| `initialize_vault(vault_id, guardians, threshold, ai_guardian, safe_address, delay_seconds, daily_limit)` | creator (becomes owner) | n/a | Creates the vault and its ATA. Validates bounds, rejects duplicate guardians and a zero threshold |
| `deposit(amount)` | Any | yes | Moves tokens from the signer's account into the vault ATA. Plain transfers into the ATA also count |
| `withdraw_instant(amount)` → `destination` | O | **no** | Allowed only if `spent_in_window + amount <= daily_limit`, after rolling the window if `now - window_start >= 86400` |
| `withdraw_trusted(amount)` → `destination` | O | **no** | Requires a TrustedAddress PDA for `destination.owner` with `now >= active_at`. No amount limit, because the funds go to the user's own address |
| `request_withdrawal(amount)` → `destination` | O | **no** | Creates a Withdrawal with `executes_at = now + delay`. `amount > 0` and `amount <= vault balance` at request time |
| `execute_withdrawal` | Any (cranker) | **no** | Requires `now >= executes_at`, `w.owner_epoch == vault.owner_epoch` and a sufficient balance. Transfers, then closes the Withdrawal |
| `cancel_withdrawal` | O, G or AI | yes | Closes the Withdrawal and refunds rent to `rent_payer` |
| `freeze` | O, G or AI | n/a | `frozen = true` |
| `emergency_sweep` | G | yes | Transfers the **entire** balance to the ATA of `safe_address`. Freezing is optional, and the vault stays frozen if it already was |
| `propose(action)` | G | yes | Creates a Proposal and auto-approves the proposer's bit |
| `approve(proposal)` | G | yes | Sets the signer's bit. When `popcount >= threshold` and `eta == 0`, sets `eta = now + timelock(action)` |
| `execute_proposal` | Any | yes (unfreeze is itself an action) | Requires `eta != 0`, `now >= eta` and an epoch match. Applies the action and closes the Proposal |
| `veto(proposal)` | G | yes | Closes the Proposal. Only actions with a timelock above 0 can be vetoed. **A guardian cannot veto a `SetGuardians` proposal that removes that guardian** (`CannotVetoOwnRemoval`), so a rogue guardian can't block their own removal |

**The owner cannot `propose` unless the owner is also a guardian.** A 1-of-1 individual typically has guardian = a separate backup wallet, never the owner key. `initialize_vault` **rejects `owner ∈ guardians`** (**INV-2**) and also rejects `ai_guardian ∈ guardians ∪ {owner}`.

**`initialize_vault` validation, complete list:**

| Check | Error |
|---|---|
| `1 <= guardians.len() <= 5` | `InvalidGuardianCount` |
| No guardian is `Pubkey::default()` | `InvalidGuardian` |
| No duplicate guardians | `DuplicateGuardian` |
| `1 <= threshold <= guardians.len()` | `InvalidThreshold` |
| `owner ∉ guardians` | `RoleOverlap` |
| `ai_guardian` is default, or `ai_guardian ∉ guardians ∪ {owner}` | `RoleOverlap` |
| `safe_address != default`, `!= owner`, `!= ai_guardian` and `!= the vault PDA itself`. It **may** be a guardian's wallet or another program-owned wallet such as a multisig | `InvalidSafeAddress` |
| `MIN_DELAY <= delay_seconds <= MAX_DELAY` | `DelayOutOfBounds` |
| The mint is owned by the classic SPL Token program | `UnsupportedMint` |

**Why the safe address can't be the owner:** `emergency_sweep` is the protective action guardians take when the owner key is stolen. If `safe_address == owner`, the sweep would deliver everything to the thief. The same rule applies wherever these values change: `RotateOwner` rejects `new_owner == safe_address`, and `SetSafeAddress` rejects the current owner or AI key. _(Added 2026-11-25 by Claude, approved by Victor.)_

**Why the safe address can't be the vault itself:** the safe ATA would then be the vault's own ATA, so a sweep would be a self-transfer that rescues nothing. Only a client bug or a paste error would set it, but it would surface mid-theft. `SetSafeAddress` applies the same rule. _(Codex review, approved by Victor 2026-11-26.)_

## 4. Governance actions and timelocks

| `GovAction` | Timelock after threshold | Notes |
|---|---|---|
| `RotateOwner { new_owner }` | **0 (immediate)** | Recovery must be fast. Increments `owner_epoch`, which kills the thief's pending withdrawals. `new_owner` must not be a guardian, the AI or the `safe_address` |
| `Unfreeze` | 0 | |
| `RemoveTrusted { wallet }` | 0 | Tightening |
| `TightenLimits { daily_limit, delay_seconds }` | 0 | Must be ≤ the current limit and ≥ the current delay (stricter only) |
| `AddTrusted { wallet }` | `delay_seconds` | The TrustedAddress is then created with `active_at = now` (the proposal timelock already provided the wait). Vetoable |
| `LoosenLimits { daily_limit, delay_seconds }` | `delay_seconds` (the current one) | Vetoable |
| `SetSafeAddress { wallet }` | `delay_seconds` | Vetoable. `wallet` must not be default, the owner, the AI or the vault PDA (`InvalidSafeAddress`) |
| `SetGuardians { guardians, threshold }` | `delay_seconds` | Increments `guardian_epoch`, so every open proposal dies. Same validation as initialize. Vetoable |
| `SetAiGuardian { key }` | `delay_seconds`, or 0 when setting it to none | Vetoable |

**On vetoing immediate actions:** these execute as soon as the threshold is reached, so there is no veto window. That is acceptable because each of them is either recovery or tightening.

**Governance rules added during implementation** _(2026-11-26, Claude. Each one tightens the rules. Approved by Victor.)_

- **Trusted wallets never hold another role.** `AddTrusted` rejects the owner and the AI key (`RoleOverlap`), plus `default` and the vault PDA (`InvalidTrustedWallet`). `RotateOwner` rejects a `new_owner` that already has a TrustedAddress record (`RoleOverlap`). Reason: a trusted wallet receives unlimited instant transfers from the owner. If the owner key were itself trusted, a thief holding it could drain the vault to themselves with no delay.
- **Every action is validated twice:** at `propose`, and again at `execute_proposal` against the vault's state at that moment. The AI key and the safe address can change between the two without bumping `guardian_epoch`.
- **`TightenLimits` is re-checked at execute:** the new values must still be ≤ the current limit and ≥ the current delay (`NotStricter`).
- **Pre-funding a record's address can't block it.** `AddTrusted` creates the TrustedAddress PDA even if someone has already sent lamports to its address (the same idea as CR-INIT-1). An existing record fails with `AlreadyTrusted`.
- **`trusted_count`** goes up on `AddTrusted` (capped at `MAX_TRUSTED`, `TooManyTrusted`) and down on `RemoveTrusted`.
- **Rent:** the proposer pays for the Proposal, and it's refunded to them on execute or veto. The `execute_proposal` caller pays for a new TrustedAddress. When `RemoveTrusted` closes it, the rent goes to whoever executes *that* removal, not necessarily the original payer, because TrustedAddress doesn't store a payer. The amount is ~0.0013 SOL. _(Clarified after Codex R1.)_
- **`propose` reaches the threshold immediately when `threshold == 1`,** so `eta` is set at propose time in that case.
- **Veto window:** any guardian can veto a vetoable proposal at any time until it's executed, whether or not it has reached the threshold.
- **Proposal expiry** _(audit I-2/I-3, approved by Victor 2026-11-26)_: a proposal that hasn't reached its threshold within `PROPOSAL_TTL = 7 days` of `created_at` can't be approved any more (`ProposalExpired`). The boundary is inclusive, so approval at exactly `created_at + TTL` still works. A proposal that has reached the threshold (`eta != 0`) never expires: it waits for execution, because its timelock can be up to 30 days. This stops a dormant proposal, such as a rogue guardian's `RotateOwner` with one approval, waiting indefinitely for a second guardian to be tricked into approving it.
- **`close_proposal`** (permissionless) closes a **dead** proposal and refunds rent to `rent_payer`. A proposal is dead if it's stale (`guardian_epoch` mismatch) or expired (`eta == 0` and `now > created_at + PROPOSAL_TTL`). A live proposal returns `ProposalStillLive`. Event: `ProposalClosed { vault, id }`.
- **INV-5 scope:** INV-5 applies to role-gated instructions. Permissionless instructions (`deposit`, `execute_withdrawal`, `execute_proposal`) don't check roles. The AI key gains nothing there that any other key doesn't already have.

## 5. Invariants (each needs a test)

- **INV-1:** Funds leave the vault ATA only through:
  - (a) `withdraw_instant` within the window limit;
  - (b) `withdraw_trusted` to an active trusted wallet;
  - (c) `execute_withdrawal` of a matured withdrawal, with a matching epoch, while not frozen;
  - (d) `emergency_sweep` to `safe_address`.
- **INV-2:** The owner key alone can never change the owner, the guardians, the AI key, the limits, the delay, the trusted list or the safe address, and can never unfreeze.
- **INV-3:** Nothing shortens an existing pending delay. `executes_at` and `eta` never decrease.
- **INV-4:** While frozen, only (d) moves funds.
- **INV-5:** The AI key can only `cancel_withdrawal` and `freeze`. Every other instruction rejects it.
- **INV-6:** After `RotateOwner`, no withdrawal requested under the old epoch can execute.
- **INV-7:** After `SetGuardians`, no proposal created under the old guardian epoch can be approved or executed.
- **INV-8:** A guardian's approval bit can only be set by that guardian. Approving twice is a no-op or an error, never a double count.
- **INV-9:** Destination and safe-address token accounts must have `mint == vault.mint`. The safe ATA's owner must equal `safe_address`.
- **INV-10:** All arithmetic is checked, with no overflow or underflow. A balance check happens before every transfer.
- **INV-11:** Every PDA is verified by seeds and bump. Every token account's owner and mint are constrained. Token transfers use `transfer_checked`.
- **INV-12:** Closed accounts cannot be revived or reused (Anchor `close`, with ids that are never reused).

## 6. Events (the Sentinel subscribes to these)

`VaultInitialized`, `Deposited`, `InstantWithdrawn`, `TrustedWithdrawn`, `WithdrawalRequested{vault, id, amount, destination, executes_at}`, `WithdrawalExecuted`, `WithdrawalCancelled{by_role}`, `Frozen{by_role}`, `Swept`, `ProposalCreated`, `ProposalApproved`, `ProposalExecuted`, `ProposalVetoed`.

## 7. Errors

Each error needs a distinct code and a human-readable message, for example: `Frozen`, `NotOwner`, `NotGuardian`, `NotAuthorizedRole`, `OverDailyLimit`, `NotTrusted`, `TrustedNotActive`, `TooEarly`, `StaleOwnerEpoch`, `StaleGuardianEpoch`, `ThresholdNotMet`, `AlreadyApproved`, `InvalidThreshold`, `DuplicateGuardian`, `RoleOverlap`, `DelayOutOfBounds`, `InvalidGuardianCount`, `InvalidGuardian`, `InvalidSafeAddress`, `UnsupportedMint`, `NotStricter`, `MintMismatch`, `InsufficientFunds`, `TooManyTrusted`, `NotVetoable`, `CannotVetoOwnRemoval`, `MathOverflow`, `InvalidAmount` (zero amount), `InvalidDestination` (destination is the vault ATA, P10). The enum in `programs/argus/src/error.rs` is **append-only**, so codes (6000 + position) never change for clients.

## 8. Off-chain components touching the program

- **Sentinel** holds the `ai_guardian` keypair. It **must never** be given the owner or guardian keys.
- **The web, mobile and Sentinel apps** use a generated TS client: Anchor IDL plus `@coral-xyz/anchor`, or a Codama-generated client.
