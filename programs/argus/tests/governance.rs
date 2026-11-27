//! Governance: propose / approve / veto / execute_proposal and every GovAction.
//! Fixture: 2-of-3 guardians, 24h delay, 100-token daily limit.
mod common;

use {
    anchor_lang::prelude::Pubkey,
    argus::{error::ArgusError, GovAction, Proposal},
    common::*,
    solana_keypair::Keypair,
    solana_signer::Signer,
};

fn g(fx: &Fx, i: usize) -> Keypair {
    fx.guardians[i].insecure_clone()
}

fn executor(fx: &mut Fx) -> Keypair {
    fx.env.funded_keypair()
}

// ===================== INV-2: the owner alone changes nothing =====================

/// A2: the owner can't add their own (thief's) address as trusted.
#[test]
fn attack_owner_cannot_add_trusted() {
    let mut fx = Fx::new(1_000 * UNIT);
    let owner = fx.owner();
    let (res, _) = fx.propose(&owner, GovAction::AddTrusted { wallet: Keypair::new().pubkey() });
    assert_argus_err(res, ArgusError::NotGuardian);
}

/// A3: the owner can't raise the limit or shorten the delay.
#[test]
fn attack_owner_cannot_loosen() {
    let mut fx = Fx::new(1_000 * UNIT);
    let owner = fx.owner();
    let (res, _) = fx.propose(&owner, GovAction::LoosenLimits { daily_limit: u64::MAX, delay_seconds: 60 });
    assert_argus_err(res, ArgusError::NotGuardian);
    let v = fx.vault_state();
    assert_eq!(v.delay_seconds, DAY);
}

/// A4: the owner can't rotate the owner to themselves or anyone else.
#[test]
fn attack_owner_cannot_rotate() {
    let mut fx = Fx::new(1_000 * UNIT);
    let owner = fx.owner();
    let (res, _) = fx.propose(&owner, GovAction::RotateOwner { new_owner: Keypair::new().pubkey() });
    assert_argus_err(res, ArgusError::NotGuardian);
}

/// A4: nor change the guardians, the AI key or the safe address.
#[test]
fn attack_owner_cannot_set_guardians() {
    let mut fx = Fx::new(1_000 * UNIT);
    let owner = fx.owner();
    let thief_keys: Vec<Pubkey> = (0..3).map(|_| Keypair::new().pubkey()).collect();
    for action in [
        GovAction::SetGuardians { guardians: thief_keys.clone(), threshold: 1 },
        GovAction::SetAiGuardian { key: Pubkey::default() },
        GovAction::SetSafeAddress { wallet: thief_keys[0] },
    ] {
        let (res, _) = fx.propose(&owner, action);
        assert_argus_err(res, ArgusError::NotGuardian);
    }
}

/// A10: after a guardian freezes, the owner can't unfreeze.
#[test]
fn attack_owner_cannot_unfreeze() {
    let mut fx = Fx::new(1_000 * UNIT);
    fx.freeze_by_guardian();
    let owner = fx.owner();
    let (res, _) = fx.propose(&owner, GovAction::Unfreeze);
    assert_argus_err(res, ArgusError::NotGuardian);
    assert!(fx.vault_state().frozen);
}

/// A8: the owner can freeze, but unfreezing takes the guardian threshold.
#[test]
fn owner_freeze_needs_threshold_unfreeze() {
    let mut fx = Fx::new(1_000 * UNIT);
    let owner = fx.owner();
    assert_ok(fx.freeze(&owner));

    let (res, p) = fx.propose(&g(&fx, 0), GovAction::Unfreeze);
    assert_ok(res);
    let ex = executor(&mut fx);
    // One of two approvals isn't enough.
    assert_argus_err(fx.exec_proposal(&ex, &p), ArgusError::ThresholdNotMet);
    assert!(fx.vault_state().frozen);

    assert_ok(fx.approve(&g(&fx, 2), &p));
    // Immediate action: executable in the same moment.
    assert_ok(fx.exec_proposal(&ex, &p));
    assert!(!fx.vault_state().frozen);
}

// ===================== INV-5: the AI is rejected everywhere else =====================

#[test]
fn ai_cannot_propose_approve_or_veto() {
    let mut fx = Fx::new(1_000 * UNIT);
    let ai = fx.ai.insecure_clone();
    let (res, _) = fx.propose(&ai, GovAction::Unfreeze);
    assert_argus_err(res, ArgusError::NotGuardian);

    let (res, p) = fx.propose(&g(&fx, 0), GovAction::AddTrusted { wallet: Keypair::new().pubkey() });
    assert_ok(res);
    assert_argus_err(fx.approve(&ai, &p), ArgusError::NotGuardian);
    assert_argus_err(fx.veto(&ai, &p), ArgusError::NotGuardian);
}

// ===================== RotateOwner (INV-6) =====================

