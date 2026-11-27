use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::{self, get_associated_token_address, AssociatedToken},
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::{
    constants::*, error::ArgusError, events::Swept, instructions::shared::*, state::Vault,
};

/// Any single guardian moves the **entire** balance to ATA(safe_address, mint)
/// (INV-1d). Allowed while frozen. Optionally freezes, and never unfreezes.
#[derive(Accounts)]
pub struct EmergencySweep<'info> {
    /// Pays for the safe ATA if it doesn't exist yet.
    #[account(
        mut,
        constraint = vault.guardian_index(&guardian.key()).is_some() @ ArgusError::NotGuardian,
    )]
    pub guardian: Signer<'info>,

    #[account(
        mut,
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

    /// CHECK: Must be `vault.safe_address`. Used only as the ATA authority.
    #[account(address = vault.safe_address @ ArgusError::InvalidSafeAddress)]
    pub safe_wallet: UncheckedAccount<'info>,

    /// CHECK: Pinned to the canonical ATA(safe_address, mint), so its owner is
    /// `safe_address` (INV-9, audit A6). It is created idempotently in the handler,
    /// so a missing safe ATA can never block a rescue. The ATA program verifies
    /// owner and mint for an existing account.
    #[account(
        mut,
        address = get_associated_token_address(&vault.safe_address, &vault.mint)
            @ ArgusError::InvalidSafeAddress,
    )]
    pub safe_token: UncheckedAccount<'info>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_emergency_sweep(ctx: Context<EmergencySweep>, freeze: bool) -> Result<()> {
    let a = &ctx.accounts;
    associated_token::create_idempotent(CpiContext::new(
        a.associated_token_program.key(),
        associated_token::Create {
            payer: a.guardian.to_account_info(),
            associated_token: a.safe_token.to_account_info(),
            authority: a.safe_wallet.to_account_info(),
            mint: a.mint.to_account_info(),
            system_program: a.system_program.to_account_info(),
            token_program: a.token_program.to_account_info(),
        },
    ))?;

    let amount = a.vault_token.amount;
    transfer_out_of_vault(
        &a.vault,
        &a.vault_token,
        &a.mint,
        a.safe_token.to_account_info(),
        &a.token_program,
        amount,
    )?;

    let by = a.guardian.key();
    let safe_address = a.vault.safe_address;
    let vault = &mut ctx.accounts.vault;
    if freeze {
        vault.frozen = true;
    }
    emit!(Swept {
        vault: vault.key(),
        by,
        amount,
        safe_address,
        frozen: vault.frozen,
    });
    Ok(())
}
