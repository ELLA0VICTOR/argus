use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::{self, get_associated_token_address, AssociatedToken},
    token_interface::{Mint, TokenInterface},
};

use crate::{constants::*, error::ArgusError, events::VaultInitialized, state::*};

#[derive(Accounts)]
#[instruction(vault_id: u64)]
pub struct InitializeVault<'info> {
    /// Pays rent and becomes the first owner.
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + Vault::INIT_SPACE,
        seeds = [VAULT_SEED, creator.key().as_ref(), &vault_id.to_le_bytes()],
        bump
    )]
    pub vault: Account<'info, Vault>,

    /// v1: classic SPL Token mints only (PROGRAM-SPEC §1, Token-2022 extensions break INV-1).
    /// Together with the `token_program` address check, every Token-2022 combination
    /// fails with `UnsupportedMint` (CR-INIT-2).
    #[account(owner = anchor_spl::token::ID @ ArgusError::UnsupportedMint)]
    pub mint: InterfaceAccount<'info, Mint>,

    /// Must come before `vault_token`. Anchor checks constraints in field order,
    /// so a Token-2022 program fails here with `UnsupportedMint` rather than as a
    /// generic address mismatch on the ATA (CR-INIT-2).
    #[account(address = anchor_spl::token::ID @ ArgusError::UnsupportedMint)]
    pub token_program: Interface<'info, TokenInterface>,

    /// CHECK: The vault's only token account, pinned to the canonical
    /// ATA(vault, mint) for classic SPL Token. It isn't created with `init`,
    /// because anyone can create an ATA permissionlessly, and a third party
    /// pre-creating it would then block the vault forever (CR-INIT-1). The handler
    /// calls ATA `create_idempotent` after every check passes. For an existing
    /// account, the ATA program verifies the owner (vault) and mint.
    #[account(
        mut,
        address = get_associated_token_address(&vault.key(), &mint.key()),
    )]
    pub vault_token: UncheckedAccount<'info>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn handle_initialize_vault(
    ctx: Context<InitializeVault>,
    vault_id: u64,
    guardians: Vec<Pubkey>,
    threshold: u8,
    ai_guardian: Pubkey,
    safe_address: Pubkey,
    delay_seconds: i64,
    daily_limit: u64,
) -> Result<()> {
    let owner = ctx.accounts.creator.key();

    validate_guardian_set(&guardians, threshold)?;
    validate_roles(
        &ctx.accounts.vault.key(),
        &owner,
        &guardians,
        &ai_guardian,
        &safe_address,
    )?;
    validate_delay(delay_seconds)?;

    // Create the vault ATA, or accept one a third party already created (CR-INIT-1).
    // Any tokens already in it belong to the vault, just like a plain transfer in.
    associated_token::create_idempotent(CpiContext::new(
        ctx.accounts.associated_token_program.key(),
        associated_token::Create {
            payer: ctx.accounts.creator.to_account_info(),
            associated_token: ctx.accounts.vault_token.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        },
    ))?;

    let now = Clock::get()?.unix_timestamp;

    let mut guardian_slots = [Pubkey::default(); MAX_GUARDIANS];
    guardian_slots[..guardians.len()].copy_from_slice(&guardians);

    let vault = &mut ctx.accounts.vault;
    vault.set_inner(Vault {
        version: VAULT_VERSION,
        bump: ctx.bumps.vault,
        creator: owner,
        vault_id,
        mint: ctx.accounts.mint.key(),
        owner,
        owner_epoch: 0,
        guardians: guardian_slots,
        guardian_count: guardians.len() as u8, // <= MAX_GUARDIANS, checked above
        threshold,
        guardian_epoch: 0,
        ai_guardian,
        safe_address,
        delay_seconds,
        daily_limit,
        window_start: now,
        spent_in_window: 0,
        frozen: false,
        trusted_count: 0,
        next_withdrawal_id: 0,
        next_proposal_id: 0,
        reserved: [0u8; 64],
    });

    emit!(VaultInitialized {
        vault: vault.key(),
        creator: owner,
        owner,
        mint: vault.mint,
        guardian_count: vault.guardian_count,
        threshold,
        ai_guardian,
        safe_address,
        delay_seconds,
        daily_limit,
    });
    Ok(())
}
