use anchor_lang::prelude::*;

use crate::{
    constants::*, error::ArgusError, events::ProposalClosed, governance::Proposal,
    instructions::shared::now, state::Vault,
};

/// Anyone closes a **dead** proposal (stale guardian epoch, or expired before
/// reaching its threshold) and returns its rent to `rent_payer` (audit I-2/I-3).
/// A dead proposal can never execute, so closing it changes nothing but rent.
#[derive(Accounts)]
pub struct CloseProposal<'info> {
    pub closer: Signer<'info>,

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

    /// CHECK: Receives the rent refund. Pinned by `has_one = rent_payer`.
    #[account(mut)]
    pub rent_payer: UncheckedAccount<'info>,
}

pub fn handle_close_proposal(ctx: Context<CloseProposal>) -> Result<()> {
    let p = &ctx.accounts.proposal;
    require!(
        p.is_dead(&ctx.accounts.vault, now()?)?,
        ArgusError::ProposalStillLive
    );
    emit!(ProposalClosed {
        vault: ctx.accounts.vault.key(),
        id: p.id,
    });
    Ok(())
}
