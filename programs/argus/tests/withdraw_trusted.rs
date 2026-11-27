//! `withdraw_trusted`: sends to active trusted wallets only (THREAT A6, audit A7).
//!
//! Trusted records are written directly here. End-to-end tests through an
//! executed `AddTrusted` proposal come with governance.
mod common;

use {
    anchor_lang::prelude::Pubkey, argus::error::ArgusError, common::*, solana_keypair::Keypair,
    solana_signer::Signer,
};

fn trusted_wallet(fx: &mut Fx, active_at: i64) -> (Pubkey, Pubkey) {
    let wallet = Keypair::new().pubkey();
    fx.set_trusted(&wallet, active_at);
    let dest = fx.token_account_for(&wallet);
    (wallet, dest)
}

/// A6: sending everything to a trusted address isn't theft, because it's the user's own wallet.
#[test]
fn trusted_send_goes_to_owner_address() {
    let mut fx = Fx::new(1_000 * UNIT);
    let (_, dest) = trusted_wallet(&mut fx, START_TIME);
    let owner = fx.owner();
    // Far above the 100-token daily limit, and no delay.
    assert_ok(fx.trusted(&owner, &dest, 1_000 * UNIT));
    assert_eq!(fx.balance(&dest), 1_000 * UNIT);
    assert_eq!(fx.vault_state().spent_in_window, 0, "trusted sends don't use allowance");
}

#[test]
fn trusted_rejects_untrusted_destination() {
    let mut fx = Fx::new(1_000 * UNIT);
    let owner = fx.owner();
    let dest = fx.owner_dest;
    assert_argus_err(fx.trusted(&owner, &dest, UNIT), ArgusError::NotTrusted);
}

#[test]
fn trusted_rejects_until_active_at() {
    let mut fx = Fx::new(1_000 * UNIT);
    let (_, dest) = trusted_wallet(&mut fx, START_TIME + 100);
    let owner = fx.owner();
    assert_argus_err(fx.trusted(&owner, &dest, UNIT), ArgusError::TrustedNotActive);
    fx.env.warp(99);
    assert_argus_err(fx.trusted(&owner, &dest, UNIT), ArgusError::TrustedNotActive);
    fx.env.warp(1);
    assert_ok(fx.trusted(&owner, &dest, UNIT));
}

/// A trusted record for wallet X must not authorize sending to wallet Y,
/// even if the attacker passes X's record explicitly.
#[test]
fn trusted_record_of_other_wallet_is_rejected() {
    let mut fx = Fx::new(1_000 * UNIT);
    let (trusted, _) = trusted_wallet(&mut fx, START_TIME);
    let owner = fx.owner();
    let attacker_dest = fx.owner_dest;
    let mut ix = trusted_ix(&fx.vault, &fx.mint(), &owner.pubkey(), &attacker_dest, &trusted, UNIT);
    // Account 6 is `trusted`. It's X's real record, but the seeds are derived from the destination owner.
    ix.accounts[6].pubkey = trusted_pda(&fx.vault, &trusted);
    assert!(fx.env.send(&[ix], &[&owner]).is_err());
    assert_eq!(fx.balance(&attacker_dest), 0);
}

/// A record created for another vault can't be reused here (seeds include the vault).
#[test]
fn trusted_record_of_other_vault_is_rejected() {
    let mut fx = Fx::new(1_000 * UNIT);
    let wallet = Keypair::new().pubkey();
    let other_vault = vault_pda(&Keypair::new().pubkey(), 0);
    let fake = trusted_pda(&other_vault, &wallet);
    write_program_account(
        &mut fx.env.svm,
        fake,
        &argus::state::TrustedAddress { vault: other_vault, wallet, active_at: 0, bump: 255 },
    );
    let dest = fx.token_account_for(&wallet);
    let owner = fx.owner();
    let mut ix = trusted_ix(&fx.vault, &fx.mint(), &owner.pubkey(), &dest, &wallet, UNIT);
    ix.accounts[6].pubkey = fake;
    assert!(fx.env.send(&[ix], &[&owner]).is_err());
    assert_eq!(fx.balance(&dest), 0);
}

/// A program-owned account at the right address but of the wrong type is not a trust record.
#[test]
fn trusted_rejects_wrong_account_type_at_trusted_address() {
    let mut fx = Fx::new(1_000 * UNIT);
    let wallet = Keypair::new().pubkey();
    let addr = trusted_pda(&fx.vault, &wallet);
    let v = fx.vault_state();
    write_program_account(&mut fx.env.svm, addr, &v); // a Vault, not a TrustedAddress
    let dest = fx.token_account_for(&wallet);
    let owner = fx.owner();
    assert_argus_err(fx.trusted(&owner, &dest, UNIT), ArgusError::NotTrusted);
}

