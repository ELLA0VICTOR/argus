use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::ArgusError,
    events::ProposalVetoed,
    governance::{GovAction, Proposal},
    state::Vault,
};

/// Any single guardian vetoes a vetoable proposal at any point before execution,
/// and the proposal is closed. A guardian can't veto a `SetGuardians` that
/// removes them (THREAT G3).
#[derive(Accounts)]
pub struct Veto<'info> {
    #[account(
        constraint = vault.guardian_index(&guardian.key()).is_some() @ ArgusError::NotGuardian,
    )]
    pub guardian: Signer<'info>,

    #[account(
        seeds = [VAULT_SEED, vault.creator.as_ref(), &vault.vault_id.to_le_bytes()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        seeds = [PROPOSAL_SEED, vault.key().as_ref(), &proposal.id.to_le_bytes()],
        bump = proposal.bump,
        has_one = vault,
        has_one = rent_payer,
        close = rent_payer,
    )]
    pub proposal: Account<'info, Proposal>,

    /// CHECK: Receives the Proposal rent refund. Pinned by `has_one = rent_payer`.
    #[account(mut)]
    pub rent_payer: UncheckedAccount<'info>,
}

pub fn handle_veto(ctx: Context<Veto>) -> Result<()> {
    let guardian = ctx.accounts.guardian.key();
    let p = &ctx.accounts.proposal;
    require!(p.action.is_vetoable(), ArgusError::NotVetoable);
    if let GovAction::SetGuardians { guardians, .. } = &p.action {
        require!(guardians.contains(&guardian), ArgusError::CannotVetoOwnRemoval);
    }
    emit!(ProposalVetoed {
        vault: ctx.accounts.vault.key(),
        id: p.id,
        by: guardian,
    });
    Ok(())
}
