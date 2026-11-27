use anchor_lang::prelude::*;

/// All Argus errors (PROGRAM-SPEC §7).
///
/// **Append only.** Codes are 6000 + position, and clients map them, so never
/// reorder or remove a variant.
#[error_code]
pub enum ArgusError {
    #[msg("The vault is frozen")]
    Frozen, // 6000
    #[msg("Signer is not the vault owner")]
    NotOwner,
    #[msg("Signer is not a guardian of this vault")]
    NotGuardian,
    #[msg("Signer's role is not allowed to perform this action")]
    NotAuthorizedRole,
    #[msg("Amount exceeds the remaining daily allowance")]
    OverDailyLimit,
    #[msg("Destination is not a trusted address")]
    NotTrusted, // 6005
    #[msg("Trusted address is not active yet")]
    TrustedNotActive,
    #[msg("Too early: the delay has not elapsed")]
    TooEarly,
    #[msg("Withdrawal was requested by a previous owner key")]
    StaleOwnerEpoch,
    #[msg("Proposal was created under a previous guardian set")]
    StaleGuardianEpoch,
    #[msg("Guardian threshold not met")]
    ThresholdNotMet, // 6010
    #[msg("This guardian has already approved")]
    AlreadyApproved,
    #[msg("Threshold must be between 1 and the number of guardians")]
    InvalidThreshold,
    #[msg("Duplicate guardian")]
    DuplicateGuardian,
    #[msg("A key cannot hold two roles (owner, guardian, AI guardian)")]
    RoleOverlap,
    #[msg("Delay is outside the allowed bounds")]
    DelayOutOfBounds, // 6015
    #[msg("Change must be stricter than the current setting")]
    NotStricter,
    #[msg("Token account mint does not match the vault mint")]
    MintMismatch,
    #[msg("Insufficient funds in the vault")]
    InsufficientFunds,
    #[msg("Too many trusted addresses")]
    TooManyTrusted,
    #[msg("This proposal cannot be vetoed")]
    NotVetoable, // 6020
    #[msg("A guardian cannot veto their own removal")]
    CannotVetoOwnRemoval,
    #[msg("A vault needs between 1 and 5 guardians")]
    InvalidGuardianCount,
    #[msg("Guardian key is invalid")]
    InvalidGuardian,
    #[msg("Safe address must be set and must not be the owner, the AI guardian or the vault itself")]
    InvalidSafeAddress,
    #[msg("Only classic SPL Token mints are supported in v1")]
    UnsupportedMint, // 6025
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Amount must be greater than zero")]
    InvalidAmount, // 6027
    #[msg("Destination cannot be the vault's own token account")]
    InvalidDestination, // 6028
    #[msg("This wallet is already trusted")]
    AlreadyTrusted,
    #[msg("Trusted wallet is invalid")]
    InvalidTrustedWallet, // 6030
    #[msg("The trusted-record account passed does not match the proposal")]
    TrustedAccountMismatch,
    #[msg("Proposal expired before reaching its threshold")]
    ProposalExpired, // 6032
    #[msg("Proposal is still live and cannot be closed")]
    ProposalStillLive,
}