/// A1 recovery: guardians rotate the owner, and the thief's pending request can never execute.
#[test]
fn attack_request_voided_by_rotation() {
    let mut fx = Fx::new(1_000 * UNIT);
    let thief = fx.owner();
    let thief_dest = fx.token_account_for(&Keypair::new().pubkey());
    let (res, w) = fx.request(&thief, &thief_dest, 1_000 * UNIT);
    assert_ok(res);

    let new_owner = fx.env.funded_keypair();
    fx.enact(GovAction::RotateOwner { new_owner: new_owner.pubkey() });
    let v = fx.vault_state();
    assert_eq!(v.owner, new_owner.pubkey());
    assert_eq!(v.owner_epoch, 1);

    fx.env.warp(DAY);
    let cranker = fx.env.funded_keypair();
    assert_argus_err(fx.execute(&cranker, &w), ArgusError::StaleOwnerEpoch);
    assert_eq!(fx.balance(&thief_dest), 0);

    // The old key is now powerless, and the new owner works.
    let dest = fx.owner_dest;
    assert_argus_err(fx.instant(&thief, &dest, UNIT), ArgusError::NotOwner);
    assert_ok(fx.instant(&new_owner, &dest, UNIT));
}

/// A7: request spam is voided wholesale by one rotation.
#[test]
fn attack_spam_requests_voided() {
    let mut fx = Fx::new(1_000 * UNIT);
    let thief = fx.owner();
    let dest = fx.token_account_for(&Keypair::new().pubkey());
    let mut ws = vec![];
    for _ in 0..5 {
        let (res, w) = fx.request(&thief, &dest, 200 * UNIT);
        assert_ok(res);
        ws.push(w);
    }
    let new_owner = Keypair::new().pubkey();
    fx.enact(GovAction::RotateOwner { new_owner });
    fx.env.warp(DAY);
    let cranker = fx.env.funded_keypair();
    for w in &ws {
        assert_argus_err(fx.execute(&cranker, w), ArgusError::StaleOwnerEpoch);
    }
    assert_eq!(fx.balance(&fx.vault_ata.clone()), 1_000 * UNIT);
    // Guardians can clean them up. The rent goes back to the thief's key, which is harmless.
    let g0 = g(&fx, 0);
    for w in &ws {
        assert_ok(fx.cancel(&g0, w));
    }
}

#[test]
fn rotate_owner_rejects_role_overlap() {
    let mut fx = Fx::new(1_000 * UNIT);
    let g0 = g(&fx, 0);
    let ai = fx.ai.pubkey();
    let safe = fx.safe.pubkey();
    let guardian2 = fx.guardians[2].pubkey();
    let (res, _) = fx.propose(&g0, GovAction::RotateOwner { new_owner: guardian2 });
    assert_argus_err(res, ArgusError::RoleOverlap);
    let (res, _) = fx.propose(&g0, GovAction::RotateOwner { new_owner: ai });
    assert_argus_err(res, ArgusError::RoleOverlap);
    let (res, _) = fx.propose(&g0, GovAction::RotateOwner { new_owner: safe });
    assert_argus_err(res, ArgusError::InvalidSafeAddress);
}

/// New rule: the owner can't be rotated to a wallet that is already trusted.
#[test]
fn rotate_owner_rejects_trusted_wallet() {
    let mut fx = Fx::new(1_000 * UNIT);
    let w = Keypair::new().pubkey();
    fx.enact(GovAction::AddTrusted { wallet: w });
    let p = fx.pass(GovAction::RotateOwner { new_owner: w });
    let ex = executor(&mut fx);
    assert_argus_err(fx.exec_proposal(&ex, &p), ArgusError::RoleOverlap);
    assert_ne!(fx.vault_state().owner, w);
}

// ===================== AddTrusted / RemoveTrusted =====================

/// The whole trusted flow, end to end: delayed, executed, usable at once, then removed.
#[test]
fn add_trusted_end_to_end_then_remove() {
    let mut fx = Fx::new(1_000 * UNIT);
    let wallet = Keypair::new().pubkey();
    let p = fx.pass(GovAction::AddTrusted { wallet });
    let prop: Proposal = fx.env.fetch(&p);
    assert_eq!(prop.eta, START_TIME + DAY);

    let ex = executor(&mut fx);
    fx.env.warp(DAY - 1);
    assert_argus_err(fx.exec_proposal(&ex, &p), ArgusError::TooEarly);
    fx.env.warp(1);
    assert_ok(fx.exec_proposal(&ex, &p));
    assert!(!fx.env.exists(&p), "proposal closed on execute");

    let rec: argus::TrustedAddress = fx.env.fetch(&trusted_pda(&fx.vault, &wallet));
    assert_eq!(rec.wallet, wallet);
    assert_eq!(rec.active_at, fx.env.now());
    assert_eq!(fx.vault_state().trusted_count, 1);

    let dest = fx.token_account_for(&wallet);
    let owner = fx.owner();
    assert_ok(fx.trusted(&owner, &dest, 500 * UNIT));

    fx.enact(GovAction::RemoveTrusted { wallet });
    assert!(!fx.env.exists(&trusted_pda(&fx.vault, &wallet)));
    assert_eq!(fx.vault_state().trusted_count, 0);
    assert_argus_err(fx.trusted(&owner, &dest, UNIT), ArgusError::NotTrusted);
}

