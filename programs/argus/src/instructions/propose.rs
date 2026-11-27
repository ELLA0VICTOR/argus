use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::ArgusError,
    events::ProposalCreated,
    governance::{GovAction, Proposal},
    instructions::shared::now,
    state::Vault,
};

/// Any single guardian proposes a governance action. The proposer's bit is set.
/// Allowed while frozen. The owner and the AI can't propose (INV-2, INV-5).
#[derive(Accounts)]
pub struct Propose<'info> {
    /// Pays the Proposal rent and gets it back on execute or veto.
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

    #[account(
        init,
        payer = guardian,
        space = 8 + Proposal::INIT_SPACE,
        seeds = [PROPOSAL_SEED, vault.key().as_ref(), &vault.next_proposal_id.to_le_bytes()],
        bump,
    )]
    pub proposal: Account<'info, Proposal>,

    pub system_program: Program<'info, System>,
}

pub fn handle_propose(ctx: Context<Propose>, action: GovAction) -> Result<()> {
    let vault_key = ctx.accounts.vault.key();
    action.validate(&vault_key, &ctx.accounts.vault)?;

    let guardian = ctx.accounts.guardian.key();
    let slot = ctx
        .accounts
        .vault
        .guardian_index(&guardian)
        .ok_or(ArgusError::NotGuardian)?;
    let now = now()?;

    let vault = &mut ctx.accounts.vault;
    let id = vault.next_proposal_id;
    vault.next_proposal_id = id.checked_add(1).ok_or(ArgusError::MathOverflow)?;

    let mut proposal = Proposal {
        vault: vault_key,
        id,
        bump: ctx.bumps.proposal,
        action: action.clone(),
        approvals: 1u8 << slot,
        guardian_epoch: vault.guardian_epoch,
        created_at: now,
        eta: 0,
        proposer: guardian,
        rent_payer: guardian,
    };
    // With threshold 1 the proposer alone reaches it.
    proposal.maybe_set_eta(vault, now)?;
    let eta = proposal.eta;
    ctx.accounts.proposal.set_inner(proposal);

    emit!(ProposalCreated {
        vault: vault_key,
        id,
        proposer: guardian,
        action,
        eta,
    });
    Ok(())
}
