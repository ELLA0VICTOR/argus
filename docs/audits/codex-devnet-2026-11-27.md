# Codex devnet verification and probe follow-up

Date: 2026-11-27 (Africa/Lagos). This verifies round-1 fixes against the public deployment; it is not a new independent audit round.

## Deployment

Queried the public `https://api.devnet.solana.com` endpoint with Solana CLI `program show`, `genesis-hash` and `program dump`. No private key, server RPC credential or upgrade-authority file was opened.

| Field | Observed |
|---|---|
| Program | `4LH7ikNGVVNaemB7eaLGUMbwSBHHqA2hKXTdrfhgD6nh` |
| Deployment slot | `526836877` |
| ProgramData | `Hu2rKJDBoXS2VPnLcTXmYoNrMTtPveLXAEbTdV7nnh7J` |
| Upgrade authority | `6X8MNjeSazjbCexkizQMwn8L2TuKLMz7NNkb8czdXhBR` |
| Loader | `BPFLoaderUpgradeab1e11111111111111111111111` |
| Executable size | `389952` bytes |
| SHA-256 | `831417e4dcbfd59cf82753479bf22101fca1614a41953d6fb3e8992662da72f9` |
| Genesis hash | `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` |

The downloaded hash exactly matches HANDOFF's 148-test build. Metadata matches the announced deployment. The mobile transaction pipeline's genesis guard was also exercised against the real public RPC and passed. Observations: `devnet-2026-11-27/deployment.json`.

## Downloaded-bytecode probes

**152/152 behavioral tests pass:** 143 project integration/property tests plus four independent probes run in LiteSVM using the actual downloaded executable; five native Rust helper tests also pass. Generated IDL-print tests are excluded. The project property test runs 20 seeds × 300 steps with successful-operation coverage. The independent sequence probe runs 16 seeds × 96 steps with mixed signers, conservation, frozen-state checks and unchanged configuration assertions.

The four independent probes verify:

1. A stale immediate proposal cannot approve/execute/veto, but dead-proposal closure refunds its original payer exactly once. Substituted payer and repeated closure fail.
2. Live immediate proposals cannot close. An expired proposal rejects another vault's accounts; correct closure succeeds.
3. Withdrawal closure, address refund and repeated execution in one transaction fail atomically. One legitimate execution afterwards succeeds.
4. Mixed-signer randomized sequences preserve the tested balance/configuration invariants.

**R1-L1 is closed in this deployed build.** Project regressions also pass for expiry, exact TTL approval boundary, passed proposals never expiring, original-payer refunds and stale cleanup. Mobile includes `close_proposal` and errors 6032/6033. The original independent round-1 report remains unchanged as a historical record.

Reproduction: dump the public program into `devnet-2026-11-27/argus.so`, then run `python3 docs/audits/devnet-2026-11-27/run.py` under the documented WSL Rust environment. The runner verifies the hash, records Rust source hashes and writes its own build outputs only in the audit directory. It does not modify program/tests/target. Logs: `devnet-2026-11-27/results.txt`. The first helper-only compile needed explicit Cargo package metadata; supplying it allowed all five helpers to pass without repeating the already-green integration suites.

## Limits

This verifies public bytes against the announced build hash and tests those bytes locally in LiteSVM. **No test transactions were submitted to the public devnet ledger, and no physical MWA wallet was used.** Simulated signers and clock warps operate only locally. A real-phone MWA smoke test remains required after EAS setup. The program remains upgradeable; repeat verification after an upgrade.

The mobile app now enables direct MWA devnet flows independently of Sentinel. It checks genesis, decodes the refreshed IDL, refetches relevant state, simulates before signing, verifies the signed message and saves signatures before broadcast for uncertain-confirmation recovery. TypeScript/tests/Android export do not establish native-wallet compatibility. Use `mobile/README.md` for the physical-device checklist and remaining dependency-advisory qualifications.

Mobile verification: 44/44 tests, TypeScript, Expo compatibility and Android export pass. The new light design uses the Argus-owned painting, exact logo paths and generated native icons. The release configuration is light/white; EAS project and FCM file are still unconfigured. Limited secret-pattern scans of the fresh export found no matches; source hashes, IDL parity, painting parity and bytecode checks are recorded in `devnet-2026-11-27/verification-results.txt`.
