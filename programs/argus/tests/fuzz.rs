//! Audit F4: property test. Random instruction sequences with random signers.
//! After every step, assert INV-1, INV-2, INV-3, INV-4, INV-5, INV-6 and INV-7
//! against the vault state before and after.
//!
//! Deterministic (xorshift PRNG), so a failing seed and step reproduces exactly.
mod common;

use {
    anchor_lang::prelude::Pubkey,
    argus::{GovAction, Proposal, Withdrawal},
    common::*,
    solana_keypair::Keypair,
    solana_signer::Signer,
    std::collections::HashMap,
};

const SEEDS: u64 = 20;
const STEPS: usize = 300;

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
    fn pick<'a, T>(&mut self, v: &'a [T]) -> &'a T {
        &v[self.below(v.len() as u64) as usize]
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Op {
    Instant,
    Trusted,
    Request,
    Execute,
    Cancel,
    Freeze,
    Sweep,
    Propose,
    Approve,
    Veto,
    ExecProposal,
    Warp,
}
const OPS: [Op; 12] = [
    Op::Instant,
    Op::Trusted,
    Op::Request,
    Op::Execute,
    Op::Cancel,
    Op::Freeze,
    Op::Sweep,
    Op::Propose,
    Op::Approve,
    Op::Veto,
    Op::ExecProposal,
    Op::Warp,
];

/// Settings that only an executed proposal may change (INV-2).
fn config(v: &argus::Vault) -> (Pubkey, [Pubkey; 5], u8, u8, Pubkey, Pubkey, i64, u64, u8) {
    (
        v.owner,
        v.guardians,
        v.guardian_count,
        v.threshold,
        v.ai_guardian,
        v.safe_address,
        v.delay_seconds,
        v.daily_limit,
        v.trusted_count,
    )
}