// ---- CR-XFER-1: body checks on a record at the *canonical* trusted PDA ----

fn assert_rejected_at_canonical_pda(fx: &mut Fx, wallet: Pubkey, dest: Pubkey) {
    let owner = fx.owner();
    assert_argus_err(fx.trusted(&owner, &dest, UNIT), ArgusError::NotTrusted);
    assert_eq!(fx.balance(&dest), 0);
    assert_eq!(fx.balance(&fx.vault_ata.clone()), 1_000 * UNIT);
    let _ = wallet;
}

fn valid_record_bytes(vault: Pubkey, wallet: Pubkey) -> Vec<u8> {
    let mut data = Vec::new();
    anchor_lang::AccountSerialize::try_serialize(
        &argus::state::TrustedAddress { vault, wallet, active_at: 0, bump: 255 },
        &mut data,
    )
    .unwrap();
    data
}

#[test]
fn trusted_rejects_canonical_pda_with_foreign_owner() {
    let mut fx = Fx::new(1_000 * UNIT);
    let wallet = Keypair::new().pubkey();
    let addr = trusted_pda(&fx.vault, &wallet);
    let bytes = valid_record_bytes(fx.vault, wallet);
    // Perfect TrustedAddress bytes, but owned by the system program, not Argus.
    write_raw_account(&mut fx.env.svm, addr, anchor_lang::system_program::ID, bytes);
    let dest = fx.token_account_for(&wallet);
    assert_rejected_at_canonical_pda(&mut fx, wallet, dest);
}

#[test]
fn trusted_rejects_canonical_pda_with_truncated_data() {
    let mut fx = Fx::new(1_000 * UNIT);
    let wallet = Keypair::new().pubkey();
    let addr = trusted_pda(&fx.vault, &wallet);
    let mut bytes = valid_record_bytes(fx.vault, wallet);
    bytes.truncate(20); // discriminator + part of `vault`
    write_raw_account(&mut fx.env.svm, addr, argus::id(), bytes);
    let dest = fx.token_account_for(&wallet);
    assert_rejected_at_canonical_pda(&mut fx, wallet, dest);
}

#[test]
fn trusted_rejects_canonical_pda_with_mismatched_vault_field() {
    let mut fx = Fx::new(1_000 * UNIT);
    let wallet = Keypair::new().pubkey();
    let addr = trusted_pda(&fx.vault, &wallet);
    let other_vault = Keypair::new().pubkey();
    write_raw_account(&mut fx.env.svm, addr, argus::id(), valid_record_bytes(other_vault, wallet));
    let dest = fx.token_account_for(&wallet);
    assert_rejected_at_canonical_pda(&mut fx, wallet, dest);
}

#[test]
fn trusted_rejects_canonical_pda_with_mismatched_wallet_field() {
    let mut fx = Fx::new(1_000 * UNIT);
    let wallet = Keypair::new().pubkey();
    let addr = trusted_pda(&fx.vault, &wallet);
    let other_wallet = Keypair::new().pubkey();
    write_raw_account(&mut fx.env.svm, addr, argus::id(), valid_record_bytes(fx.vault, other_wallet));
    let dest = fx.token_account_for(&wallet);
    assert_rejected_at_canonical_pda(&mut fx, wallet, dest);
}

#[test]
fn trusted_rejects_non_owner_and_frozen() {
    let mut fx = Fx::new(1_000 * UNIT);
    let (_, dest) = trusted_wallet(&mut fx, START_TIME);
    let g = fx.guardians[0].insecure_clone();
    let ai = fx.ai.insecure_clone();
    assert_argus_err(fx.trusted(&g, &dest, UNIT), ArgusError::NotOwner);
    assert_argus_err(fx.trusted(&ai, &dest, UNIT), ArgusError::NotOwner);
    fx.freeze_by_guardian();
    let owner = fx.owner();
    assert_argus_err(fx.trusted(&owner, &dest, UNIT), ArgusError::Frozen);
}

#[test]
fn trusted_rejects_overdraw() {
    let mut fx = Fx::new(10 * UNIT);
    let (_, dest) = trusted_wallet(&mut fx, START_TIME);
    let owner = fx.owner();
    assert_argus_err(fx.trusted(&owner, &dest, 11 * UNIT), ArgusError::InsufficientFunds);
}
