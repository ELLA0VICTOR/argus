# Argus design direction (web and mobile)

**Current direction (Victor, 2026-11-27): light, airy and painterly.** The visual reference is the *style* of cluely.com: painted-sky hero, serif display headline, soft blue, rounded glassy cards, light grey and white pages. Argus uses **its own** content, imagery, product shots and logo. Never copy another product's images, text or brand marks.

The earlier "dark control room" direction is retired. Its tokens are replaced in `app/src/index.css`, and the token *names* are unchanged.

## Feel

Calm, premium, trustworthy. Lots of air. The landing page can be cinematic. The app is quiet and obvious: one job per screen, plain words, colour only when you need to act.

## Tokens (`app/src/index.css`, Tailwind v4 `@theme`)

| Token | Value | Use |
|---|---|---|
| `ink` | #ffffff | Page background |
| `panel` / `raised` | #f4f6fa / #eef2f8 | Soft surfaces, hover |
| `line` / `line-soft` / `line-strong` | #e4e8ef / #eef1f6 / #cfd6e2 | Hairlines and borders |
| `fg` | #16191f | Primary text |
| `muted` | #5f6877 | Secondary text (4.5:1 on white) |
| `faint` | #8b94a3 | Second tone in two-tone headings, tertiary labels |
| `brand` / `brand-2` / `brand-soft` | #2563eb / #3b82f6 / #eaf1ff | **Argus blue.** Primary buttons (gradient + glow via `.btn-brand`), selected states, links |
| `threat` | #dc2626 | **Only** the Cancel button and the edge of a suspicious withdrawal |
| `wait` | #c2410c | **Only** countdown digits |
| `safe` | #059669 | **Only** "done" states |

**Surfaces** (classes in `index.css`):
- `.card-blue` is a blue gradient feature card.
- `.card-soft` and `.card-mist` are light grey-blue cards.
- `.glass-dark` and `.glass-light` are frosted UI floating over imagery.
- `.wallpaper` is the colourful background behind the product window.
- `.shadow-float` is the long, soft shadow for floating windows.

**Shape:** cards 20–28px radius, buttons 10–14px, tags and pills full radius, inputs as underlines.

## Type

- **EB Garamond** (`font-serif`): the hero headline only, large, white on the sky.
- **Inter**: everything else. Section headings are semibold with tight tracking, and are **two-tone**, with the second part in `faint` ("How Argus protects *every withdrawal*").
- **Numbers** use Inter with tabular figures (`.num`). **JetBrains Mono** is only for addresses and transaction ids.

## Logo

The triangle "A" with an almond eye, with **rounded strokes and a single colour**: white on imagery, ink on white (`components/Logo.tsx`). The pupil turns red and dilates **only** inside the app when there's a threat. It can "look around" (the pupil drifts) as idle motion.

## Imagery

- **Hero:** `app/public/img/hero-dawn.webp`. It's an original painted dawn landscape with snow peaks, a low sun, warm dunes, and a distant watchtower on the left ridge (Argus, the watchman). It was generated for Argus with ElevenLabs (flow `TT4mcgMUzPRmAHV6sB1c`, variant 2) and is 1280×720.
- **Product shots:** these are live HTML. The Argus app in a window over `.wallpaper`, with a frosted overlay replaying "Argus calls → you say cancel → cancelled on-chain". No screenshots of other products.

## Landing structure (`app/src/landing/`)

1. **Hero:** the full-bleed painting, a nav (logo plus How it works / Security / Mobile / FAQ), the serif headline "Crypto has no undo. Argus gives it 24 hours.", a white subtitle, one glowing blue CTA, and "or open the web app".
2. **Floating "Launch app" button,** top-right, once you scroll past the hero.
3. **Product window** rising over the bottom of the hero.
4. **"How Argus protects *every withdrawal*":** a blue card (watches, live countdown) and a soft card (calls you, transcript and actions).
5. **"Safety, *without the friction*":** three cards (allowance, trusted, guardians), plus "Works with every Solana wallet".
6. **"Built so the AI *can only say no*":** big-number stats beside a watch-log card.
7. **"Your vault, *on every device*":** Android APK, web, dApp Store.
8. **FAQ** (chevron accordion).
9. **Closing CTA** with floating glass tiles, then the footer with the "Live on Solana devnet" pill.

## Inside the app (`/app`)

- **Quiet white UI.** White rounded cards (`Group`, 20px radius, hairline dividers) on a soft `canvas` background. A white left sidebar on desktop, five tabs on phones (Home, Send, Activity, Guardians, Settings). Page titles use the serif, as on the landing page.
- **Home:** a balance card with a status pill ("Protected", "Argus is on it", "Frozen") and a meter for today's instant allowance, Send (blue) and Deposit, and a "Freeze vault" text button. Then "Needs your attention" (red band), "Waiting to leave" (each with a thin bar for how much of the wait has passed), and "Recent activity" as a dot timeline.
- **Send:** one card. A three-way route indicator (Instant / Trusted / Waits 24h) lights up the path the transfer will take before you sign.
- **People and keys** get a round initials avatar. The AI guardian uses the Argus mark.
- **Colour only to act:** red Cancel on a suspicious item, amber countdowns, green "done" and "Protected".
- **Plain sentence-case language.** No instruction names, and no all-caps labels.

## Mobile (Codex, `mobile/`)

Same tokens, fonts, logo and rules: light, rounded and calm. The primary action sits at the bottom. The alert screen is the hero screen: a calm white sheet with the suspicious amount, a countdown, a red **Cancel** button and a secondary **Freeze**.

## Interaction rules

- Every on-chain action shows pending, then confirmed (with an explorer link) or an error with the program's human message.
- Countdowns tick live. At zero, show "Ready".
- Touch targets are at least 44px. Text contrast is at least 4.5:1.
- Animation means entrances, gentle floats and state changes. It respects `prefers-reduced-motion`.
- The intro splash (about 3.5s, every load) shows the logo drawing in ink on white, the letters rising and a blue progress line, then fades into the hero.
