import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Logo, Wordmark } from "../components/Logo";
import { Icon, type IconName } from "../components/Icon";
import { Address } from "../components/ui";
import { ProductShot } from "./ProductShot";
import { useReveal, useScrolled } from "../lib/hooks";
import { APK_URL, DAPP_STORE_URL, PROGRAM_ID, REPO_URL, TEST_COUNT } from "../lib/config";
import { explorerAddr } from "../lib/format";

export default function Landing() {
  useEffect(() => {
    document.title = "Argus · Crypto has no undo. Argus gives it 24 hours.";
  }, []);
  return (
    <div className="min-h-screen overflow-x-clip bg-white text-fg">
      <FloatingCta />
      <Hero />
      <main>
        <Showcase />
        <HowItHelps />
        <Features />
        <Numbers />
        <GetArgus />
        <Faq />
      </main>
      <Closing />
    </div>
  );
}

/* ---------------------------------------------------------------- shared */

function Section({ id, children, className = "" }: { id?: string; children: ReactNode; className?: string }) {
  const ref = useReveal<HTMLElement>();
  return (
    <section id={id} ref={ref} className={`scroll-mt-8 ${className}`}>
      {children}
    </section>
  );
}

/** Two-tone heading: the second part sits in a softer grey. */
function Heading({ a, b, center, className = "" }: { a: ReactNode; b?: ReactNode; center?: boolean; className?: string }) {
  return (
    <h2 className={`reveal text-[34px] leading-[1.08] font-semibold tracking-[-0.035em] sm:text-[48px] ${center ? "text-center" : ""} ${className}`}>
      <span className="text-fg">{a}</span>
      {b && <span className="text-faint"> {b}</span>}
    </h2>
  );
}

function BrandButton({ to, children, size = "lg", dark }: { to: string; children: ReactNode; size?: "md" | "lg"; dark?: boolean }) {
  const cls = `press nudge inline-flex items-center justify-center gap-2.5 font-medium text-white ${size === "lg" ? "min-h-13 rounded-[14px] px-7 text-[16px]" : "min-h-10 rounded-xl px-4 text-[14px]"} ${dark ? "bg-[#1f2329] shadow-[0_10px_30px_-10px_rgba(0,0,0,0.5)] hover:bg-black" : "btn-brand"}`;
  return (
    <Link to={to} className={cls}>
      {children}
    </Link>
  );
}

/* ------------------------------------------------------- floating CTA */

function FloatingCta() {
  const past = useScrolled(520);
  return (
    <div className={`fixed top-4 right-4 z-50 transition-all duration-500 sm:top-5 sm:right-6 ${past ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-3 opacity-0"}`} style={{ transitionTimingFunction: "cubic-bezier(0.16,1,0.3,1)" }}>
      <BrandButton to="/app" size="md">
        Launch app
      </BrandButton>
    </div>
  );
}

/* ------------------------------------------------------------------ hero */

