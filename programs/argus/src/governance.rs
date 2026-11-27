//! Governance: actions, timelocks and validation (PROGRAM-SPEC §4).

use anchor_lang::prelude::*;

use crate::{error::ArgusError, state::*};

/// A guardian-threshold change to the vault.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug, InitSpace)]
pub enum GovAction {
    /// Immediate. Bumps `owner_epoch`, voiding the old key's withdrawals (INV-6).
    RotateOwner { new_owner: Pubkey },
    /// Immediate.
    Unfreeze,
    /// Immediate (tightening).
    RemoveTrusted { wallet: Pubkey },
    /// Immediate, but stricter only.
    TightenLimits { daily_limit: u64, delay_seconds: i64 },
    /// Delayed, vetoable.
    AddTrusted { wallet: Pubkey },
    /// Delayed, vetoable.
    LoosenLimits { daily_limit: u64, delay_seconds: i64 },
    /// Delayed, vetoable.
    SetSafeAddress { wallet: Pubkey },
    /// Delayed, vetoable. Bumps `guardian_epoch`, killing every open proposal (INV-7).
    SetGuardians {
        #[max_len(5)]
        guardians: Vec<Pubkey>,
        threshold: u8,
    },
    /// Delayed and vetoable, except that removing the AI (`default`) is immediate.
    SetAiGuardian { key: Pubkey },
}

impl GovAction {
    /// Seconds between reaching the threshold and becoming executable.
    pub fn timelock(&self, vault: &Vault) -> i64 {
        match self {
            GovAction::RotateOwner { .. }
            | GovAction::Unfreeze
            | GovAction::RemoveTrusted { .. }
            | GovAction::TightenLimits { .. } => 0,
            GovAction::SetAiGuardian { key } if *key == Pubkey::default() => 0,
            GovAction::AddTrusted { .. }
            | GovAction::LoosenLimits { .. }
            | GovAction::SetSafeAddress { .. }
            | GovAction::SetGuardians { .. }
            | GovAction::SetAiGuardian { .. } => vault.delay_seconds,
        }
    }

    /// Only actions with a timelock can be vetoed (PROGRAM-SPEC §3, audit C8).
    pub fn is_vetoable(&self) -> bool {
        match self {
            GovAction::AddTrusted { .. }
            | GovAction::LoosenLimits { .. }
            | GovAction::SetSafeAddress { .. }
            | GovAction::SetGuardians { .. } => true,
            GovAction::SetAiGuardian { key } => *key != Pubkey::default(),
            _ => false,
        }
    }

    /// The wallet whose TrustedAddress record this action reads or writes, if any.
    pub fn trusted_wallet(&self) -> Option<Pubkey> {
        match self {
            GovAction::AddTrusted { wallet } | GovAction::RemoveTrusted { wallet } => Some(*wallet),
            GovAction::RotateOwner { new_owner } => Some(*new_owner),
            // A new AI key must not be a trusted wallet (audit F-2).
            GovAction::SetAiGuardian { key } if *key != Pubkey::default() => Some(*key),
            _ => None,
        }
    }

    /// Parameter checks against the vault's *current* state. These run at propose
    /// and again at execute (audit C9). Checks that need the trusted-record
    /// account (existence, `trusted_count`) happen in `execute_proposal`.
    pub fn validate(&self, vault_key: &Pubkey, vault: &Vault) -> Result<()> {
        let guardians = vault.active_guardians();
        match self {
            GovAction::RotateOwner { new_owner } => validate_roles(
                vault_key,
                new_owner,
                guardians,
                &vault.ai_guardian,
                &vault.safe_address,
            ),
            GovAction::Unfreeze => Ok(()),
            GovAction::RemoveTrusted { .. } => Ok(()),
            GovAction::TightenLimits {
                daily_limit,
                delay_seconds,
            } => {
                validate_delay(*delay_seconds)?;
                require!(
                    *daily_limit <= vault.daily_limit && *delay_seconds >= vault.delay_seconds,
                    ArgusError::NotStricter
                );
                Ok(())
            }
            GovAction::AddTrusted { wallet } => {
                require!(
                    *wallet != Pubkey::default() && wallet != vault_key,
                    ArgusError::InvalidTrustedWallet
                );
                // A trusted owner/AI key would let a thief drain the vault instantly.
                require!(
                    !vault.is_owner(wallet) && !vault.is_ai(wallet),
                    ArgusError::RoleOverlap
                );
                Ok(())
            }
            GovAction::LoosenLimits { delay_seconds, .. } => validate_delay(*delay_seconds),
            GovAction::SetSafeAddress { wallet } => validate_roles(
                vault_key,
                &vault.owner,
                guardians,
                &vault.ai_guardian,
                wallet,
            ),
            GovAction::SetGuardians {
                guardians: new_set,
                threshold,
            } => {
                validate_guardian_set(new_set, *threshold)?;
                validate_roles(
                    vault_key,
                    &vault.owner,
                    new_set,
                    &vault.ai_guardian,
                    &vault.safe_address,
                )
            }
            GovAction::SetAiGuardian { key } => validate_roles(
                vault_key,
                &vault.owner,
                guardians,
                key,
                &vault.safe_address,
            ),
        }
    }
}

