use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    constants::*,
    error::ArgusError,
    events::TrustedWithdrawn,
    instructions::shared::*,
    state::{TrustedAddress, Vault},
};

/// Owner sends any amount to an *active* trusted wallet (INV-1b). Blocked while frozen.
#[derive(Accounts)]
pub struct WithdrawTrusted<'info> {
    #[account(
        seeds = [VAULT_SEED, vault.creator.as_ref(), &vault.vault_id.to_le_bytes()],
        bump = vault.bump,
        constraint = !vault.frozen @ ArgusError::Frozen,
    )]
    pub vault: Account<'info, Vault>,

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

    /// CHECK: The address is pinned to `["trusted", vault, destination.owner]` (audit A7).
    /// It is unchecked so that a missing record returns `NotTrusted`
    /// rather than a generic framework error. The handler verifies the owner and discriminator.
    #[account(
        seeds = [TRUSTED_SEED, vault.key().as_ref(), destination.owner.as_ref()],
        bump,
    )]
    pub trusted: UncheckedAccount<'info>,
}

pub fn handle_withdraw_trusted(ctx: Context<WithdrawTrusted>, amount: u64) -> Result<()> {
    let a = &ctx.accounts;

    require!(
        a.trusted.owner == &crate::ID && !a.trusted.data_is_empty(),
        ArgusError::NotTrusted
    );
    // Owner is checked above; try_deserialize checks the TrustedAddress discriminator.
    let record = {
        let data = a.trusted.try_borrow_data()?;
        TrustedAddress::try_deserialize(&mut &data[..])
            .map_err(|_| error!(ArgusError::NotTrusted))?
    };
    require_keys_eq!(record.vault, a.vault.key(), ArgusError::NotTrusted);
    require_keys_eq!(record.wallet, a.destination.owner, ArgusError::NotTrusted);
    require!(now()? >= record.active_at, ArgusError::TrustedNotActive);

    transfer_out_of_vault(
        &a.vault,
        &a.vault_token,
        &a.mint,
        a.destination.to_account_info(),
        &a.token_program,
        amount,
    )?;

    emit!(TrustedWithdrawn {
        vault: a.vault.key(),
        wallet: record.wallet,
        destination: a.destination.key(),
        amount,
    });
    Ok(())
}
