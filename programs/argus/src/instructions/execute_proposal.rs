use anchor_lang::{
    prelude::*,
    system_program::{self, Allocate, Assign, CreateAccount, Transfer},
};

use crate::{
    constants::*,
    error::ArgusError,
    events::ProposalExecuted,
    governance::{GovAction, Proposal},
    instructions::shared::now,
    state::{TrustedAddress, Vault},
};

/// Anyone executes a proposal that has reached its threshold and its `eta`.
/// Allowed while frozen (Unfreeze is itself an action).
#[derive(Accounts)]
pub struct ExecuteProposal<'info> {
    /// Pays for a new TrustedAddress (AddTrusted) and gets RemoveTrusted refunds.
    #[account(mut)]
    pub executor: Signer<'info>,

    #[account(
        mut,
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
    /// `dup`: the proposer usually executes their own proposal, so this is often
    /// the same account as `executor` (audit F-1). It only ever receives lamports,
    /// so aliasing is safe.
    #[account(mut, dup)]
    pub rent_payer: UncheckedAccount<'info>,

    /// CHECK: Required for AddTrusted, RemoveTrusted, RotateOwner and SetAiGuardian(key). The handler
    /// checks that it's exactly PDA `["trusted", vault, action.trusted_wallet()]`.
    #[account(mut)]
    pub trusted: Option<UncheckedAccount<'info>>,

    pub system_program: Program<'info, System>,
}

pub fn handle_execute_proposal(ctx: Context<ExecuteProposal>) -> Result<()> {
    let now = now()?;
    let vault_key = ctx.accounts.vault.key();
    let action = ctx.accounts.proposal.action.clone();
    {
        let p = &ctx.accounts.proposal;
        let v = &ctx.accounts.vault;
        require!(p.eta != 0, ArgusError::ThresholdNotMet);
        require!(now >= p.eta, ArgusError::TooEarly);
        require!(
            p.guardian_epoch == v.guardian_epoch,
            ArgusError::StaleGuardianEpoch
        );
        // Re-validate against the vault as it is now (audit C9).
        action.validate(&vault_key, v)?;
    }

    // Resolve and verify the trusted-record account where the action needs one.
    let trusted_info = match action.trusted_wallet() {
        Some(wallet) => {
            let (expected, bump) = Pubkey::find_program_address(
                &[TRUSTED_SEED, vault_key.as_ref(), wallet.as_ref()],
                &crate::ID,
            );
            let info = ctx
                .accounts
                .trusted
                .as_ref()
                .ok_or(ArgusError::TrustedAccountMismatch)?
                .to_account_info();
            require_keys_eq!(info.key(), expected, ArgusError::TrustedAccountMismatch);
            Some((info, wallet, bump))
        }
        None => None,
    };

    match &action {
        GovAction::RotateOwner { new_owner } => {
            let (info, _, _) = trusted_info.as_ref().unwrap();
            // The new owner must not already be a trusted wallet.
            require!(!is_live_record(info), ArgusError::RoleOverlap);
            let v = &mut ctx.accounts.vault;
            v.owner = *new_owner;
            v.owner_epoch = v.owner_epoch.checked_add(1).ok_or(ArgusError::MathOverflow)?;
        }
        GovAction::Unfreeze => ctx.accounts.vault.frozen = false,
        GovAction::RemoveTrusted { .. } => {
            let (info, wallet, _) = trusted_info.as_ref().unwrap();
            require!(is_live_record(info), ArgusError::NotTrusted);
            let record = {
                let data = info.try_borrow_data()?;
                // try_deserialize checks the TrustedAddress discriminator.
                TrustedAddress::try_deserialize(&mut &data[..])
                    .map_err(|_| error!(ArgusError::NotTrusted))?
            };
            require_keys_eq!(record.vault, vault_key, ArgusError::NotTrusted);
            require_keys_eq!(record.wallet, *wallet, ArgusError::NotTrusted);
            // Lamports go to the executor, the data is zeroed and the account
            // goes back to the system program (INV-12).
            close_account(info, &ctx.accounts.executor.to_account_info())?;
            let v = &mut ctx.accounts.vault;
            v.trusted_count = v.trusted_count.checked_sub(1).ok_or(ArgusError::MathOverflow)?;
        }
        GovAction::TightenLimits {
            daily_limit,
            delay_seconds,
        }
        | GovAction::LoosenLimits {
            daily_limit,
            delay_seconds,
        } => {
            let v = &mut ctx.accounts.vault;
            v.daily_limit = *daily_limit;
            v.delay_seconds = *delay_seconds;
        }
        GovAction::AddTrusted { .. } => {
            let (info, wallet, bump) = trusted_info.as_ref().unwrap();
            require!(!is_live_record(info), ArgusError::AlreadyTrusted);
            require!(
                ctx.accounts.vault.trusted_count < MAX_TRUSTED,
                ArgusError::TooManyTrusted
            );
            let seeds: &[&[u8]] = &[TRUSTED_SEED, vault_key.as_ref(), wallet.as_ref(), &[*bump]];
            create_pda(
                &ctx.accounts.executor,
                info,
                &ctx.accounts.system_program,
                8 + TrustedAddress::INIT_SPACE,
                seeds,
            )?;
            let record = TrustedAddress {
                vault: vault_key,
                wallet: *wallet,
                // The proposal timelock already provided the wait.
                active_at: now,
                bump: *bump,
            };
            let mut data = info.try_borrow_mut_data()?;
            let mut cursor: &mut [u8] = &mut data;
            record.try_serialize(&mut cursor)?;
            drop(data);
            let v = &mut ctx.accounts.vault;
            v.trusted_count = v.trusted_count.checked_add(1).ok_or(ArgusError::MathOverflow)?;
        }
        GovAction::SetSafeAddress { wallet } => ctx.accounts.vault.safe_address = *wallet,
        GovAction::SetGuardians {
            guardians,
            threshold,
        } => {
            let v = &mut ctx.accounts.vault;
            let mut slots = [Pubkey::default(); MAX_GUARDIANS];
            slots[..guardians.len()].copy_from_slice(guardians);
            v.guardians = slots;
            v.guardian_count = guardians.len() as u8; // validated <= MAX_GUARDIANS
            v.threshold = *threshold;
            // Every other open proposal dies (INV-7).
            v.guardian_epoch = v.guardian_epoch.checked_add(1).ok_or(ArgusError::MathOverflow)?;
        }
        GovAction::SetAiGuardian { key } => {
            if let Some((info, _, _)) = trusted_info.as_ref() {
                // Trusted wallets never hold another role (PROGRAM-SPEC §4, audit F-2).
                require!(!is_live_record(info), ArgusError::RoleOverlap);
            }
            ctx.accounts.vault.ai_guardian = *key;
        }
    }

    emit!(ProposalExecuted {
        vault: vault_key,
        id: ctx.accounts.proposal.id,
        action,
    });
    Ok(())
}

