#[path = "../../../programs/argus/tests/common/mod.rs"]
mod common;
use common::*;
use argus::GovAction;
use solana_signer::Signer;

#[test]
fn stale_immediate_proposal_refunds_only_original_payer_once() {
    let mut fx = Fx::new(UNIT);
    let g = fx.guardians[0].insecure_clone();
    let (res, stale) = fx.propose(&g, GovAction::Unfreeze);
    assert_ok(res);
    let guardians = fx.guardians.iter().map(|k| k.pubkey()).collect();
    fx.enact(GovAction::SetGuardians { guardians, threshold: 2 });
    let g1 = fx.guardians[1].insecure_clone();
    let ex = fx.env.funded_keypair();
    assert!(fx.approve(&g1, &stale).is_err());
    assert!(fx.exec_proposal(&ex, &stale).is_err());
    assert!(fx.veto(&g1, &stale).is_err());
    let rent = fx.env.svm.get_account(&stale).unwrap().lamports;
    let before = fx.env.svm.get_account(&g.pubkey()).unwrap().lamports;
    let wrong_payer = close_proposal_ix(&fx.vault, &ex.pubkey(), &stale, &ex.pubkey());
    assert!(fx.env.send(&[wrong_payer], &[&ex]).is_err());
    assert_ok(fx.close_proposal(&ex, &stale));
    assert!(!fx.env.exists(&stale));
    assert_eq!(fx.env.svm.get_account(&g.pubkey()).unwrap().lamports, before + rent);
    let repeat = close_proposal_ix(&fx.vault, &ex.pubkey(), &stale, &g.pubkey());
    assert!(fx.env.send(&[repeat], &[&ex]).is_err());
}

#[test]
fn cleanup_rejects_live_and_cross_vault_proposals() {
    let mut fx = Fx::new(UNIT);
    let guardian = fx.guardians[0].insecure_clone();
    let (res, p) = fx.propose(&guardian, GovAction::Unfreeze);
    assert_ok(res);
    let closer = fx.env.funded_keypair();
    assert_argus_err(fx.close_proposal(&closer, &p), argus::error::ArgusError::ProposalStillLive);
    let mut params = fx.params.clone(); params.vault_id = 77;
    let owner = fx.owner();
    assert_ok(fx.env.send(&[init_vault_ix(&owner.pubkey(), &fx.mint(), &params)], &[&owner]));
    fx.env.warp(argus::PROPOSAL_TTL + 1);
    let other = vault_pda(&owner.pubkey(), 77);
    let invalid = close_proposal_ix(&other, &closer.pubkey(), &p, &guardian.pubkey());
    assert!(fx.env.send(&[invalid], &[&closer]).is_err());
    assert!(fx.env.exists(&p));
    assert_ok(fx.close_proposal(&closer, &p));
}

#[test]
fn closed_withdrawal_cannot_be_revived_in_same_transaction() {
    let mut fx = Fx::new(10 * UNIT);
    let owner = fx.owner();
    let dest = fx.owner_dest;
    let (res, w) = fx.request(&owner, &dest, UNIT);
    assert_ok(res);
    fx.env.warp(DAY);
    let crank = fx.env.funded_keypair();
    let execute = execute_ix(&fx.vault, &fx.mint(), &crank.pubkey(), &w, &owner.pubkey(), &dest);
    let revive = anchor_lang::solana_program::system_instruction::transfer(&crank.pubkey(), &w, 10_000_000);
    let before = fx.balance(&fx.vault_ata);
    let res = fx.env.send(&[execute.clone(), revive, execute], &[&crank]);
    assert!(res.is_err());
    assert_eq!(before, fx.balance(&fx.vault_ata));
    assert!(fx.env.exists(&w)); // whole transaction rolled back
    assert_ok(fx.execute(&crank, &w));
    assert!(!fx.env.exists(&w));
}

