use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::{constants::*, error::ArgusError, events::Deposited, state::Vault};

/// Anyone may deposit, even while frozen. Plain SPL transfers into the vault ATA
/// also count. This instruction just adds an event.
#[derive(Accounts)]
pub struct Deposit<'info> {
    pub depositor: Signer<'info>,

    #[account(
        seeds = [VAULT_SEED, vault.creator.as_ref(), &vault.vault_id.to_le_bytes()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,

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

    /// Source account. The token program enforces that `depositor` is its owner or delegate.
    #[account(
        mut,
        constraint = from.mint == vault.mint @ ArgusError::MintMismatch,
        constraint = from.key() != vault_token.key() @ ArgusError::InvalidDestination,
    )]
    pub from: InterfaceAccount<'info, TokenAccount>,
}

pub fn handle_deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, ArgusError::InvalidAmount);
    let a = &ctx.accounts;
    transfer_checked(
        CpiContext::new(
            a.token_program.key(),
            TransferChecked {
                from: a.from.to_account_info(),
                mint: a.mint.to_account_info(),
                to: a.vault_token.to_account_info(),
                authority: a.depositor.to_account_info(),
            },
        ),
        amount,
        a.mint.decimals,
    )?;
    emit!(Deposited {
        vault: a.vault.key(),
        depositor: a.depositor.key(),
        amount,
    });
    Ok(())
}