/// A thief with the owner key watches a legitimate AddTrusted pass: any single guardian can veto it.
#[test]
fn add_trusted_vetoed_by_single_guardian() {
    let mut fx = Fx::new(1_000 * UNIT);
    let p = fx.pass(GovAction::AddTrusted { wallet: Keypair::new().pubkey() });
    let proposer = fx.guardians[0].pubkey();
    let before = fx.env.svm.get_account(&proposer).unwrap().lamports;
    let rent = fx.env.svm.get_account(&p).unwrap().lamports;
    assert_ok(fx.veto(&g(&fx, 2), &p));
    assert!(!fx.env.exists(&p));
    let after = fx.env.svm.get_account(&proposer).unwrap().lamports;
    assert_eq!(after, before + rent, "rent refunded to the proposer");
}

/// New rule: the owner key and the AI key can never be trusted.
#[test]
fn add_trusted_rejects_owner_ai_default_and_vault() {
    let mut fx = Fx::new(1_000 * UNIT);
    let g0 = g(&fx, 0);
    let owner = fx.owner().pubkey();
    let ai = fx.ai.pubkey();
    let vault = fx.vault;
    let (res, _) = fx.propose(&g0, GovAction::AddTrusted { wallet: owner });
    assert_argus_err(res, ArgusError::RoleOverlap);
    let (res, _) = fx.propose(&g0, GovAction::AddTrusted { wallet: ai });
    assert_argus_err(res, ArgusError::RoleOverlap);
    let (res, _) = fx.propose(&g0, GovAction::AddTrusted { wallet: Pubkey::default() });
    assert_argus_err(res, ArgusError::InvalidTrustedWallet);
    let (res, _) = fx.propose(&g0, GovAction::AddTrusted { wallet: vault });
    assert_argus_err(res, ArgusError::InvalidTrustedWallet);
}

#[test]
fn add_trusted_twice_fails_already_trusted() {
    let mut fx = Fx::new(1_000 * UNIT);
    let wallet = Keypair::new().pubkey();
    fx.enact(GovAction::AddTrusted { wallet });
    let p = fx.pass(GovAction::AddTrusted { wallet });
    fx.env.warp(DAY);
    let ex = executor(&mut fx);
    assert_argus_err(fx.exec_proposal(&ex, &p), ArgusError::AlreadyTrusted);
    assert_eq!(fx.vault_state().trusted_count, 1);
}

/// Pre-funding the TrustedAddress PDA can't block AddTrusted (same class as CR-INIT-1).
#[test]
fn add_trusted_succeeds_when_pda_prefunded_by_griefer() {
    let mut fx = Fx::new(1_000 * UNIT);
    let wallet = Keypair::new().pubkey();
    let addr = trusted_pda(&fx.vault, &wallet);
    let griefer = fx.env.funded_keypair();
    // Enough to be rent-exempt at 0 bytes, or the runtime refuses the transfer.
    let ix = anchor_lang::solana_program::system_instruction::transfer(&griefer.pubkey(), &addr, 1_000_000);
    assert_ok(fx.env.send(&[ix], &[&griefer]));
    fx.enact(GovAction::AddTrusted { wallet });
    let rec: argus::TrustedAddress = fx.env.fetch(&addr);
    assert_eq!(rec.wallet, wallet);
}

#[test]
fn add_trusted_capped_at_max() {
    let mut fx = Fx::new(1_000 * UNIT);
    for _ in 0..argus::MAX_TRUSTED {
        fx.enact(GovAction::AddTrusted { wallet: Keypair::new().pubkey() });
    }
    assert_eq!(fx.vault_state().trusted_count, argus::MAX_TRUSTED);
    let p = fx.pass(GovAction::AddTrusted { wallet: Keypair::new().pubkey() });
    fx.env.warp(DAY);
    let ex = executor(&mut fx);
    assert_argus_err(fx.exec_proposal(&ex, &p), ArgusError::TooManyTrusted);
}

#[test]
fn remove_trusted_of_unknown_wallet_fails() {
    let mut fx = Fx::new(1_000 * UNIT);
    let p = fx.pass(GovAction::RemoveTrusted { wallet: Keypair::new().pubkey() });
    let ex = executor(&mut fx);
    assert_argus_err(fx.exec_proposal(&ex, &p), ArgusError::NotTrusted);
}

