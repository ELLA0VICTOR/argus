# Argus submission video: recording plan and narration draft

Updated 2026-11-28. Target **2:45**, including the live agent conversation; hard maximum **under 3:00**. This is a production plan, not a claim that footage, narration or the final video has been generated.

## The story

**A stolen key should not mean an instant loss of your savings.** Argus gives tokens deposited in its self-custodial Solana vault a cancellable waiting period. Sentinel detects suspicious pending withdrawals; an ElevenLabs call makes the warning understandable and actionable. The program enforces the limits, and the AI key can only cancel or freeze.

Explain that promise in the first 30 seconds, demonstrate it, then prove the role boundary. Do not pitch a cure for every Web3 hack. The allowance, existing trusted destinations, guardian-key compromise and assets outside the vault remain outside that promise. This build uses devnet test tokens.

## Existing demo mechanism

The working implementation is `app/src/demo/DemoPage.tsx`, `PhonePage.tsx`, `IncomingCall.tsx`, and `sentinel/src/demo.ts`.

1. Open `https://tryargus.vercel.app/demo` and click **Hand me the stolen key**. Sentinel creates a disposable owner, a real devnet vault and 12,000 test dUSDC. No viewer wallet or sign-up is needed. Keep this disposable key masked in the recording; never use an owner's real wallet key.
2. Before requesting the withdrawal, scan the QR. It opens `/demo/phone/:session` on the phone. Tap **Use this phone as the owner's** to unlock audio/join the session. Use HTTPS, allow the microphone and keep that browser page active. This is a browser handoff, not proof of background ringing or a native Android notification.
3. Try **Take everything, right now**: simulation rejects it under the allowance rule. Optionally show the untrusted-destination rejection. Skip **Take the daily allowance** in the main take so the final balance remains the full 12,000; it is an intentionally permitted spend, not a failed protection.
4. Choose **Request a withdrawal of everything**. A real pending withdrawal is submitted. Sentinel reads on-chain signals and emits risk and incoming-call events. The funds have not moved.
5. Accept the call on the phone and say **No, that wasn't me. Cancel it.** The existing ElevenLabs agent invokes its scoped client tool. The demo posts the decision to `/v1/demo/:id/decision`; the server's restricted AI key cancels, then freezes on-chain. The laptop mirrors the call and captions.
6. Show the preserved balance, frozen status and real transaction links. Open one explorer receipt. In the demo, no answer for 90 seconds also triggers cancellation. The real-vault watcher has a separate 40-second critical-alert deadline; do not conflate them.

Events are persisted in Postgres and SSE resumes across reconnects. Phone joining and caption relay use `/phone` and `/call`; captions are display-only. A real connected vault uses wallet-signed Cancel/Freeze, not the disposable demo's public decision route. A critical real-vault stand-down requires a guardian signature.

## Run of show and narration draft

The narration below leaves room for an approximately 15-second excerpt of the actual agent conversation. Do not narrate over the proof moment. Render and time the requested voice before locking the edit; shorten narration if the call takes longer.