// Deterministic seeds make failures replayable. No direct account/state injection.
#[test]
fn randomized_instruction_sequences_preserve_inv1_inv2() {
    for seed in 1..=16u64 {
        let mut rng = seed;
        let mut fx = Fx::new(1_000 * UNIT);
        let owner = fx.owner();
        let source = fx.token_account_for(&owner.pubkey());
        fx.mint_to(&source, 1_000 * UNIT);
        let safe = fx.safe_ata();
        let dest = fx.owner_dest;
        let stranger = fx.env.funded_keypair();
        let mut signers = vec![owner.insecure_clone(), fx.ai.insecure_clone(), stranger];
        signers.extend(fx.guardians.iter().map(|k| k.insecure_clone()));
        let mut pending = Vec::new();
        let original = fx.vault_state();
        for _step in 0..96 {
            rng ^= rng << 13; rng ^= rng >> 7; rng ^= rng << 17;
            let who = (rng % signers.len() as u64) as usize;
            let op = (rng >> 8) % 9;
            let amount = ((rng >> 16) % 200 + 1) * UNIT;
            let before = fx.balance(&fx.vault_ata);
            let frozen = fx.vault_state().frozen;
            let mut expected = before;
            match op {
                0 => { if fx.instant(&signers[who], &dest, amount).is_ok() {
                    assert!(!frozen, "INV-4 seed={seed}: instant withdrawal succeeded while frozen");
                    expected -= amount;
                } }
                1 => {
                    let (res, address) = fx.request(&signers[who], &dest, amount);
                    if res.is_ok() { pending.push((address, amount)); }
                }
                2 if !pending.is_empty() => {
                    let ix = ((rng >> 24) % pending.len() as u64) as usize;
                    let (address, value) = pending[ix];
                    if fx.execute(&signers[who], &address).is_ok() { expected -= value; pending.swap_remove(ix); }
                }
                3 if !pending.is_empty() => {
                    let ix = ((rng >> 24) % pending.len() as u64) as usize;
                    if fx.cancel(&signers[who], &pending[ix].0).is_ok() { pending.swap_remove(ix); }
                }
                4 => { let _ = fx.freeze(&signers[who]); }
                5 => { if fx.deposit(&signers[who], &source, amount).is_ok() { expected += amount; } }
                6 => { if fx.sweep(&signers[who], rng & 1 == 1).is_ok() { expected = 0; } }
                7 => {
                    // Owner alone must never create a config-changing proposal.
                    assert!(fx.propose(&owner, GovAction::LoosenLimits { daily_limit: u64::MAX, delay_seconds: 60 }).0.is_err());
                }
                _ => fx.env.warp(((rng >> 32) % 86_401) as i64),
            }
            assert_eq!(fx.balance(&fx.vault_ata), expected, "INV-1 seed={seed} op={op}");
            let safe_balance = if fx.env.exists(&safe) { fx.balance(&safe) } else { 0 };
            assert_eq!(fx.balance(&fx.vault_ata) + fx.balance(&source) + fx.balance(&dest) + safe_balance, 2_000 * UNIT);
            let now = fx.vault_state();
            assert_eq!(now.owner, original.owner, "INV-2 seed={seed}");
            assert_eq!(now.guardians, original.guardians);
            assert_eq!(now.threshold, original.threshold);
            assert_eq!(now.ai_guardian, original.ai_guardian);
            assert_eq!(now.safe_address, original.safe_address);
            assert_eq!(now.daily_limit, original.daily_limit);
            assert_eq!(now.delay_seconds, original.delay_seconds);
            assert_eq!(now.trusted_count, original.trusted_count);
        }
    }
}

// Compile the real integration suites against the downloaded on-chain bytecode.
#[path = "../../../programs/argus/tests/initialize_vault.rs"] mod suite_init;
#[path = "../../../programs/argus/tests/deposit.rs"] mod suite_deposit;
#[path = "../../../programs/argus/tests/withdraw_instant.rs"] mod suite_instant;
#[path = "../../../programs/argus/tests/withdraw_trusted.rs"] mod suite_trusted;
#[path = "../../../programs/argus/tests/withdrawals.rs"] mod suite_withdrawals;
#[path = "../../../programs/argus/tests/protective.rs"] mod suite_protective;
#[path = "../../../programs/argus/tests/governance.rs"] mod suite_governance;
#[path = "../../../programs/argus/tests/rollback.rs"] mod suite_rollback;
#[path = "../../../programs/argus/tests/fuzz.rs"] mod suite_fuzz;
