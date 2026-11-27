use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::ArgusError,
    events::WithdrawalCancelled,
    state::{Vault, Withdrawal},
};

/// Owner, any single guardian or the AI cancels a pending withdrawal.
/// Allowed while frozen. Rent goes back to whoever paid it.
#[derive(Accounts)]
pub struct CancelWithdrawal<'info> {
    #[account(
        constraint = vault.protective_role(&canceller.key()).is_some() @ ArgusError::NotAuthorizedRole,
    )]
    pub canceller: Signer<'info>,

    #[account(
        seeds = [VAULT_SEED, vault.creator.as_ref(), &vault.vault_id.to_le_bytes()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        seeds = [WITHDRAWAL_SEED, vault.key().as_ref(), &withdrawal.id.to_le_bytes()],
        bump = withdrawal.bump,
        has_one = vault,
        has_one = rent_payer,
        close = rent_payer,
    )]
    pub withdrawal: Account<'info, Withdrawal>,

    /// CHECK: Receives the rent refund. Pinned by `has_one = rent_payer`.
    #[account(mut)]
    pub rent_payer: UncheckedAccount<'info>,
}

pub fn handle_cancel_withdrawal(ctx: Context<CancelWithdrawal>) -> Result<()> {
    let a = &ctx.accounts;
    let by = a.canceller.key();
    // Checked by the account constraint above.
    let by_role = a
        .vault
        .protective_role(&by)
        .ok_or(ArgusError::NotAuthorizedRole)?;
    emit!(WithdrawalCancelled {
        vault: a.vault.key(),
        id: a.withdrawal.id,
        amount: a.withdrawal.amount,
        by,
        by_role,
    });
    Ok(())
}
