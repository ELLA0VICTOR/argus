use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    constants::*,
    error::ArgusError,
    events::WithdrawalRequested,
    instructions::shared::*,
    state::{Vault, Withdrawal},
};

/// Owner requests a delayed withdrawal of any amount. Blocked while frozen.
#[derive(Accounts)]
pub struct RequestWithdrawal<'info> {
    #[account(
        mut,
        seeds = [VAULT_SEED, vault.creator.as_ref(), &vault.vault_id.to_le_bytes()],
        bump = vault.bump,
        constraint = !vault.frozen @ ArgusError::Frozen,
    )]
    pub vault: Account<'info, Vault>,

    /// Pays the Withdrawal rent and gets it back on execute or cancel.
    #[account(
        mut,
        constraint = vault.is_owner(&owner.key()) @ ArgusError::NotOwner,
    )]
    pub owner: Signer<'info>,

    #[account(address = vault.mint @ ArgusError::MintMismatch)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(address = anchor_spl::token::ID @ ArgusError::UnsupportedMint)]
    pub token_program: Interface<'info, TokenInterface>,

    #[account(
        associated_token::mint = mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_token: InterfaceAccount<'info, TokenAccount>,

    #[account(
        constraint = destination.mint == vault.mint @ ArgusError::MintMismatch,
        constraint = destination.key() != vault_token.key() @ ArgusError::InvalidDestination,
    )]
    pub destination: InterfaceAccount<'info, TokenAccount>,

    /// Ids come from the vault counter and are never reused (INV-12, E2).
    #[account(
        init,
        payer = owner,
        space = 8 + Withdrawal::INIT_SPACE,
        seeds = [WITHDRAWAL_SEED, vault.key().as_ref(), &vault.next_withdrawal_id.to_le_bytes()],
        bump,
    )]
    pub withdrawal: Account<'info, Withdrawal>,

    pub system_program: Program<'info, System>,
}

pub fn handle_request_withdrawal(ctx: Context<RequestWithdrawal>, amount: u64) -> Result<()> {
    require!(amount > 0, ArgusError::InvalidAmount);
    require!(
        ctx.accounts.vault_token.amount >= amount,
        ArgusError::InsufficientFunds
    );

    let now = now()?;
    let vault = &mut ctx.accounts.vault;
    let executes_at = now
        .checked_add(vault.delay_seconds)
        .ok_or(ArgusError::MathOverflow)?;
    let id = vault.next_withdrawal_id;
    vault.next_withdrawal_id = id.checked_add(1).ok_or(ArgusError::MathOverflow)?;
    let vault_key = vault.key();
    let owner_epoch = vault.owner_epoch;

    let destination = ctx.accounts.destination.key();
    ctx.accounts.withdrawal.set_inner(Withdrawal {
        vault: vault_key,
        id,
        bump: ctx.bumps.withdrawal,
        destination,
        amount,
        requested_at: now,
        executes_at,
        owner_epoch,
        rent_payer: ctx.accounts.owner.key(),
    });

    emit!(WithdrawalRequested {
        vault: vault_key,
        id,
        amount,
        destination,
        executes_at,
    });
    Ok(())
}
