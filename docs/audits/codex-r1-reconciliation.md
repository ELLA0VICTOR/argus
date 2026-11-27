# Round 1 reconciliation — Codex

2026-11-26. Read `claude-r1.md` only after `codex-r1.md` was complete and written. The independent Codex report's SHA-256, captured before that first read, is `383e869b7f52bd28c5ce79d572431559a87aa6dce19df58ede36dac565c2157c`. The original independent report is preserved unchanged; this document contains the subsequent comparison.

## Agreements

| Topic | Reconciled result |
|---|---|
| Claude F-1: proposer executing own proposal | Fixed by the intentional `rent_payer` duplicate-account allowance. Existing regression covers immediate execution and AddTrusted. Codex reviewed the fixed baseline and does not claim discovery of this finding. |
| Claude F-2: trusted wallet becoming AI | Fixed. A non-default SetAiGuardian key requires its trusted PDA and must not have a live record. Mobile `ArgusClient.executeProposal()` supplies it; removing the AI with the default key omits it. Client tests cover both cases. |
| Claude F-3: TrustedAddress IDL omission | Resolved by the refreshed export. Mobile JSON and TS copies exactly match `app/src/idl/`; all four account types have verified decoders. |
| Codex R1-L1 / Claude I-3: stranded proposal rent | Same underlying issue, independently recorded. Codex classifies it Low; Claude records it as informational pending Victor's decision. Neither report alleges vault-token theft. A stale-only close/refund path is a suitable narrow fix, separate from a general proposal TTL. |
| Window boundaries | Both reports recognize the implemented reset-window rule and its boundary behavior. Align product wording with that explicit rule. |
| Mutation test | Claude's report identifies the temporary frozen-constraint removal as a deliberate mutation check. This explains the concurrent source/cache changes observed during Codex's run. The guard was restored; the final normal tests are green. It is not an open regression. |

No conflicting fund-movement or role-authorization finding emerged from comparing the reports. This does not establish deployed-bytecode equivalence or replace future deployment checks.

## Checklist interpretations and remaining work

- **B2/B3:** the status labels differ, but both apply the same spec clarification: deposit, execute-withdrawal and execute-proposal are permissionless. The owner/AI cannot create guardian approvals by calling an executor. Amend the checklist's blanket rejection wording to match the instruction table.
- **D2:** Codex leaves the literal item unmet because deposit has no explicit Argus balance precheck; Claude marks the outflow checks as sufficient. Both implementations rely on classic SPL Token to reject an excessive deposit atomically. Decide whether the checklist means explicit checks for vault outflows or every transfer; no vault-token escape is demonstrated.
- **F2:** program attack tests pass in both reports. The named Sentinel O6 test and actual response/e2e checks remain pending. Treat full-system coverage as incomplete until Sentinel exists, even though the on-chain cases are green.
- **G1:** Codex additionally scanned the built mobile app, separately bundled mobile SDK and existing web dist for the recorded secret patterns. Repeat scanning for release artifacts after integrations/configuration change.
- **Victor decisions:** stale-proposal rent cleanup; optional proposal expiry (Claude I-2); and the deployment/upgrade-authority policy (Claude I-1). No TTL, authority change or program patch was made during reconciliation. The program remains undeployed according to HANDOFF, so a live upgrade authority has not been independently verified.
- **Other advisory items:** retain Claude's notes about colluding guardians and vetoes, issuer freeze authority, self-locking owner values and the demo's minimum delay. Codex's spec activation-time and trusted-record rent-recipient ambiguities also remain documentation decisions. These should not be represented as newly verified deployed behavior.

## Validation boundary

At reconciliation, every file in the final reviewed-source manifest still matches; the refreshed mobile JSON/TS copies match upstream. The prior results therefore stand: 142 project behavioral tests and 3 independent probes pass; 33 mobile tests, TypeScript and Android bundle checks pass. No redundant program rebuild or test rerun was performed for this documentation-only comparison. Devnet deployment, live MWA transaction flows, EAS/FCM setup and physical-device smoke tests remain pending.
