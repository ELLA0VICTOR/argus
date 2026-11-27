//! Shared LiteSVM harness for Argus tests.
#![allow(dead_code)]

use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{
            instruction::Instruction, program_option::COption, program_pack::Pack,
            system_program,
        },
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    anchor_spl::{associated_token, token, token::spl_token, token_2022},
    argus::error::ArgusError,
    litesvm::{types::TransactionResult, LiteSVM},
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

pub const DAY: i64 = 86_400;
pub const DECIMALS: u8 = 6;
pub const START_TIME: i64 = 1_800_000_000;

pub struct Env {
    pub svm: LiteSVM,
    /// The vault creator and first owner.
    pub owner: Keypair,
    /// A classic SPL Token mint.
    pub mint: Pubkey,
    pub mint_authority: Keypair,
}

impl Env {
    pub fn new() -> Self {
        let mut svm = LiteSVM::new();
        let bytes = include_bytes!(concat!(
            env!("CARGO_TARGET_TMPDIR"),
            "/../deploy/argus.so"
        ));
        svm.add_program(argus::id(), bytes).unwrap();

        let mut clock: Clock = svm.get_sysvar();
        clock.unix_timestamp = START_TIME;
        svm.set_sysvar(&clock);

        let owner = Keypair::new();
        svm.airdrop(&owner.pubkey(), 100_000_000_000).unwrap();
        let mint_authority = Keypair::new();
        let mint = create_mint(&mut svm, &mint_authority.pubkey(), token::ID);
        Env { svm, owner, mint, mint_authority }
    }

    pub fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }

    /// Moves the clock forward (LiteSVM time travel, audit F5).
    pub fn warp(&mut self, seconds: i64) {
        let mut clock: Clock = self.svm.get_sysvar();
        clock.unix_timestamp += seconds;
        self.svm.set_sysvar(&clock);
        self.svm.expire_blockhash();
    }

    pub fn funded_keypair(&mut self) -> Keypair {
        let k = Keypair::new();
        self.svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
        k
    }

    /// Sends `ixs` with `signers[0]` as the fee payer.
    pub fn send(&mut self, ixs: &[Instruction], signers: &[&Keypair]) -> TransactionResult {
        let blockhash = self.svm.latest_blockhash();
        let msg = Message::new_with_blockhash(ixs, Some(&signers[0].pubkey()), &blockhash);
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
        let res = self.svm.send_transaction(tx);
        self.svm.expire_blockhash();
        res
    }

    pub fn fetch<T: AccountDeserialize>(&self, address: &Pubkey) -> T {
        let acc = self.svm.get_account(address).expect("account missing");
        T::try_deserialize(&mut acc.data.as_slice()).expect("deserialize failed")
    }

    pub fn exists(&self, address: &Pubkey) -> bool {
        self.svm
            .get_account(address)
            .map(|a| a.lamports > 0)
            .unwrap_or(false)
    }

    pub fn token_account(&self, address: &Pubkey) -> spl_token::state::Account {
        let acc = self.svm.get_account(address).expect("token account missing");
        spl_token::state::Account::unpack(&acc.data).unwrap()
    }
}

/// Writes an initialized mint account directly (no CPI needed in tests).
/// `token_program` is `token::ID` or `token_2022::ID`; a plain 82-byte mint is
/// valid for both.
pub fn create_mint(svm: &mut LiteSVM, authority: &Pubkey, token_program: Pubkey) -> Pubkey {
    let mint = Keypair::new().pubkey();
    let state = spl_token::state::Mint {
        mint_authority: COption::Some(*authority),
        supply: 0,
        decimals: DECIMALS,
        is_initialized: true,
        freeze_authority: COption::None,
    };
    let mut data = vec![0u8; spl_token::state::Mint::LEN];
    spl_token::state::Mint::pack(state, &mut data).unwrap();
    let lamports = svm.minimum_balance_for_rent_exemption(data.len());
    svm.set_account(
        mint,
        Account { lamports, data, owner: token_program, executable: false, rent_epoch: 0 },
    )
    .unwrap();
    mint
}