/// The executor must pass exactly the record the proposal names.
#[test]
fn execute_rejects_wrong_trusted_account() {
    let mut fx = Fx::new(1_000 * UNIT);
    let a = Keypair::new().pubkey();
    let b = Keypair::new().pubkey();
    fx.enact(GovAction::AddTrusted { wallet: a });
    fx.enact(GovAction::AddTrusted { wallet: b });
    let p = fx.pass(GovAction::RemoveTrusted { wallet: a });
    let ex = executor(&mut fx);
    let prop: Proposal = fx.env.fetch(&p);
    let wrong = trusted_pda(&fx.vault, &b);
    let ix = exec_proposal_ix(&fx.vault, &ex.pubkey(), &p, &prop.rent_payer, Some(wrong));
    assert_argus_err(fx.env.send(&[ix], &[&ex]), ArgusError::TrustedAccountMismatch);
    let ix = exec_proposal_ix(&fx.vault, &ex.pubkey(), &p, &prop.rent_payer, None);
    assert_argus_err(fx.env.send(&[ix], &[&ex]), ArgusError::TrustedAccountMismatch);
    assert!(fx.env.exists(&trusted_pda(&fx.vault, &a)));
}

// ===================== Limits =====================

#[test]
fn tighten_limits_is_immediate_and_stricter_only() {
    let mut fx = Fx::new(1_000 * UNIT);
    let g0 = g(&fx, 0);
    let (res, _) = fx.propose(&g0, GovAction::TightenLimits { daily_limit: 200 * UNIT, delay_seconds: DAY });
    assert_argus_err(res, ArgusError::NotStricter);
    let (res, _) = fx.propose(&g0, GovAction::TightenLimits { daily_limit: 50 * UNIT, delay_seconds: DAY - 1 });
    assert_argus_err(res, ArgusError::NotStricter);

    fx.enact(GovAction::TightenLimits { daily_limit: 10 * UNIT, delay_seconds: 2 * DAY });
    let v = fx.vault_state();
    assert_eq!(v.daily_limit, 10 * UNIT);
    assert_eq!(v.delay_seconds, 2 * DAY);
    assert_eq!(fx.env.now(), START_TIME, "no timelock");
}

#[test]
fn tighten_is_not_vetoable() {
    let mut fx = Fx::new(1_000 * UNIT);
    let (res, p) = fx.propose(&g(&fx, 0), GovAction::TightenLimits { daily_limit: 0, delay_seconds: DAY });
    assert_ok(res);
    assert_argus_err(fx.veto(&g(&fx, 1), &p), ArgusError::NotVetoable);
}

#[test]
fn loosen_limits_is_delayed_and_vetoable() {
    let mut fx = Fx::new(1_000 * UNIT);
    let p = fx.pass(GovAction::LoosenLimits { daily_limit: 500 * UNIT, delay_seconds: 60 });
    assert_eq!(fx.env.fetch::<Proposal>(&p).eta, START_TIME + DAY);
    let ex = executor(&mut fx);
    assert_argus_err(fx.exec_proposal(&ex, &p), ArgusError::TooEarly);
    fx.env.warp(DAY);
    assert_ok(fx.exec_proposal(&ex, &p));
    let v = fx.vault_state();
    assert_eq!(v.daily_limit, 500 * UNIT);
    assert_eq!(v.delay_seconds, 60);

    let (res, _) = fx.propose(&g(&fx, 0), GovAction::LoosenLimits { daily_limit: 0, delay_seconds: 59 });
    assert_argus_err(res, ArgusError::DelayOutOfBounds);
}

/// INV-3: shortening the delay doesn't shorten an already-pending withdrawal.
#[test]
fn loosen_delay_does_not_shorten_pending_withdrawal() {
    let mut fx = Fx::new(1_000 * UNIT);
    let owner = fx.owner();
    let dest = fx.owner_dest;
    // The loosen (delay 24 h -> 60 s) passes at t0 and becomes executable at t0 + 24 h.
    let p = fx.pass(GovAction::LoosenLimits { daily_limit: 100 * UNIT, delay_seconds: 60 });
    // Just before then, a withdrawal is requested under the 24 h delay.
    fx.env.warp(DAY - 10);
    let (res, w) = fx.request(&owner, &dest, 300 * UNIT);
    assert_ok(res);
    let executes_at = fx.env.fetch::<argus::Withdrawal>(&w).executes_at;
    assert_eq!(executes_at, fx.env.now() + DAY);

    fx.env.warp(10);
    let ex = executor(&mut fx);
    assert_ok(fx.exec_proposal(&ex, &p));
    assert_eq!(fx.vault_state().delay_seconds, 60);
    // The pending withdrawal keeps its full 24 h.
    assert_eq!(fx.env.fetch::<argus::Withdrawal>(&w).executes_at, executes_at);
    fx.env.warp(120);
    let cranker = fx.env.funded_keypair();
    assert_argus_err(fx.execute(&cranker, &w), ArgusError::TooEarly);
}

