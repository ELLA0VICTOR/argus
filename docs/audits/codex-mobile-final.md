# Codex mobile audit — final devnet candidate

Date: 2026-11-27. Reviewer: Codex. Baseline: `c1f4b9e`, plus the mobile changes described below. This is a source/integration audit of the Android client, not a new audit of the Rust program or a third-party certification. Claude's audit reports were not used to form these findings.

**Disposition:** the core client, hosted-service integration and standalone APK artifact pass the checks listed here. Physical cold launch, MWA approvals, real microphone/audio behavior and background delivery still require device verification. Do not describe those as passed because desktop tests passed. The program is devnet-only and remains upgradeable by the announced developer authority.

## Scope and trust boundaries

Reviewed the shipping entry graph from `mobile/index.ts` and `App.tsx`: MWA authorization/signatures; generated IDL decoding/building; transaction simulation, persistence and confirmation; native vault UI; live Sentinel reads and signed decisions; demo signing/SSE; voice tools and audio lifetime; notification/deep-link routing; Expo configuration and EAS upload boundaries. The draft SIWS/contact client and its mocks remain tested source, but are no longer imported by the shipping entry.

The connected wallet owns its keys. Sentinel supplies risk information and an RPC relay, never an app signing key. An alert, deep link, transcript or model tool cannot choose arbitrary transaction accounts. Normal Cancel/Freeze are signed by the connected wallet. Only the isolated disposable demo uses the public demo decision endpoint.

## Findings and fixes

| ID | Severity | Scenario and evidence | Resolution |
|---|---|---|---|
| MOB-1 | Medium | A failed/corrupt SecureStore read was caught as a display error while the client remained able to send. After an uncertain prior send, a restart could therefore lose the retry block and let the user send again. The earlier colon-containing key was also invalid in SecureStore. | **Fixed.** `mobile/src/program/transactions.ts:14` validates pending signatures, blockhashes, heights and phases; unreadable state throws. `mobile/src/screens/LiveApp.tsx:80` keeps sending paused until restoration succeeds, with a retry check. The transaction is saved before broadcast at `transactions.ts:75`. Tests cover strict SecureStore keys, restart recovery, malformed state and read failure in `transactions.test.ts:50` and `:146`. |
| MOB-2 | Medium | `checkTransaction` originally accepted an error at merely processed commitment as final. A fork's failed observation could unlock another send while the original signature's outcome remained uncertain. SDK blockheight confirmation also depended on a WebSocket subscription, which the hosted HTTP relay does not supply. | **Fixed.** `transactions.ts:39` polls HTTP with a deadline; both confirmation paths require confirmed/finalized commitment before accepting success or failure. Unknown outcomes retain the signature and block another action. Tests: `transactions.test.ts:129`, `:139`, and `:112`. |
| MOB-3 | Medium | Notification taps still entered the retired mock-alert shell. In addition, changing the selected vault without clearing an old successful read could leave the old vault displayed after a failed fetch while builders used the new selection. That is an intent mismatch even though the program still checks roles. | **Fixed.** `mobile/App.tsx:38` routes IDs into the real wallet flow. `LiveApp.tsx` clears the old view before changing the target during notification/manual selection, verifies the candidate against discovered vaults, and consumes a matching incoming ID before opening its call. Incoming IDs survive a lookup error for explicit retry; resolved alerts route to Activity. Notification lookup considers the current plus the first 20 discovered vaults; larger sets require manual vault selection. Device regression: select/tap a second vault while its read fails and confirm that no old-vault Send/Freeze remains available. |
| MOB-4 | Low | Generated native configuration included legacy external-storage permissions and the development overlay permission, although the standalone app only needs app-private assets and an in-app call surface. | **Fixed; release manifest verified.** `mobile/app.config.ts:9` blocks external-storage permissions in every build and `SYSTEM_ALERT_WINDOW` in preview/production. Camera is already blocked in `app.json`. The downloaded final APK's merged manifest contains none of those four permissions and retains `RECORD_AUDIO`. |
| MOB-5 | Medium, availability | Moving all RPC traffic behind Sentinel would otherwise make reading/cancelling/freezing depend on relay availability. Retrying a failed submit blindly would also obscure an uncertain result. | **Fixed.** `mobile/src/program/rpcFetch.ts:7` switches to the fixed public devnet endpoint for safe read/simulation failures. It never resends the failed `sendTransaction`; a later status read can use the fallback to resolve the existing signature. Explicit custom RPC configuration is respected. Regression: `transactions.test.ts:153`. |
| MOB-DEP | Dependency advisory | The initial installed production graph reported 17 advisories, including vulnerable TOML and the unpatched bigint-buffer Node native addon. Package severity is not itself proof that an Android call path is exploitable. | **Partly remediated / tracked.** TOML is pinned to patched 5.0.1 (`mobile/package.json:60`). Android resolves bigint-buffer to its pure-JS browser implementation (`mobile/metro.config.cjs:6`); the production source map confirms that `dist/node.js` is absent. The remaining installed graph still reports **16 advisories: 3 high, 13 moderate, 0 critical**. The three high entries are bigint-buffer and its two dependent packages. Further upstream/Node-tooling remediation remains open; no clean dependency-audit claim is made. |

