//! Protective actions: `cancel_withdrawal`, `freeze`, `emergency_sweep`.
//! One signature is enough for each (CONTEXT decision 4). The AI can only
//! cancel and freeze (INV-5).
mod common;

use {
    anchor_lang::prelude::Pubkey,
    argus::error::ArgusError,
    common::*,
    solana_keypair::Keypair,
    solana_signer::Signer,
};

fn pending(fx: &mut Fx, amount: u64) -> Pubkey {
    let owner = fx.owner();
    let dest = fx.owner_dest;
    let (res, w) = fx.request(&owner, &dest, amount);
    assert_ok(res);
    w
}

// ---------------- cancel_withdrawal ----------------

/// A1: the thief requests everything, the AI cancels after the phone call, and nothing can execute.
#[test]
fn attack_owner_request_then_cancel() {
    let mut fx = Fx::new(1_000 * UNIT);
    let thief = fx.owner();
    let thief_dest = fx.token_account_for(&Keypair::new().pubkey());
    let (res, w) = fx.request(&thief, &thief_dest, 1_000 * UNIT);
    assert_ok(res);

    let ai = fx.ai.insecure_clone();
    assert_ok(fx.cancel(&ai, &w));
    assert!(!fx.env.exists(&w));

    fx.env.warp(DAY);
    let cranker = fx.env.funded_keypair();
    let ix = execute_ix(&fx.vault, &fx.mint(), &cranker.pubkey(), &w, &thief.pubkey(), &thief_dest);
    assert!(fx.env.send(&[ix], &[&cranker]).is_err());
    assert_eq!(fx.balance(&thief_dest), 0);
    assert_eq!(fx.balance(&fx.vault_ata.clone()), 1_000 * UNIT);
}

#[test]
fn cancel_by_owner_refunds_rent_to_rent_payer() {
    let mut fx = Fx::new(1_000 * UNIT);
    let w = pending(&mut fx, 10 * UNIT);
    let owner = fx.owner();
    let rent = fx.env.svm.get_account(&w).unwrap().lamports;
    let before = fx.env.svm.get_account(&owner.pubkey()).unwrap().lamports;
    assert_ok(fx.cancel(&owner, &w));
    let after = fx.env.svm.get_account(&owner.pubkey()).unwrap().lamports;
    // The owner also paid the tx fee (5000 lamports), so net = rent - fee.
    assert_eq!(after, before + rent - 5_000);
    assert!(!fx.env.exists(&w));
}

#[test]
fn cancel_by_every_guardian() {
    let mut fx = Fx::new(1_000 * UNIT);
    for i in 0..3 {
        let w = pending(&mut fx, UNIT);
        let g = fx.guardians[i].insecure_clone();
        assert_ok(fx.cancel(&g, &w));
        assert!(!fx.env.exists(&w));
    }
}

#[test]
fn cancel_rejects_stranger_and_safe_wallet() {
    let mut fx = Fx::new(1_000 * UNIT);
    let w = pending(&mut fx, UNIT);
    let stranger = fx.env.funded_keypair();
    assert_argus_err(fx.cancel(&stranger, &w), ArgusError::NotAuthorizedRole);
    let safe = fx.safe.insecure_clone();
    fx.env.svm.airdrop(&safe.pubkey(), 1_000_000_000).unwrap();
    assert_argus_err(fx.cancel(&safe, &w), ArgusError::NotAuthorizedRole);
    assert!(fx.env.exists(&w));
}

#[test]
fn cancel_allowed_while_frozen() {
    let mut fx = Fx::new(1_000 * UNIT);
    let w = pending(&mut fx, UNIT);
    fx.freeze_by_guardian();
    let ai = fx.ai.insecure_clone();
    assert_ok(fx.cancel(&ai, &w));
}