function Hero() {
  const [open, setOpen] = useState(false);
  return (
    <header className="relative isolate overflow-hidden bg-[#9ea9bf]">
      <img src="/img/hero-dawn.webp" srcSet="/img/hero-dawn-640.webp 640w, /img/hero-dawn.webp 1280w" sizes="100vw" alt="" className="absolute inset-0 -z-10 h-full w-full object-cover object-[30%_60%]" fetchPriority="high" />
      {/* a whisper of shade behind the white type */}
      <div className="absolute inset-x-0 top-0 -z-10 h-[70%] bg-[linear-gradient(180deg,rgba(23,52,120,0.28),rgba(23,52,120,0))]" aria-hidden="true" />

      <nav className="mx-auto flex h-20 max-w-[1240px] items-center justify-between px-5 text-white sm:px-8">
        <div className="flex items-center gap-12">
          <Link to="/" aria-label="Argus home" className="drop-shadow-[0_1px_8px_rgba(0,0,0,0.15)]">
            <Wordmark size={28} />
          </Link>
          <div className="hidden items-center gap-8 text-[15px] font-medium text-white/90 md:flex">
            <a href="#how" className="hover:text-white">How it works</a>
            <a href="#features" className="hover:text-white">Security</a>
            <a href="#get" className="hover:text-white">Mobile</a>
            <a href="#faq" className="hover:text-white">FAQ</a>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/app" className="hidden rounded-xl px-4 py-2 text-[14.5px] font-medium text-white/90 hover:text-white sm:inline-flex">
            Open app
          </Link>
          <button type="button" className="grid size-10 place-items-center md:hidden" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>
            <Icon name={open ? "close" : "menu"} size={22} />
          </button>
        </div>
      </nav>
      {open && (
        <div className="fade-in glass-light mx-4 rounded-2xl p-2 text-fg md:hidden">
          {[
            ["How it works", "#how"],
            ["Security", "#features"],
            ["Mobile", "#get"],
            ["FAQ", "#faq"],
            ["Open app", "/app"],
          ].map(([l, h]) =>
            h.startsWith("/") ? (
              <Link key={l} to={h} className="block rounded-xl px-4 py-3 text-[16px] hover:bg-white/60">
                {l}
              </Link>
            ) : (
              <a key={l} href={h} onClick={() => setOpen(false)} className="block rounded-xl px-4 py-3 text-[16px] hover:bg-white/60">
                {l}
              </a>
            ),
          )}
        </div>
      )}

      <div className="mx-auto flex max-w-[980px] flex-col items-center px-5 pt-16 pb-56 text-center text-white sm:pt-24 sm:pb-72 lg:pb-80">
        <h1 className="enter font-serif text-[clamp(38px,11.4vw,52px)] leading-[0.98] font-normal tracking-[-0.015em] drop-shadow-[0_2px_24px_rgba(20,40,90,0.25)] sm:text-[84px] lg:text-[104px]" style={{ ["--d" as string]: 80 }}>
          <span className="whitespace-nowrap">Crypto has no undo.</span>
          <br />
          Argus gives it 24&nbsp;hours.
        </h1>
        <div className="enter mt-8 h-px w-[min(480px,70%)] bg-white/40" style={{ ["--d" as string]: 180 }} />
        <p className="enter mt-7 max-w-[40rem] text-[17px] leading-relaxed font-medium text-white/95 drop-shadow-[0_1px_12px_rgba(20,40,90,0.3)] sm:text-[20px]" style={{ ["--d" as string]: 240 }}>
          A self-custodial vault on Solana. Big withdrawals wait, an AI guardian watches every one, and a single word on a phone call stops a thief.
        </p>
        <div className="enter mt-10 flex flex-col items-center gap-4" style={{ ["--d" as string]: 320 }}>
          <BrandButton to="/demo">
            <Icon name="play" size={16} strokeWidth={2} className="fill-current" />
            Try the live demo
          </BrandButton>
          <Link to="/app" className="nudge inline-flex items-center gap-1.5 text-[14.5px] font-medium text-white/90 hover:text-white">
            or open the web app <Icon name="arrow-right" size={15} className="arrow" />
          </Link>
        </div>
      </div>
    </header>
  );
}

/* --------------------------------------------------------- showcase */

function Showcase() {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className="relative z-10 mx-auto -mt-44 max-w-[1240px] px-3 sm:-mt-56 sm:px-8 lg:-mt-64">
      <div className="reveal">
        <ProductShot />
      </div>
    </div>
  );
}

/* ---------------------------------------------------- how it helps */

function Pill({ icon, children, light }: { icon: IconName; children: ReactNode; light?: boolean }) {
  return (
    <span className={`mx-1 inline-flex translate-y-[-3px] items-center gap-1.5 rounded-full px-3 py-0.5 align-middle text-[0.82em] ${light ? "bg-white/25 text-white ring-1 ring-white/40" : "bg-white text-fg ring-1 ring-line"}`}>
      <Icon name={icon} size={16} />
      {children}
    </span>
  );
}