// ===================== Safe address / AI guardian =====================

#[test]
fn set_safe_address_delayed_and_validated() {
    let mut fx = Fx::new(1_000 * UNIT);
    let g0 = g(&fx, 0);
    let owner = fx.owner().pubkey();
    let vault = fx.vault;
    let (res, _) = fx.propose(&g0, GovAction::SetSafeAddress { wallet: owner });
    assert_argus_err(res, ArgusError::InvalidSafeAddress);
    let (res, _) = fx.propose(&g0, GovAction::SetSafeAddress { wallet: vault });
    assert_argus_err(res, ArgusError::InvalidSafeAddress);

    let new_safe = Keypair::new().pubkey();
    let p = fx.pass(GovAction::SetSafeAddress { wallet: new_safe });
    assert_eq!(fx.env.fetch::<Proposal>(&p).eta, START_TIME + DAY);
    fx.env.warp(DAY);
    let ex = executor(&mut fx);
    assert_ok(fx.exec_proposal(&ex, &p));
    assert_eq!(fx.vault_state().safe_address, new_safe);

    let g1 = g(&fx, 1);
    assert_ok(fx.sweep(&g1, true));
    assert_eq!(fx.balance(&ata(&new_safe, &fx.mint())), 1_000 * UNIT);
}

/// Removing a compromised AI key is immediate. The old AI loses cancel and freeze at once.
#[test]
fn remove_ai_is_immediate_and_revokes_it() {
    let mut fx = Fx::new(1_000 * UNIT);
    let old_ai = fx.ai.insecure_clone();
    let (res, p) = fx.propose(&g(&fx, 0), GovAction::SetAiGuardian { key: Pubkey::default() });
    assert_ok(res);
    assert_argus_err(fx.veto(&g(&fx, 1), &p), ArgusError::NotVetoable);
    assert_ok(fx.approve(&g(&fx, 1), &p));
    let ex = executor(&mut fx);
    assert_ok(fx.exec_proposal(&ex, &p));
    assert_eq!(fx.vault_state().ai_guardian, Pubkey::default());
    assert_argus_err(fx.freeze(&old_ai), ArgusError::NotAuthorizedRole);
}

#[test]
fn set_new_ai_is_delayed_and_validated() {
    let mut fx = Fx::new(1_000 * UNIT);
    let g0 = g(&fx, 0);
    let guardian1 = fx.guardians[1].pubkey();
    let owner = fx.owner().pubkey();
    let (res, _) = fx.propose(&g0, GovAction::SetAiGuardian { key: guardian1 });
    assert_argus_err(res, ArgusError::RoleOverlap);
    let (res, _) = fx.propose(&g0, GovAction::SetAiGuardian { key: owner });
    assert_argus_err(res, ArgusError::RoleOverlap);

    let new_ai = fx.env.funded_keypair();
    let p = fx.pass(GovAction::SetAiGuardian { key: new_ai.pubkey() });
    assert_eq!(fx.env.fetch::<Proposal>(&p).eta, START_TIME + DAY);
    fx.env.warp(DAY);
    let ex = executor(&mut fx);
    assert_ok(fx.exec_proposal(&ex, &p));
    assert_ok(fx.freeze(&new_ai));
}

/// Re-validation at execute: an AddTrusted for wallet W becomes invalid if W is
/// made the AI key in the meantime.
#[test]
fn actions_revalidated_at_execute() {
    let mut fx = Fx::new(1_000 * UNIT);
    let w = fx.env.funded_keypair().pubkey();
    let add = fx.pass(GovAction::AddTrusted { wallet: w });
    fx.enact(GovAction::SetAiGuardian { key: w });
    let ex = executor(&mut fx);
    assert_argus_err(fx.exec_proposal(&ex, &add), ArgusError::RoleOverlap);
}

// ===================== SetGuardians (INV-7) and G3 =====================

/// INV-7 / P5: after SetGuardians, old proposals can't be approved or executed,
/// and removed guardians can't act.
#[test]
fn set_guardians_kills_old_proposals_and_removed_guardians() {
    let mut fx = Fx::new(1_000 * UNIT);
    let (res, old) = fx.propose(&g(&fx, 0), GovAction::Unfreeze);
    assert_ok(res);
    let passed_old = fx.pass(GovAction::TightenLimits { daily_limit: 0, delay_seconds: DAY });

    let new_g = fx.env.funded_keypair();
    let keep = vec![fx.guardians[0].pubkey(), fx.guardians[1].pubkey(), new_g.pubkey()];
    fx.enact(GovAction::SetGuardians { guardians: keep.clone(), threshold: 2 });
    let v = fx.vault_state();
    assert_eq!(v.guardian_epoch, 1);
    assert_eq!(&v.guardians[..3], &keep[..]);

    assert_argus_err(fx.approve(&g(&fx, 1), &old), ArgusError::StaleGuardianEpoch);
    let ex = executor(&mut fx);
    assert_argus_err(fx.exec_proposal(&ex, &passed_old), ArgusError::StaleGuardianEpoch);

    // The removed guardian (slot 2) has no powers left.
    let removed = g(&fx, 2);
    let (res, _) = fx.propose(&removed, GovAction::Unfreeze);
    assert_argus_err(res, ArgusError::NotGuardian);
    assert_argus_err(fx.sweep(&removed, true), ArgusError::NotGuardian);
    // The new guardian has them.
    assert_ok(fx.freeze(&new_g));
}