#[test]
fn cancel_twice_fails() {
    let mut fx = Fx::new(1_000 * UNIT);
    let w = pending(&mut fx, UNIT);
    let owner = fx.owner();
    assert_ok(fx.cancel(&owner, &w));
    let ix = cancel_ix(&fx.vault, &owner.pubkey(), &w, &owner.pubkey());
    assert!(fx.env.send(&[ix], &[&owner]).is_err());
}

/// The canceller can't redirect the rent refund to themselves.
#[test]
fn cancel_rejects_substituted_rent_payer() {
    let mut fx = Fx::new(1_000 * UNIT);
    let w = pending(&mut fx, UNIT);
    let ai = fx.ai.insecure_clone();
    let ix = cancel_ix(&fx.vault, &ai.pubkey(), &w, &ai.pubkey());
    assert!(fx.env.send(&[ix], &[&ai]).is_err());
    assert!(fx.env.exists(&w));
}

/// A guardian of vault B can't cancel vault A's withdrawal by passing vault B.
#[test]
fn cancel_rejects_withdrawal_of_another_vault() {
    let mut fx = Fx::new(1_000 * UNIT);
    let w = pending(&mut fx, UNIT);
    // A different creator's vault, where the attacker is a guardian.
    let other_creator = fx.env.funded_keypair();
    let attacker = fx.env.funded_keypair();
    let p = InitParams::new(vec![attacker.pubkey()], 1, Pubkey::default(), Keypair::new().pubkey());
    let ix = init_vault_ix(&other_creator.pubkey(), &fx.mint(), &p);
    assert_ok(fx.env.send(&[ix], &[&other_creator]));
    let other_vault = vault_pda(&other_creator.pubkey(), 0);

    let owner = fx.owner();
    let ix = cancel_ix(&other_vault, &attacker.pubkey(), &w, &owner.pubkey());
    assert!(fx.env.send(&[ix], &[&attacker]).is_err());
    assert!(fx.env.exists(&w));
}

// ---------------- freeze ----------------

#[test]
fn freeze_by_owner_guardian_or_ai() {
    for who in 0..3 {
        let mut fx = Fx::new(1_000 * UNIT);
        let signer = match who {
            0 => fx.owner(),
            1 => fx.guardians[2].insecure_clone(),
            _ => fx.ai.insecure_clone(),
        };
        assert_ok(fx.freeze(&signer));
        assert!(fx.vault_state().frozen);
    }
}

#[test]
fn freeze_rejects_stranger() {
    let mut fx = Fx::new(1_000 * UNIT);
    let stranger = fx.env.funded_keypair();
    assert_argus_err(fx.freeze(&stranger), ArgusError::NotAuthorizedRole);
    assert!(!fx.vault_state().frozen);
}

#[test]
fn freeze_is_idempotent() {
    let mut fx = Fx::new(1_000 * UNIT);
    let ai = fx.ai.insecure_clone();
    assert_ok(fx.freeze(&ai));
    fx.freeze_by_guardian();
    assert!(fx.vault_state().frozen);
}

/// INV-4 with a real freeze: every outbound path except the sweep is blocked.
#[test]
fn frozen_blocks_all_outflows_except_sweep() {
    let mut fx = Fx::new(1_000 * UNIT);
    let w = pending(&mut fx, 100 * UNIT);
    let trusted_wallet = Keypair::new().pubkey();
    fx.set_trusted(&trusted_wallet, START_TIME);
    let trusted_dest = fx.token_account_for(&trusted_wallet);
    let ai = fx.ai.insecure_clone();
    assert_ok(fx.freeze(&ai));

    let owner = fx.owner();
    let dest = fx.owner_dest;
    assert_argus_err(fx.instant(&owner, &dest, UNIT), ArgusError::Frozen);
    assert_argus_err(fx.trusted(&owner, &trusted_dest, UNIT), ArgusError::Frozen);
    let (res, _) = fx.request(&owner, &dest, UNIT);
    assert_argus_err(res, ArgusError::Frozen);
    fx.env.warp(DAY);
    let cranker = fx.env.funded_keypair();
    assert_argus_err(fx.execute(&cranker, &w), ArgusError::Frozen);
    assert_eq!(fx.balance(&fx.vault_ata.clone()), 1_000 * UNIT);

    let g = fx.guardians[1].insecure_clone();
    assert_ok(fx.sweep(&g, false));
    assert_eq!(fx.balance(&fx.safe_ata()), 1_000 * UNIT);
}