The dependency evidence is the installed `npm audit --omit=dev` output saved under ignored `.program-check/`. Primary advisory references: [bigint-buffer, no patched version](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg), [TOML, patched in 5.0.1](https://github.com/advisories/GHSA-h895-cgqg-jf52). Node tooling should not process attacker-controlled inputs through the vulnerable native package. The Android resolver mitigation is not a blanket remediation of the installed package tree.

## Boundary checks

| Check | Evidence/result |
|---|---|
| IDL and reserved program match; no handwritten account layouts | `program/client.test.ts:56`; decoder/PDA/owner/discriminator round trips and all builder flags are tested there. |
| Full u64 amounts, no floating-point signing values | `program/transactions.ts:110`, `domain/amountInput.ts`; parsing rejects rounding, scientific notation, negative values, unsupported precision and overflow. |
| Wallet cannot replace the prepared message or signer | `services/wallet.ts:60` pins the authorized account; `program/transactions.ts:71` compares serialized message bytes and verifies every signature before broadcast. Mutation/unsigned/wrong-chain cases are regression-tested. |
| Exactly one submission; recover uncertainty | `transactions.ts:75` persists first; `:76` uses preflight and `maxRetries:0`. The UI lock and restored pending state prevent another action. No automatic retry builds a fresh transaction. |
| Owner/guardian/AI role boundaries | UI uses the current IDL-decoded vault membership. Guardians compose all nine governance actions via `components/ProposalComposer.tsx:29`; the owner can execute already-approved permissionless proposals but cannot create or vote on changes. The program remains the authority. |
| Public alerts cannot supply payment instructions | `domain/liveProtection.ts:5` binds vault, withdrawal PDA, exact id/amount/destination/times and owner epoch to a decoded current withdrawal. Recipient ownership for voice is read from the SPL token account. Server token metadata is not used for the signed amount; inconsistent labels get a generic reason. Tests: `sentinel/live.test.ts:38`. |
| Signed dismissal cannot redirect a transaction | `sentinel/live.ts:63` re-fetches the alert, validates the binding, signs the exact fixed message, verifies its returned bytes and wallet signature, then posts only wallet/signature/timestamp. Critical owner dismissal is blocked in UI/tools and was rejected by the live server. |
| Voice tools are scoped and deduplicated | `domain/guardianCall.ts` gates duplicate/conflicting/expired decisions. `components/GuardianCall.tsx` checks `canAllow`; the main-vault callback cancels only the bound withdrawal and requires confirmed chain status before reporting cancellation. Model arguments never choose accounts. |
| Microphone and SDK resources | Permission requested on Accept (`services/voice.ts`), not on launch/ringing. `NativeVoice.tsx:24` owns the connection; errors, backgrounding and unmount end audio. Unit tests cover late connection resolution and one-time teardown. **Physical audio still unverified.** |
| Notification/deep-link payloads | `services/notifications.ts:44` and `sentinel/rules.ts` validate exact `argus://alert/<id>` syntax, reject injected URLs, and treat payloads as navigation hints. Native channel remains `argus-alerts`; omitting its custom filename selects default system sound. |
| Demo secret isolation | `sentinel/demo.ts` validates the devnet identity, disposable owner and fixed demo accounts; removes the returned seed from public session data, keeps it only in memory and wipes it on dispose. Prepared messages are restricted to the expected program, action, accounts, flags and amount. |
| Build/source secret boundary | EAS uploads only `mobile/`, using `.easignore` to exclude `.env`, native output, credentials, key files and scratch. Production source-map content contains no `KEY_AI_GUARDIAN`, `KEY_FUNDER`, `ELEVENLABS_API_KEY` or private-key PEM marker. This is a targeted scan, not proof that arbitrary secrets could never be introduced. |
| Sample/live distinction | The shipping entry imports the real client and the explicitly labelled preview. Production source map has no `sentinel/mock` module. The legacy full-contract test client is not presented as a live registration service. |

## Validation

- TypeScript passes. **75/75 unit/integration tests pass.** Android production export with source maps passes; the existing resolver export warnings remain nonfatal.
- **29/29 live devnet checks pass** through the hosted RPC and mobile SDK: faucet, create, deposit, over-limit rejection before signing, instant send, delayed request/early rejection/mature release, delayed trust proposal/application, trusted send, owner freeze, guardian unfreeze, safe-address sweep, IDL event history, monitored vault, critical alert, owner dismissal rejection, guardian signed dismissal, cancellation and preserved balance. Public receipts: `docs/audits/codex-mobile-live-2026-11-27.json`.
- Those checks use **in-memory throwaway local signers**, not MWA on a phone. No private keys were saved or committed. The first attempt stopped because the test expected 6002 instead of the correct TooEarly 6007; the expectation was corrected and a fresh full run passed.
- Standalone preview build completed and its downloaded artifact passed the checks below. Earlier candidates were cancelled to include audit fixes; their artifacts are not the final candidate.

## Standalone APK verification

[EAS preview build 0fa26674](https://expo.dev/accounts/vickytor/projects/argus-mobile/builds/0fa26674-a2b1-4508-b04e-1710ec2677d9) completed on 2026-11-27 at 21:57 UTC. [Download APK](https://expo.dev/artifacts/eas/H-EnfZuI-_t3FbopjKywARvkT7H0KrEO8Zyo-SxYMGM.apk). Public metadata: `docs/audits/codex-mobile-apk-preview-2026-11-27.json`. The binary itself stays in ignored `mobile/.program-check/`.

- Package `com.argus.vault`, version 0.1.0 / Android code 1; not debuggable.
- 167,317,287 bytes; SHA-256 `e48ce032f6a3cfbe5bd8d661577e33fcba03d0c2a6a06d645dea51caec4936fb`.
- ZIP checksums pass. The embedded Hermes app bundle is present (5,954,636 bytes), so this preview does not require Metro. Native libraries cover arm64-v8a, armeabi-v7a, x86 and x86_64.
- Merged manifest omits camera, external-storage and overlay permissions; microphone permission is present.

These are local file-integrity, bundle and manifest checks, not signing-certificate attestation or proof of a successful phone launch.

## Remaining sign-off work

1. Install the standalone APK, keep Metro stopped, and check cold start; MWA connect/account change/rejection; deposit/send/cancel/freeze; restore after interrupted confirmation; and notification/deep-link vault selection with a failed read.
2. Accept a real native voice session, verify audio/microphone denial/mute/background cleanup and the button fallback. Confirm that a critical owner has no working stand-down path and that a guardian gets the exact dismissal message.
3. **Background push is not delivered by this backend yet.** FCM credentials plus Sentinel device registration/delivery are required. The current backend deliberately has no SIWS/contacts endpoints; the tested draft client cannot substitute for them. Foreground real-vault polling and native calls are implemented.
4. Native vault setup requires external guardian addresses; it does not duplicate the web's optional backup-key download wizard. MWA reconnects on app restart instead of silently restoring a wallet authorization. These are explicit scope differences, not completed parity items.
5. dApp Store publishing/submission, publisher credentials and the outstanding dependency advisories remain separate release work.

This report completes the source/integration review for this devnet candidate. It does not close the device and background-delivery checks above.