| Time | Picture and action | Narration |
| --- | --- | --- |
| 0:00–0:12 | An original, simple stolen-key/withdrawal animation; then the Argus logo. | "One stolen wallet key can turn years of savings into an irreversible transfer. What if the thief had the key, but couldn't take everything?" |
| 0:12–0:30 | Landing page into the vault; highlight daily allowance and waiting withdrawal. Small devnet label. | "Meet Argus: a self-custodial savings vault on Solana. Everyday spending stays instant within your allowance. Large withdrawals to new destinations wait, twenty-four hours by default. During that wait, you or a guardian can cancel." |
| 0:30–0:50 | Actual demo: the disposable key stays masked; instant-drain rejection, then delayed request. Brief QR/phone handoff inset. | "Let's give an attacker the owner key to a vault holding twelve thousand test dollars. An instant drain is rejected by the program. A delayed withdrawal is accepted, but the money stays in the vault. Now Sentinel starts watching." |
| 0:50–1:22 | Real risk signals, phone ringing, Accept. Leave room for the agent and Victor's response. Finish on cancellation and freeze. | "The destination is unfamiliar, and the request takes the whole vault. Argus calls to ask whether it's really me." **Then use actual call audio:** Victor: "No, that wasn't me. Cancel it." Keep the real response and resulting transaction on screen. |
| 1:22–1:48 | Explorer receipt and preserved balance; simple owner / guardians / AI diagram. | "The withdrawal is cancelled on-chain, and the vault is frozen. The funds never left. The AI doesn't hold a spending key. Our Anchor program lets it cancel and freeze, never transfer funds. Guardians can replace a compromised owner key and invalidate its pending withdrawals." |
| 1:48–2:13 | Actual Android APK on the phone: connect Solflare via MWA, vault, Cancel/Freeze and guardian proposal screen. | "The same protection is available in our native Android app. Connect through Solana Mobile Wallet Adapter, inspect your vault, and approve protective actions with your wallet. Guardians can manage recovery and rule changes through proposals. Your wallet keeps its keys; the program checks every role." |
| 2:13–2:35 | Short architecture overlay, live web app and test evidence. Use actual results, with no dense terminal scroll. | "Solana enforces the waiting period and recovery rules. Sentinel watches on-chain activity. ElevenLabs turns a warning into a conversation. The program has one hundred and forty-eight tests; the mobile client has seventy-five automated tests and twenty-nine live devnet checks. This demo uses test tokens." |
| 2:35–2:45 | Live demo URL, Android download and Argus mark. | "Try to steal our demo wallet at tryargus dot vercel dot app. Argus never sleeps, so you can." |

The numbers above are recorded checks, not an independent third-party certification. Only use Android footage after the pending phone wallet/audio tests pass. If they uncover a problem, fix and retest before recording that segment.

## Voice and capture plan

- Requested narrator: **Todd — Engaging or Educative v4**, subject to confirming the exact available ElevenLabs voice ID/name after Victor connects the service. Do not infer a model ID from a voice label. No ElevenLabs tool was connected when this plan was written.
- Generate narration in short timed sections after the wording is approved. Use a calm, clear teaching pace with more urgency at the attack; leave the live agent conversation un-narrated. The narrator voice is separate from the existing guardian agent.
- Record a real successful session first, then edit the narration around it. Keep transaction confirmations and outcomes genuine. Label shortened waits or cuts; do not replace a failed action with fabricated success.
- Capture laptop at 1920×1080 and the actual phone separately. Use the phone/browser QR call for the main heist, and a separate actual native APK/MWA clip for the mobile segment. Avoid speaker feedback; retain a clean recording of the real agent audio.
- Export 1080p H.264/AAC, burn in readable captions, and check the final media duration is below 180 seconds. Aim for 165 seconds to leave margin.

## Claims and evidence

- **Scam reports:** Firecrawl was planned, but no lookup adapter is implemented. Show only the real on-chain risk signals in this take. Never add a "reported drainer" badge or narration without an actual exact-address source.
- **Ansem inspiration:** optional brief context, not necessary for the core story. A [Bitquery investigation](https://bitquery.io/investigations/ansem-solana-wallet-drain) describes the reported $2.57M drain on 24 November 2026 and explicitly says chain data cannot establish how the key was lost. If used, attribute it as a reported drain; do not claim Argus was tested against that attack or would prevent every part of it. Prefer an original title card over third-party article screenshots or assets.
- **Background calls/push:** not demonstrated by an active QR browser tab. Native background push still needs FCM and backend registration/delivery.
- **Protection scope:** only deposited vault assets; allowance and already trusted destinations can still be spent by a compromised owner. Keep that distinction in the README and answer it honestly in Q&A.

## Before recording

- [ ] Confirm hosted web and `GET /v1/health?deep=1` are healthy.
- [ ] Finish real-phone cold launch, MWA and native microphone/audio sign-off.
- [ ] Connect ElevenLabs; confirm the exact requested narrator voice and available generation tool.
- [ ] Rehearse one QR call and verify captions, Cancel/Freeze receipts and preserved balance.
- [ ] Capture the main take plus a clearly described button fallback take.
- [ ] Time the assembled narration and call; keep the export under three minutes.
- [ ] Verify final subtitles, devnet label, public links and actual mobile download; submit the video and store/hackathon entries separately.
