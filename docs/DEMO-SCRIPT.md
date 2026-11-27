# Demo video script (target 2:45, hard limit under 3:00)

| Time | On screen | Voice-over (draft; Victor rewrites in his own words) |
|---|---|---|
| 0:00–0:15 | A headline about a real drain (Ansem, about $2.57M). Then a black screen and the Argus logo | "In crypto, a stolen key means your money is gone in seconds. No bank to call, no undo. It just happened to one of Solana's best-known traders." |
| 0:15–0:35 | Landing page | "Argus is a self-custodial vault on Solana. Small spending is instant. Anything big waits 24 hours, and during that wait, it can be cancelled. You keep your keys." |
| 0:35–1:20 | **The heist, live on devnet.** The "thief" uses the owner key to request a withdrawal of the whole vault. The dashboard turns red. The watch log fills: address 3 min old, named in drainer reports (Firecrawl). The phone rings (ElevenLabs). We hear the call. The owner says "cancel". The banner turns teal, with an explorer link | "Someone has my key and they're draining my vault. Watch. Argus's AI spots a brand-new address that's been reported for draining wallets. And it calls me." [call audio] "One word, and it's cancelled on-chain. The money never left." |
| 1:20–1:50 | Diagram of the roles: owner, guardians, AI cancel-only | "The AI can stop a withdrawal, but it can never move your money. It has a cancel-only key, enforced by our Anchor program. A thief with my main key can't trust a new address, raise limits or replace me. Only my guardians can, and they can swap the stolen key out in one step." |
| 1:50–2:10 | Mobile app: alert screen and guardian approvals on an Android phone | "Guardians can be your phone, your family, or a company's team, any 2 of 3. Our Android app puts the cancel button in your pocket." |
| 2:10–2:30 | Comparison slide: Coinbase (custodial) / Bitcoin (needs a soft fork) / Argus (live on Solana) | "Coinbase offers this only if they hold your money. Bitcoin can't do it yet. On Solana we can, today." |
| 2:30–2:45 | "Try it: steal my wallet", with the live link and the team | "Don't take our word for it. Go to our site and try to steal our money. Argus never sleeps, so you can." |

**Recording tips:**
- Record the phone call for real, but splice it into the screen recording. Don't rely on live network timing.
- Use short delays (60s) on the demo vault.
- Show the explorer for every on-chain step.
