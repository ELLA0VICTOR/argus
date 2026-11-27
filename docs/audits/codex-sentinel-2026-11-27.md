# Mobile Sentinel v0 integration verification

2026-11-27. This is an integration check of the throwaway devnet demo, not a new independent program audit or a physical-phone test.

## Local service and key boundary

`GET http://127.0.0.1:8787/v1/health` returned 200, devnet, program `4LH7ikNGVVNaemB7eaLGUMbwSBHHqA2hKXTdrfhgD6nh`, AI public address `DDZHZxxtYEwjttMJMoipr7tXuyPy6BmCCu4ECUi8Jppm`, version 0.1.0. The mobile create form prefills that public address and the announced dUSDC mint. No monitoring private-key file or server RPC credential was opened or copied.

The running v0 API implements health, demo sessions, prepared moves, SSE and demo decisions. It does not yet implement the full wallet-auth/contacts/regular-alert contract. Mobile uses a separate `EXPO_PUBLIC_SENTINEL_DEMO_URL`, leaving the normal authenticated client separate. Private-host HTTP is permitted only in development; standalone builds require HTTPS.

The demo owner key is deliberately handed to each visitor by the demo API. Mobile retains only an in-memory seed, excludes it from public UI session state, stores/logs no key material and clears its seed buffer when disposing the session. It validates the prepared message's sole signer, Argus program/instruction, bound session accounts, permissions and test-token amount, then returns only a signature. Normal user vault transactions continue through MWA. The monitoring key remains server-side and performs protective operations only.

## Live smoke: 7/7

Ran `npm.cmd run smoke:sentinel` through the mobile client's implementation against the local service. This run created and used real disposable devnet test accounts; it did not use a personal MWA wallet.

- Session/vault: `2HXpZtDkoQteDv9D5tiRWtoz89AKLDZGiVefcAUMQ5UY`
- Setup transaction: `3xMdmDiUnMDCC8GTW9M5x1wvDH5NazQWJ6GxXBazVbxxM9EMyANnd7sXJtXmzWMDdMtctG4JDKctZHmtLaRsA3eK`
- SSE events observed: 25.

| Check | Result |
|---|---|
| Instant drain | Rejected with OverDailyLimit (6004) |
| Untrusted transfer | Rejected with NotTrusted (6005) |
| Daily allowance | Confirmed |
| Delayed request | Confirmed |
| Owner's demo cancellation decision | Delivered through the incoming/decision API; Sentinel cancellation transaction observed |
| Sentinel freeze | Confirmed transaction and frozen-state event observed |
| Spending after freeze | Rejected with Frozen (6000) |

The critical-risk event was also asserted. The first attempt used the earlier auto-response timing while the service was gaining the 90-second incoming-decision wait. The client/parser and smoke now handle `incoming`/`decision`, explicitly request cancellation and wait for confirmed protection. The successful run above tests that current flow.

## Voice, notifications and remaining limits

The public ElevenLabs agent is `agent_3001m8ebdd1ee1yrp9ga4kcn2436`. The optional native voice SDK is not added; mobile retains its existing push/deep-link/phone-call path and provides demo decision buttons. Confirming a demo withdrawal preserves its original delay and does not execute it. Live phone delivery, FCM setup and physical-device MWA/SSE/notification testing remain pending. The Node smoke verifies the HTTP/client/decoder flow, not native rendering or audio.

Unit coverage includes private-development URL restrictions, session key exclusion, exact-message signing, health mismatch, substituted programs/accounts/amounts/extra instructions, incremental SSE framing and incoming/decision events. Final mobile checks are recorded in HANDOFF.

## Build-output cleanup

Downloaded `.so` files and deploy staging were moved out of `docs/audits/` into ignored `mobile/.program-check/audits/`. Both probe runners now direct binaries/libraries/object outputs there; the devnet runner also places compiler temporary files there. The relocated helper-only run passed all five tests. A recursive audit-directory scan found no `.o`, `.rlib`, `.so`, `.pyc`, `probe-bin`, `unit-bin` or `deploy/` outputs. Audit sources, results and manifests remain readable here.

## Hosted service update: 8/8

After Sentinel's Vercel bundling fix (`__filename` / `__dirname` for a dependency), reran the mobile smoke against `https://argus-sentinel-six.vercel.app`. Deep health returned HTTP 200 with the expected devnet program/AI address and both database and RPC healthy. The earlier database-connect error was not enough to diagnose the full bundled handler; direct database queries had succeeded locally.

- Session/vault: `7f3za8327PTdtSWrUpHoKSrHYhErxuU2qocBbL97qAjx`
- Setup transaction: `3t1cn7BBBLxRDx4s2Vw3AEtrz9HHwPuogjAPBfgrp6yDc5u8qaWRXnrGHkJa35oo89KZWSN3bJh2AaCnqL7byHBW`
- **8/8 checks passed:** rejected drain and untrusted moves, allowed daily spending, numbered event-stream reconnection, delayed request, Sentinel cancellation, Sentinel freeze and rejection after freeze.
- Two SSE connections; forced reconnection resumed after event `195`, continued through event `213`, and delivered 25 events to the smoke client.

Mobile now defaults to the hosted demo URL. It resumes Vercel's short-lived streams with the last accepted event ID using `?after=<id>`, honors bounded retry hints and discards incomplete frames when reconnecting. Tests cover replays, equal/out-of-order timestamps, partial frames, invalid cursors and older unnumbered local streams. Unit/behavior checks are now **63/63**, with TypeScript, Android export, native prebuild and Expo Doctor **20/20** passing.

Since the original local check above, the native ElevenLabs call implementation has been added. Its live microphone/MWA/notification behavior still requires a physical-phone test. The authenticated ordinary-alert backend and FCM remain separate from the hosted demo. No monitoring private key or RPC secret was embedded in mobile. The first EAS development APK build is `e5086e85-9b45-4b36-948a-bebf943af86d`; its outcome and download link are tracked in HANDOFF.
