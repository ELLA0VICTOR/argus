# Argus Android

Native Expo / React Native app with MWA wallet sign-in, Sentinel contacts and alerts, push routing, and an interactive local demo. The client implements `../docs/SENTINEL-API.md`; the service and on-chain program are not deployed yet.

## Run on Android

Use Node 24 LTS and npm. Windows PowerShell may require `npm.cmd` / `npx.cmd` instead of the `.ps1` launchers.

```powershell
cd mobile
npm.cmd ci
npx.cmd eas-cli@latest login
npx.cmd eas-cli@latest init
npx.cmd eas-cli@latest build --platform android --profile development
npm.cmd start
```

Install the development APK on a physical Android phone with an MWA-compatible devnet wallet. Connect the development client to Metro. **Rebuild the development APK after this update**: SecureStore and Notifications add native modules. Expo Go does not support the complete app. No emulator or local Android SDK is required for EAS builds.

After EAS project linking, `npm.cmd run build:preview` builds a standalone APK. No cloud build, Android signing, or publisher registration has been performed. `com.argus.vault` is the provisional application ID; Victor must confirm it before release.

## Mock and live Sentinel

By default, the app uses the in-process contract mock in `src/sentinel/mock.ts`. Every screen displays a **LOCAL MOCK** banner. Sample contacts, alerts and watch-log events reset when the app process restarts. No phone number or registration is sent to a server. Only the masked phone number remains in mock contact state after submission.

- **Explore the demo** needs no wallet. Its preview token is memory-only. Cancel, freeze and guardian votes are explicitly local simulations.
- **Connect wallet and sign in** uses real MWA authorization and `signMessages`, even with the mock service. The mock verifies the Ed25519 signature before issuing its local token. Any correctly signed wallet receives a sample owner role; this is not an on-chain membership claim.
- Signed-in Sentinel tokens are encrypted in SecureStore with wallet, backend scope and expiry. MWA authorization tokens stay in memory. Restoring a saved token revalidates it against the service. A fresh mock process does not retain server sessions and rejects its previous token, requiring sign-in again.

When the real HTTPS endpoint is announced, set this in an ignored `mobile/.env` and restart Metro/rebuild the standalone app:

```dotenv
EXPO_PUBLIC_SENTINEL_URL=https://the-announced-sentinel-host
```

Setting this variable selects HTTP mode and removes the wallet-free demo entry. Live errors never fall back to fixtures. Tokens are scoped to the backend, so mock tokens are not sent to a live service. API errors remain visible; expired or revoked sessions clear SecureStore and return to sign-in. Background polling pauses, then refreshes when the app becomes active.

## Wallet sign-in and contacts

The client fetches the challenge, checks its domain, wallet, nonce, network and expiry, and asks MWA to sign the **exact UTF-8 message bytes**. It checks the signed payload and connected signer, extracts the appended 64-byte signature, base58-encodes it, and posts `/v1/auth/verify`. No transaction is built for sign-in. The implementation uses the contract-supported `signMessages` route, without reconstructing a message through `signIn`.

Settings implements:

- Add an E.164 phone number and label. `verified: true, verification: "none"` activates it immediately. There is **no SMS code step**. The field clears on success; contact responses show masked numbers.
- List phone and push contacts. Adding preserves existing contacts. Phone removal is shown only to guardians; the service still enforces permissions on every request.
- Register an Android Expo push token. Mock mode registers a clearly labeled sample device without contacting Expo.
- Store the one-time `device_secret` in SecureStore, scoped to backend, wallet and vault. Idempotent registration preserves the stored secret when the server does not reveal it again. Push-token rotation removes the previous own-device contact before replacing its secret.
- Remove this device with `X-Device-Secret`, including after bearer expiry. Guardians can remove other devices. Sign-out removes locally registered devices before revoking the token; cleanup failures remain retryable instead of reporting a successful sign-out.

The server owns membership and contact rules. A client-side role label is never authorization to sign a program action.

## Alerts and push

The Alerts tab loads all alerts, can filter to open alerts, and paginates with `next_before` unix-second cursors. Detail screens fetch `/v1/alerts/{id}`, display every alert status, show call state/transcripts and resolution transaction links, and refresh while active. Amounts remain base-unit strings and are formatted without JS floating-point conversion. The Alert `token: { mint, symbol, decimals }` metadata supplies the unit: `12000000000` at six decimals displays as **12,000 USDC**. Null or blank symbols display **tokens** instead. Detail screens also show the full token mint. Both list and detail share the same formatter, which preserves fractional base units and large integers exactly.

