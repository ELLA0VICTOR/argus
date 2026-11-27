//! `request_withdrawal` and `execute_withdrawal`: the delayed path (INV-1c, INV-3, INV-6).
mod common;

use {
    argus::{error::ArgusError, state::Withdrawal},
    common::*,
    solana_signer::Signer,
};

#[test]
fn request_creates_pending_withdrawal() {
    let mut fx = Fx::new(1_000 * UNIT);
    let owner = fx.owner();
    let dest = fx.owner_dest;
    let (res, w) = fx.request(&owner, &dest, 500 * UNIT);
    assert_ok(res);

    let wd: Withdrawal = fx.env.fetch(&w);
    assert_eq!(wd.vault, fx.vault);
    assert_eq!(wd.id, 0);
    assert_eq!(wd.destination, dest);
    assert_eq!(wd.amount, 500 * UNIT);
    assert_eq!(wd.requested_at, START_TIME);
    assert_eq!(wd.executes_at, START_TIME + DAY);
    assert_eq!(wd.owner_epoch, 0);
    assert_eq!(wd.rent_payer, owner.pubkey());
    assert_eq!(fx.vault_state().next_withdrawal_id, 1);
    // Nothing moves at request time.
    assert_eq!(fx.balance(&fx.vault_ata.clone()), 1_000 * UNIT);
}

#[test]
fn execute_after_delay_by_any_cranker_and_refunds_rent() {
    let mut fx = Fx::new(1_000 * UNIT);
    let owner = fx.owner();
    let dest = fx.owner_dest;
    let (res, w) = fx.request(&owner, &dest, 500 * UNIT);
    assert_ok(res);
    let rent = fx.env.svm.get_account(&w).unwrap().lamports;
    let owner_lamports = fx.env.svm.get_account(&owner.pubkey()).unwrap().lamports;

    fx.env.warp(DAY);
    let cranker = fx.env.funded_keypair();
    assert_ok(fx.execute(&cranker, &w));

    assert_eq!(fx.balance(&dest), 500 * UNIT);
    assert_eq!(fx.balance(&fx.vault_ata.clone()), 500 * UNIT);
    assert!(!fx.env.exists(&w), "withdrawal is closed on execute");
    let after = fx.env.svm.get_account(&owner.pubkey()).unwrap().lamports;
    assert_eq!(after, owner_lamports + rent, "rent goes back to rent_payer");
}

/// C3: execution needs `now >= executes_at`, so one second early fails.
#[test]
fn execute_one_second_early_fails() {
    let mut fx = Fx::new(1_000 * UNIT);
    let owner = fx.owner();
    let dest = fx.owner_dest;
    let (res, w) = fx.request(&owner, &dest, 500 * UNIT);
    assert_ok(res);
    fx.env.warp(DAY - 1);
    let cranker = fx.env.funded_keypair();
    assert_argus_err(fx.execute(&cranker, &w), ArgusError::TooEarly);
    assert_eq!(fx.balance(&dest), 0);
}

/// P3: the same withdrawal can't execute twice.
#[test]
fn execute_twice_fails() {
    let mut fx = Fx::new(1_000 * UNIT);
    let owner = fx.owner();
    let dest = fx.owner_dest;
    let (res, w) = fx.request(&owner, &dest, 400 * UNIT);
    assert_ok(res);
    fx.env.warp(DAY);
    let cranker = fx.env.funded_keypair();
    let ix_dest = dest;
    assert_ok(fx.execute(&cranker, &w));
    let ix = execute_ix(&fx.vault, &fx.mint(), &cranker.pubkey(), &w, &owner.pubkey(), &ix_dest);
    assert!(fx.env.send(&[ix], &[&cranker]).is_err());
    assert_eq!(fx.balance(&dest), 400 * UNIT);
}

/// E2 / INV-12: ids are never reused after a withdrawal closes.
#[test]
fn withdrawal_ids_never_reused() {
    let mut fx = Fx::new(1_000 * UNIT);
    let owner = fx.owner();
    let dest = fx.owner_dest;
    let (res, w0) = fx.request(&owner, &dest, UNIT);
    assert_ok(res);
    fx.env.warp(DAY);
    let cranker = fx.env.funded_keypair();
    assert_ok(fx.execute(&cranker, &w0));
    let (res, w1) = fx.request(&owner, &dest, UNIT);
    assert_ok(res);
    assert_ne!(w0, w1);
    assert_eq!(fx.env.fetch::<Withdrawal>(&w1).id, 1);
}

