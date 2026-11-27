use anchor_lang::prelude::*;

use crate::{governance::GovAction, state::Role};

#[event]
pub struct ProposalCreated {
    pub vault: Pubkey,
    pub id: u64,
    pub proposer: Pubkey,
    pub action: GovAction,
    pub eta: i64,
}

#[event]
pub struct ProposalApproved {
    pub vault: Pubkey,
    pub id: u64,
    pub by: Pubkey,
    pub approvals: u8,
    pub eta: i64,
}

#[event]
pub struct ProposalExecuted {
    pub vault: Pubkey,
    pub id: u64,
    pub action: GovAction,
}

#[event]
pub struct ProposalClosed {
    pub vault: Pubkey,
    pub id: u64,
}

#[event]
pub struct ProposalVetoed {
    pub vault: Pubkey,
    pub id: u64,
    pub by: Pubkey,
}

#[event]
pub struct WithdrawalCancelled {
    pub vault: Pubkey,
    pub id: u64,
    pub amount: u64,
    pub by: Pubkey,
    pub by_role: Role,
}

#[event]
pub struct Frozen {
    pub vault: Pubkey,
    pub by: Pubkey,
    pub by_role: Role,
}

#[event]
pub struct Swept {
    pub vault: Pubkey,
    pub by: Pubkey,
    pub amount: u64,
    pub safe_address: Pubkey,
    pub frozen: bool,
}

/// Program events (PROGRAM-SPEC §6). Sentinel subscribes to these.
#[event]
pub struct VaultInitialized {
    pub vault: Pubkey,
    pub creator: Pubkey,
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub guardian_count: u8,
    pub threshold: u8,
    pub ai_guardian: Pubkey,
    pub safe_address: Pubkey,
    pub delay_seconds: i64,
    pub daily_limit: u64,
}

#[event]
pub struct Deposited {
    pub vault: Pubkey,
    pub depositor: Pubkey,
    pub amount: u64,
}

#[event]
pub struct InstantWithdrawn {
    pub vault: Pubkey,
    pub destination: Pubkey,
    pub amount: u64,
    pub spent_in_window: u64,
}

#[event]
pub struct TrustedWithdrawn {
    pub vault: Pubkey,
    pub wallet: Pubkey,
    pub destination: Pubkey,
    pub amount: u64,
}

#[event]
pub struct WithdrawalRequested {
    pub vault: Pubkey,
    pub id: u64,
    pub amount: u64,
    pub destination: Pubkey,
    pub executes_at: i64,
}

#[event]
pub struct WithdrawalExecuted {
    pub vault: Pubkey,
    pub id: u64,
    pub amount: u64,
    pub destination: Pubkey,
}
