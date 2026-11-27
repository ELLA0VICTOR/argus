//! `initialize_vault`: happy paths and every validation rule in PROGRAM-SPEC §3.
mod common;

use {
    anchor_lang::prelude::Pubkey,
    argus::{error::ArgusError, state::Vault, MAX_DELAY, MIN_DELAY},
    common::*,
    solana_keypair::Keypair,
    solana_signer::Signer,
};

fn key() -> Pubkey {
    Keypair::new().pubkey()
}

/// 1-of-1 individual: guardian = backup wallet, AI set, separate safe wallet.
fn individual() -> InitParams {
    InitParams::new(vec![key()], 1, key(), key())
}

fn init(env: &mut Env, p: &InitParams) -> litesvm::types::TransactionResult {
    let owner = env.owner.insecure_clone();
    let ix = init_vault_ix(&owner.pubkey(), &env.mint, p);
    env.send(&[ix], &[&owner])
}

// ---------- happy paths ----------

#[test]
fn init_happy_path_sets_every_field() {
    let mut env = Env::new();
    let p = individual();
    assert_ok(init(&mut env, &p));

    let owner = env.owner.pubkey();
    let vault_key = vault_pda(&owner, 0);
    let v: Vault = env.fetch(&vault_key);

    assert_eq!(v.version, 1);
    assert_eq!(v.creator, owner);
    assert_eq!(v.owner, owner);
    assert_eq!(v.vault_id, 0);
    assert_eq!(v.mint, env.mint);
    assert_eq!(v.owner_epoch, 0);
    assert_eq!(v.guardian_count, 1);
    assert_eq!(v.threshold, 1);
    assert_eq!(v.guardians[0], p.guardians[0]);
    assert!(v.guardians[1..].iter().all(|g| *g == Pubkey::default()));
    assert_eq!(v.guardian_epoch, 0);
    assert_eq!(v.ai_guardian, p.ai_guardian);
    assert_eq!(v.safe_address, p.safe_address);
    assert_eq!(v.delay_seconds, DAY);
    assert_eq!(v.daily_limit, p.daily_limit);
    assert_eq!(v.window_start, START_TIME);
    assert_eq!(v.spent_in_window, 0);
    assert!(!v.frozen);
    assert_eq!(v.trusted_count, 0);
    assert_eq!(v.next_withdrawal_id, 0);
    assert_eq!(v.next_proposal_id, 0);
    assert_eq!(v.reserved, [0u8; 64]);

    // Bump matches the canonical PDA bump (INV-11).
    let (_, bump) = Pubkey::find_program_address(
        &[argus::VAULT_SEED, owner.as_ref(), &0u64.to_le_bytes()],
        &argus::id(),
    );
    assert_eq!(v.bump, bump);

    // The vault ATA exists, is owned by the vault PDA, holds the right mint and is empty.
    let t = env.token_account(&ata(&vault_key, &env.mint));
    assert_eq!(t.owner, vault_key);
    assert_eq!(t.mint, env.mint);
    assert_eq!(t.amount, 0);
}

#[test]
fn init_family_2_of_3_and_company_3_of_5() {
    let mut env = Env::new();
    let mut family = InitParams::new(vec![key(), key(), key()], 2, key(), key());
    family.vault_id = 1;
    assert_ok(init(&mut env, &family));

    let mut company = InitParams::new(vec![key(), key(), key(), key(), key()], 3, key(), key());
    company.vault_id = 2;
    assert_ok(init(&mut env, &company));

    let v: Vault = env.fetch(&vault_pda(&env.owner.pubkey(), 2));
    assert_eq!(v.guardian_count, 5);
    assert_eq!(v.threshold, 3);
    assert_eq!(&v.guardians[..], &company.guardians[..]);
}

#[test]
fn init_without_ai_guardian_is_allowed() {
    let mut env = Env::new();
    let p = InitParams::new(vec![key()], 1, Pubkey::default(), key());
    assert_ok(init(&mut env, &p));
    let v: Vault = env.fetch(&vault_pda(&env.owner.pubkey(), 0));
    assert_eq!(v.ai_guardian, Pubkey::default());
}

#[test]
fn init_safe_address_may_be_a_guardian_wallet() {
    let mut env = Env::new();
    let g = key();
    let p = InitParams::new(vec![g], 1, key(), g);
    assert_ok(init(&mut env, &p));
}

#[test]
fn init_delay_bounds_are_inclusive() {
    let mut env = Env::new();
    let mut p = individual();
    p.delay_seconds = MIN_DELAY;
    assert_ok(init(&mut env, &p));

    let mut p = individual();
    p.vault_id = 1;
    p.delay_seconds = MAX_DELAY;
    assert_ok(init(&mut env, &p));
}

#[test]
fn init_same_creator_many_vaults_by_id() {
    let mut env = Env::new();
    for id in [0u64, 1, u64::MAX] {
        let mut p = individual();
        p.vault_id = id;
        assert_ok(init(&mut env, &p));
        assert!(env.exists(&vault_pda(&env.owner.pubkey(), id)));
    }
}