/// A governance proposal. PDA: `["proposal", vault, id_le]`. Closed on execute or veto.
#[account]
#[derive(InitSpace)]
pub struct Proposal {
    pub vault: Pubkey,
    pub id: u64,
    pub bump: u8,
    pub action: GovAction,
    /// Bitmap indexed by guardian slot (INV-8).
    pub approvals: u8,
    /// `vault.guardian_epoch` at creation (INV-7).
    pub guardian_epoch: u32,
    pub created_at: i64,
    /// 0 until the threshold is reached, then `now + timelock`. Set once (INV-3, C7).
    pub eta: i64,
    pub proposer: Pubkey,
    pub rent_payer: Pubkey,
}

impl Proposal {
    pub fn approval_count(&self) -> u32 {
        self.approvals.count_ones()
    }

    /// Didn't reach its threshold within `PROPOSAL_TTL` (inclusive boundary).
    /// A passed proposal (`eta != 0`) never expires.
    pub fn is_expired(&self, now: i64) -> Result<bool> {
        let deadline = self
            .created_at
            .checked_add(crate::constants::PROPOSAL_TTL)
            .ok_or(ArgusError::MathOverflow)?;
        Ok(self.eta == 0 && now > deadline)
    }

    /// Can never execute: from an old guardian set, or expired.
    pub fn is_dead(&self, vault: &Vault, now: i64) -> Result<bool> {
        Ok(self.guardian_epoch != vault.guardian_epoch || self.is_expired(now)?)
    }

    /// Sets `eta` the first time the threshold is reached. Never changes it again.
    pub fn maybe_set_eta(&mut self, vault: &Vault, now: i64) -> Result<()> {
        if self.eta == 0 && self.approval_count() >= vault.threshold as u32 {
            self.eta = now
                .checked_add(self.action.timelock(vault))
                .ok_or(ArgusError::MathOverflow)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timelocks_match_spec_table() {
        let mut v = crate::state::tests_support::vault();
        v.delay_seconds = 1234;
        let k = Pubkey::new_unique();
        let cases: Vec<(GovAction, i64, bool)> = vec![
            (GovAction::RotateOwner { new_owner: k }, 0, false),
            (GovAction::Unfreeze, 0, false),
            (GovAction::RemoveTrusted { wallet: k }, 0, false),
            (GovAction::TightenLimits { daily_limit: 0, delay_seconds: 60 }, 0, false),
            (GovAction::AddTrusted { wallet: k }, 1234, true),
            (GovAction::LoosenLimits { daily_limit: 0, delay_seconds: 60 }, 1234, true),
            (GovAction::SetSafeAddress { wallet: k }, 1234, true),
            (GovAction::SetGuardians { guardians: vec![k], threshold: 1 }, 1234, true),
            (GovAction::SetAiGuardian { key: k }, 1234, true),
            (GovAction::SetAiGuardian { key: Pubkey::default() }, 0, false),
        ];
        for (a, lock, veto) in cases {
            assert_eq!(a.timelock(&v), lock, "{a:?}");
            assert_eq!(a.is_vetoable(), veto, "{a:?}");
        }
    }
}
