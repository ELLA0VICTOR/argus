//! CR-XFER-2: when the token CPI itself fails (not our pre-checks), every state
//! change made earlier in the instruction must roll back.
//!
//! Setup: give the test mint a freeze authority, then SPL-freeze the destination
//! token account, so `transfer_checked` fails inside the token program.
mod common;

use {argus::Withdrawal, common::*, solana_signer::Signer};

fn freeze_token_account(fx: &mut Fx, account: &anchor_lang::prelude::Pubkey) {
    let auth = fx.env.mint_authority.insecure_clone();
    let mint = fx.mint();
    give_mint_freeze_authority(&mut fx.env.svm, &mint, &auth.pubkey());
    let ix = spl_freeze_ix(account, &mint, &auth.pubkey());
    let payer = fx.owner();
    assert_ok(fx.env.send(&[ix], &[&payer, &auth]));
}

/// The window roll and the spend are written *before* the CPI. A failing CPI must undo both.
#[test]
fn instant_cpi_failure_rolls_back_window_and_spend() {
    let mut fx = Fx::new(1_000 * UNIT);
    let owner = fx.owner();
    let dest = fx.owner_dest;
    assert_ok(fx.instant(&owner, &dest, 30 * UNIT));
    fx.env.warp(DAY); // the next call would roll the window

    freeze_token_account(&mut fx, &dest);
    let before = fx.vault_state();
    let res = fx.instant(&owner, &dest, 10 * UNIT);
    assert!(res.is_err(), "transfer into a frozen token account must fail");

    let after = fx.vault_state();
    assert_eq!(after.window_start, before.window_start, "window roll rolled back");
    assert_eq!(after.spent_in_window, before.spent_in_window, "spend rolled back");
    assert_eq!(after.spent_in_window, 30 * UNIT);
    assert_eq!(fx.balance(&fx.vault_ata.clone()), 970 * UNIT);
    assert_eq!(fx.balance(&dest), 30 * UNIT);
}

/// A failing CPI on execute leaves the withdrawal pending, and its rent is not refunded.
#[test]
fn execute_cpi_failure_keeps_withdrawal_pending_and_rent_in_place() {
    let mut fx = Fx::new(1_000 * UNIT);
    let owner = fx.owner();
    let dest = fx.owner_dest;
    let (res, w) = fx.request(&owner, &dest, 400 * UNIT);
    assert_ok(res);
    fx.env.warp(DAY);
    freeze_token_account(&mut fx, &dest);

    let rent_before = fx.env.svm.get_account(&w).unwrap().lamports;
    // The owner is the rent recipient. A separate cranker pays the fee, so owner
    // lamports are comparable.
    let owner_before = fx.env.svm.get_account(&owner.pubkey()).unwrap().lamports;
    let cranker = fx.env.funded_keypair();
    assert!(fx.execute(&cranker, &w).is_err());

    assert!(fx.env.exists(&w), "withdrawal still pending");
    assert_eq!(fx.env.svm.get_account(&w).unwrap().lamports, rent_before);
    assert_eq!(
        fx.env.svm.get_account(&owner.pubkey()).unwrap().lamports,
        owner_before,
        "rent not refunded"
    );
    let wd: Withdrawal = fx.env.fetch(&w);
    assert_eq!(wd.amount, 400 * UNIT);
    assert_eq!(fx.balance(&fx.vault_ata.clone()), 1_000 * UNIT);

    // And it can still be cancelled afterwards.
    let g = fx.guardians[0].insecure_clone();
    assert_ok(fx.cancel(&g, &w));
}
