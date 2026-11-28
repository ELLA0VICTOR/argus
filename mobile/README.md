# Argus Android

Native Expo / React Native client for the Argus devnet vault. It uses Mobile Wallet Adapter for wallet authorization, signing and message decisions. The main vault is live; the disconnected Savings screen is a clearly labelled read-only preview. The separate theft demo uses disposable test keys in memory and never the connected wallet.

The light, rounded design follows `../docs/DESIGN.md` and the web phone layout: Argus blue, white cards on a soft canvas, EB Garamond titles, Inter text/numbers and JetBrains Mono addresses. The painting and rounded eye logo are Argus assets. After the ink-logo intro, the app opens the vault interface directly. Home / Send / Activity / Guardians / Settings share the web tab structure.

## Implemented

- Discover, open and create classic SPL-token vaults. Name the vault locally, configure external guardians and threshold, safe address, allowance, delay and optional AI guardian.
- Get test dUSDC and SOL for fees from the hosted faucet. Show wallet funds when depositing.
- Deposit; instant, trusted and delayed sends; release matured withdrawals; cancel and freeze; guardian sweep to the preset safe address.
- Review, create, approve, veto, apply and close proposals. All nine governance actions are available in the compact proposal selector. The program enforces final roles and parameter validation.
- Automatically refresh the on-chain vault every 12 seconds. Decode recent activity through Anchor's IDL event parser; history failure does not block the vault read.
- Poll real Sentinel alerts/watch log every six seconds while active. Bind each alert to its current decoded on-chain withdrawal. Critical alerts open the native Argus call; cancellation signs with MWA. Critical stand-down requires a guardian's exact signed message, matching the server rule.
- Route `argus://alert/<id>` and notification IDs into discovered real vaults. Never use payload amounts or destinations to build a transaction. Defer incoming alerts during an unresolved transaction or call.
- Format Send/deposit amounts with grouping commas and a decimal point while preserving every entered decimal. All transaction values remain exact BigInts/BNs.

The generated JSON/TS IDLs in `src/idl/` match `../app/src/idl/`: 14 instructions, four account types. Anchor handles layouts, discriminators, data and account flags; PDA prefixes come from IDL metadata. The program is **4LH7ikNGVVNaemB7eaLGUMbwSBHHqA2hKXTdrfhgD6nh**, deployed on devnet. Every signed transaction checks the devnet genesis hash, simulates first, verifies the returned message and signatures, persists its signature before broadcast, uses preflight and never automatically resends. Unknown outcomes block another send across restart. Unreadable saved state pauses sending until recovery succeeds. Confirmation polls HTTP with a deadline instead of depending on the relay having WebSockets.

The default RPC is Sentinel's hosted `/v1/rpc/devnet`. Read/simulation failures can switch to the fixed public devnet RPC. A failed transaction submission is never retried by that fallback; its existing signature must be checked. A custom RPC override disables automatic fallback.

## Run in CMD

Use Node 24 and npm. From the repo root:

```cmd
cd mobile
npm ci
npm start
```

Install the development APK on Android and open Argus with the Metro QR code. Expo Go cannot supply QuickCrypto, WebRTC and the other native modules. If LAN transfer stalls:

```cmd
npx expo start --dev-client --tunnel
```

