use anchor_lang::prelude::*;

/// Account layout version written into new vaults.
pub const VAULT_VERSION: u8 = 1;

#[constant]
pub const VAULT_SEED: &[u8] = b"vault";
#[constant]
pub const WITHDRAWAL_SEED: &[u8] = b"withdrawal";
#[constant]
pub const TRUSTED_SEED: &[u8] = b"trusted";
#[constant]
pub const PROPOSAL_SEED: &[u8] = b"proposal";

/// Guardian slots per vault (PROGRAM-SPEC §2). `usize` for array lengths. The IDL
/// has no `usize`, so clients get the `u8` copy below.
pub const MAX_GUARDIANS: usize = 5;
#[constant]
pub const MAX_GUARDIAN_SLOTS: u8 = MAX_GUARDIANS as u8;

/// Trusted-address cap per vault.
#[constant]
pub const MAX_TRUSTED: u8 = 10;

/// Timelock bounds, in seconds. 60 s is the minimum so the devnet demo can show a
/// full cycle. The UI defaults to 86,400.
#[constant]
pub const MIN_DELAY: i64 = 60;
#[constant]
pub const MAX_DELAY: i64 = 30 * 86_400;

/// A proposal must reach its threshold within this many seconds of creation.
#[constant]
pub const PROPOSAL_TTL: i64 = 7 * 86_400;

/// Length of the instant-allowance window.
#[constant]
pub const WINDOW_SECONDS: i64 = 86_400;