/// INV-4: frozen blocks both request and execute.
#[test]
fn frozen_blocks_request_and_execute() {
    let mut fx = Fx::new(1_000 * UNIT);
    let owner = fx.owner();
    let dest = fx.owner_dest;
    let (res, w) = fx.request(&owner, &dest, 500 * UNIT);
    assert_ok(res);
    fx.freeze_by_guardian();

    let (res, _) = fx.request(&owner, &dest, UNIT);
    assert_argus_err(res, ArgusError::Frozen);
    fx.env.warp(DAY);
    let cranker = fx.env.funded_keypair();
    assert_argus_err(fx.execute(&cranker, &w), ArgusError::Frozen);
    assert_eq!(fx.balance(&dest), 0);
}

/// INV-6: after an owner rotation, the old key's withdrawals can't execute.
/// The epoch bump is patched in directly until `RotateOwner` lands; the
/// THREAT-MODEL test `attack_request_voided_by_rotation` will do it end to end.
#[test]
fn execute_rejects_stale_owner_epoch() {
    let mut fx = Fx::new(1_000 * UNIT);
    let owner = fx.owner();
    let dest = fx.owner_dest;
    let (res, w) = fx.request(&owner, &dest, 500 * UNIT);
    assert_ok(res);
    fx.patch_vault(|v| v.owner_epoch += 1);
    fx.env.warp(DAY);
    let cranker = fx.env.funded_keypair();
    assert_argus_err(fx.execute(&cranker, &w), ArgusError::StaleOwnerEpoch);
    assert_eq!(fx.balance(&dest), 0);
}

/// P11: request more than the balance can later cover; execution re-checks it and
/// the withdrawal stays pending.
#[test]
fn execute_rechecks_balance_and_stays_pending() {
    let mut fx = Fx::new(150 * UNIT);
    let owner = fx.owner();
    let dest = fx.owner_dest;
    let (res, w) = fx.request(&owner, &dest, 150 * UNIT);
    assert_ok(res);
    assert_ok(fx.instant(&owner, &dest, 100 * UNIT)); // balance is now 50
    fx.env.warp(DAY);
    let cranker = fx.env.funded_keypair();
    assert_argus_err(fx.execute(&cranker, &w), ArgusError::InsufficientFunds);
    assert!(fx.env.exists(&w), "failed execution leaves the withdrawal pending");
}

#[test]
fn request_rejects_guardian_ai_and_stranger() {
    let mut fx = Fx::new(1_000 * UNIT);
    let dest = fx.owner_dest;
    let g = fx.guardians[1].insecure_clone();
    let ai = fx.ai.insecure_clone();
    let stranger = fx.env.funded_keypair();
    let (res, _) = fx.request(&g, &dest, UNIT);
    assert_argus_err(res, ArgusError::NotOwner);
    let (res, _) = fx.request(&ai, &dest, UNIT);
    assert_argus_err(res, ArgusError::NotOwner); // INV-5
    let (res, _) = fx.request(&stranger, &dest, UNIT);
    assert_argus_err(res, ArgusError::NotOwner);
}

#[test]
fn request_rejects_zero_overdraw_bad_mint_and_vault_ata() {
    let mut fx = Fx::new(100 * UNIT);
    let owner = fx.owner();
    let dest = fx.owner_dest;
    let (res, _) = fx.request(&owner, &dest, 0);
    assert_argus_err(res, ArgusError::InvalidAmount);
    let (res, _) = fx.request(&owner, &dest, 100 * UNIT + 1);
    assert_argus_err(res, ArgusError::InsufficientFunds);

    let auth = fx.env.mint_authority.pubkey();
    let other_mint = create_mint(&mut fx.env.svm, &auth, anchor_spl::token::ID);
    let ix = create_ata_ix(&owner.pubkey(), &owner.pubkey(), &other_mint);
    assert_ok(fx.env.send(&[ix], &[&owner]));
    let (res, _) = fx.request(&owner, &ata(&owner.pubkey(), &other_mint), UNIT);
    assert_argus_err(res, ArgusError::MintMismatch);

    let vault_ata = fx.vault_ata;
    let (res, _) = fx.request(&owner, &vault_ata, UNIT);
    assert_argus_err(res, ArgusError::InvalidDestination);
    assert_eq!(fx.vault_state().next_withdrawal_id, 0, "failed requests don't consume ids");
}