/// Closes a program-owned account: moves all lamports to `dest`, zeroes the data
/// and assigns it back to the system program, so it can't be revived (INV-12).
fn close_account<'info>(info: &AccountInfo<'info>, dest: &AccountInfo<'info>) -> Result<()> {
    let lamports = info.lamports();
    let new_dest = dest
        .lamports()
        .checked_add(lamports)
        .ok_or(ArgusError::MathOverflow)?;
    **dest.try_borrow_mut_lamports()? = new_dest;
    **info.try_borrow_mut_lamports()? = 0;
    info.try_borrow_mut_data()?.fill(0);
    info.assign(&system_program::ID);
    info.resize(0)?;
    Ok(())
}

/// True if `info` holds an Argus-owned record.
fn is_live_record(info: &AccountInfo) -> bool {
    info.owner == &crate::ID && !info.data_is_empty()
}

/// Creates a program-owned PDA. It also works when someone has pre-funded the
/// address with lamports, which would make plain `create_account` fail and
/// could block the action forever (same class as CR-INIT-1).
fn create_pda<'info>(
    payer: &Signer<'info>,
    target: &AccountInfo<'info>,
    system: &Program<'info, System>,
    space: usize,
    seeds: &[&[u8]],
) -> Result<()> {
    let rent = Rent::get()?.minimum_balance(space);
    let signer: &[&[&[u8]]] = &[seeds];
    let current = target.lamports();
    if current == 0 {
        system_program::create_account(
            CpiContext::new_with_signer(
                system.key(),
                CreateAccount {
                    from: payer.to_account_info(),
                    to: target.clone(),
                },
                signer,
            ),
            rent,
            space as u64,
            &crate::ID,
        )
    } else {
        require!(
            target.owner == &system_program::ID && target.data_is_empty(),
            ArgusError::AlreadyTrusted
        );
        let top_up = rent.saturating_sub(current);
        if top_up > 0 {
            system_program::transfer(
                CpiContext::new(
                    system.key(),
                    Transfer {
                        from: payer.to_account_info(),
                        to: target.clone(),
                    },
                ),
                top_up,
            )?;
        }
        system_program::allocate(
            CpiContext::new_with_signer(
                system.key(),
                Allocate {
                    account_to_allocate: target.clone(),
                },
                signer,
            ),
            space as u64,
        )?;
        system_program::assign(
            CpiContext::new_with_signer(
                system.key(),
                Assign {
                    account_to_assign: target.clone(),
                },
                signer,
            ),
            &crate::ID,
        )
    }
}
