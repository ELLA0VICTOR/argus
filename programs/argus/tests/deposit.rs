//! `deposit`: anyone can add funds, including while frozen.
mod common;

use {argus::error::ArgusError, common::*, solana_keypair::Keypair, solana_signer::Signer};

#[test]
fn deposit_by_anyone_moves_tokens_into_vault() {
    let mut fx = Fx::new(0);
    let friend = fx.env.funded_keypair();
    let src = fx.token_account_for(&friend.pubkey());
    fx.mint_to(&src, 50 * UNIT);

    assert_ok(fx.deposit(&friend, &src, 30 * UNIT));
    assert_eq!(fx.balance(&fx.vault_ata.clone()), 30 * UNIT);
    assert_eq!(fx.balance(&src), 20 * UNIT);
}

#[test]
fn deposit_allowed_while_frozen() {
    let mut fx = Fx::new(0);
    fx.freeze_by_guardian();
    let owner = fx.owner();
    let src = fx.token_account_for(&owner.pubkey());
    fx.mint_to(&src, 5 * UNIT);
    assert_ok(fx.deposit(&owner, &src, 5 * UNIT));
    assert_eq!(fx.balance(&fx.vault_ata.clone()), 5 * UNIT);
}

#[test]
fn deposit_rejects_zero() {
    let mut fx = Fx::new(0);
    let owner = fx.owner();
    let src = fx.token_account_for(&owner.pubkey());
    fx.mint_to(&src, UNIT);
    assert_argus_err(fx.deposit(&owner, &src, 0), ArgusError::InvalidAmount);
}

#[test]
fn deposit_rejects_source_of_another_mint() {
    let mut fx = Fx::new(0);
    let owner = fx.owner();
    let auth = fx.env.mint_authority.pubkey();
    let other_mint = create_mint(&mut fx.env.svm, &auth, anchor_spl::token::ID);
    let ix = create_ata_ix(&owner.pubkey(), &owner.pubkey(), &other_mint);
    assert_ok(fx.env.send(&[ix], &[&owner]));
    let src = ata(&owner.pubkey(), &other_mint);
    assert_argus_err(fx.deposit(&owner, &src, UNIT), ArgusError::MintMismatch);
}

#[test]
fn deposit_cannot_spend_someone_elses_tokens() {
    let mut fx = Fx::new(0);
    let victim = Keypair::new();
    let src = fx.token_account_for(&victim.pubkey());
    fx.mint_to(&src, 10 * UNIT);
    let thief = fx.env.funded_keypair();
    // The token program rejects a transfer the thief isn't authorized for.
    assert!(fx.deposit(&thief, &src, 10 * UNIT).is_err());
    assert_eq!(fx.balance(&src), 10 * UNIT);
}
