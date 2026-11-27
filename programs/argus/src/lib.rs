//! Argus: a self-custodial savings vault with a cancellable withdrawal delay,
//! M-of-N guardians and a cancel/freeze-only AI guardian.
//!
//! The source of truth for behaviour is `docs/PROGRAM-SPEC.md`.

pub mod constants;
pub mod error;
pub mod events;
pub mod governance;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use governance::*;
pub use instructions::*;
pub use state::*;

declare_id!("4LH7ikNGVVNaemB7eaLGUMbwSBHHqA2hKXTdrfhgD6nh");

#[program]
pub mod argus {
    use super::*;

    /// Creates a vault and its token account. The creator becomes the owner.
    #[allow(clippy::too_many_arguments)]
    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        vault_id: u64,
        guardians: Vec<Pubkey>,
        threshold: u8,
        ai_guardian: Pubkey,
        safe_address: Pubkey,
        delay_seconds: i64,
        daily_limit: u64,
    ) -> Result<()> {
        instructions::initialize_vault::handle_initialize_vault(
            ctx,
            vault_id,
            guardians,
            threshold,
            ai_guardian,
            safe_address,
            delay_seconds,
            daily_limit,
        )
    }

    /// Anyone moves tokens into the vault. Allowed while frozen.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::handle_deposit(ctx, amount)
    }

    /// Owner spends within the rolling 24h allowance.
    pub fn withdraw_instant(ctx: Context<WithdrawInstant>, amount: u64) -> Result<()> {
        instructions::withdraw_instant::handle_withdraw_instant(ctx, amount)
    }

    /// Owner sends any amount to an active trusted wallet.
    pub fn withdraw_trusted(ctx: Context<WithdrawTrusted>, amount: u64) -> Result<()> {
        instructions::withdraw_trusted::handle_withdraw_trusted(ctx, amount)
    }

    /// Owner requests a delayed withdrawal (cancellable until `executes_at`).
    pub fn request_withdrawal(ctx: Context<RequestWithdrawal>, amount: u64) -> Result<()> {
        instructions::request_withdrawal::handle_request_withdrawal(ctx, amount)
    }

    /// Anyone executes a matured withdrawal with a matching owner epoch.
    pub fn execute_withdrawal(ctx: Context<ExecuteWithdrawal>) -> Result<()> {
        instructions::execute_withdrawal::handle_execute_withdrawal(ctx)
    }

    /// Owner, any guardian or the AI cancels a pending withdrawal. Allowed while frozen.
    pub fn cancel_withdrawal(ctx: Context<CancelWithdrawal>) -> Result<()> {
        instructions::cancel_withdrawal::handle_cancel_withdrawal(ctx)
    }

    /// Owner, any guardian or the AI freezes the vault.
    pub fn freeze(ctx: Context<Freeze>) -> Result<()> {
        instructions::freeze::handle_freeze(ctx)
    }

    /// Any guardian sweeps the whole balance to the safe address. Allowed while frozen.
    pub fn emergency_sweep(ctx: Context<EmergencySweep>, freeze: bool) -> Result<()> {
        instructions::emergency_sweep::handle_emergency_sweep(ctx, freeze)
    }

    /// Any guardian proposes a governance action (auto-approves their own bit).
    pub fn propose(ctx: Context<Propose>, action: GovAction) -> Result<()> {
        instructions::propose::handle_propose(ctx, action)
    }

    /// A guardian approves. Reaching the threshold sets `eta`.
    pub fn approve(ctx: Context<Approve>) -> Result<()> {
        instructions::approve::handle_approve(ctx)
    }

    /// Anyone executes a proposal past its `eta`.
    pub fn execute_proposal(ctx: Context<ExecuteProposal>) -> Result<()> {
        instructions::execute_proposal::handle_execute_proposal(ctx)
    }

    /// Anyone closes a dead (stale or expired) proposal and refunds its rent.
    pub fn close_proposal(ctx: Context<CloseProposal>) -> Result<()> {
        instructions::close_proposal::handle_close_proposal(ctx)
    }

    /// Any guardian vetoes a vetoable proposal (but not their own removal).
    pub fn veto(ctx: Context<Veto>) -> Result<()> {
        instructions::veto::handle_veto(ctx)
    }
}