Current development APK: [EAS build 992ad6a2](https://expo.dev/accounts/vickytor/projects/argus-mobile/builds/992ad6a2-8847-4916-9669-5cfe0b0f5c40). This build requires Metro. The updated **standalone preview** is ready: [download APK](https://expo.dev/artifacts/eas/H-EnfZuI-_t3FbopjKywARvkT7H0KrEO8Zyo-SxYMGM.apk) ([EAS build 0fa26674](https://expo.dev/accounts/vickytor/projects/argus-mobile/builds/0fa26674-a2b1-4508-b04e-1710ec2677d9)). It embeds the JavaScript and needs no Metro server. Downloaded ZIP integrity and merged permissions were checked; physical cold launch, wallet and audio checks remain. Earlier preview candidates were cancelled to include audit fixes. SHA-256: `e48ce032f6a3cfbe5bd8d661577e33fcba03d0c2a6a06d645dea51caec4936fb`.

## Build/configuration

EAS is linked to `@vickytor/argus-mobile`, project `568c7aa0-0130-498e-b56f-5f93af5bda9b`, package `com.argus.vault`. The remote Android keystore is managed by Expo. Build scripts scope uploads to `mobile/` with `.easignore`; backend files, credentials, keypairs, `.env`, scratch and generated native output are excluded.

```cmd
npx eas-cli@latest login
npm run build:development
npm run build:preview
```

All native/build output belongs under ignored `mobile/android/`, `.program-check/` or `dist/`. `docs/audits/` holds readable reports/metadata only. Preview/production block camera, legacy external storage and the development overlay permission. Development retains its overlay capability; camera/storage remain blocked.

Public configuration, if needed, goes in ignored `mobile/.env`:

```dotenv
EXPO_PUBLIC_SENTINEL_LIVE_URL=https://argus-sentinel-six.vercel.app
EXPO_PUBLIC_SENTINEL_DEMO_URL=https://argus-sentinel-six.vercel.app
# Optional: a client-safe HTTPS devnet RPC instead of the hosted relay.
# EXPO_PUBLIC_SOLANA_RPC_URL=https://your-devnet-rpc.example
```

No server API key or guardian signing key belongs in an EXPO_PUBLIC value. `GOOGLE_SERVICES_JSON` accepts an ignored local/EAS file-variable path when FCM is configured. The older `EXPO_PUBLIC_SENTINEL_URL` belongs to the draft contract test client; the shipping entry does not import it.

## Voice and delivery scope

Twilio is dropped. Native voice uses the internet, public ElevenLabs agent `agent_3001m8ebdd1ee1yrp9ga4kcn2436`, and the dynamic variables owner_name, vault_name, amount, destination and reason. No ElevenLabs API key is shipped. Accept requests microphone permission and lazily starts the native WebRTC SDK. Buttons remain available for permission denial, connection failure or interruption. The decision gate prevents conflicting/duplicate/expired actions; backgrounding and teardown stop audio, including late connection setup.

For a real vault, Cancel uses the connected MWA wallet and Allow signs only a dismissal; neither moves funds. Owners cannot stand down a critical alert. The disposable theft demo instead posts decisions to its own `/v1/demo/:id/decision`, with bounded display-only caption relay. Its SSE connection resumes accepted event IDs after reconnects and discards interrupted frames.

**Foreground monitoring and native calls are implemented. Background push delivery is not yet available from this backend.** FCM credentials and Sentinel device registration/delivery are still required. The full SIWS/contacts API in the original contract is not implemented by the hosted service. Its separate mock/client tests do not constitute a live sign-in or contact-registration feature. The `argus-alerts` Android channel and validated link/tap paths are ready for delivery integration.

Native setup requires external guardian addresses and does not generate/export the web's optional backup-key file. MWA reconnects when the app restarts; it does not silently restore a wallet session. Keep the owner and guardian keys separate. The program remains upgradeable; this is a test-token devnet build.

## Verification/audit

```cmd
npm run typecheck
npm test
npm run check:expo
npm run export:android
npm run smoke:live
```

`smoke:live` creates throwaway devnet keys only in memory, consumes faucet claims and creates test vaults. It exercises the mobile SDK and hosted service with local test signers; it does not test physical MWA. Public-only receipts go to ignored `.program-check/live-smoke.json`.

As of 2026-11-27: **75/75 automated tests**, TypeScript and Android production export pass; **29/29 live SDK/hosted-service checks** pass. See [the mobile audit](../docs/audits/codex-mobile-final.md) and [public receipts](../docs/audits/codex-mobile-live-2026-11-27.json). Physical MWA approvals, native microphone/audio and background delivery are separate checks and are not claimed passed.

The installed production dependency graph still reports 16 advisories (3 high, 13 moderate, no critical). TOML is pinned to patched 5.0.1. Android's Metro resolver forces bigint-buffer's pure-JS browser implementation; the source map confirms the vulnerable Node addon is absent. The remaining high package entries track that unpatched Node dependency and its dependents. This is not a clean dependency-audit claim. Details and primary advisory links are in the audit. No incompatible audit-force downgrades were applied.

React/React DOM are pinned together. TypeScript 5.9 is intentionally retained for the Solana codec peer constraint and excluded only from Expo's compiler-version recommendation. Metro's rpc-websockets/noble export-fallback warnings remain nonfatal.
