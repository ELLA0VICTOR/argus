# Argus Android

Native Expo / React Native app with live Solana devnet transactions through Mobile Wallet Adapter, plus a separate Sentinel alerts/contact client and a labelled sample vault.

The design follows `../docs/DESIGN.md`: white rounded cards on the soft canvas, Argus blue, EB Garamond on the painted hero and page titles, and Inter for body text and amounts. JetBrains Mono is reserved for addresses/signatures. The painting is Argus’s own `app/public/img/hero-dawn.webp`; logo paths match `app/src/components/Logo.tsx`. No other product’s imagery or copy is used. `npm.cmd run assets:brand` renders launcher/adaptive/notification icons from those paths. The ink-logo intro respects reduced motion.

Home shares the web app’s Protected/Frozen status pill, today’s instant-allowance meter, thin wait-progress bars and recent-activity dot timeline. Guardian keys use round initials avatars; the AI uses the Argus mark. Red identifies suspicious items and their Cancel action, amber is reserved for countdowns, and green means done/protected. The live transaction timeline shows up to ten confirmed devnet signatures with Explorer links; it does not infer action names from signatures. Unavailable history is shown explicitly and does not block the vault read. Send keeps the explicit route choice in one card, highlighting **Instant / Trusted / Waits 24h** (the wait label follows the actual vault delay). The transaction and wallet checks are unchanged.

## Run and build

Use Node 24 and npm. Windows PowerShell may require `npm.cmd` / `npx.cmd`.