/// Rewrites `mint` so that `authority` is also its freeze authority (for SPL freeze tests).
pub fn give_mint_freeze_authority(svm: &mut LiteSVM, mint: &Pubkey, authority: &Pubkey) {
    let mut acc = svm.get_account(mint).unwrap();
    let mut state = spl_token::state::Mint::unpack(&acc.data).unwrap();
    state.freeze_authority = COption::Some(*authority);
    spl_token::state::Mint::pack(state, &mut acc.data).unwrap();
    svm.set_account(*mint, acc).unwrap();
}

/// SPL `FreezeAccount`, signed by the mint's freeze authority.
pub fn spl_freeze_ix(account: &Pubkey, mint: &Pubkey, freeze_authority: &Pubkey) -> Instruction {
    spl_token::instruction::freeze_account(&token::ID, account, mint, freeze_authority, &[]).unwrap()
}

/// Writes raw bytes at `addr` with the given owner (for malformed-account tests).
pub fn write_raw_account(svm: &mut LiteSVM, addr: Pubkey, owner: Pubkey, data: Vec<u8>) {
    let lamports = svm.minimum_balance_for_rent_exemption(data.len());
    svm.set_account(addr, Account { lamports, data, owner, executable: false, rent_epoch: 0 })
        .unwrap();
}

pub fn token_2022_id() -> Pubkey {
    token_2022::ID
}

pub fn ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    associated_token::get_associated_token_address_with_program_id(owner, mint, &token::ID)
}

/// Permissionless ATA creation, as any third party could do on-chain.
pub fn create_ata_ix(payer: &Pubkey, wallet: &Pubkey, mint: &Pubkey) -> Instruction {
    associated_token::spl_associated_token_account::instruction::create_associated_token_account(
        payer, wallet, mint, &token::ID,
    )
}

pub fn mint_to_ix(mint: &Pubkey, dest: &Pubkey, authority: &Pubkey, amount: u64) -> Instruction {
    spl_token::instruction::mint_to(&token::ID, mint, dest, authority, &[], amount).unwrap()
}

pub fn vault_pda(creator: &Pubkey, vault_id: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[argus::VAULT_SEED, creator.as_ref(), &vault_id.to_le_bytes()],
        &argus::id(),
    )
    .0
}

/// Arguments for `initialize_vault`, with sensible defaults (1-of-1, 24h delay).
#[derive(Clone)]
pub struct InitParams {
    pub vault_id: u64,
    pub guardians: Vec<Pubkey>,
    pub threshold: u8,
    pub ai_guardian: Pubkey,
    pub safe_address: Pubkey,
    pub delay_seconds: i64,
    pub daily_limit: u64,
}

impl InitParams {
    pub fn new(guardians: Vec<Pubkey>, threshold: u8, ai: Pubkey, safe: Pubkey) -> Self {
        InitParams {
            vault_id: 0,
            guardians,
            threshold,
            ai_guardian: ai,
            safe_address: safe,
            delay_seconds: DAY,
            daily_limit: 100 * 10u64.pow(DECIMALS as u32),
        }
    }
}

pub fn init_vault_ix(creator: &Pubkey, mint: &Pubkey, p: &InitParams) -> Instruction {
    init_vault_ix_with(creator, mint, p, token::ID, None)
}

