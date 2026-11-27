//! `withdraw_instant`: daily allowance (THREAT A5) and role checks.
mod common;

use {argus::error::ArgusError, common::*, solana_signer::Signer};

const LIMIT: u64 = 100 * UNIT;

#[test]
fn instant_within_limit_moves_funds_and_tracks_spend() {
    let mut fx = Fx::new(1_000 * UNIT);
    let owner = fx.owner();
    let dest = fx.owner_dest;
    assert_ok(fx.instant(&owner, &dest, 40 * UNIT));
    assert_eq!(fx.balance(&dest), 40 * UNIT);
    assert_eq!(fx.balance(&fx.vault_ata.clone()), 960 * UNIT);
    assert_eq!(fx.vault_state().spent_in_window, 40 * UNIT);

    // Exactly up to the limit is allowed.
    assert_ok(fx.instant(&owner, &dest, 60 * UNIT));
    assert_eq!(fx.vault_state().spent_in_window, LIMIT);
}

/// A5: a thief holding the owner key is capped at `daily_limit` per window.
#[test]
fn attack_instant_capped() {
    let mut fx = Fx::new(1_000 * UNIT);
    let owner = fx.owner();
    let dest = fx.owner_dest;
    assert_argus_err(fx.instant(&owner, &dest, LIMIT + 1), ArgusError::OverDailyLimit);
    assert_ok(fx.instant(&owner, &dest, LIMIT));
    assert_argus_err(fx.instant(&owner, &dest, 1), ArgusError::OverDailyLimit);
    assert_eq!(fx.balance(&fx.vault_ata.clone()), 900 * UNIT);
}

/// A5 / audit C6: the window resets at exactly 86,400 s, not one second earlier.
#[test]
fn attack_window_rollover() {
    let mut fx = Fx::new(1_000 * UNIT);
    let owner = fx.owner();
    let dest = fx.owner_dest;
    assert_ok(fx.instant(&owner, &dest, LIMIT));

    fx.env.warp(DAY - 1);
    assert_argus_err(fx.instant(&owner, &dest, 1), ArgusError::OverDailyLimit);

    fx.env.warp(1);
    assert_ok(fx.instant(&owner, &dest, LIMIT));
    let v = fx.vault_state();
    assert_eq!(v.window_start, START_TIME + DAY);
    assert_eq!(v.spent_in_window, LIMIT);
    // Two windows: at most 2 x limit left the vault.
    assert_eq!(fx.balance(&fx.vault_ata.clone()), 800 * UNIT);
}

#[test]
fn instant_rejects_guardian_ai_and_stranger() {
    let mut fx = Fx::new(1_000 * UNIT);
    let dest = fx.owner_dest;
    let g = fx.guardians[0].insecure_clone();
    let ai = fx.ai.insecure_clone();
    let stranger = fx.env.funded_keypair();
    assert_argus_err(fx.instant(&g, &dest, UNIT), ArgusError::NotOwner);
    assert_argus_err(fx.instant(&ai, &dest, UNIT), ArgusError::NotOwner); // INV-5
    assert_argus_err(fx.instant(&stranger, &dest, UNIT), ArgusError::NotOwner);
}

#[test]
fn instant_rejects_when_frozen() {
    let mut fx = Fx::new(1_000 * UNIT);
    fx.freeze_by_guardian();
    let owner = fx.owner();
    let dest = fx.owner_dest;
    assert_argus_err(fx.instant(&owner, &dest, UNIT), ArgusError::Frozen); // INV-4
}

#[test]
fn instant_rejects_zero_and_overdraw() {
    let mut fx = Fx::new(10 * UNIT);
    let owner = fx.owner();
    let dest = fx.owner_dest;
    assert_argus_err(fx.instant(&owner, &dest, 0), ArgusError::InvalidAmount);
    // Within the limit but more than the balance.
    assert_argus_err(fx.instant(&owner, &dest, 11 * UNIT), ArgusError::InsufficientFunds);
    // A failed transfer must not consume allowance.
    assert_eq!(fx.vault_state().spent_in_window, 0);
}

#[test]
fn instant_rejects_destination_of_another_mint() {
    let mut fx = Fx::new(1_000 * UNIT);
    let owner = fx.owner();
    let auth = fx.env.mint_authority.pubkey();
    let other_mint = create_mint(&mut fx.env.svm, &auth, anchor_spl::token::ID);
    let ix = create_ata_ix(&owner.pubkey(), &owner.pubkey(), &other_mint);
    assert_ok(fx.env.send(&[ix], &[&owner]));
    let bad_dest = ata(&owner.pubkey(), &other_mint);
    assert_argus_err(fx.instant(&owner, &bad_dest, UNIT), ArgusError::MintMismatch);
}

/// P10: the vault ATA can't be both source and destination. Anchor 1.x's built-in
/// duplicate-mutable-account guard fires first (2040). Our `InvalidDestination`
/// constraint is the second layer, and it's the one that catches the non-mut case
/// in `request_withdrawal`.
#[test]
fn instant_rejects_vault_ata_as_destination() {
    let mut fx = Fx::new(1_000 * UNIT);
    let owner = fx.owner();
    let vault_ata = fx.vault_ata;
    assert_anchor_err(
        fx.instant(&owner, &vault_ata, UNIT),
        anchor_lang::error::ErrorCode::ConstraintDuplicateMutableAccount,
    );
    assert_eq!(fx.balance(&vault_ata), 1_000 * UNIT);
}

/// INV-10: spend accounting can't overflow into a small number.
#[test]
fn instant_spend_overflow_is_rejected() {
    let mut fx = Fx::new(1_000 * UNIT);
    fx.patch_vault(|v| {
        v.daily_limit = u64::MAX;
        v.spent_in_window = u64::MAX - 1;
    });
    let owner = fx.owner();
    let dest = fx.owner_dest;
    assert_argus_err(fx.instant(&owner, &dest, 2), ArgusError::MathOverflow);
}