/// G3: a rogue guardian can veto other things, but not their own removal.
#[test]
fn attack_rogue_guardian_cannot_block_removal() {
    let mut fx = Fx::new(1_000 * UNIT);
    let rogue = g(&fx, 2);
    let replacement = Keypair::new().pubkey();
    let set = vec![fx.guardians[0].pubkey(), fx.guardians[1].pubkey(), replacement];
    let p = fx.pass(GovAction::SetGuardians { guardians: set, threshold: 2 });
    assert_argus_err(fx.veto(&rogue, &p), ArgusError::CannotVetoOwnRemoval);
    fx.env.warp(DAY);
    let ex = executor(&mut fx);
    assert_ok(fx.exec_proposal(&ex, &p));
    assert!(fx.vault_state().guardian_index(&rogue.pubkey()).is_none());
}

/// A guardian who stays in the new set can still veto it.
#[test]
fn kept_guardian_can_veto_set_guardians() {
    let mut fx = Fx::new(1_000 * UNIT);
    let set = vec![fx.guardians[0].pubkey(), fx.guardians[1].pubkey(), fx.guardians[2].pubkey()];
    let p = fx.pass(GovAction::SetGuardians { guardians: set, threshold: 3 });
    assert_ok(fx.veto(&g(&fx, 1), &p));
}

#[test]
fn set_guardians_validated_like_init() {
    let mut fx = Fx::new(1_000 * UNIT);
    let g0 = g(&fx, 0);
    let owner = fx.owner().pubkey();
    let ai = fx.ai.pubkey();
    let k = Keypair::new().pubkey();
    for (action, err) in [
        (GovAction::SetGuardians { guardians: vec![], threshold: 1 }, ArgusError::InvalidGuardianCount),
        (GovAction::SetGuardians { guardians: vec![k, k], threshold: 1 }, ArgusError::DuplicateGuardian),
        (GovAction::SetGuardians { guardians: vec![k], threshold: 2 }, ArgusError::InvalidThreshold),
        (GovAction::SetGuardians { guardians: vec![k, owner], threshold: 1 }, ArgusError::RoleOverlap),
        (GovAction::SetGuardians { guardians: vec![k, ai], threshold: 1 }, ArgusError::RoleOverlap),
    ] {
        let (res, _) = fx.propose(&g0, action);
        assert_argus_err(res, err);
    }
    let six: Vec<Pubkey> = (0..6).map(|_| Keypair::new().pubkey()).collect();
    let (res, _) = fx.propose(&g0, GovAction::SetGuardians { guardians: six, threshold: 2 });
    assert!(res.is_err());
}

// ===================== Approvals (INV-8, INV-3, C7) =====================

#[test]
fn approve_twice_is_rejected_never_double_counted() {
    let mut fx = Fx::new(1_000 * UNIT);
    let (res, p) = fx.propose(&g(&fx, 0), GovAction::Unfreeze);
    assert_ok(res);
    assert_argus_err(fx.approve(&g(&fx, 0), &p), ArgusError::AlreadyApproved);
    let prop: Proposal = fx.env.fetch(&p);
    assert_eq!(prop.approval_count(), 1);
    assert_eq!(prop.eta, 0);
}

/// INV-3 / C7: extra approvals after the threshold never move `eta`.
#[test]
fn eta_set_once_and_never_moves() {
    let mut fx = Fx::new(1_000 * UNIT);
    let p = fx.pass(GovAction::AddTrusted { wallet: Keypair::new().pubkey() });
    let eta = fx.env.fetch::<Proposal>(&p).eta;
    fx.env.warp(3_600);
    assert_ok(fx.approve(&g(&fx, 2), &p));
    let prop: Proposal = fx.env.fetch(&p);
    assert_eq!(prop.eta, eta);
    assert_eq!(prop.approvals, 0b111);
}

#[test]
fn non_guardian_cannot_approve_or_veto() {
    let mut fx = Fx::new(1_000 * UNIT);
    let (res, p) = fx.propose(&g(&fx, 0), GovAction::AddTrusted { wallet: Keypair::new().pubkey() });
    assert_ok(res);
    let stranger = fx.env.funded_keypair();
    let owner = fx.owner();
    assert_argus_err(fx.approve(&stranger, &p), ArgusError::NotGuardian);
    assert_argus_err(fx.approve(&owner, &p), ArgusError::NotGuardian);
    assert_argus_err(fx.veto(&owner, &p), ArgusError::NotGuardian);
}