/// The cranker can't redirect funds by passing a different destination account.
#[test]
fn execute_rejects_substituted_destination() {
    let mut fx = Fx::new(1_000 * UNIT);
    let owner = fx.owner();
    let dest = fx.owner_dest;
    let (res, w) = fx.request(&owner, &dest, 500 * UNIT);
    assert_ok(res);
    fx.env.warp(DAY);
    let cranker = fx.env.funded_keypair();
    let thief_dest = fx.token_account_for(&cranker.pubkey());
    let ix = execute_ix(&fx.vault, &fx.mint(), &cranker.pubkey(), &w, &owner.pubkey(), &thief_dest);
    assert!(fx.env.send(&[ix], &[&cranker]).is_err());
    assert_eq!(fx.balance(&thief_dest), 0);
}

/// The cranker can't steal the rent refund.
#[test]
fn execute_rejects_substituted_rent_payer() {
    let mut fx = Fx::new(1_000 * UNIT);
    let owner = fx.owner();
    let dest = fx.owner_dest;
    let (res, w) = fx.request(&owner, &dest, 500 * UNIT);
    assert_ok(res);
    fx.env.warp(DAY);
    let cranker = fx.env.funded_keypair();
    let ix = execute_ix(&fx.vault, &fx.mint(), &cranker.pubkey(), &w, &cranker.pubkey(), &dest);
    assert!(fx.env.send(&[ix], &[&cranker]).is_err());
    assert!(fx.env.exists(&w));
}

/// P1: a withdrawal from vault A can't be executed against vault B's funds.
#[test]
fn execute_rejects_withdrawal_of_another_vault() {
    let mut fx = Fx::new(1_000 * UNIT);
    let owner = fx.owner();
    let dest = fx.owner_dest;
    let (res, w) = fx.request(&owner, &dest, 500 * UNIT);
    assert_ok(res);

    // A second vault by the same owner, also funded.
    let mut p2 = fx.params.clone();
    p2.vault_id = 7;
    let ix = init_vault_ix(&owner.pubkey(), &fx.mint(), &p2);
    assert_ok(fx.env.send(&[ix], &[&owner]));
    let vault2 = vault_pda(&owner.pubkey(), 7);
    let vault2_ata = ata(&vault2, &fx.mint());
    fx.mint_to(&vault2_ata, 1_000 * UNIT);

    fx.env.warp(DAY);
    let cranker = fx.env.funded_keypair();
    let ix = execute_ix(&vault2, &fx.mint(), &cranker.pubkey(), &w, &owner.pubkey(), &dest);
    assert!(fx.env.send(&[ix], &[&cranker]).is_err());
    assert_eq!(fx.balance(&vault2_ata), 1_000 * UNIT);
}

/// A1, first half: the thief's request of everything just sits pending through
/// the delay. Cancelling comes with `cancel_withdrawal`.
#[test]
fn attack_owner_request_waits_full_delay() {
    let mut fx = Fx::new(1_000 * UNIT);
    let thief = fx.owner(); // attacker holds the owner key
    let thief_wallet = solana_keypair::Keypair::new().pubkey();
    let thief_dest = fx.token_account_for(&thief_wallet);
    let (res, w) = fx.request(&thief, &thief_dest, 1_000 * UNIT);
    assert_ok(res);
    let cranker = fx.env.funded_keypair();
    // Probe at +1 s, +12 h and +24 h - 1 s: always too early.
    for target in [1, DAY / 2, DAY - 1] {
        let now = fx.env.now() - START_TIME;
        fx.env.warp(target - now);
        assert_argus_err(fx.execute(&cranker, &w), ArgusError::TooEarly);
    }
    assert_eq!(fx.balance(&thief_dest), 0);
    assert_eq!(fx.balance(&fx.vault_ata.clone()), 1_000 * UNIT);
}