function HowItHelps() {
  const [s, setS] = useState(86_392);
  useEffect(() => {
    const id = setInterval(() => setS((v) => (v <= 86_330 ? 86_392 : v - 1)), 1000);
    return () => clearInterval(id);
  }, []);
  const t = `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  return (
    <Section id="how" className="mx-auto max-w-[1240px] px-5 pt-28 sm:px-8 lg:pt-36">
      <Heading a="How Argus protects" b="every withdrawal" />
      <div className="mt-12 grid gap-5 lg:grid-cols-2">
        {/* watches */}
        <article className="reveal card-blue relative overflow-hidden rounded-[28px] p-7 text-white sm:p-10" style={{ ["--d" as string]: 80 }}>
          <h3 className="text-[26px] leading-tight font-semibold tracking-[-0.02em] sm:text-[30px]">
            Argus <Pill icon="eye" light>watches</Pill> every withdrawal
          </h3>
          <p className="mt-4 max-w-[30rem] text-[16px] leading-relaxed text-white/90">Anything above your daily allowance waits 24 hours in public. The moment it's requested, Argus starts checking it.</p>
          <div className="mt-10 text-center">
            <div className="num text-[48px] leading-none font-medium sm:text-[56px]">{t}</div>
            <div className="mt-2 flex items-center justify-center gap-1.5 text-[14px] text-white/85">
              <span className="size-1.5 animate-pulse-dot rounded-full bg-white" /> Cancellable until then
            </div>
          </div>
          <div className="mt-10 space-y-2.5 rounded-2xl bg-white/12 p-4 ring-1 ring-white/20 backdrop-blur-sm">
            {[
              ["How new is the address?", "14 min"],
              ["Does it imitate one you trust?", "Yes"],
              ["Share of the vault", "96%"],
            ].map(([k, v], i) => (
              <div key={k} className="flex items-center justify-between text-[14px]" style={{ opacity: 1 - i * 0.12 }}>
                <span className="text-white/85">{k}</span>
                <span className="font-medium">{v}</span>
              </div>
            ))}
          </div>
        </article>

        {/* calls */}
        <article className="reveal card-soft relative overflow-hidden rounded-[28px] p-7 sm:p-10" style={{ ["--d" as string]: 160 }}>
          <h3 className="text-[26px] leading-tight font-semibold tracking-[-0.02em] sm:text-[30px]">
            When it looks like theft, Argus <Pill icon="phone">calls</Pill> you
          </h3>
          <p className="mt-4 max-w-[30rem] text-[16px] leading-relaxed text-muted">Say “cancel” and it's cancelled on-chain. The AI's key can cancel or freeze, and nothing else. It can never move your funds.</p>

          <div className="mt-10 flex justify-center">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-[#1f2329] p-1.5 pr-2 text-white shadow-[0_10px_30px_-10px_rgba(0,0,0,0.5)]">
              <span className="grid size-8 place-items-center rounded-full bg-white/10">
                <Logo size={18} />
              </span>
              <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[12.5px]">
                <span className="size-1.5 animate-pulse-dot rounded-full bg-[#ef4444]" /> Calling…
              </span>
              <span className="grid size-8 place-items-center rounded-full bg-white/10">
                <span className="size-2.5 rounded-[2px] bg-white" />
              </span>
            </div>
          </div>

          <div className="mt-4 rounded-2xl bg-[#3a3d44] p-5 text-white shadow-[0_24px_50px_-24px_rgba(0,0,0,0.5)]">
            <div className="flex justify-end">
              <span className="rounded-full bg-[#2563eb] px-3 py-1 text-[12px] font-medium">Theft suspected</span>
            </div>
            <div className="mt-2 text-[12px] text-white/55">On the call</div>
            <p className="mt-1 text-[14px] leading-relaxed text-white/95">“12,000 USDC is waiting to leave your vault for a brand-new address. Was this you?” &nbsp;You: “No, cancel it.”</p>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-white/10 pt-3 text-[12.5px] text-white/75">
              <span className="flex items-center gap-1.5">
                <Icon name="x" size={13} /> Cancel
              </span>
              <span className="flex items-center gap-1.5">
                <Icon name="snow" size={13} /> Freeze
              </span>
              <span className="flex items-center gap-1.5">
                <Icon name="check" size={13} /> It was me
              </span>
            </div>
          </div>
        </article>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------ features */

function Features() {
  return (
    <Section id="features" className="mx-auto max-w-[1120px] px-5 pt-32 sm:px-8 lg:pt-40">
      <Heading a="Safety," b="without the friction" center />
      <p className="reveal mt-4 text-center text-[17px] text-muted">Everything a stolen key can't do, and everything you still can.</p>

      <div className="mt-14 grid gap-8 md:grid-cols-3">
        <Feature
          d={0}
          title="Spend as usual."
          body="Everyday payments within your daily allowance go through instantly. No waiting, no co-signers."
          visual={
            <div className="w-full rounded-2xl bg-white p-4 shadow-[0_10px_30px_-18px_rgba(30,50,100,0.35)]">
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="font-medium">Instant today</span>
                <span className="rounded-full bg-safe-bg px-2 py-0.5 text-[11px] font-medium text-safe">Within limit</span>
              </div>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="text-[26px] font-semibold tracking-[-0.02em]">18.50</span>
                <span className="text-[13px] text-muted">/ 100 USDC</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line">
                <div className="h-full w-[18.5%] rounded-full bg-brand" />
              </div>
              <div className="mt-4 space-y-2 text-[12px]">
                {[["Coffee", "4.50"], ["Groceries", "14.00"]].map(([a, b]) => (
                  <div key={a} className="flex justify-between text-muted">
                    <span>{a}</span>
                    <span className="num text-fg">{b}</span>
                  </div>
                ))}
              </div>
            </div>
          }
        />
        <Feature
          d={110}
          title="Your own wallets, instantly."
          body="Send any amount to addresses your guardians approved, like your exchange account or a cold wallet."
          visual={
            <div className="w-full rounded-2xl bg-white p-4 shadow-[0_10px_30px_-18px_rgba(30,50,100,0.35)]">
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="font-medium">Trusted addresses</span>
                <span className="text-[11px] text-muted">2</span>
              </div>
              {[["Exchange account", "EfK2…q9mX"], ["Cold wallet", "5HdC…3mX"]].map(([a, b]) => (
                <div key={a} className="mt-3 flex items-center justify-between rounded-xl border border-line p-2.5">
                  <div>
                    <div className="text-[12.5px] font-medium">{a}</div>
                    <div className="font-mono text-[10.5px] text-muted">{b}</div>
                  </div>
                  <span className="grid size-6 place-items-center rounded-full bg-brand-soft text-brand">
                    <Icon name="check" size={13} strokeWidth={2} />
                  </span>
                </div>
              ))}
            </div>
          }
        />
        <Feature
          d={220}
          title="Guardians have your back."
          body="Any one guardian can cancel or freeze. Together they replace a stolen key, and you never need a seed phrase."
          visual={
            <div className="w-full rounded-2xl bg-white p-4 shadow-[0_10px_30px_-18px_rgba(30,50,100,0.35)]">
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="font-medium">Guardians</span>
                <span className="rounded-full bg-panel px-2 py-0.5 text-[11px] text-muted">2 of 3</span>
              </div>
              {([["Ada", "Family", "#f59e0b", true], ["Tunde", "Family", "#10b981", true], ["Backup key", "Your Seeker", "#6366f1", false]] as [string, string, string, boolean][]).map(([n, r, c, signed]) => (
                <div key={n} className="mt-3 flex items-center gap-2.5">
                  <span className="grid size-7 place-items-center rounded-full text-[11px] font-semibold text-white" style={{ background: c }}>
                    {n[0]}
                  </span>
                  <div className="flex-1">
                    <div className="text-[12.5px] font-medium">{n}</div>
                    <div className="text-[10.5px] text-muted">{r}</div>
                  </div>
                  {signed ? (
                    <span className="grid size-[18px] place-items-center rounded-full bg-fg text-white" title="Approved">
                      <Icon name="check" size={11} strokeWidth={2.6} />
                    </span>
                  ) : (
                    <span className="size-[18px] rounded-full border-[1.5px] border-dashed border-line-strong" title="Waiting" />
                  )}
                </div>
              ))}
            </div>
          }
        />
      </div>

      <div className="reveal mt-20 text-center" style={{ ["--d" as string]: 120 }}>
        <div className="text-[11.5px] font-medium tracking-[0.18em] text-faint uppercase">Works with every Solana wallet</div>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-[15px] text-muted">
          {["Phantom", "Solflare", "Backpack", "Seeker", "Mobile Wallet Adapter"].map((w) => (
            <span key={w} className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-line-strong" />
              {w}
            </span>
          ))}
        </div>
      </div>
    </Section>
  );
}

function Feature({ title, body, visual, d }: { title: string; body: string; visual: ReactNode; d: number }) {
  return (
    <article className="reveal" style={{ ["--d" as string]: d }}>
      <div className="card-mist flex aspect-[1.08] items-center justify-center rounded-[24px] p-6">{visual}</div>
      <p className="mt-5 text-[15.5px] leading-relaxed text-muted">
        <span className="font-semibold text-fg">{title}</span> {body}
      </p>
    </article>
  );
}

/* ------------------------------------------------------------- numbers */

function Numbers() {
  const rows: [string, string, string][] = [
    ["24h", "To change your mind", "Big withdrawals wait a full day in public, and anyone protecting you can cancel them."],
    ["1", "Signature to stop a thief", "You, any single guardian or the AI guardian can cancel or freeze on its own."],
    ["0", "Tokens the AI can move", "Its key can cancel and freeze. The program rejects everything else it tries."],
    [`${TEST_COUNT}`, "Tests on the program", "Including a 6,000-step fuzz that tries to break every rule."],
  ];
  return (
    <Section className="mx-auto max-w-[1080px] px-5 pt-32 sm:px-8 lg:pt-40">
      <div className="grid items-center gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <div className="reveal card-mist rounded-[24px] p-7 sm:p-9">
          <div className="rounded-2xl bg-white p-5 shadow-[0_20px_40px_-24px_rgba(30,50,100,0.4)]">
            <div className="text-[11px] text-muted">Today · Savings vault</div>
            <div className="mt-1 text-[17px] font-semibold tracking-[-0.01em]">Watch log</div>
            <div className="mt-3 flex gap-1.5 text-[11px]">
              {["All", "Money", "Alerts"].map((t, i) => (
                <span key={t} className={`rounded-md px-2 py-0.5 ${i === 0 ? "bg-panel text-fg" : "text-muted"}`}>
                  {t}
                </span>
              ))}
            </div>
            <ol className="mt-4 space-y-3 text-[12.5px]">
              {[
                ["03:12", "Withdrawal of 12,000.00 USDC requested", ""],
                ["03:12", "The destination was created 14 minutes ago", "text-threat"],
                ["03:12", "Argus rated it critical. Calling you", "text-threat"],
                ["03:13", "You said “cancel”", ""],
                ["03:13", "Cancelled on-chain. Funds never left", "text-safe"],
              ].map(([t, m, c], i) => (
                <li key={i} className="flex gap-3">
                  <span className="num w-10 shrink-0 text-[11px] text-faint">{t}</span>
                  <span className={c || "text-fg"}>{m}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div>
          <Heading a="Built so the AI" b="can only say no" />
          <dl className="mt-8">
            {rows.map(([n, t, b], i) => (
              <div key={t} className="reveal grid grid-cols-[96px_1fr] gap-6 border-b border-line py-6 last:border-0 sm:grid-cols-[130px_1fr]" style={{ ["--d" as string]: i * 80 }}>
                <dt className="text-[40px] leading-none font-medium tracking-[-0.03em] sm:text-[48px]">{n}</dt>
                <dd className="m-0">
                  <div className="text-[19px] font-medium tracking-[-0.01em]">{t}</div>
                  <div className="mt-1.5 text-[15px] leading-relaxed text-muted">{b}</div>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------- get argus */

function GetArgus() {
  return (
    <Section id="get" className="mx-auto max-w-[1120px] px-5 pt-32 sm:px-8 lg:pt-40">
      <Heading a="Your vault," b="on every device" center />
      <p className="reveal mt-4 text-center text-[17px] text-muted">Approve, cancel and freeze from wherever you are. Alerts arrive as calls and push notifications.</p>
      <div className="mt-12 grid gap-5 md:grid-cols-3">
        <GetCard
          d={0}
          icon="android"
          title="Android app"
          body="Built for Solana Mobile and the Seeker. Signs with your wallet through Mobile Wallet Adapter."
          action={
            APK_URL ? (
              <a href={APK_URL} className="press btn-brand inline-flex min-h-11 items-center gap-2 rounded-xl px-5 text-[14px] font-medium text-white">
                <Icon name="download" size={16} /> Download APK
              </a>
            ) : (
              <span className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-panel px-4 text-[13.5px] text-muted">
                <span className="size-1.5 animate-pulse-dot rounded-full bg-wait" /> APK building
              </span>
            )
          }
        />
        <GetCard
          d={110}
          icon="globe"
          title="Web app"
          body="The full vault in your browser, with Phantom, Solflare or Backpack."
          action={
            <Link to="/app" className="press nudge inline-flex min-h-11 items-center gap-2 rounded-xl border border-line-strong bg-white px-5 text-[14px] font-medium hover:bg-panel">
              Open web app <Icon name="arrow-right" size={15} className="arrow" />
            </Link>
          }
        />
        <GetCard
          d={220}
          icon="store"
          title="Solana dApp Store"
          body="One-tap install on Seeker, distributed through the Solana Mobile dApp Store."
          action={
            DAPP_STORE_URL ? (
              <a href={DAPP_STORE_URL} className="press inline-flex min-h-11 items-center gap-2 rounded-xl border border-line-strong bg-white px-5 text-[14px] font-medium">
                Open listing
              </a>
            ) : (
              <span className="inline-flex min-h-11 items-center rounded-xl bg-panel px-4 text-[13.5px] text-muted">Coming soon</span>
            )
          }
        />
      </div>
    </Section>
  );
}

function GetCard({ icon, title, body, action, d }: { icon: IconName; title: string; body: string; action: ReactNode; d: number }) {
  return (
    <article className="reveal card-soft flex flex-col rounded-[24px] p-7" style={{ ["--d" as string]: d }}>
      <span className="grid size-11 place-items-center rounded-xl bg-white text-fg shadow-[0_6px_16px_-8px_rgba(30,50,100,0.4)]">
        <Icon name={icon} size={20} />
      </span>
      <h3 className="mt-6 text-[19px] font-semibold tracking-[-0.01em]">{title}</h3>
      <p className="mt-2 flex-1 text-[15px] leading-relaxed text-muted">{body}</p>
      <div className="mt-6">{action}</div>
    </article>
  );
}

/* ------------------------------------------------------------------- faq */

const FAQS: [string, string][] = [
  ["Is Argus custodial?", "No. Your funds sit in a vault account controlled by a Solana program. Nobody at Argus can move them, not even the AI guardian, whose key can only cancel and freeze."],
  ["What if someone steals my phone or main key?", "They can spend at most your daily allowance. Anything bigger waits, 24 hours by default, while Argus calls you. Say “cancel”, or let any one guardian cancel. Your guardians then replace the stolen key, which voids everything it requested."],
  ["What if the Argus server is hacked?", "The worst it can do is cancel withdrawals or freeze your vault. That's annoying, but your funds stay put. Your guardians can remove the AI key immediately."],
  ["What if I lose my main key?", "Your guardians replace it. Argus stores who your owner is, not a secret, so recovery doesn't need a seed phrase. Your vault and funds stay where they are."],
  ["Who should my guardians be?", "A backup wallet on another device for individuals (1-of-1), two of three trusted people for families, or three of five for teams."],
  ["Will Argus ever ask for my seed phrase?", "Never. An Argus call only ever offers one thing: say “cancel”. Anyone asking for keys is not Argus."],
  ["Is it audited?", "Argus runs on devnet only. Two independent reviewers audited the program internally, and it has 148 tests including a 6,000-step fuzz. It hasn't had a third-party audit, so use test tokens."],
];

function Faq() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <Section id="faq" className="mx-auto max-w-[920px] px-5 pt-32 sm:px-8 lg:pt-40">
      <h2 className="reveal text-[30px] font-semibold tracking-[-0.03em] sm:text-[36px]">Frequently asked questions</h2>
      <div className="reveal mt-8" style={{ ["--d" as string]: 80 }}>
        {FAQS.map(([q, a], i) => {
          const isOpen = open === i;
          return (
            <div key={q} className="border-b border-line">
              <button type="button" className="flex w-full items-center justify-between gap-6 py-5 text-left text-[17px] font-medium" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : i)}>
                {q}
                <Icon name="chevron-down" size={18} className={`shrink-0 text-muted transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`} />
              </button>
              <div className={`grid transition-all duration-500 ${isOpen ? "grid-rows-[1fr] pb-5 opacity-100" : "grid-rows-[0fr] opacity-0"}`} style={{ transitionTimingFunction: "cubic-bezier(0.16,1,0.3,1)" }}>
                <p className="overflow-hidden pr-10 text-[15.5px] leading-relaxed text-muted">{a}</p>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------ closing + footer */

function Closing() {
  const ref = useReveal<HTMLElement>();
  return (
    <footer ref={ref} className="relative mt-32 overflow-hidden bg-[linear-gradient(180deg,#ffffff_0%,#eef1f8_22%,#e6eaf4_100%)] lg:mt-40">
      <div className="relative mx-auto max-w-[920px] px-5 pt-28 pb-16 sm:px-8">
        {/* floating glass tiles */}
        <GlassTile className="top-14 right-[8%] hidden sm:grid" rotate={-8} delay={0}>
          <Logo size={40} />
        </GlassTile>
        <GlassTile className="top-[190px] right-[30%] hidden sm:grid" rotate={10} delay={1200} glow>
          <DelayRing />
        </GlassTile>

        <div className="reveal max-w-[34rem]">
          <h2 className="text-[26px] leading-tight font-semibold tracking-[-0.02em] sm:text-[30px]">
            Theft takes one signature.
            <br />
            <span className="text-faint">Stopping it takes one word.</span>
          </h2>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <BrandButton to="/demo" size="md" dark>
              <Icon name="play" size={14} strokeWidth={2} className="fill-current" /> Try the live demo
            </BrandButton>
            <Link to="/app" className="nudge inline-flex items-center gap-1.5 text-[14px] font-medium text-muted hover:text-fg">
              Open the web app <Icon name="arrow-right" size={14} className="arrow" />
            </Link>
          </div>
        </div>

        <div className="mt-28 grid gap-10 border-t border-line-strong/60 pt-10 sm:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <Wordmark size={24} className="text-fg" />
          <FooterCol title="Product" links={[["Live demo", "/demo"], ["Web app", "/app"], ["Android", "#get"]]} />
          <FooterCol title="Learn" links={[["How it works", "#how"], ["Security", "#features"], ["FAQ", "#faq"]]} />
          <div>
            <div className="text-[14px] font-semibold">Program</div>
            <div className="mt-3 space-y-2.5 text-[14px] text-muted">
              <Address value={PROGRAM_ID} className="text-[12.5px] text-muted" />
              <a href={explorerAddr(PROGRAM_ID)} target="_blank" rel="noreferrer" className="block hover:text-fg">
                Solana Explorer
              </a>
              {REPO_URL && (
                <a href={REPO_URL} target="_blank" rel="noreferrer" className="block hover:text-fg">
                  GitHub
                </a>
              )}
            </div>
          </div>
        </div>

        <div className="mt-12 inline-flex items-center gap-2 rounded-lg border border-line bg-white/70 px-3 py-1.5 text-[12.5px] text-muted">
          <span className="size-1.5 animate-pulse-dot rounded-full bg-safe" /> Live on Solana devnet
        </div>
        <div className="mt-6 flex flex-col justify-between gap-2 border-t border-line-strong/60 pt-6 text-[12.5px] text-faint sm:flex-row">
          <span>© 2026 Argus. Devnet only, not audited by a third party.</span>
          <span>Argus never asks for your seed phrase.</span>
        </div>
      </div>
    </footer>
  );
}

/** The 24-hour delay as a ring: most of the wait still ahead, time running. */
function DelayRing() {
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative grid place-items-center">
      <svg width="76" height="76" viewBox="0 0 76 76" className="-rotate-90">
        <circle cx="38" cy="38" r={r} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="5" />
        <circle cx="38" cy="38" r={r} fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * 0.28} />
      </svg>
      <span className="num absolute text-[13px] font-semibold tracking-[-0.02em] text-[#2f5fd0]">23:41</span>
    </span>
  );
}

function GlassTile({ children, className = "", rotate, delay, glow }: { children: ReactNode; className?: string; rotate: number; delay: number; glow?: boolean }) {
  return (
    <div
      className={`animate-float absolute size-28 place-items-center rounded-[26px] border border-white/80 bg-white/45 text-[#9aa6bf] backdrop-blur-md ${glow ? "shadow-[0_0_60px_10px_rgba(59,130,246,0.25),0_30px_50px_-20px_rgba(30,50,100,0.4)] text-[#5b8def]" : "shadow-[0_30px_50px_-20px_rgba(30,50,100,0.35)]"} ${className}`}
      style={{ ["--r" as string]: `${rotate}deg`, animationDelay: `${delay}ms` }}
      aria-hidden="true"
    >
      {children}
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <div className="text-[14px] font-semibold">{title}</div>
      <ul className="mt-3 space-y-2.5">
        {links.map(([l, h]) => (
          <li key={l}>
            {h.startsWith("/") ? (
              <Link to={h} className="text-[14px] text-muted hover:text-fg">
                {l}
              </Link>
            ) : (
              <a href={h} className="text-[14px] text-muted hover:text-fg">
                {l}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
