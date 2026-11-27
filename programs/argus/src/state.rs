use anchor_lang::prelude::*;

use crate::{constants::*, error::ArgusError};

/// A self-custodial savings vault. PDA: `["vault", creator, vault_id_le]`.
///
/// Seeds use `creator` (immutable), never `owner` (rotatable).
#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub version: u8,
    pub bump: u8,
    pub creator: Pubkey,
    pub vault_id: u64,
    pub mint: Pubkey,
    pub owner: Pubkey,
    /// Bumped on owner rotation. Pending withdrawals must match it (INV-6).
    pub owner_epoch: u32,
    /// Unused slots are `Pubkey::default()`.
    pub guardians: [Pubkey; MAX_GUARDIANS],
    pub guardian_count: u8,
    pub threshold: u8,
    /// Bumped whenever the guardian set or threshold changes (INV-7).
    pub guardian_epoch: u32,
    /// `Pubkey::default()` means no AI guardian.
    pub ai_guardian: Pubkey,
    /// Wallet that receives an emergency sweep (its ATA for `mint`).
    pub safe_address: Pubkey,
    pub delay_seconds: i64,
    pub daily_limit: u64,
    pub window_start: i64,
    pub spent_in_window: u64,
    pub frozen: bool,
    pub trusted_count: u8,
    pub next_withdrawal_id: u64,
    pub next_proposal_id: u64,
    /// Reserved for future fields, so we never need a realloc.
    pub reserved: [u8; 64],
}

/// A pending delayed withdrawal. PDA: `["withdrawal", vault, id_le]`.
/// It exists only while pending. Execute or cancel closes it.
#[account]
#[derive(InitSpace)]
pub struct Withdrawal {
    pub vault: Pubkey,
    pub id: u64,
    pub bump: u8,
    /// Destination **token account** (mint checked at request and execute).
    pub destination: Pubkey,
    pub amount: u64,
    pub requested_at: i64,
    pub executes_at: i64,
    /// `vault.owner_epoch` at request time (INV-6).
    pub owner_epoch: u32,
    pub rent_payer: Pubkey,
}

/// A trusted destination wallet. PDA: `["trusted", vault, wallet]`.
/// Created only by an executed `AddTrusted` proposal.
#[account]
#[derive(InitSpace)]
pub struct TrustedAddress {
    pub vault: Pubkey,
    pub wallet: Pubkey,
    pub active_at: i64,
    pub bump: u8,
}

/// Which role performed a protective action (reported in events).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Role {
    Owner,
    Guardian,
    Ai,
}

impl Vault {
    /// Role of `key` for protective actions (cancel, freeze). Roles are disjoint by
    /// construction (`validate_roles`), so at most one matches.
    pub fn protective_role(&self, key: &Pubkey) -> Option<Role> {
        if self.is_owner(key) {
            Some(Role::Owner)
        } else if self.guardian_index(key).is_some() {
            Some(Role::Guardian)
        } else if self.is_ai(key) {
            Some(Role::Ai)
        } else {
            None
        }
    }

    /// The active guardian slots.
    pub fn active_guardians(&self) -> &[Pubkey] {
        &self.guardians[..self.guardian_count as usize]
    }

    /// Slot index of `key` among the *current* guardians (audit B4).
    pub fn guardian_index(&self, key: &Pubkey) -> Option<usize> {
        self.active_guardians().iter().position(|g| g == key)
    }

    pub fn is_owner(&self, key: &Pubkey) -> bool {
        self.owner == *key
    }

    pub fn is_ai(&self, key: &Pubkey) -> bool {
        self.ai_guardian != Pubkey::default() && self.ai_guardian == *key
    }
}

/// Guardian-set rules shared by `initialize_vault` and `SetGuardians`.
pub fn validate_guardian_set(guardians: &[Pubkey], threshold: u8) -> Result<()> {
    require!(
        !guardians.is_empty() && guardians.len() <= MAX_GUARDIANS,
        ArgusError::InvalidGuardianCount
    );
    for (i, g) in guardians.iter().enumerate() {
        require!(*g != Pubkey::default(), ArgusError::InvalidGuardian);
        require!(
            !guardians[..i].contains(g),
            ArgusError::DuplicateGuardian
        );
    }
    require!(
        threshold >= 1 && (threshold as usize) <= guardians.len(),
        ArgusError::InvalidThreshold
    );
    Ok(())
}