fn run(seed: u64) {
    let mut rng = Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1);
    let total: u64 = 2_000 * UNIT;
    let mut fx = Fx::new(total);

    // A real, governance-created trusted wallet.
    let tw = Keypair::new().pubkey();
    fx.enact(GovAction::AddTrusted { wallet: tw });
    let trusted_dest = fx.token_account_for(&tw);
    let owner_dest = fx.owner_dest;

    // Every keypair that could ever hold a role, so we can always sign as it.
    let mut owners: Vec<Keypair> = vec![fx.owner()];
    let mut ais: Vec<Keypair> = vec![fx.ai.insecure_clone()];
    let guardians: Vec<Keypair> = fx.guardians.iter().map(|k| k.insecure_clone()).collect();
    let stranger = fx.env.funded_keypair();
    let mut safes: Vec<Pubkey> = vec![fx.safe.pubkey()];

    // Tracked objects: withdrawal -> (executes_at, owner_epoch); proposal -> (eta, guardian_epoch).
    let mut wds: HashMap<Pubkey, (i64, u32)> = HashMap::new();
    let mut props: HashMap<Pubkey, (i64, u32)> = HashMap::new();
    let mut wins: HashMap<String, u32> = HashMap::new();

    for step in 0..STEPS {
        let ctx = format!("seed {seed} step {step}");
        let pre = fx.vault_state();
        let pre_bal = fx.balance(&fx.vault_ata.clone());

        let mut signers: Vec<Keypair> = vec![];
        signers.extend(owners.iter().map(|k| k.insecure_clone()));
        signers.extend(guardians.iter().map(|k| k.insecure_clone()));
        signers.extend(ais.iter().map(|k| k.insecure_clone()));
        signers.push(stranger.insecure_clone());
        // Weighted signer: about 40% current owner, 30% a guardian, 10% the AI and
        // 20% anyone (old owners, past AIs, the stranger). Role checks then get
        // exercised in both directions.
        let current_owner = owners.iter().find(|k| k.pubkey() == pre.owner);
        let current_ai = ais.iter().find(|k| k.pubkey() == pre.ai_guardian);
        let roll = rng.below(10);
        let signer = match (roll, current_owner, current_ai) {
            (0..=3, Some(o), _) => o.insecure_clone(),
            (4..=6, _, _) => rng.pick(&guardians).insecure_clone(),
            (7, _, Some(a)) => a.insecure_clone(),
            _ => rng.pick(&signers).insecure_clone(),
        };
        for k in &signers {
            if fx.env.svm.get_balance(&k.pubkey()).unwrap_or(0) < 1_000_000_000 {
                fx.env.svm.airdrop(&k.pubkey(), 5_000_000_000).unwrap();
            }
        }
        let s = signer.pubkey();
        let is_owner = pre.owner == s;
        let is_guardian = pre.active_guardians().contains(&s);
        let is_ai = pre.ai_guardian != Pubkey::default() && pre.ai_guardian == s;

        // Weighted ops: freeze and sweep are rare (each ends most outflow activity),
        // while outflows, governance and time are common.
        let op = match rng.below(100) {
            0..=13 => Op::Instant,
            14..=25 => Op::Trusted,
            26..=37 => Op::Request,
            38..=47 => Op::Execute,
            48..=53 => Op::Cancel,
            54..=55 => Op::Freeze,
            56 => Op::Sweep,
            57..=66 => Op::Propose,
            67..=76 => Op::Approve,
            77..=79 => Op::Veto,
            80..=89 => Op::ExecProposal,
            _ => Op::Warp,
        };
        let _ = OPS;
        let amount = (1 + rng.below(60)) * UNIT;
        let mut target_wd: Option<Pubkey> = None;
        let mut target_prop: Option<Pubkey> = None;
        let mut new_prop: Option<Pubkey> = None;

        // When frozen, a third of the time the guardians run the full unfreeze flow
        // (propose, approve, execute), so the run doesn't stay frozen. This counts as
        // an ExecProposal for the invariant checks.
        let unfreeze_flow = pre.frozen && rng.below(3) == 0;
        let op = if unfreeze_flow { Op::ExecProposal } else { op };

        let ok = match op {
            Op::ExecProposal if unfreeze_flow => {
                let g0 = guardians[0].insecure_clone();
                let g1 = guardians[1].insecure_clone();
                let (r, p) = fx.propose(&g0, GovAction::Unfreeze);
                assert!(r.is_ok(), "{ctx}: guardian propose Unfreeze failed");
                let pr: Proposal = fx.env.fetch(&p);
                props.insert(p, (pr.eta, pr.guardian_epoch));
                let _ = fx.approve(&g1, &p);
                target_prop = Some(p);
                fx.exec_proposal(&stranger.insecure_clone(), &p).is_ok()
            }
            Op::Instant => fx.instant(&signer, &owner_dest, amount).is_ok(),
            Op::Trusted => fx.trusted(&signer, &trusted_dest, amount).is_ok(),
            Op::Request => {
                let dest = if rng.below(2) == 0 { owner_dest } else { trusted_dest };
                let (r, w) = fx.request(&signer, &dest, amount);
                if r.is_ok() {
                    let wd: Withdrawal = fx.env.fetch(&w);
                    wds.insert(w, (wd.executes_at, wd.owner_epoch));
                }
                r.is_ok()
            }
            Op::Execute | Op::Cancel => {
                let live: Vec<Pubkey> = wds.keys().copied().collect();
                if live.is_empty() {
                    continue;
                }
                let w = *rng.pick(&live);
                target_wd = Some(w);
                let r = if op == Op::Execute {
                    fx.execute(&stranger.insecure_clone(), &w)
                } else {
                    fx.cancel(&signer, &w)
                };
                r.is_ok()
            }
            Op::Freeze => fx.freeze(&signer).is_ok(),
            Op::Sweep => {
                let freeze = rng.below(2) == 0;
                fx.sweep(&signer, freeze).is_ok()
            }
            Op::Propose => {
                let action = match rng.below(9) {
                    0 => {
                        let k = Keypair::new();
                        let a = GovAction::RotateOwner { new_owner: k.pubkey() };
                        owners.push(k);
                        a
                    }
                    1 => GovAction::RotateOwner { new_owner: *rng.pick(&[pre.owner, guardians[0].pubkey(), tw]) },
                    2 => GovAction::Unfreeze,
                    3 => GovAction::TightenLimits {
                        daily_limit: pre.daily_limit.saturating_sub(UNIT * rng.below(20)),
                        delay_seconds: pre.delay_seconds + rng.below(3_600) as i64,
                    },
                    4 => GovAction::LoosenLimits {
                        daily_limit: pre.daily_limit + UNIT * rng.below(200),
                        delay_seconds: 60 + rng.below(2 * DAY as u64) as i64,
                    },
                    5 => {
                        if rng.below(2) == 0 {
                            GovAction::SetAiGuardian { key: Pubkey::default() }
                        } else {
                            let k = Keypair::new();
                            let a = GovAction::SetAiGuardian { key: k.pubkey() };
                            ais.push(k);
                            a
                        }
                    }
                    6 => GovAction::AddTrusted { wallet: *rng.pick(&[Keypair::new().pubkey(), pre.owner, tw]) },
                    7 => {
                        let k = Keypair::new().pubkey();
                        safes.push(k);
                        GovAction::SetSafeAddress { wallet: *rng.pick(&[k, pre.owner]) }
                    }
                    _ => GovAction::SetGuardians {
                        guardians: guardians.iter().map(|k| k.pubkey()).collect(),
                        threshold: 1 + rng.below(3) as u8,
                    },
                };
                let (r, p) = fx.propose(&signer, action);
                if r.is_ok() {
                    new_prop = Some(p);
                    let pr: Proposal = fx.env.fetch(&p);
                    props.insert(p, (pr.eta, pr.guardian_epoch));
                }
                r.is_ok()
            }
            Op::Approve | Op::Veto | Op::ExecProposal => {
                let live: Vec<Pubkey> = props.keys().copied().collect();
                if live.is_empty() {
                    continue;
                }
                let p = *rng.pick(&live);
                target_prop = Some(p);
                let r = match op {
                    Op::Approve => fx.approve(&signer, &p),
                    Op::Veto => fx.veto(&signer, &p),
                    _ => fx.exec_proposal(&stranger.insecure_clone(), &p),
                };
                r.is_ok()
            }
            Op::Warp => {
                fx.env.warp(1 + rng.below(2 * DAY as u64) as i64);
                true
            }
        };

        if ok {
            *wins.entry(format!("{op:?}")).or_default() += 1;
        }
        let post = fx.vault_state();
        let post_bal = fx.balance(&fx.vault_ata.clone());

        // ---------- role matrix: success implies a permitted signer (INV-2, INV-5) ----------
        if ok {
            match op {
                Op::Instant | Op::Trusted | Op::Request => assert!(is_owner, "{ctx}: {op:?} succeeded for non-owner"),
                Op::Cancel | Op::Freeze => assert!(is_owner || is_guardian || is_ai, "{ctx}: {op:?} by no role"),
                Op::Sweep | Op::Propose | Op::Approve | Op::Veto => {
                    assert!(is_guardian, "{ctx}: {op:?} succeeded for non-guardian (owner={is_owner}, ai={is_ai})")
                }
                _ => {}
            }
            if matches!(op, Op::Instant | Op::Trusted | Op::Request) {
                assert!(!pre.frozen, "{ctx}: {op:?} succeeded while frozen");
            }
        }

        // ---------- INV-1 / INV-4: outflows only through allowed paths ----------
        if post_bal < pre_bal {
            assert!(ok, "{ctx}: balance fell on a failed tx");
            assert!(
                matches!(op, Op::Instant | Op::Trusted | Op::Execute | Op::Sweep),
                "{ctx}: balance fell via {op:?}"
            );
            if pre.frozen {
                assert_eq!(op, Op::Sweep, "{ctx}: funds moved while frozen via {op:?} (INV-4)");
            }
            if op == Op::Instant {
                assert!(post.spent_in_window <= post.daily_limit, "{ctx}: over daily limit");
            }
        }
        assert!(post_bal <= pre_bal, "{ctx}: vault balance increased unexpectedly");
        // Conservation: every token is in the vault or a known destination.
        let mut sum = post_bal + fx.balance(&owner_dest) + fx.balance(&trusted_dest);
        for sa in &safes {
            let a = ata(sa, &fx.mint());
            if fx.env.exists(&a) {
                sum += fx.balance(&a);
            }
        }
        assert_eq!(sum, total, "{ctx}: tokens not conserved");

        // ---------- INV-2: settings change only by an executed proposal ----------
        if config(&pre) != config(&post) {
            assert!(ok && op == Op::ExecProposal, "{ctx}: config changed via {op:?}");
        }
        if pre.frozen && !post.frozen {
            assert!(ok && op == Op::ExecProposal, "{ctx}: unfrozen via {op:?}");
        }
        if !pre.frozen && post.frozen {
            assert!(matches!(op, Op::Freeze | Op::Sweep), "{ctx}: frozen via {op:?}");
        }
        if pre.owner_epoch != post.owner_epoch {
            assert!(post.owner_epoch == pre.owner_epoch + 1 && op == Op::ExecProposal, "{ctx}: owner_epoch");
        }

        // ---------- INV-6 / INV-7: epochs on success ----------
        if ok && op == Op::Execute {
            let (_, epoch) = wds[&target_wd.unwrap()];
            assert_eq!(epoch, pre.owner_epoch, "{ctx}: stale withdrawal executed (INV-6)");
        }
        if ok && matches!(op, Op::Approve | Op::ExecProposal) {
            let (_, epoch) = props[&target_prop.unwrap()];
            assert_eq!(epoch, pre.guardian_epoch, "{ctx}: stale proposal {op:?} (INV-7)");
        }

        // ---------- INV-3: executes_at / eta never move; drop closed accounts ----------
        wds.retain(|w, (executes_at, _)| {
            if !fx.env.exists(w) {
                return false;
            }
            let cur: Withdrawal = fx.env.fetch(w);
            assert_eq!(cur.executes_at, *executes_at, "{ctx}: executes_at moved (INV-3)");
            true
        });
        props.retain(|p, (eta, _)| {
            if !fx.env.exists(p) {
                return false;
            }
            let cur: Proposal = fx.env.fetch(p);
            if *eta != 0 {
                assert_eq!(cur.eta, *eta, "{ctx}: eta moved (INV-3)");
            }
            *eta = cur.eta;
            true
        });
        let _ = new_prop;
    }
    let mut w: Vec<_> = wins.into_iter().collect();
    w.sort();
    println!("seed {seed} successes: {w:?}");
    coverage_add(&w);
}

fn coverage_add(w: &[(String, u32)]) {
    let mut g = COVERAGE.lock().unwrap();
    for (k, v) in w {
        *g.entry(k.clone()).or_default() += v;
    }
}

static COVERAGE: std::sync::Mutex<std::collections::BTreeMap<String, u32>> =
    std::sync::Mutex::new(std::collections::BTreeMap::new());

#[test]
fn fuzz_random_sequences_preserve_invariants() {
    for seed in 1..=SEEDS {
        run(seed);
    }
    // The fuzz is only meaningful if every operation actually succeeds sometimes.
    let cov = COVERAGE.lock().unwrap();
    println!("total successes: {cov:?}");
    for op in ["Instant", "Trusted", "Request", "Execute", "Cancel", "Freeze", "Sweep", "Propose", "Approve", "Veto", "ExecProposal"] {
        assert!(cov.get(op).copied().unwrap_or(0) > 0, "fuzz never exercised a successful {op}");
    }
}