// ---------------- emergency_sweep ----------------

/// The safe ATA doesn't exist yet. The sweep creates it, moves everything and freezes.
#[test]
fn sweep_moves_everything_to_safe_and_freezes() {
    let mut fx = Fx::new(1_000 * UNIT);
    let safe_ata = fx.safe_ata();
    assert!(!fx.env.exists(&safe_ata));
    let g = fx.guardians[0].insecure_clone();
    assert_ok(fx.sweep(&g, true));

    assert_eq!(fx.balance(&fx.vault_ata.clone()), 0);
    let t = fx.env.token_account(&safe_ata);
    assert_eq!(t.amount, 1_000 * UNIT);
    assert_eq!(t.owner, fx.safe.pubkey(), "INV-9: the safe ATA is owned by safe_address");
    assert!(fx.vault_state().frozen);
}

#[test]
fn sweep_without_freeze_leaves_vault_unfrozen() {
    let mut fx = Fx::new(1_000 * UNIT);
    let g = fx.guardians[0].insecure_clone();
    assert_ok(fx.sweep(&g, false));
    assert!(!fx.vault_state().frozen);
}

/// A sweep never unfreezes: freeze=false on a frozen vault keeps it frozen.
#[test]
fn sweep_never_unfreezes() {
    let mut fx = Fx::new(1_000 * UNIT);
    fx.freeze_by_guardian();
    let g = fx.guardians[2].insecure_clone();
    assert_ok(fx.sweep(&g, false));
    assert!(fx.vault_state().frozen);
}

#[test]
fn sweep_works_when_safe_ata_already_exists() {
    let mut fx = Fx::new(1_000 * UNIT);
    let safe = fx.safe.pubkey();
    let safe_ata = fx.token_account_for(&safe);
    fx.mint_to(&safe_ata, 5 * UNIT);
    let g = fx.guardians[0].insecure_clone();
    assert_ok(fx.sweep(&g, true));
    assert_eq!(fx.balance(&safe_ata), 1_005 * UNIT);
}

/// INV-5 and audit B3: only guardians can sweep, not the owner, the AI or anyone else.
#[test]
fn sweep_rejects_owner_ai_and_stranger() {
    let mut fx = Fx::new(1_000 * UNIT);
    let owner = fx.owner();
    let ai = fx.ai.insecure_clone();
    let stranger = fx.env.funded_keypair();
    assert_argus_err(fx.sweep(&owner, true), ArgusError::NotGuardian);
    assert_argus_err(fx.sweep(&ai, true), ArgusError::NotGuardian);
    assert_argus_err(fx.sweep(&stranger, true), ArgusError::NotGuardian);
    assert_eq!(fx.balance(&fx.vault_ata.clone()), 1_000 * UNIT);
}

/// G2: a rogue guardian can't redirect the sweep to their own token account.
#[test]
fn sweep_rejects_substituted_safe_token_account() {
    let mut fx = Fx::new(1_000 * UNIT);
    let rogue = fx.guardians[0].insecure_clone();
    let rogue_ata = fx.token_account_for(&rogue.pubkey());
    let safe = fx.safe.pubkey();
    let ix = sweep_ix_with(&fx.vault, &fx.mint(), &rogue.pubkey(), &safe, &rogue_ata, true);
    assert_argus_err(fx.env.send(&[ix], &[&rogue]), ArgusError::InvalidSafeAddress);
    assert_eq!(fx.balance(&rogue_ata), 0);
}