/// Full control over the token program and the vault token account, for attack tests.
pub fn init_vault_ix_with(
    creator: &Pubkey,
    mint: &Pubkey,
    p: &InitParams,
    token_program: Pubkey,
    vault_token_override: Option<Pubkey>,
) -> Instruction {
    let vault = vault_pda(creator, p.vault_id);
    let vault_token = vault_token_override.unwrap_or_else(|| {
        associated_token::get_associated_token_address_with_program_id(&vault, mint, &token_program)
    });
    Instruction::new_with_bytes(
        argus::id(),
        &argus::instruction::InitializeVault {
            vault_id: p.vault_id,
            guardians: p.guardians.clone(),
            threshold: p.threshold,
            ai_guardian: p.ai_guardian,
            safe_address: p.safe_address,
            delay_seconds: p.delay_seconds,
            daily_limit: p.daily_limit,
        }
        .data(),
        argus::accounts::InitializeVault {
            creator: *creator,
            vault,
            mint: *mint,
            token_program,
            vault_token,
            associated_token_program: associated_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

// ---------------------------------------------------------------------------
// Vault fixture: real keypairs for every role and a funded vault.
// ---------------------------------------------------------------------------

pub const UNIT: u64 = 1_000_000; // 1 token at 6 decimals

pub struct Fx {
    pub env: Env,
    pub vault: Pubkey,
    pub vault_ata: Pubkey,
    pub guardians: Vec<Keypair>,
    pub ai: Keypair,
    pub safe: Keypair,
    /// A wallet the owner controls elsewhere (e.g. their exchange account).
    pub owner_dest: Pubkey,
    pub params: InitParams,
}

impl Fx {
    /// 2-of-3 vault, 24h delay, 100-token daily limit, funded with `balance` tokens.
    pub fn new(balance: u64) -> Self {
        let mut env = Env::new();
        let guardians: Vec<Keypair> = (0..3).map(|_| env.funded_keypair()).collect();
        let ai = env.funded_keypair();
        let safe = Keypair::new();
        let params = InitParams::new(
            guardians.iter().map(|g| g.pubkey()).collect(),
            2,
            ai.pubkey(),
            safe.pubkey(),
        );
        let owner = env.owner.insecure_clone();
        assert_ok(env.send(&[init_vault_ix(&owner.pubkey(), &env.mint, &params)], &[&owner]));
        let vault = vault_pda(&owner.pubkey(), params.vault_id);
        let vault_ata = ata(&vault, &env.mint);
        let mut fx = Fx {
            env,
            vault,
            vault_ata,
            guardians,
            ai,
            safe,
            owner_dest: Pubkey::default(),
            params,
        };
        if balance > 0 {
            fx.mint_to(&vault_ata, balance);
        }
        let owner_wallet = Keypair::new().pubkey();
        fx.owner_dest = fx.token_account_for(&owner_wallet);
        fx
    }

    pub fn owner(&self) -> Keypair {
        self.env.owner.insecure_clone()
    }

    pub fn mint(&self) -> Pubkey {
        self.env.mint
    }

    pub fn mint_to(&mut self, dest: &Pubkey, amount: u64) {
        let auth = self.env.mint_authority.insecure_clone();
        let payer = self.owner();
        let ix = mint_to_ix(&self.env.mint, dest, &auth.pubkey(), amount);
        assert_ok(self.env.send(&[ix], &[&payer, &auth]));
    }

    /// Creates (if needed) and returns the vault-mint ATA of `wallet`.
    pub fn token_account_for(&mut self, wallet: &Pubkey) -> Pubkey {
        let addr = ata(wallet, &self.env.mint);
        if !self.env.exists(&addr) {
            let payer = self.owner();
            let ix = create_ata_ix(&payer.pubkey(), wallet, &self.env.mint);
            assert_ok(self.env.send(&[ix], &[&payer]));
        }
        addr
    }

    pub fn balance(&self, token_account: &Pubkey) -> u64 {
        self.env.token_account(token_account).amount
    }

    pub fn vault_state(&self) -> argus::state::Vault {
        self.env.fetch(&self.vault)
    }

    /// Patches vault state directly, for states whose instructions come later
    /// (freeze, owner rotation). Replace with real instructions as they land.
    pub fn patch_vault(&mut self, f: impl FnOnce(&mut argus::state::Vault)) {
        let mut acc = self.env.svm.get_account(&self.vault).unwrap();
        let mut v: argus::state::Vault =
            AccountDeserialize::try_deserialize(&mut acc.data.as_slice()).unwrap();
        f(&mut v);
        let mut data = Vec::with_capacity(acc.data.len());
        anchor_lang::AccountSerialize::try_serialize(&v, &mut data).unwrap();
        data.resize(acc.data.len(), 0);
        acc.data = data;
        self.env.svm.set_account(self.vault, acc).unwrap();
    }

    /// Writes a TrustedAddress record (normally created by an executed AddTrusted).
    pub fn set_trusted(&mut self, wallet: &Pubkey, active_at: i64) -> Pubkey {
        let addr = trusted_pda(&self.vault, wallet);
        write_program_account(
            &mut self.env.svm,
            addr,
            &argus::state::TrustedAddress {
                vault: self.vault,
                wallet: *wallet,
                active_at,
                bump: Pubkey::find_program_address(
                    &[argus::TRUSTED_SEED, self.vault.as_ref(), wallet.as_ref()],
                    &argus::id(),
                )
                .1,
            },
        );
        addr
    }

    // ----- instruction senders -----

    pub fn deposit(&mut self, depositor: &Keypair, from: &Pubkey, amount: u64) -> TransactionResult {
        let ix = deposit_ix(&self.vault, &self.env.mint, &depositor.pubkey(), from, amount);
        self.env.send(&[ix], &[depositor])
    }

    pub fn instant(&mut self, signer: &Keypair, dest: &Pubkey, amount: u64) -> TransactionResult {
        let ix = instant_ix(&self.vault, &self.env.mint, &signer.pubkey(), dest, amount);
        self.env.send(&[ix], &[signer])
    }

    pub fn trusted(&mut self, signer: &Keypair, dest: &Pubkey, amount: u64) -> TransactionResult {
        let dest_owner = self.env.token_account(dest).owner;
        let ix = trusted_ix(&self.vault, &self.env.mint, &signer.pubkey(), dest, &dest_owner, amount);
        self.env.send(&[ix], &[signer])
    }

    /// Requests a withdrawal; returns the result and the Withdrawal PDA it targets.
    pub fn request(&mut self, signer: &Keypair, dest: &Pubkey, amount: u64) -> (TransactionResult, Pubkey) {
        let id = self.vault_state().next_withdrawal_id;
        let w = withdrawal_pda(&self.vault, id);
        let ix = request_ix(&self.vault, &self.env.mint, &signer.pubkey(), dest, &w, amount);
        (self.env.send(&[ix], &[signer]), w)
    }

    pub fn cancel(&mut self, signer: &Keypair, withdrawal: &Pubkey) -> TransactionResult {
        let w: argus::state::Withdrawal = self.env.fetch(withdrawal);
        let ix = cancel_ix(&self.vault, &signer.pubkey(), withdrawal, &w.rent_payer);
        self.env.send(&[ix], &[signer])
    }

    pub fn freeze(&mut self, signer: &Keypair) -> TransactionResult {
        let ix = freeze_ix(&self.vault, &signer.pubkey());
        self.env.send(&[ix], &[signer])
    }

    /// Freezes through the real instruction, signed by guardian 0.
    pub fn freeze_by_guardian(&mut self) {
        let g = self.guardians[0].insecure_clone();
        assert_ok(self.freeze(&g));
    }

    pub fn sweep(&mut self, signer: &Keypair, freeze: bool) -> TransactionResult {
        let safe = self.vault_state().safe_address;
        let ix = sweep_ix(&self.vault, &self.env.mint, &signer.pubkey(), &safe, freeze);
        self.env.send(&[ix], &[signer])
    }

    pub fn safe_ata(&self) -> Pubkey {
        ata(&self.vault_state().safe_address, &self.env.mint)
    }

    // ----- governance -----

    pub fn propose(&mut self, guardian: &Keypair, action: argus::GovAction) -> (TransactionResult, Pubkey) {
        let id = self.vault_state().next_proposal_id;
        let p = proposal_pda(&self.vault, id);
        let ix = propose_ix(&self.vault, &guardian.pubkey(), &p, action);
        (self.env.send(&[ix], &[guardian]), p)
    }

    pub fn approve(&mut self, guardian: &Keypair, proposal: &Pubkey) -> TransactionResult {
        let ix = approve_ix(&self.vault, &guardian.pubkey(), proposal);
        self.env.send(&[ix], &[guardian])
    }

    pub fn veto(&mut self, guardian: &Keypair, proposal: &Pubkey) -> TransactionResult {
        let p: argus::Proposal = self.env.fetch(proposal);
        let ix = veto_ix(&self.vault, &guardian.pubkey(), proposal, &p.rent_payer);
        self.env.send(&[ix], &[guardian])
    }

    pub fn exec_proposal(&mut self, executor: &Keypair, proposal: &Pubkey) -> TransactionResult {
        let p: argus::Proposal = self.env.fetch(proposal);
        let trusted = p.action.trusted_wallet().map(|w| trusted_pda(&self.vault, &w));
        let ix = exec_proposal_ix(&self.vault, &executor.pubkey(), proposal, &p.rent_payer, trusted);
        self.env.send(&[ix], &[executor])
    }

    pub fn close_proposal(&mut self, closer: &Keypair, proposal: &Pubkey) -> TransactionResult {
        let p: argus::Proposal = self.env.fetch(proposal);
        let ix = close_proposal_ix(&self.vault, &closer.pubkey(), proposal, &p.rent_payer);
        self.env.send(&[ix], &[closer])
    }

    /// Guardian 0 proposes and guardian 1 approves (2-of-3), so the threshold is reached.
    pub fn pass(&mut self, action: argus::GovAction) -> Pubkey {
        let g0 = self.guardians[0].insecure_clone();
        let g1 = self.guardians[1].insecure_clone();
        let (res, p) = self.propose(&g0, action);
        assert_ok(res);
        assert_ok(self.approve(&g1, &p));
        p
    }

    /// Passes, waits out the timelock and executes.
    pub fn enact(&mut self, action: argus::GovAction) {
        let p = self.pass(action);
        let eta = self.env.fetch::<argus::Proposal>(&p).eta;
        let wait = eta - self.env.now();
        if wait > 0 {
            self.env.warp(wait);
        }
        let ex = self.env.funded_keypair();
        assert_ok(self.exec_proposal(&ex, &p));
    }

    pub fn execute(&mut self, cranker: &Keypair, withdrawal: &Pubkey) -> TransactionResult {
        let w: argus::state::Withdrawal = self.env.fetch(withdrawal);
        let ix = execute_ix(&self.vault, &self.env.mint, &cranker.pubkey(), withdrawal, &w.rent_payer, &w.destination);
        self.env.send(&[ix], &[cranker])
    }
}

pub fn write_program_account<T: anchor_lang::AccountSerialize>(svm: &mut LiteSVM, addr: Pubkey, value: &T) {
    let mut data = Vec::new();
    value.try_serialize(&mut data).unwrap();
    let lamports = svm.minimum_balance_for_rent_exemption(data.len());
    svm.set_account(
        addr,
        Account { lamports, data, owner: argus::id(), executable: false, rent_epoch: 0 },
    )
    .unwrap();
}

pub fn withdrawal_pda(vault: &Pubkey, id: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[argus::WITHDRAWAL_SEED, vault.as_ref(), &id.to_le_bytes()],
        &argus::id(),
    )
    .0
}

pub fn trusted_pda(vault: &Pubkey, wallet: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[argus::TRUSTED_SEED, vault.as_ref(), wallet.as_ref()],
        &argus::id(),
    )
    .0
}

pub fn deposit_ix(vault: &Pubkey, mint: &Pubkey, depositor: &Pubkey, from: &Pubkey, amount: u64) -> Instruction {
    Instruction::new_with_bytes(
        argus::id(),
        &argus::instruction::Deposit { amount }.data(),
        argus::accounts::Deposit {
            depositor: *depositor,
            vault: *vault,
            mint: *mint,
            token_program: token::ID,
            vault_token: ata(vault, mint),
            from: *from,
        }
        .to_account_metas(None),
    )
}

pub fn instant_ix(vault: &Pubkey, mint: &Pubkey, owner: &Pubkey, dest: &Pubkey, amount: u64) -> Instruction {
    Instruction::new_with_bytes(
        argus::id(),
        &argus::instruction::WithdrawInstant { amount }.data(),
        argus::accounts::WithdrawInstant {
            vault: *vault,
            owner: *owner,
            mint: *mint,
            token_program: token::ID,
            vault_token: ata(vault, mint),
            destination: *dest,
        }
        .to_account_metas(None),
    )
}

pub fn trusted_ix(
    vault: &Pubkey,
    mint: &Pubkey,
    owner: &Pubkey,
    dest: &Pubkey,
    dest_owner: &Pubkey,
    amount: u64,
) -> Instruction {
    Instruction::new_with_bytes(
        argus::id(),
        &argus::instruction::WithdrawTrusted { amount }.data(),
        argus::accounts::WithdrawTrusted {
            vault: *vault,
            owner: *owner,
            mint: *mint,
            token_program: token::ID,
            vault_token: ata(vault, mint),
            destination: *dest,
            trusted: trusted_pda(vault, dest_owner),
        }
        .to_account_metas(None),
    )
}

pub fn request_ix(
    vault: &Pubkey,
    mint: &Pubkey,
    owner: &Pubkey,
    dest: &Pubkey,
    withdrawal: &Pubkey,
    amount: u64,
) -> Instruction {
    Instruction::new_with_bytes(
        argus::id(),
        &argus::instruction::RequestWithdrawal { amount }.data(),
        argus::accounts::RequestWithdrawal {
            vault: *vault,
            owner: *owner,
            mint: *mint,
            token_program: token::ID,
            vault_token: ata(vault, mint),
            destination: *dest,
            withdrawal: *withdrawal,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

pub fn execute_ix(
    vault: &Pubkey,
    mint: &Pubkey,
    cranker: &Pubkey,
    withdrawal: &Pubkey,
    rent_payer: &Pubkey,
    dest: &Pubkey,
) -> Instruction {
    Instruction::new_with_bytes(
        argus::id(),
        &argus::instruction::ExecuteWithdrawal {}.data(),
        argus::accounts::ExecuteWithdrawal {
            cranker: *cranker,
            vault: *vault,
            withdrawal: *withdrawal,
            rent_payer: *rent_payer,
            mint: *mint,
            token_program: token::ID,
            vault_token: ata(vault, mint),
            destination: *dest,
        }
        .to_account_metas(None),
    )
}

pub fn proposal_pda(vault: &Pubkey, id: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[argus::PROPOSAL_SEED, vault.as_ref(), &id.to_le_bytes()],
        &argus::id(),
    )
    .0
}

pub fn propose_ix(vault: &Pubkey, guardian: &Pubkey, proposal: &Pubkey, action: argus::GovAction) -> Instruction {
    Instruction::new_with_bytes(
        argus::id(),
        &argus::instruction::Propose { action }.data(),
        argus::accounts::Propose {
            guardian: *guardian,
            vault: *vault,
            proposal: *proposal,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

pub fn approve_ix(vault: &Pubkey, guardian: &Pubkey, proposal: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        argus::id(),
        &argus::instruction::Approve {}.data(),
        argus::accounts::Approve { guardian: *guardian, vault: *vault, proposal: *proposal }
            .to_account_metas(None),
    )
}

pub fn veto_ix(vault: &Pubkey, guardian: &Pubkey, proposal: &Pubkey, rent_payer: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        argus::id(),
        &argus::instruction::Veto {}.data(),
        argus::accounts::Veto {
            guardian: *guardian,
            vault: *vault,
            proposal: *proposal,
            rent_payer: *rent_payer,
        }
        .to_account_metas(None),
    )
}

pub fn exec_proposal_ix(
    vault: &Pubkey,
    executor: &Pubkey,
    proposal: &Pubkey,
    rent_payer: &Pubkey,
    trusted: Option<Pubkey>,
) -> Instruction {
    Instruction::new_with_bytes(
        argus::id(),
        &argus::instruction::ExecuteProposal {}.data(),
        argus::accounts::ExecuteProposal {
            executor: *executor,
            vault: *vault,
            proposal: *proposal,
            rent_payer: *rent_payer,
            trusted,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

pub fn close_proposal_ix(vault: &Pubkey, closer: &Pubkey, proposal: &Pubkey, rent_payer: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        argus::id(),
        &argus::instruction::CloseProposal {}.data(),
        argus::accounts::CloseProposal {
            closer: *closer,
            vault: *vault,
            proposal: *proposal,
            rent_payer: *rent_payer,
        }
        .to_account_metas(None),
    )
}

pub fn cancel_ix(vault: &Pubkey, canceller: &Pubkey, withdrawal: &Pubkey, rent_payer: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        argus::id(),
        &argus::instruction::CancelWithdrawal {}.data(),
        argus::accounts::CancelWithdrawal {
            canceller: *canceller,
            vault: *vault,
            withdrawal: *withdrawal,
            rent_payer: *rent_payer,
        }
        .to_account_metas(None),
    )
}

pub fn freeze_ix(vault: &Pubkey, signer: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        argus::id(),
        &argus::instruction::Freeze {}.data(),
        argus::accounts::Freeze { signer: *signer, vault: *vault }.to_account_metas(None),
    )
}

pub fn sweep_ix(vault: &Pubkey, mint: &Pubkey, guardian: &Pubkey, safe_wallet: &Pubkey, freeze: bool) -> Instruction {
    sweep_ix_with(vault, mint, guardian, safe_wallet, &ata(safe_wallet, mint), freeze)
}

pub fn sweep_ix_with(
    vault: &Pubkey,
    mint: &Pubkey,
    guardian: &Pubkey,
    safe_wallet: &Pubkey,
    safe_token: &Pubkey,
    freeze: bool,
) -> Instruction {
    Instruction::new_with_bytes(
        argus::id(),
        &argus::instruction::EmergencySweep { freeze }.data(),
        argus::accounts::EmergencySweep {
            guardian: *guardian,
            vault: *vault,
            mint: *mint,
            token_program: token::ID,
            vault_token: ata(vault, mint),
            safe_wallet: *safe_wallet,
            safe_token: *safe_token,
            associated_token_program: associated_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

/// Asserts the transaction failed with a specific Argus error.
pub fn assert_argus_err(res: TransactionResult, expected: ArgusError) {
    let code = anchor_lang::error::ERROR_CODE_OFFSET + expected as u32;
    match res {
        Ok(_) => panic!("expected {expected:?} ({code}), but the transaction succeeded"),
        Err(e) => {
            let got = format!("{:?}", e.err);
            assert!(
                got.contains(&format!("Custom({code})")),
                "expected {expected:?} (Custom({code})), got {got}\nlogs:\n{}",
                e.meta.logs.join("\n")
            );
        }
    }
}

/// Asserts the transaction failed with a specific Anchor framework error.
pub fn assert_anchor_err(res: TransactionResult, expected: anchor_lang::error::ErrorCode) {
    let code = expected as u32;
    match res {
        Ok(_) => panic!("expected {expected:?} ({code}), but the transaction succeeded"),
        Err(e) => {
            let got = format!("{:?}", e.err);
            assert!(
                got.contains(&format!("Custom({code})")),
                "expected {expected:?} (Custom({code})), got {got}\nlogs:\n{}",
                e.meta.logs.join("\n")
            );
        }
    }
}

pub fn assert_ok(res: TransactionResult) {
    if let Err(e) = res {
        panic!("transaction failed: {:?}\nlogs:\n{}", e.err, e.meta.logs.join("\n"));
    }
}
