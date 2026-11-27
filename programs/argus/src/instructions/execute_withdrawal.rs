use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    constants::*,
    error::ArgusError,
    events::WithdrawalExecuted,
    instructions::shared::*,
    state::{Vault, Withdrawal},
};

/// Anyone may crank a matured withdrawal (INV-1c). Blocked while frozen.
#[derive(Accounts)]
pub struct ExecuteWithdrawal<'info> {
    pub cranker: Signer<'info>,

    #[account(
        seeds = [VAULT_SEED, vault.creator.as_ref(), &vault.vault_id.to_le_bytes()],
        bump = vault.bump,
        constraint = !vault.frozen @ ArgusError::Frozen,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        seeds = [WITHDRAWAL_SEED, vault.key().as_ref(), &withdrawal.id.to_le_bytes()],
        bump = withdrawal.bump,
        has_one = vault,
        has_one = rent_payer,
        has_one = destination,
        close = rent_payer,
    )]
    pub withdrawal: Account<'info, Withdrawal>,

    /// CHECK: Receives the Withdrawal rent refund. Pinned by `has_one = rent_payer`.
    #[account(mut)]
    pub rent_payer: UncheckedAccount<'info>,

    #[account(address = vault.mint @ ArgusError::MintMismatch)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(address = anchor_spl::token::ID @ ArgusError::UnsupportedMint)]
    pub token_program: Interface<'info, TokenInterface>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_token: InterfaceAccount<'info, TokenAccount>,

    /// Pinned by `has_one = destination`. The mint is re-checked here (INV-9).
    #[account(
        mut,
        constraint = destination.mint == vault.mint @ ArgusError::MintMismatch,
    )]
    pub destination: InterfaceAccount<'info, TokenAccount>,
}

pub fn handle_execute_withdrawal(ctx: Context<ExecuteWithdrawal>) -> Result<()> {
    let a = &ctx.accounts;
    let w = &a.withdrawal;

    require!(now()? >= w.executes_at, ArgusError::TooEarly);
    // A rotated owner voids every withdrawal the old key requested (INV-6).
    require!(
        w.owner_epoch == a.vault.owner_epoch,
        ArgusError::StaleOwnerEpoch
    );

    // Balance is re-checked here (P11). On failure the withdrawal stays pending
    // and can be cancelled.
    transfer_out_of_vault(
        &a.vault,
        &a.vault_token,
        &a.mint,
        a.destination.to_account_info(),
        &a.token_program,
        w.amount,
    )?;

    emit!(WithdrawalExecuted {
        vault: a.vault.key(),
        id: w.id,
        amount: w.amount,
        destination: w.destination,
    });
    Ok(())
}
