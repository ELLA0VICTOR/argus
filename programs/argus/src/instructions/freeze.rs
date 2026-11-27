use anchor_lang::prelude::*;

use crate::{constants::*, error::ArgusError, events::Frozen, state::Vault};

/// Owner, any single guardian or the AI freezes the vault. This is idempotent,
/// so an AI auto-freeze racing a guardian's freeze is harmless.
/// Only an executed `Unfreeze` proposal (guardian threshold) clears it.
#[derive(Accounts)]
pub struct Freeze<'info> {
    #[account(
        constraint = vault.protective_role(&signer.key()).is_some() @ ArgusError::NotAuthorizedRole,
    )]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, vault.creator.as_ref(), &vault.vault_id.to_le_bytes()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,
}

pub fn handle_freeze(ctx: Context<Freeze>) -> Result<()> {
    let by = ctx.accounts.signer.key();
    let vault = &mut ctx.accounts.vault;
    let by_role = vault
        .protective_role(&by)
        .ok_or(ArgusError::NotAuthorizedRole)?;
    vault.frozen = true;
    emit!(Frozen {
        vault: vault.key(),
        by,
        by_role,
    });
    Ok(())
}