// ---------- guardian set ----------

#[test]
fn init_rejects_zero_guardians() {
    let mut env = Env::new();
    let p = InitParams::new(vec![], 1, key(), key());
    assert_argus_err(init(&mut env, &p), ArgusError::InvalidGuardianCount);
}

#[test]
fn init_rejects_six_guardians() {
    let mut env = Env::new();
    let p = InitParams::new((0..6).map(|_| key()).collect(), 3, key(), key());
    assert_argus_err(init(&mut env, &p), ArgusError::InvalidGuardianCount);
}

#[test]
fn init_rejects_zero_threshold() {
    let mut env = Env::new();
    let p = InitParams::new(vec![key(), key()], 0, key(), key());
    assert_argus_err(init(&mut env, &p), ArgusError::InvalidThreshold);
}

#[test]
fn init_rejects_threshold_above_guardian_count() {
    let mut env = Env::new();
    let p = InitParams::new(vec![key(), key()], 3, key(), key());
    assert_argus_err(init(&mut env, &p), ArgusError::InvalidThreshold);
}

#[test]
fn init_rejects_duplicate_guardian() {
    let mut env = Env::new();
    let g = key();
    let p = InitParams::new(vec![key(), g, g], 2, key(), key());
    assert_argus_err(init(&mut env, &p), ArgusError::DuplicateGuardian);
}

#[test]
fn init_rejects_default_pubkey_guardian() {
    let mut env = Env::new();
    let p = InitParams::new(vec![key(), Pubkey::default()], 1, key(), key());
    assert_argus_err(init(&mut env, &p), ArgusError::InvalidGuardian);
}

// ---------- role separation (INV-2, P12) ----------

#[test]
fn init_rejects_owner_as_guardian() {
    let mut env = Env::new();
    let owner = env.owner.pubkey();
    let p = InitParams::new(vec![key(), owner], 1, key(), key());
    assert_argus_err(init(&mut env, &p), ArgusError::RoleOverlap);
}

#[test]
fn init_rejects_ai_equal_to_owner() {
    let mut env = Env::new();
    let owner = env.owner.pubkey();
    let p = InitParams::new(vec![key()], 1, owner, key());
    assert_argus_err(init(&mut env, &p), ArgusError::RoleOverlap);
}

#[test]
fn init_rejects_ai_as_guardian() {
    let mut env = Env::new();
    let ai = key();
    let p = InitParams::new(vec![key(), ai], 1, ai, key());
    assert_argus_err(init(&mut env, &p), ArgusError::RoleOverlap);
}

// ---------- safe address ----------

#[test]
fn init_rejects_default_safe_address() {
    let mut env = Env::new();
    let p = InitParams::new(vec![key()], 1, key(), Pubkey::default());
    assert_argus_err(init(&mut env, &p), ArgusError::InvalidSafeAddress);
}

/// If the safe address were the owner, a guardian's emergency sweep would send
/// everything to the stolen owner key.
#[test]
fn init_rejects_safe_address_equal_to_owner() {
    let mut env = Env::new();
    let owner = env.owner.pubkey();
    let p = InitParams::new(vec![key()], 1, key(), owner);
    assert_argus_err(init(&mut env, &p), ArgusError::InvalidSafeAddress);
}

#[test]
fn init_rejects_safe_address_equal_to_ai() {
    let mut env = Env::new();
    let ai = key();
    let p = InitParams::new(vec![key()], 1, ai, ai);
    assert_argus_err(init(&mut env, &p), ArgusError::InvalidSafeAddress);
}

/// The safe address must not be the vault itself, or a sweep would be a
/// self-transfer that rescues nothing.
#[test]
fn init_rejects_safe_address_equal_to_vault() {
    let mut env = Env::new();
    let p0 = individual();
    let vault = vault_pda(&env.owner.pubkey(), p0.vault_id);
    let p = InitParams::new(vec![key()], 1, key(), vault);
    assert_argus_err(init(&mut env, &p), ArgusError::InvalidSafeAddress);
    assert!(!env.exists(&vault));
}

/// Another program-owned wallet (e.g. a multisig vault PDA) is a valid safe address.
#[test]
fn init_allows_safe_address_that_is_another_pda() {
    let mut env = Env::new();
    let other_vault = vault_pda(&key(), 0);
    let p = InitParams::new(vec![key()], 1, key(), other_vault);
    assert_ok(init(&mut env, &p));
}

// ---------- delay ----------

#[test]
fn init_rejects_delay_below_min() {
    let mut env = Env::new();
    let mut p = individual();
    p.delay_seconds = MIN_DELAY - 1;
    assert_argus_err(init(&mut env, &p), ArgusError::DelayOutOfBounds);
}

#[test]
fn init_rejects_delay_above_max() {
    let mut env = Env::new();
    let mut p = individual();
    p.delay_seconds = MAX_DELAY + 1;
    assert_argus_err(init(&mut env, &p), ArgusError::DelayOutOfBounds);
}

