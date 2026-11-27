# Argus Android app (owner: Codex)

## Why it exists

It targets the **Solana Mobile track**. Requirements copied from the track page:
- A functional Android APK.
- Solana Mobile Stack plus the **Mobile Wallet Adapter (MWA)**.
- Designed for mobile from the ground up, **with no ports and no PWA wrappers.**
- Meaningful interaction with Solana.
- Submission to the Solana dApp Store (publish.solanamobile.com).
- Contract addresses, a public repo, a video under 3 minutes and a live demo link.

## Stack

- **Expo (React Native) with TypeScript**, in `mobile/` at the repo root.
- Build the APK with **EAS Build** (cloud) so no local Android SDK is needed. The dev machine has 7 GB RAM, so avoid emulators and test on a real Android phone.
- **MWA:** `@solana-mobile/mobile-wallet-adapter-protocol-web3js`, plus `@solana/web3.js`. Follow docs.solanamobile.com/mobile-wallet-adapter/mobile-apps.
- **Program client:** the Anchor IDL from `target/idl/argus.json`, copied into `mobile/src/idl/`. Do not hand-write account layouts.
- **Fonts:** Syncopate, Inter, JetBrains Mono (via `expo-font`). Tokens and colours exactly as in DESIGN.md.
- **Push alerts:** Expo push notifications. The Sentinel backend sends them.

## Screens (v1)

1. **Connect:** MWA authorize, plus pick or enter the vault address.
2. **Vault:** balance, instant allowance, delay, Send.
3. **Pending:** withdrawals with live countdowns. Each has Cancel (if the signer is the owner or a guardian). The vault has Freeze.
4. **Alert (hero screen):** matches `docs/mockups/Mobile.dc.html`. It opens from a push notification. Buttons: Cancel withdrawal / Freeze vault / "It was me, let it through" (which just dismisses).
5. **Guardian approvals:** open proposals. Approve or Veto with the connected guardian wallet.
6. **Settings:** register a phone number and push token with the Sentinel API.

## Rules

- **Only modify files under `mobile/`.** The program, web app and Sentinel are owned by Claude. Request changes in `docs/HANDOFF.md`.
- **Never** embed private keys, API keys or the AI guardian key in the app.
- Every transaction is built from the IDL and signed through MWA. Show the explorer link on success.
- No commits or pushes until the lead says so.

## Order of work

1. Scaffold Expo, set up the fonts and theme, and build static screens from the mockup. This can start before the program exists, with mock data.
2. MWA connect and a read of the vault account (once the program is deployed to devnet).
3. Cancel, freeze, approve and veto transactions.
4. Push notifications and the alert screen deep link.
5. EAS build the APK. **Start the dApp Store publisher setup early**, because it involves minting an NFT for the publisher and app and a review.