/// G2: or by naming themselves as the safe wallet.
#[test]
fn sweep_rejects_substituted_safe_wallet() {
    let mut fx = Fx::new(1_000 * UNIT);
    let rogue = fx.guardians[0].insecure_clone();
    let ix = sweep_ix(&fx.vault, &fx.mint(), &rogue.pubkey(), &rogue.pubkey(), true);
    assert_argus_err(fx.env.send(&[ix], &[&rogue]), ArgusError::InvalidSafeAddress);
    assert_eq!(fx.balance(&fx.vault_ata.clone()), 1_000 * UNIT);
}

/// The safe address may be a guardian's own wallet, and that guardian can sweep to it.
/// Same key as signer and as `safe_wallet`.
#[test]
fn sweep_when_safe_address_is_the_sweeping_guardian() {
    let mut env = Env::new();
    let g = env.funded_keypair();
    let p = InitParams::new(vec![g.pubkey()], 1, Pubkey::default(), g.pubkey());
    let owner = env.owner.insecure_clone();
    assert_ok(env.send(&[init_vault_ix(&owner.pubkey(), &env.mint, &p)], &[&owner]));
    let vault = vault_pda(&owner.pubkey(), 0);
    let auth = env.mint_authority.insecure_clone();
    let ix = mint_to_ix(&env.mint, &ata(&vault, &env.mint), &auth.pubkey(), 9 * UNIT);
    assert_ok(env.send(&[ix], &[&owner, &auth]));

    let ix = sweep_ix(&vault, &env.mint, &g.pubkey(), &g.pubkey(), true);
    assert_ok(env.send(&[ix], &[&g]));
    assert_eq!(env.token_account(&ata(&g.pubkey(), &env.mint)).amount, 9 * UNIT);
}

/// The owner can crank their own matured withdrawal (cranker = rent_payer).
#[test]
fn owner_can_execute_own_withdrawal() {
    let mut fx = Fx::new(1_000 * UNIT);
    let w = pending(&mut fx, 10 * UNIT);
    fx.env.warp(DAY);
    let owner = fx.owner();
    assert_ok(fx.execute(&owner, &w));
    assert_eq!(fx.balance(&fx.owner_dest.clone()), 10 * UNIT);
}

#[test]
fn sweep_of_empty_vault_fails() {
    let mut fx = Fx::new(0);
    let g = fx.guardians[0].insecure_clone();
    assert_argus_err(fx.sweep(&g, true), ArgusError::InvalidAmount);
}

/// INV-1: across a mixed sequence, funds leave only by the four allowed paths, and
/// the total of vault + destinations is conserved.
#[test]
fn inv1_balances_conserved_across_all_paths() {
    let mut fx = Fx::new(1_000 * UNIT);
    let owner = fx.owner();
    let dest = fx.owner_dest;
    let tw = Keypair::new().pubkey();
    fx.set_trusted(&tw, START_TIME);
    let tdest = fx.token_account_for(&tw);

    assert_ok(fx.instant(&owner, &dest, 50 * UNIT)); // (a)
    assert_ok(fx.trusted(&owner, &tdest, 200 * UNIT)); // (b)
    let w = pending(&mut fx, 300 * UNIT);
    fx.env.warp(DAY);
    let cranker = fx.env.funded_keypair();
    assert_ok(fx.execute(&cranker, &w)); // (c)
    let g = fx.guardians[0].insecure_clone();
    assert_ok(fx.sweep(&g, true)); // (d)

    let total = fx.balance(&fx.vault_ata.clone())
        + fx.balance(&dest)
        + fx.balance(&tdest)
        + fx.balance(&fx.safe_ata());
    assert_eq!(total, 1_000 * UNIT);
    assert_eq!(fx.balance(&dest), 350 * UNIT);
    assert_eq!(fx.balance(&tdest), 200 * UNIT);
    assert_eq!(fx.balance(&fx.safe_ata()), 450 * UNIT);
}