/// P3: a proposal executes once, and ids are never reused.
#[test]
fn proposal_executes_once_and_ids_increment() {
    let mut fx = Fx::new(1_000 * UNIT);
    fx.freeze_by_guardian();
    let p = fx.pass(GovAction::Unfreeze);
    let ex = executor(&mut fx);
    assert_ok(fx.exec_proposal(&ex, &p));
    let ix = exec_proposal_ix(&fx.vault, &ex.pubkey(), &p, &fx.guardians[0].pubkey(), None);
    assert!(fx.env.send(&[ix], &[&ex]).is_err());
    let p2 = fx.pass(GovAction::Unfreeze);
    assert_ne!(p, p2);
    assert_eq!(fx.vault_state().next_proposal_id, 2);
}

/// A 1-of-1 vault: the single guardian's proposal reaches the threshold at creation.
#[test]
fn one_of_one_propose_sets_eta_immediately() {
    let mut env = Env::new();
    let guardian = env.funded_keypair();
    let p = InitParams::new(vec![guardian.pubkey()], 1, Pubkey::default(), Keypair::new().pubkey());
    let owner = env.owner.insecure_clone();
    assert_ok(env.send(&[init_vault_ix(&owner.pubkey(), &env.mint, &p)], &[&owner]));
    let vault = vault_pda(&owner.pubkey(), 0);
    let prop = proposal_pda(&vault, 0);
    let ix = propose_ix(&vault, &guardian.pubkey(), &prop, GovAction::RotateOwner { new_owner: Keypair::new().pubkey() });
    assert_ok(env.send(&[ix], &[&guardian]));
    let pr: Proposal = env.fetch(&prop);
    assert_eq!(pr.eta, START_TIME);
}

// ===================== Audit round 1 regressions =====================

/// F-1: the proposer, who is also `rent_payer`, can execute their own proposal.
/// Before the fix, Anchor's duplicate-mutable-account guard rejected it (2040).
#[test]
fn proposer_can_execute_own_proposal() {
    let mut fx = Fx::new(1_000 * UNIT);
    fx.freeze_by_guardian();
    let g0 = g(&fx, 0);
    let p = fx.pass(GovAction::Unfreeze);
    let before = fx.env.svm.get_account(&g0.pubkey()).unwrap().lamports;
    let rent = fx.env.svm.get_account(&p).unwrap().lamports;
    assert_ok(fx.exec_proposal(&g0, &p));
    assert!(!fx.vault_state().frozen);
    let after = fx.env.svm.get_account(&g0.pubkey()).unwrap().lamports;
    assert_eq!(after, before + rent - 5_000, "rent refunded, minus the tx fee");

    // And with the trusted account in play (AddTrusted, where the executor pays for the record).
    let wallet = Keypair::new().pubkey();
    let p = fx.pass(GovAction::AddTrusted { wallet });
    fx.env.warp(DAY);
    assert_ok(fx.exec_proposal(&g0, &p));
    assert!(fx.env.exists(&trusted_pda(&fx.vault, &wallet)));
}

/// F-2: a trusted wallet can't become the AI key.
#[test]
fn set_ai_rejects_trusted_wallet() {
    let mut fx = Fx::new(1_000 * UNIT);
    let w = Keypair::new().pubkey();
    fx.enact(GovAction::AddTrusted { wallet: w });
    let p = fx.pass(GovAction::SetAiGuardian { key: w });
    fx.env.warp(DAY);
    let ex = executor(&mut fx);
    assert_argus_err(fx.exec_proposal(&ex, &p), ArgusError::RoleOverlap);
    assert_ne!(fx.vault_state().ai_guardian, w);
}

/// The Proposal account has room for the largest action: SetGuardians with 5 keys.
#[test]
fn set_guardians_with_five_guardians_fits() {
    let mut fx = Fx::new(1_000 * UNIT);
    let mut set: Vec<Pubkey> = fx.guardians.iter().map(|k| k.pubkey()).collect();
    set.push(Keypair::new().pubkey());
    set.push(Keypair::new().pubkey());
    fx.enact(GovAction::SetGuardians { guardians: set.clone(), threshold: 3 });
    let v = fx.vault_state();
    assert_eq!(v.guardian_count, 5);
    assert_eq!(&v.guardians[..], &set[..]);
    assert_eq!(v.threshold, 3);
}

// ===================== Proposal expiry (audit I-2 / I-3) =====================

const TTL: i64 = argus::PROPOSAL_TTL;

