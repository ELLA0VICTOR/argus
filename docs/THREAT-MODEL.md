# Argus threat model

Every row needs an **attack test** in `tests/` showing the attack fails, or the bounded loss being reached. The "Test" column names the test. Add rows whenever anyone, the team lead especially, thinks of a new attack.

## Attacker has the OWNER key (the most likely case)

| # | Attack | Defence | Max loss | Test |
|---|---|---|---|---|
| A1 | Request a withdrawal of everything to their own address | 24h delay. AI, guardian or owner cancels. Guardians rotate the owner, which voids pending withdrawals (INV-6) | 0 | `attack_owner_request_then_cancel`, `attack_request_voided_by_rotation` |
| A2 | Add their own address as trusted | The owner cannot propose (INV-2). Only guardians can, and it is delayed and vetoable | 0 | `attack_owner_cannot_add_trusted` |
| A3 | Raise the daily limit or shorten the delay | The owner cannot propose. Loosening is delayed and vetoable | 0 | `attack_owner_cannot_loosen` |
| A4 | Rotate the owner to themselves, or change guardians, the AI or the safe address | Guardian threshold only | 0 | `attack_owner_cannot_rotate`, `..._set_guardians` |
| A5 | Drain via `withdraw_instant` | Capped at `daily_limit` per 24h reset window (the window restarts at the first spend after 24h, so at most 2× limit can straddle one reset). Rotation stops it | `daily_limit` per day until rotation | `attack_instant_capped`, `attack_window_rollover` |
| A6 | Send everything to a trusted address | Trusted addresses belong to the user, so this is not theft | 0 (inconvenience) | `trusted_send_goes_to_owner_address` |
| A7 | Spam `request_withdrawal` | Each request costs the attacker rent. One rotation voids them all. Executing a stale request fails | 0 | `attack_spam_requests_voided` |
| A8 | Freeze the vault to annoy the user | Denial of service only. Guardians unfreeze | 0 | `owner_freeze_needs_threshold_unfreeze` |
| A9 | Cancel the user's legitimate withdrawals | Denial of service only, and visible in the watch log | 0 | — |
| A10 | Unfreeze after a guardian froze the vault | Unfreezing needs the threshold | 0 | `attack_owner_cannot_unfreeze` |
| A11 | Wait out the delay while the user is asleep or travelling | The AI phones the user, any single guardian can cancel, and the AI can freeze automatically when risk is high | 0 if anyone responds within 24h | Demo and e2e |

## Attacker has ONE guardian key (with a threshold above 1)

| # | Attack | Defence | Max loss |
|---|---|---|---|
| G1 | Rotate the owner, add trusted, loosen limits | Needs the threshold | 0 |
| G2 | Emergency sweep | Funds go only to `safe_address`, which the user controls (INV-9) | 0 (inconvenience) |
| G3 | Veto legitimate governance changes | Denial of service only. The other guardians remove the rogue guardian with `SetGuardians`, and **the rogue guardian cannot veto their own removal** (`CannotVetoOwnRemoval`). Test: `attack_rogue_guardian_cannot_block_removal` | 0 |
| G4 | Freeze to annoy | Denial of service. The threshold unfreezes | 0 |

## Attacker has the AI guardian key (Sentinel server compromised)

| # | Attack | Defence | Max loss |
|---|---|---|---|
| S1 | Cancel every withdrawal or freeze the vault | The role allows only cancel and freeze (INV-5). Guardians can remove the AI | 0 (denial of service) |
| S2 | Any transfer, proposal or approval | Rejected by role checks | 0 |

## Attacker has the OWNER key plus the GUARDIAN THRESHOLD

Known and accepted. They can rotate the owner and then wait out the delay, or add trusted addresses after the timelock. The AI can still freeze, but they can unfreeze. **Mitigation is operational:** keep keys on separate devices and with separate people. We say this plainly in the pitch and README.

## Program-level and Solana-specific attacks

| # | Attack | Defence (see AUDIT-CHECKLIST) |
|---|---|---|
| P1 | Pass a fake vault, withdrawal or proposal account | Seeds and bump constraints, `has_one = vault`, owner = program |
| P2 | Pass a token account of the wrong mint or owner | `token::mint`, `token::authority` / ATA constraints, `transfer_checked` |
| P3 | Execute the same withdrawal or proposal twice | Close on execute, and ids are never reused |
| P4 | Approve the same proposal twice | Bitmap check (INV-8) |
| P5 | Approve with a guardian removed by `SetGuardians` | `guardian_epoch` check (INV-7) |
| P6 | Overflow on limits or time | Checked arithmetic everywhere (INV-10) |
| P7 | Clock manipulation | Use `Clock::get()?.unix_timestamp`. Validator skew of a few seconds is irrelevant against long delays |
| P8 | Revive a closed account in the same transaction | Anchor `close`. Never reuse ids |
| P9 | Substitute the token program or call an arbitrary CPI | `Program<'info, TokenInterface>` and `Interface` checks |
| P10 | Duplicate mutable accounts (same account passed twice) | Constraints that destination ≠ vault ATA |
| P11 | Request more than the balance, then the balance drops | Execution re-checks the balance. A failed withdrawal stays pending and can be cancelled |
| P12 | Self-referential roles (owner = guardian, AI = owner) | `RoleOverlap` checks at init, rotation and `SetGuardians` |

## Off-chain threats

| # | Threat | Defence |
|---|---|---|
| O1 | Sentinel misses an event (RPC drop) | Poll for pending Withdrawal accounts on an interval as well as subscribing to events. Pending accounts are the source of truth |
| O2 | A spoofed "Argus" phone call is used for phishing | Argus never asks for keys or seed phrases. Calls only offer "say cancel". The app shows the same alert. Documented in the README |
| O3 | Voice "cancel" spoofed by an attacker | Worst case, the attacker *cancels* a withdrawal, which is harmless. A voice command can never approve or move funds |
| O4 | Leaked API keys (ElevenLabs, Firecrawl) | Server-side env only, never shipped to clients. Supabase RLS on all tables |
| O5 | The AI keypair is leaked from the repo | Never committed. `.gitignore` covers `*.json` keypairs under `keys/` and `.env*`. Loaded from env or a secret file at runtime |
| O6 | A thief with the owner key re-points alerts (phone or push) to themselves, so the real owner is never called | Contacts can be added by any role, but only a guardian can remove a phone. Every add notifies existing contacts. Alerts go to *all* contacts. See `docs/SENTINEL-API.md` §3. Test: `sentinel_owner_cannot_remove_phone` |