EAS is linked to **[@vickytor/argus-mobile](https://expo.dev/accounts/vickytor/projects/argus-mobile)**, project ID `568c7aa0-0130-498e-b56f-5f93af5bda9b`. The public project ID is in app config; account/session credentials remain outside the repository. The light Android theme uses `expo-system-ui`.

The Solana SDK's older codec dependencies require TypeScript 5, so this app uses `~5.9.3` and excludes only TypeScript from Expo's compiler-version recommendation. The actual TypeScript check remains required and passes. React DOM is pinned to the same version as React for LiveKit's optional web peer dependency. A clean npm install is validated before cloud builds. MWA authorization identifies the app with its owned website, `https://tryargus.vercel.app`.

The npm build scripts scope EAS uploads to `mobile/` using its `.easignore`, so backend keys and ignored native/audit scratch output are excluded. `npm.cmd run inspect:archive` previews the upload under ignored `.program-check/eas-mobile-archive` (use a new output directory or remove that preview before repeating). This uses EAS's supported no-VCS upload mode; commit/push still happen through Git separately. The current development build is [992ad6a2](https://expo.dev/accounts/vickytor/projects/argus-mobile/builds/992ad6a2-8847-4916-9669-5cfe0b0f5c40), using the 293 KB mobile-only archive. The first build [e5086e85](https://expo.dev/accounts/vickytor/projects/argus-mobile/builds/e5086e85-9b45-4b36-948a-bebf943af86d) failed at clean dependency installation; the compiler/lockfile fix above is included in the retry. Its original monorepo archive excluded key files and `.env`, but included unnecessary public scratch artifacts.

```powershell
cd mobile
npm.cmd ci
npx.cmd eas-cli@latest login
npx.cmd eas-cli@latest init
npm.cmd run build:development
npm.cmd start
```

Install the development APK on a physical Android phone with an MWA-compatible wallet. **Rebuild the APK for this update:** native dependencies now include ElevenLabs/LiveKit WebRTC as well as LinearGradient, SecureStore and Notifications. Expo Go cannot run voice or the complete wallet flow. `build:preview` produces a standalone APK after EAS setup. No APK, physical-device test or store submission is claimed. `com.argus.vault` remains the provisional application ID.

## Live devnet vaults

Program **`4LH7ikNGVVNaemB7eaLGUMbwSBHHqA2hKXTdrfhgD6nh`**, deployment slot **526836877**. The public-RPC dump matches HANDOFF SHA-256 **`831417e4dcbfd59cf82753479bf22101fca1614a41953d6fb3e8992662da72f9`**. Probe details: `../docs/audits/codex-devnet-2026-11-27.md`.

The default experience connects directly to devnet without Sentinel:

- Discover/open a vault or create one for an existing classic SPL mint. Configure guardians/threshold, safe wallet, optional AI, delay and allowance. Creation pays devnet rent; it does not create a mint or acquire tokens.
- Read balances, allowances, pending requests, trusted wallets and proposals from the chain. Deposit an explicit amount from the connected wallet’s associated account.
- Send using the daily allowance, an active trusted wallet or a delayed request. Recipient ATAs are created idempotently in the same transaction. Delayed requests need a separate execution after the countdown.
- Cancel, freeze, execute matured requests, approve/veto/apply proposals and close dead proposals. Guardians can sweep to the preset safe wallet and freeze.
- Propose unfreezing, adding/removing trust or owner rotation. Existing proposals for all nine governance actions can be reviewed and executed.

On-chain state determines UI roles; the program remains the authority. Actions refetch their relevant accounts, simulate, open MWA, verify the returned message/signatures, broadcast with preflight and show confirmation/error plus Explorer link. All errors 6000–6033 are mapped. Failed simulations stop before the wallet prompt. Sentinel never signs app transactions.

The signature/blockhash is saved in SecureStore **before broadcast**. Uncertain results block another send until status is checked, including after restart. No automatic resubmission occurs. Wallet account changes and non-devnet RPCs are rejected. Foreground/manual refresh updates vault state. Refetch counters after a competing request/proposal creation.

Default RPC: `https://api.devnet.solana.com`. For a client-specific HTTPS devnet RPC, set ignored `mobile/.env`:

```dotenv
EXPO_PUBLIC_SOLANA_RPC_URL=https://your-devnet-rpc.example
```

This value is public in the bundle. Never use a server/guardian secret. The client checks devnet genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`; network requests time out. Public RPC can rate-limit discovery/refresh. Live reads never fall back to sample balances.

**Test tokens only.** The program is upgradeable by the hackathon dev wallet. Settle upgrade-authority policy before real funds.

## IDL

`src/idl/argus.{json,ts}` exactly match `../app/src/idl/` (Windows cannot traverse the WSL target link): 14 instructions and four account types. Anchor 1.2.2 codes all layouts/discriminators/instruction data/account metas. PDA prefixes come from IDL metadata; ATAs use the SPL SDK. Decoders check owner, discriminator, canonical PDA, bump and parent/wallet binding. Inputs are bigint; decoded u64/i64 stay Anchor BN.

The TrustedAddress gap is fixed. Non-default SetAiGuardian execution supplies the new key’s trusted PDA; AI removal omits it. A sub-threshold proposal expires after seven days; passed proposals never expire. Dead-proposal closure refunds the stored payer. Anchor’s Node-only filesystem import is routed to a throwing native stub; no local keypair signing is used.

## Sentinel, sample mode and push

### Hosted live theft demo

The app and all three EAS build profiles default to **`https://argus-sentinel-six.vercel.app`**, the hosted Sentinel demo service. The website is `https://tryargus.vercel.app`. Local Sentinel still runs on port 8787. The hosted service implements health and demo endpoints; the regular authenticated wallet/contact/alert API is still separate and pending. Do not point `EXPO_PUBLIC_SENTINEL_URL` at this service and expect those endpoints to work.

Use **Try the live theft demo** for a real devnet session. The mobile client checks health/program/AI identity, receives a disposable demo owner, keeps its seed only in memory and submits only a signature for a verified Argus move. It checks the instruction kind, session accounts and test-token amount before signing. It never uses the connected MWA wallet for this demo and never receives the AI guardian signing key. The live SSE log shows risk, incoming/decision events and confirmed transactions. The demo owner can choose Cancel or confirm the request was theirs; confirmation preserves the original delay. On no answer, Sentinel protects the high-risk session automatically.

Override the public demo URL only when testing another deployment or your local server:

```dotenv
EXPO_PUBLIC_SENTINEL_DEMO_URL=https://argus-sentinel-six.vercel.app
```

When unset, the app uses the hosted HTTPS endpoint rather than Metro's host. Private-host HTTP is allowed only in development. For USB, override with `http://127.0.0.1:8787` and use `adb reverse tcp:8787 tcp:8787`; WSL/LAN setups may need host forwarding. Production/standalone builds require HTTPS. The health response must match the announced devnet program and AI public address. Vault creation prefills the announced AI public address and dUSDC mint; clear the AI field to disable it.

Vercel closes each live event stream after roughly 50 seconds. Mobile retains the last complete, accepted event ID and reconnects using `?after=<id>`. Numbered events are deduplicated by ID, including equal or out-of-order timestamps; partial frames are discarded on reconnect. Server retry hints are bounded to 1–30 seconds. Foreground resume preserves the same cursor; closing a demo subscription discards it. Older unnumbered local streams retain their timestamp/content fallback.

### In-app Argus calls

Twilio is dropped. Calls use the internet, without a phone number or SIM. An `incoming` demo event opens a full-screen **Argus · Vault guardian** screen with Accept and Decline. Decline sends Cancel. Accept requests microphone access, then lazily loads `@elevenlabs/react-native` and starts a WebRTC conversation with public agent `agent_3001m8ebdd1ee1yrp9ga4kcn2436`. The five dynamic variables come from the current session: `owner_name`, `vault_name`, `amount`, `destination`, `reason`. No ElevenLabs API key is shipped.

The native integration uses `ConversationProvider` / `useConversation`. Compatible versions are locked: SDK 1.3.0, LiveKit React Native 2.12.0, WebRTC 144.1.2, Expo plugin 1.1.0. Both Expo plugins and Android microphone permission are configured; the camera permission is blocked. Microphone permission is requested only after Accept. The SDK module stays unloaded while ringing, so a missing native module can fall back to buttons.

The `cancel_withdrawal` and `allow_withdrawal` tools post to this demo session's `/decision` with `via: voice`; the existing decision buttons use `via: button`. Tool arguments cannot substitute the session or destination. A shared decision gate serializes answers, deduplicates repeated tools/buttons and rejects contradictory or expired decisions. HTTP acceptance is shown as a received request, with on-chain confirmation left to the live log. Allow preserves the original delay. Caption/status relay to `/call` is optional and cannot block a decision: at most 80 posts with lines capped at 400 characters. Captions remain display-only.

Mute, connection timeout, permission denial, disconnect and Back all retain the decision-button path. Ending the call, leaving the app, receiving Sentinel's decision or reaching the deadline tears down voice; the SDK provider and the connection owner also handle late connection cleanup. Call transcripts stay in memory and are relayed to the laptop only for the current demo session.

For **normal production push alerts**, a foreground notification opens the alert; a background/cold notification opens it on tap. After authenticated detail and owner-role checks, an open high/critical withdrawal opens the same incoming-call screen. Amounts, destinations and actions never come from push data. The existing v1 contract has no production voice-decision route: **Cancel still opens MWA and must confirm on-chain; Allow calls the authenticated dismiss endpoint and keeps the withdrawal delay.** Demo `/decision` is never used for ordinary vaults. Guardian/sample/resolved alerts do not auto-ring. Delivery needs the hosted authenticated Sentinel API plus EAS/FCM; there is no OS lock-screen call service or background microphone recording.

`npm.cmd run smoke:sentinel` defaults to the hosted endpoint; pass `-- http://127.0.0.1:8787` to test local Sentinel. It creates a throwaway live devnet session and checks eight outcomes through the same client: blocked drain/trusted moves, allowed daily spending, numbered event-stream reconnection, delayed request, AI cancellation/freeze and rejection after freeze. It prints public session/transaction IDs and results only; no key is written to disk. This smoke uses real devnet test-token transactions and the server's demo funding.

Explore the sample vault opens explicitly simulated balances and actions. The alerts/contact client defaults to an in-process contract mock while Sentinel is offline; its sample banner applies to those screens, not live devnet vaults.

Set `EXPO_PUBLIC_SENTINEL_URL` only to the announced HTTPS service. HTTP failures never fall back to fixtures. Sign-in validates the challenge and signs its exact UTF-8 bytes with MWA signMessages; scoped bearer tokens and device secrets use SecureStore. MWA authorization stays in memory. Logout revokes the session and removes this device; cleanup failures remain retryable.

Settings now focuses on push devices and explains internet calls; it does not ask for a phone number. The legacy v1 phone-contact client methods remain for contract compatibility. Device registration retains the one-time secret on repeats and handles token rotation/removal. Alerts use signals[].id, exact token metadata, pagination, call status/transcripts and resolution links. Dismissal stops calls without cancelling or shortening the request.

Live HTTP alerts enable direct MWA Cancel/Freeze. The chain withdrawal’s vault/id/amount/destination are checked against the alert before signing. Mock alerts outside the preview do not enable live transactions.

The `argus-alerts` MAX-importance Android channel and `argus://alert/<id>` route remain. Taps fetch authenticated detail; payload amounts/destinations/transactions are never trusted. Incoming alerts wait during unresolved wallet transactions.

Victor must link EAS, configure FCM v1 and supply ignored `google-services.json`. `GOOGLE_SERVICES_JSON` accepts a local/EAS file-variable path. Local notifications do not require remote FCM, but need a fresh native APK. No service secret belongs in EXPO_PUBLIC variables.

## Validation and physical smoke test

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run check:expo
npm.cmd run export:android
```

Tests cover IDL parity/decoding, all 14 builders, exact amounts, allowance reset/limit boundaries, per-request wait progress, optional RPC history failure, devnet guard, changed/unsigned/refused wallet payloads, pre-sign simulation failure, confirmation and recovery without resending, plus Sentinel auth/contact/alert behavior. Call tests cover authenticated owner eligibility, voice context, decision races/deduplication/expiry, retryable delivery, late connection teardown, microphone controls and exact decision/caption requests. Android export checks JavaScript/assets, not native wallet or live microphone compatibility.

Validated on 2026-11-27: **63/63 tests** and TypeScript pass, including numbered SSE replay/resume, interrupted frames, retry limits and older-stream compatibility. Android native prebuild succeeds; its generated manifest has microphone permission, communication audio routing, screen-sharing disabled and camera removed. Expo compatibility, Android export and native-config introspection pass. The **hosted mobile smoke passes 8/8**, including two numbered SSE connections resuming through event 213, blocked drain/untrusted moves, allowed daily spending, delayed request, Sentinel cancellation/freeze and rejection after freeze. Hosted deep health reports database and RPC healthy. The initial session-creation failure was Sentinel's dependency needing `__filename` in its Vercel bundle; a standalone database query alone did not diagnose that full-bundle problem. It is fixed upstream. EAS login/project linking is complete; APK build and physical-device results are tracked separately. FCM is not configured and adb is unavailable. Native sources/build output stay under ignored `mobile/android/`, `mobile/.program-check/` and `mobile/dist/`; `docs/audits/` contains readable evidence only.

After EAS setup, check the intro/hero, fonts, large text, keyboard, Back and reduced motion. Connect/open/create a test-token vault; reject a wallet request and switch accounts. Deposit a small amount, request/cancel/freeze, then approve/apply Unfreeze with a guardian. Test instant/trusted sends, matured execution and cleanup/refunds. Interrupt connectivity after signing and recover the saved signature after restart. Separately test sample contact registration, local notification taps and cold deep links; test remote delivery/live-alert actions once Sentinel/FCM are ready.

For voice, use a rebuilt development APK and the hosted/tunnel Sentinel demo URL. Start the live demo, request the remaining balance, Accept, and say cancel; verify the transcript/decision on the laptop and the actual cancel/freeze transactions. On a fresh session confirm the request was yours and verify its delay remains. Also test Decline, denied microphone, muted microphone, no network, connection timeout, Back, Home/background, server timeout while connecting, repeated tool calls and a fresh incoming call after teardown. For production push, test foreground receipt and background/cold taps after sign-in, guardian/resolved-alert exclusion, MWA rejection/unknown confirmation and late alert arrival while another wallet request is pending. These are pending physical-phone checks, not claimed results.

The dependency graph reports **17 upstream advisories: 5 high, 12 moderate**, including the WebRTC config plugin's Expo tooling path. High paths include bigint-buffer’s [native conversion advisory](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg) and toml [parser advisories](https://github.com/advisories/GHSA-v5mp-jgw5-2x6j). The bigint package declares a JS browser replacement; mobile does not open Anchor workspaces/TOML. This is not a blanket reachability proof or a clean dependency graph. No incompatible audit-force downgrades were applied. Recheck before release. Metro also reports package-export fallbacks for rpc-websockets and noble hashes.

References: [Sentinel contract](../docs/SENTINEL-API.md), [ElevenLabs React Native SDK](https://elevenlabs.io/docs/eleven-agents/libraries/react-native), [Expo/WebRTC setup](https://elevenlabs.io/docs/eleven-agents/guides/integrations/expo-react-native), [MWA specification](https://solana-mobile.github.io/mobile-wallet-adapter/spec/spec.html), [Expo notifications](https://docs.expo.dev/versions/latest/sdk/notifications/), [SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/).