Signal icons use only the stable `signals[].id` values: `new_address`, `lookalike`, `share_of_vault`, `odd_hour`, `scam_report`, and `first_destination`. Text labels do not control icons.

“It was me, let it through” calls `/dismiss`. It stops further calls and changes the displayed status; the withdrawal, unlock time and ability to cancel remain unchanged. A phone-call `cancel_requested` outcome is not displayed as an on-chain cancellation.

The app creates Android channel **`argus-alerts`** at **MAX** importance. It handles foreground/background notification taps, the last response on cold start, and **`argus://alert/<id>`** through both initial URLs and runtime links. Signed-out users sign in before the saved alert route resumes. Only the validated alert ID is used from a notification; the detail and vault are fetched under wallet authentication. No push payload can initiate a signature or supply trusted transaction accounts.

Settings includes **Test a local alert notification** in mock mode. This requests Android notification permission and schedules a local notification for `al_9`, allowing tap routing to be exercised without EAS push credentials.

For real remote delivery, Victor must link the EAS project, configure Android FCM v1 credentials in EAS, and supply Firebase's `google-services.json`. Set **`GOOGLE_SERVICES_JSON`** to an ignored local file path or an EAS file environment variable; `app.config.ts` passes it to Expo. Rebuild the APK. The EAS project ID is read from Expo Constants. Push registration reports missing project setup, permission denial and network failures. No service keys belong in `EXPO_PUBLIC_*` or source files.

## Program client and deployment

Program ID: **`4LH7ikNGVVNaemB7eaLGUMbwSBHHqA2hKXTdrfhgD6nh`**. It is **not deployed**. The feature-complete generated JSON and TS helper are copied from `../app/src/idl/` into `src/idl/`.

`src/program/client.ts` provides IDL-based Vault, Withdrawal, Proposal and TrustedAddress decoders/fetchers, PDA derivation and all 13 instruction builders. It uses Anchor 1.2.2's `@anchor-lang/core` client and classic SPL Token. Numeric inputs are `bigint`; decoded 64-bit fields are Anchor `BN`, never JS numbers. Decoders check the Argus owner, discriminator, PDA, bump and optional parent-vault binding. `withdrawTrusted` reads the destination's SPL authority to select the correct trusted PDA. `executeProposal` supplies the optional trusted account for owner rotation and non-default AI changes as well as add/remove trusted.

Construct `new ArgusClient(connection)`, fetch the selected vault/withdrawal/proposal, then call a builder to obtain a `TransactionInstruction`. Builders do not sign or send. Request/proposal builders use the fetched next counter; refetch before retrying after a competing creation. The initial TrustedAddress IDL gap was corrected upstream during integration; the client uses the corrected generated schema.

After Claude announces the devnet deployment in `../docs/HANDOFF.md`, verify the deployed address, wire verified live accounts and MWA signing with pending/confirmed/error states and Explorer links. **Cancel and freeze stay MWA → program. No Sentinel endpoint signs for the app.** Outside the explicit preview, program action buttons remain disabled.

Program audit/test targets are Rust + LiteSVM in `programs/argus/tests/`. No program, Sentinel service, web app, or program-test files were changed by this mobile work.

### Cancel and Freeze account contract

Both instructions take no arguments. Their transactions will be generated from the final IDL and signed by the connected wallet through MWA. These notes record the reviewed contract; live buttons remain disabled until the deployment/IDL announcement.

| Instruction | Account | Source | Signer | Writable |
|---|---|---|---|---|
| `cancel_withdrawal` | `canceller` | Connected MWA wallet | Yes | No |
| `cancel_withdrawal` | `vault` | Verified selected Vault account | No | No |
| `cancel_withdrawal` | `withdrawal` | Verified Withdrawal belonging to that vault | No | Yes |
| `cancel_withdrawal` | `rent_payer` | Original rent payer decoded from that Withdrawal | No | Yes |
| `freeze` | `signer` | Connected MWA wallet | Yes | No |
| `freeze` | `vault` | Verified selected Vault account | No | Yes |

Cancellation refunds the original rent payer, including after owner rotation; the wallet submitting the cancellation is not automatically that recipient. It remains allowed while frozen and after the delay ends, provided the Withdrawal account still exists and the signer currently has an allowed protective role. Confirm account existence/ownership and refresh current vault roles before signing; a raced execution/cancellation can remove the account. Freeze is idempotent, works independently of token balance and transfers, and always sets the frozen flag. Success messages require confirmed chain results and transaction Explorer links; Sentinel dismissal remains a separate API action.

