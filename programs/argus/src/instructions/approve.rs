use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::ArgusError,
    events::ProposalApproved,
    governance::Proposal,
    instructions::shared::now,
    state::Vault,
};

/// A guardian adds their approval. When the threshold is first reached, `eta` is set
/// to `now + timelock(action)` and never changes again.
#[derive(Accounts)]
pub struct Approve<'info> {
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
        // A proposal from an old guardian set can't gather approvals (INV-7, P5).
        constraint = proposal.guardian_epoch == vault.guardian_epoch @ ArgusError::StaleGuardianEpoch,
    )]
    pub proposal: Account<'info, Proposal>,
}

pub fn handle_approve(ctx: Context<Approve>) -> Result<()> {
    let guardian = ctx.accounts.guardian.key();
    let slot = ctx
        .accounts
        .vault
        .guardian_index(&guardian)
        .ok_or(ArgusError::NotGuardian)?;
    let bit = 1u8 << slot;

    let now = now()?;
    let vault = &ctx.accounts.vault;
    let p = &mut ctx.accounts.proposal;
    // A dormant proposal can't be revived (audit I-2).
    require!(!p.is_expired(now)?, ArgusError::ProposalExpired);
    // Only the signer's own bit, and only once (INV-8).
    require!(p.approvals & bit == 0, ArgusError::AlreadyApproved);
    p.approvals |= bit;
    p.maybe_set_eta(vault, now)?;

    emit!(ProposalApproved {
        vault: vault.key(),
        id: p.id,
        by: guardian,
        approvals: p.approvals,
        eta: p.eta,
    });
    Ok(())
}
