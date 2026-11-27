use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    constants::*, error::ArgusError, events::InstantWithdrawn, instructions::shared::*,
    state::Vault,
};

/// Owner spends within the rolling daily allowance (INV-1a). Blocked while frozen.
#[derive(Accounts)]
pub struct WithdrawInstant<'info> {
    #[account(
        mut,
        seeds = [VAULT_SEED, vault.creator.as_ref(), &vault.vault_id.to_le_bytes()],
        bump = vault.bump,
        constraint = !vault.frozen @ ArgusError::Frozen,
    )]
    pub vault: Account<'info, Vault>,

    /// Only the current owner. Guardians and the AI are rejected (INV-5).
    #[account(constraint = vault.is_owner(&owner.key()) @ ArgusError::NotOwner)]
    pub owner: Signer<'info>,

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

    #[account(
        mut,
        constraint = destination.mint == vault.mint @ ArgusError::MintMismatch,
        constraint = destination.key() != vault_token.key() @ ArgusError::InvalidDestination,
    )]
    pub destination: InterfaceAccount<'info, TokenAccount>,
}

pub fn handle_withdraw_instant(ctx: Context<WithdrawInstant>, amount: u64) -> Result<()> {
    let now = now()?;
    let vault = &mut ctx.accounts.vault;

    // Roll the window once a full 24h has passed (boundary inclusive, audit C6).
    let elapsed = now
        .checked_sub(vault.window_start)
        .ok_or(ArgusError::MathOverflow)?;
    if elapsed >= WINDOW_SECONDS {
        vault.window_start = now;
        vault.spent_in_window = 0;
    }

    let spent = vault
        .spent_in_window
        .checked_add(amount)
        .ok_or(ArgusError::MathOverflow)?;
    require!(spent <= vault.daily_limit, ArgusError::OverDailyLimit);
    vault.spent_in_window = spent;

    let a = &ctx.accounts;
    transfer_out_of_vault(
        &a.vault,
        &a.vault_token,
        &a.mint,
        a.destination.to_account_info(),
        &a.token_program,
        amount,
    )?;

    emit!(InstantWithdrawn {
        vault: a.vault.key(),
        destination: a.destination.key(),
        amount,
        spent_in_window: spent,
    });
    Ok(())
}