Sentinel's bearer token does not authorize these instructions. The app uses the user's MWA signature; the server's AI key is never part of the mobile transaction flow.

## Transaction error messages

`src/program/errors.ts` maps every append-only Argus code **6000–6031** to its exact Rust variant name and a short user message, including `InvalidAmount` (6027), `InvalidDestination` (6028), and the subsequently appended trusted-governance errors (6029–6031). `argusErrorForCode(code)` is for codes already identified as Argus errors. `transactionErrorMessage(error, instructionPrograms)` handles Anchor error objects, RPC confirmation/preflight results, and web3.js logs. Pass the submitted transaction's ordered program-ID list when an RPC error only identifies an instruction index. The formatter avoids attributing a foreign program/CPI custom code or a JSON-RPC code to Argus. Unknown/future codes use a message asking the user to check transaction status before retrying. Anchor duplicate-mutable error 2040 remains a framework error; it is not relabeled as Argus 6028.

The mapping test reads `../programs/argus/src/error.rs` directly and checks all names and numeric positions. Appending/reordering an error without updating the mobile mapping fails that test. This does not consume the starter IDL. Connect the formatter to the transaction UI when Day 1 signing is implemented; the current app has no live transaction path.

## Device build readiness

The development build command is ready: **`npm.cmd run build:development`**. EAS project linking and Android FCM configuration are still pending Victor's setup. At the latest check there was no configured EAS project ID or Firebase file in this app, and no `adb` executable was available. No APK build or physical-device result is claimed. Once Victor supplies the setup and a reachable phone, build the development APK and run the MWA and local-notification steps below. Local notifications themselves do not need remote FCM delivery, but the new native modules require a fresh APK.

## Validation

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run check:expo
npm.cmd run export:android
npm.cmd run check:program-bundle
```

Validated on 2026-11-26: 33 behavior tests, TypeScript, Expo dependency compatibility, Android export and a separate Metro bundle containing the program SDK pass. All 32 Rust error names/codes are mapped. Client tests cover generated-file parity, account ownership/discriminator/PDA/bump/parent checks, u64/i64 bounds, all 13 instruction builders, destination token authority and governance optional accounts. Existing tests cover signed-message bytes and signer, nonce expiry/replay, token persistence/restoration/revocation, backend scoping, stale responses, contact permissions/masking, device-secret idempotence/rotation, logout retry, dismissal, cursors, deep links, token metadata and transaction-error provenance.

Anchor 1.2.2's browser entry references `fs` inside its Node-only local-wallet helper. `metro.config.cjs` routes only Anchor's filesystem import to a throwing native stub. The client supplies a wallet-free provider; MWA remains responsible for signing.

The Android bundle is a JavaScript/native-configuration check; **no APK/native compilation, physical-device wallet test, or remote push delivery test has been run**. Metro's existing package-export fallback warnings for `rpc-websockets` and `@noble/hashes/crypto.js` remain. The last dependency audit reported eight moderate upstream Expo/Solana advisories; no incompatible overrides or SDK downgrade were applied.

Physical-device smoke test:

1. Explore the demo; open Alerts and review the critical request. Dismiss it and check that its countdown and Pending request remain. Cancel it separately and check the cancelled state.
2. Reset, freeze the sample vault, check Send is disabled and a freeze alert appears, then cancel a pending withdrawal. Check guardian approval/veto still preserves its delay.
3. In Settings add a phone, confirm no SMS screen appears and the listed number is masked. Add another and verify the first remains. The sample owner cannot remove phone contacts.
4. Register a sample push device twice; there should be one contact. Remove it, re-register, then sign out and verify the device is removed.
5. Schedule the local alert notification. Tap it while the app is foregrounded/backgrounded. Also launch `argus://alert/al_9` with the app closed; verify sign-in gates the detail and Back returns to the list.
6. Reject and retry wallet authorization and message signing. Test a wallet-account change, expired session, offline server and API 403/429. Reopening with a live token should restore it securely; failed live calls must not show sample data.
7. With real FCM/EAS setup and live Sentinel, register the phone, send the contract push, test killed-app tap handling, then remove the device. Check large text, keyboard scrolling and Android Back.

References: [Sentinel contract](../docs/SENTINEL-API.md), [MWA signing specification](https://solana-mobile.github.io/mobile-wallet-adapter/spec/spec.html), [Expo notifications](https://docs.expo.dev/versions/latest/sdk/notifications/), [SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/), [APK build profiles](https://docs.expo.dev/build-reference/apk/).