/// The dormant-proposal attack: a rogue guardian's RotateOwner sits with one
/// approval, and eight days later a second guardian is tricked into approving it.
#[test]
fn attack_dormant_rotate_owner_expires() {
    let mut fx = Fx::new(1_000 * UNIT);
    let rogue = g(&fx, 0);
    let attacker = Keypair::new().pubkey();
    let (res, p) = fx.propose(&rogue, GovAction::RotateOwner { new_owner: attacker });
    assert_ok(res);
    fx.env.warp(TTL + 1);
    assert_argus_err(fx.approve(&g(&fx, 1), &p), ArgusError::ProposalExpired);
    let ex = executor(&mut fx);
    assert_argus_err(fx.exec_proposal(&ex, &p), ArgusError::ThresholdNotMet);
    assert_ne!(fx.vault_state().owner, attacker);
}

/// The expiry boundary is inclusive: approving at exactly `created_at + TTL` works.
#[test]
fn approve_at_exact_ttl_boundary_succeeds() {
    let mut fx = Fx::new(1_000 * UNIT);
    let (res, p) = fx.propose(&g(&fx, 0), GovAction::Unfreeze);
    assert_ok(res);
    fx.env.warp(TTL);
    assert_ok(fx.approve(&g(&fx, 1), &p));
}

/// A passed proposal never expires. A long-timelock AddTrusted stays executable
/// after the TTL.
#[test]
fn passed_proposal_does_not_expire() {
    let mut fx = Fx::new(1_000 * UNIT);
    fx.enact(GovAction::TightenLimits { daily_limit: 100 * UNIT, delay_seconds: 10 * DAY });
    let wallet = Keypair::new().pubkey();
    let p = fx.pass(GovAction::AddTrusted { wallet });
    fx.env.warp(10 * DAY);
    let closer = fx.env.funded_keypair();
    assert_argus_err(fx.close_proposal(&closer, &p), ArgusError::ProposalStillLive);
    let ex = executor(&mut fx);
    assert_ok(fx.exec_proposal(&ex, &p));
    assert!(fx.env.exists(&trusted_pda(&fx.vault, &wallet)));
}

/// Anyone can close an expired proposal, and the rent goes back to the proposer.
#[test]
fn expired_proposal_closed_by_anyone_refunds_rent() {
    let mut fx = Fx::new(1_000 * UNIT);
    let (res, p) = fx.propose(&g(&fx, 0), GovAction::RotateOwner { new_owner: Keypair::new().pubkey() });
    assert_ok(res);
    let closer = fx.env.funded_keypair();
    assert_argus_err(fx.close_proposal(&closer, &p), ArgusError::ProposalStillLive);
    fx.env.warp(TTL);
    assert_argus_err(fx.close_proposal(&closer, &p), ArgusError::ProposalStillLive);
    fx.env.warp(1);
    let proposer = fx.guardians[0].pubkey();
    let before = fx.env.svm.get_account(&proposer).unwrap().lamports;
    let rent = fx.env.svm.get_account(&p).unwrap().lamports;
    assert_ok(fx.close_proposal(&closer, &p));
    assert!(!fx.env.exists(&p));
    assert_eq!(fx.env.svm.get_account(&proposer).unwrap().lamports, before + rent);
}

/// A proposal from an old guardian set can be closed straight away, even an
/// immediate (non-vetoable) one.
#[test]
fn stale_proposal_closed_immediately() {
    let mut fx = Fx::new(1_000 * UNIT);
    let (res, p) = fx.propose(&g(&fx, 0), GovAction::Unfreeze);
    assert_ok(res);
    let set: Vec<Pubkey> = fx.guardians.iter().map(|k| k.pubkey()).collect();
    fx.enact(GovAction::SetGuardians { guardians: set, threshold: 3 });
    let closer = fx.env.funded_keypair();
    assert_ok(fx.close_proposal(&closer, &p));
    assert!(!fx.env.exists(&p));
}

/// The closer can't redirect the rent refund.
#[test]
fn close_proposal_rejects_substituted_rent_payer() {
    let mut fx = Fx::new(1_000 * UNIT);
    let (res, p) = fx.propose(&g(&fx, 0), GovAction::Unfreeze);
    assert_ok(res);
    fx.env.warp(TTL + 1);
    let closer = fx.env.funded_keypair();
    let ix = close_proposal_ix(&fx.vault, &closer.pubkey(), &p, &closer.pubkey());
    assert!(fx.env.send(&[ix], &[&closer]).is_err());
    assert!(fx.env.exists(&p));
}

/// Governance works while frozen (unfreeze is itself an action).
#[test]
fn governance_allowed_while_frozen() {
    let mut fx = Fx::new(1_000 * UNIT);
    fx.freeze_by_guardian();
    let new_owner = Keypair::new().pubkey();
    fx.enact(GovAction::RotateOwner { new_owner });
    fx.enact(GovAction::Unfreeze);
    let v = fx.vault_state();
    assert_eq!(v.owner, new_owner);
    assert!(!v.frozen);
}