/// Role-separation rules (INV-2, THREAT P12). Shared by init, `RotateOwner`,
/// `SetGuardians`, `SetAiGuardian` and `SetSafeAddress`.
pub fn validate_roles(
    vault: &Pubkey,
    owner: &Pubkey,
    guardians: &[Pubkey],
    ai_guardian: &Pubkey,
    safe_address: &Pubkey,
) -> Result<()> {
    require!(*owner != Pubkey::default(), ArgusError::NotOwner);
    require!(!guardians.contains(owner), ArgusError::RoleOverlap);
    if *ai_guardian != Pubkey::default() {
        require!(
            ai_guardian != owner && !guardians.contains(ai_guardian),
            ArgusError::RoleOverlap
        );
    }
    // A sweep must never deliver funds to the (possibly stolen) owner key or the AI key,
    // and must never be a self-transfer back into the vault.
    require!(
        *safe_address != Pubkey::default()
            && safe_address != owner
            && safe_address != vault
            && (*ai_guardian == Pubkey::default() || safe_address != ai_guardian),
        ArgusError::InvalidSafeAddress
    );
    Ok(())
}

pub fn validate_delay(delay_seconds: i64) -> Result<()> {
    require!(
        (MIN_DELAY..=MAX_DELAY).contains(&delay_seconds),
        ArgusError::DelayOutOfBounds
    );
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests_support {
    use super::*;

    /// A plain 1-of-1 vault for unit tests.
    pub fn vault() -> Vault {
        let mut guardians = [Pubkey::default(); MAX_GUARDIANS];
        guardians[0] = Pubkey::new_from_array([10; 32]);
        Vault {
            version: 1,
            bump: 255,
            creator: Pubkey::new_from_array([1; 32]),
            vault_id: 0,
            mint: Pubkey::new_from_array([2; 32]),
            owner: Pubkey::new_from_array([1; 32]),
            owner_epoch: 0,
            guardians,
            guardian_count: 1,
            threshold: 1,
            guardian_epoch: 0,
            ai_guardian: Pubkey::new_from_array([9; 32]),
            safe_address: Pubkey::new_from_array([3; 32]),
            delay_seconds: 86_400,
            daily_limit: 0,
            window_start: 0,
            spent_in_window: 0,
            frozen: false,
            trusted_count: 0,
            next_withdrawal_id: 0,
            next_proposal_id: 0,
            reserved: [0; 64],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn k(n: u8) -> Pubkey {
        Pubkey::new_from_array([n; 32])
    }

    fn vault_with(guardians: &[Pubkey], ai: Pubkey) -> Vault {
        let mut slots = [Pubkey::default(); MAX_GUARDIANS];
        slots[..guardians.len()].copy_from_slice(guardians);
        Vault {
            version: 1,
            bump: 255,
            creator: k(1),
            vault_id: 0,
            mint: k(2),
            owner: k(1),
            owner_epoch: 0,
            guardians: slots,
            guardian_count: guardians.len() as u8,
            threshold: 1,
            guardian_epoch: 0,
            ai_guardian: ai,
            safe_address: k(3),
            delay_seconds: 86_400,
            daily_limit: 0,
            window_start: 0,
            spent_in_window: 0,
            frozen: false,
            trusted_count: 0,
            next_withdrawal_id: 0,
            next_proposal_id: 0,
            reserved: [0; 64],
        }
    }

    #[test]
    fn guardian_index_finds_every_active_slot() {
        let gs = [k(10), k(11), k(12), k(13), k(14)];
        let v = vault_with(&gs, k(9));
        for (i, g) in gs.iter().enumerate() {
            assert_eq!(v.guardian_index(g), Some(i));
        }
        assert_eq!(v.guardian_index(&k(99)), None);
    }

    /// Unused slots hold `Pubkey::default()`, which must never count as a guardian (B4).
    #[test]
    fn guardian_index_ignores_unused_default_slots() {
        let v = vault_with(&[k(10), k(11)], k(9));
        assert_eq!(v.guardian_index(&Pubkey::default()), None);
        assert_eq!(v.active_guardians().len(), 2);
    }

    /// With the AI disabled (`default`), the default key must not pass as the AI (INV-5).
    #[test]
    fn is_ai_false_for_default_when_ai_disabled() {
        let v = vault_with(&[k(10)], Pubkey::default());
        assert!(!v.is_ai(&Pubkey::default()));
        let v = vault_with(&[k(10)], k(9));
        assert!(v.is_ai(&k(9)));
        assert!(!v.is_ai(&k(10)));
    }

    #[test]
    fn is_owner_matches_only_owner() {
        let v = vault_with(&[k(10)], k(9));
        assert!(v.is_owner(&k(1)));
        assert!(!v.is_owner(&k(10)));
    }
}