#[test]
fn init_rejects_negative_delay() {
    let mut env = Env::new();
    let mut p = individual();
    p.delay_seconds = i64::MIN;
    assert_argus_err(init(&mut env, &p), ArgusError::DelayOutOfBounds);
}

// ---------- mint and token program ----------

/// Every Token-2022 combination returns `UnsupportedMint` (CR-INIT-2) and leaves
/// no vault behind.
fn assert_unsupported(env: &mut Env, mint: Pubkey, token_program: Pubkey) {
    let owner = env.owner.insecure_clone();
    let p = individual();
    let ix = init_vault_ix_with(&owner.pubkey(), &mint, &p, token_program, None);
    assert_argus_err(env.send(&[ix], &[&owner]), ArgusError::UnsupportedMint);
    let vault = vault_pda(&owner.pubkey(), p.vault_id);
    assert!(!env.exists(&vault), "failed init must not leave a vault");
    assert!(!env.exists(&ata(&vault, &mint)), "failed init must not leave an ATA");
}

#[test]
fn init_rejects_token_2022_mint_with_token_2022_program() {
    let mut env = Env::new();
    let auth = env.mint_authority.pubkey();
    let mint22 = create_mint(&mut env.svm, &auth, token_2022_id());
    assert_unsupported(&mut env, mint22, token_2022_id());
}

#[test]
fn init_rejects_token_2022_mint_with_classic_program() {
    let mut env = Env::new();
    let auth = env.mint_authority.pubkey();
    let mint22 = create_mint(&mut env.svm, &auth, token_2022_id());
    assert_unsupported(&mut env, mint22, anchor_spl::token::ID);
}

#[test]
fn init_rejects_classic_mint_with_token_2022_program() {
    let mut env = Env::new();
    let mint = env.mint;
    assert_unsupported(&mut env, mint, token_2022_id());
}

/// CR-INIT-1: anyone can create ATA(vault PDA, mint) before the vault exists.
/// That must not block the creator, and tokens already there belong to the vault.
#[test]
fn init_succeeds_when_ata_precreated_and_funded_by_third_party() {
    let mut env = Env::new();
    let griefer = env.funded_keypair();
    let p = individual();
    let vault = vault_pda(&env.owner.pubkey(), p.vault_id);
    let vault_ata = ata(&vault, &env.mint);

    let create = create_ata_ix(&griefer.pubkey(), &vault, &env.mint);
    assert_ok(env.send(&[create], &[&griefer]));
    let mint_ix = mint_to_ix(&env.mint, &vault_ata, &env.mint_authority.pubkey(), 7_000_000);
    let auth = env.mint_authority.insecure_clone();
    assert_ok(env.send(&[mint_ix], &[&griefer, &auth]));

    assert_ok(init(&mut env, &p));

    let v: Vault = env.fetch(&vault);
    assert_eq!(v.owner, env.owner.pubkey());
    let t = env.token_account(&vault_ata);
    assert_eq!(t.owner, vault);
    assert_eq!(t.mint, env.mint);
    assert_eq!(t.amount, 7_000_000);
}

// ---------- account substitution (P1, P2, INV-11) ----------

#[test]
fn init_same_vault_id_twice_fails() {
    let mut env = Env::new();
    let p = individual();
    assert_ok(init(&mut env, &p));
    // A second init can't overwrite the existing vault (INV-12).
    let p2 = InitParams::new(vec![key()], 1, key(), key());
    assert!(init(&mut env, &p2).is_err());
    let v: Vault = env.fetch(&vault_pda(&env.owner.pubkey(), 0));
    assert_eq!(v.guardians[0], p.guardians[0]);
}

#[test]
fn init_rejects_vault_pda_of_another_creator() {
    let mut env = Env::new();
    let attacker = env.funded_keypair();
    let victim = env.owner.pubkey();
    let p = individual();
    let mut ix = init_vault_ix(&attacker.pubkey(), &env.mint, &p);
    // Point the vault account at the victim's PDA for the same id.
    ix.accounts[1].pubkey = vault_pda(&victim, p.vault_id);
    assert!(env.send(&[ix], &[&attacker]).is_err());
    assert!(!env.exists(&vault_pda(&victim, p.vault_id)));
}

#[test]
fn init_rejects_non_ata_vault_token_account() {
    let mut env = Env::new();
    let owner = env.owner.insecure_clone();
    let bogus = Keypair::new().pubkey();
    let ix = init_vault_ix_with(&owner.pubkey(), &env.mint, &individual(), anchor_spl::token::ID, Some(bogus));
    assert!(env.send(&[ix], &[&owner]).is_err());
}

#[test]
fn init_requires_creator_signature() {
    let mut env = Env::new();
    let payer = env.funded_keypair();
    let victim = env.owner.pubkey();
    let mut ix = init_vault_ix(&victim, &env.mint, &individual());
    // Strip the creator's signer flag: the transaction can't claim it signed.
    ix.accounts[0].is_signer = false;
    assert!(env.send(&[ix], &[&payer]).is_err());
}
