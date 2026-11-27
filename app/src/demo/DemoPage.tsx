import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Wordmark } from "../components/Logo";
import { Icon } from "../components/Icon";
import { explorerAddr, explorerTx, shortAddr } from "../lib/format";
import { attack, startDemo, streamEvents, type AttackKind, type AttackResult, type DemoEvent, type DemoSession } from "../lib/sentinel";
import { IncomingCall } from "./IncomingCall";

/**
 * "Steal my wallet": a live devnet heist. The visitor gets a real vault's owner
 * key and tries to take the money. Every move is a real transaction against the
 * deployed Argus program, and Sentinel reacts live.
 */

const MOVES: { kind: AttackKind; title: string; body: string }[] = [
  { kind: "drain", title: "Take everything, right now", body: "Withdraw all 12,000 instantly." },
  { kind: "trusted", title: "Send it to a “trusted” address", body: "Trusted sends skip the wait. Is your wallet trusted?" },
  { kind: "allowance", title: "Take the daily allowance", body: "Small spending goes through instantly." },
  { kind: "request", title: "Request a withdrawal of everything", body: "The real heist. It has to wait 24 hours, so let's see if anyone notices." },
];

type MoveState = { status: "idle" | "working" } | { status: "done"; result: AttackResult };

export default function DemoPage() {
  useEffect(() => {
    document.title = "Steal this wallet · Argus live demo";
  }, []);
  const [session, setSession] = useState<DemoSession | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<DemoEvent[]>([]);
  const [moves, setMoves] = useState<Record<string, MoveState>>({});

  useEffect(() => {
    if (!session) return;
    setEvents([]);
    return streamEvents(session.session, (e) => setEvents((xs) => [...xs, e]));
  }, [session]);

  const begin = async () => {
    setStarting(true);
    setError(null);
    setMoves({});
    try {
      const s = await startDemo();
      setSession(s);
      requestAnimationFrame(() => document.getElementById("heist")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const play = async (kind: AttackKind) => {
    if (!session) return;
    setMoves((m) => ({ ...m, [kind]: { status: "working" } }));
    try {
      const result = await attack(session, kind);
      setMoves((m) => ({ ...m, [kind]: { status: "done", result } }));
      if (kind === "request" && result.ok && window.innerWidth < 1024) {
        document.getElementById("argus-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (e) {
      setMoves((m) => ({ ...m, [kind]: { status: "done", result: { ok: false, error: { code: null, name: "Error", msg: (e as Error).message } } } }));
    }
  };

  const state = useMemo(() => [...events].reverse().find((e) => e.type === "state") as Extract<DemoEvent, { type: "state" }> | undefined, [events]);
  const stopped = events.some((e) => e.type === "tx" && e.by === "argus" && e.label.startsWith("Vault frozen"));

  return (
    <div className="min-h-screen bg-white text-fg">
      <header className="mx-auto flex h-18 max-w-[1240px] items-center justify-between px-5 sm:px-8">
        <Link to="/" aria-label="Argus home">
          <Wordmark size={24} />
        </Link>
        <span className="hidden items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-[12.5px] text-muted sm:inline-flex">
          <span className="size-1.5 animate-pulse-dot rounded-full bg-safe" /> Live on Solana devnet. Every move is a real transaction
        </span>
        <Link to="/app" className="text-[14px] font-medium text-muted hover:text-fg">
          Open app
        </Link>
      </header>

      {/* intro */}
      <section className="mx-auto max-w-[1240px] px-3 sm:px-8">
        <div className="relative isolate overflow-hidden rounded-[28px] bg-[#9ea9bf]">
          <img src="/img/hero-dawn.webp" alt="" className="absolute inset-0 -z-10 h-full w-full object-cover object-[30%_65%]" />
          <div className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(23,52,120,0.35),rgba(23,52,120,0.05))]" />
          <div className="mx-auto flex max-w-[760px] flex-col items-center px-6 py-16 text-center text-white sm:py-24">
            <h1 className="enter font-serif text-[48px] leading-[1] tracking-[-0.01em] drop-shadow-[0_2px_20px_rgba(20,40,90,0.3)] sm:text-[76px]">Steal this wallet.</h1>
            <p className="enter mt-6 max-w-[34rem] text-[17px] leading-relaxed font-medium text-white/95 drop-shadow-[0_1px_10px_rgba(20,40,90,0.35)] sm:text-[19px]" style={{ ["--d" as string]: 100 }}>
              A real vault on Solana devnet with 12,000 test dollars inside, and its owner's private key. Take the money. Argus will try to stop you.
            </p>
            <button type="button" onClick={begin} disabled={starting} className="enter press btn-brand mt-9 inline-flex min-h-13 items-center gap-2.5 rounded-[14px] px-7 text-[16px] font-medium text-white disabled:opacity-80" style={{ ["--d" as string]: 180 }}>
              {starting ? (
                <>
                  <Spinner /> Creating your vault on devnet…
                </>
              ) : session ? (
                <>Start over with a new vault</>
              ) : (
                <>
                  <Icon name="key" size={18} /> Hand me the stolen key
                </>
              )}
            </button>
            {error && <p className="mt-4 rounded-xl bg-white/90 px-4 py-2 text-[14px] text-threat">{error}</p>}
            <p className="mt-5 text-[13px] text-white/80">No wallet or sign-up needed. Test tokens only.</p>
          </div>
        </div>
      </section>

      {session && (
        <section id="heist" className="mx-auto max-w-[1240px] scroll-mt-4 px-5 pt-10 pb-24 sm:px-8">
          {stopped && <Outcome session={session} thief={state?.thief ?? "0"} vault={state?.vault ?? "0"} onRestart={begin} />}

          <div className="grid gap-6 lg:grid-cols-2">
            <Thief session={session} state={state} moves={moves} onPlay={play} frozen={!!state?.frozen} />
            <ArgusPanel session={session.session} events={events} stopped={stopped} />
          </div>
        </section>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- the thief */

function Thief({ session, state, moves, onPlay, frozen }: { session: DemoSession; state?: Extract<DemoEvent, { type: "state" }>; moves: Record<string, MoveState>; onPlay: (k: AttackKind) => void; frozen: boolean }) {
  const [reveal, setReveal] = useState(false);
  const [copied, setCopied] = useState(false);
  const busy = Object.values(moves).some((m) => m.status === "working");
  return (
    <div className="card-soft rounded-[28px] p-6 sm:p-8">
      <div className="text-[13px] font-medium tracking-[0.12em] text-faint uppercase">You, the thief</div>

      <div className="mt-5 rounded-2xl bg-white p-4 shadow-[0_10px_30px_-20px_rgba(30,50,100,0.4)]">
        <div className="flex items-center justify-between text-[13px]">
          <span className="font-medium">The stolen owner key</span>
          <span className="flex gap-3 text-muted">
            <button type="button" className="hover:text-fg" onClick={() => setReveal(!reveal)}>
              {reveal ? "Hide" : "Reveal"}
            </button>
            <button
              type="button"
              className="hover:text-fg"
              onClick={() => navigator.clipboard?.writeText(session.stolenKey).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1400)))}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </span>
        </div>
        <div className="mt-2 font-mono text-[12px] leading-relaxed break-all text-muted">{reveal ? session.stolenKey : `${session.stolenKey.slice(0, 6)}${"•".repeat(28)}${session.stolenKey.slice(-4)}`}</div>
        <div className="mt-2 text-[12px] text-faint">
          It's the real key to{" "}
          <a href={explorerAddr(session.vault)} target="_blank" rel="noreferrer" className="underline-offset-2 hover:text-fg hover:underline">
            this vault
          </a>
          . Use it here, or with your own tools if you like. Argus watches the chain either way.
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Balance label="In the vault" value={state?.vault ?? session.rules.funds.replace(/,/g, "")} />
        <Balance label="In your pocket" value={state?.thief ?? "0"} accent={Number(state?.thief ?? 0) > 0} />
      </div>

      <div className="mt-7 text-[15px] font-semibold">Your moves</div>
      <div className="mt-3 space-y-2.5">
        {MOVES.map((m) => {
          const st = moves[m.kind] ?? { status: "idle" };
          return (
            <div key={m.kind} className={`rounded-2xl border bg-white p-4 transition-colors ${m.kind === "request" ? "border-brand/30" : "border-line"}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[15px] font-medium">{m.title}</div>
                  <div className="mt-0.5 text-[13.5px] text-muted">{m.body}</div>
                </div>
                <button
                  type="button"
                  disabled={busy || st.status === "working"}
                  onClick={() => onPlay(m.kind)}
                  className={`press shrink-0 rounded-xl px-4 py-2 text-[13.5px] font-medium disabled:opacity-50 ${m.kind === "request" ? "btn-brand text-white" : "border border-line-strong bg-white hover:bg-panel"}`}
                >
                  {st.status === "working" ? <Spinner dark={m.kind !== "request"} /> : st.status === "done" ? "Again" : "Try it"}
                </button>
              </div>
              {st.status === "done" && <MoveResult result={st.result} frozen={frozen} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MoveResult({ result }: { result: AttackResult; frozen: boolean }) {
  if (result.ok) {
    return (
      <div className="enter mt-3 flex items-center justify-between gap-3 rounded-xl bg-panel px-3 py-2 text-[13px]">
        <span className="text-fg">It went through.</span>
        <a href={explorerTx(result.sig)} target="_blank" rel="noreferrer" className="nudge inline-flex items-center gap-1 text-muted hover:text-fg">
          View transaction <Icon name="arrow-up-right" size={12} className="arrow" />
        </a>
      </div>
    );
  }
  return (
    <div className="enter mt-3 rounded-xl bg-safe-bg px-3 py-2 text-[13px]">
      <span className="font-medium text-safe">Blocked by the Argus program.</span> <span className="text-fg">{result.error.msg}.</span>
      {result.error.code !== null && <span className="ml-1 font-mono text-[11.5px] text-muted">({result.error.name}, {result.error.code})</span>}
    </div>
  );
}

function Balance({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  const n = Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <div className="rounded-2xl bg-white p-4 shadow-[0_10px_30px_-20px_rgba(30,50,100,0.4)]">
      <div className="text-[12.5px] text-muted">{label}</div>
      <div className={`num mt-1 text-[24px] font-semibold tracking-[-0.02em] ${accent ? "text-wait" : ""}`}>{n}</div>
      <div className="text-[11.5px] text-faint">dUSDC</div>
    </div>
  );
}

/* --------------------------------------------------------------- argus */

function ArgusPanel({ session, events, stopped }: { session: string; events: DemoEvent[]; stopped: boolean }) {
  const risk = [...events].reverse().find((e) => e.type === "risk") as Extract<DemoEvent, { type: "risk" }> | undefined;
  const incoming = [...events].reverse().find((e) => e.type === "incoming") as Extract<DemoEvent, { type: "incoming" }> | undefined;
  const decision = [...events].reverse().find((e) => e.type === "decision") as Extract<DemoEvent, { type: "decision" }> | undefined;
  const timedOut = events.some((e) => e.type === "log" && e.text.startsWith("No answer"));
  const decided = decision?.decision ?? (timedOut ? "timeout" : null);
  const feed = events.filter((e) => e.type === "log" || e.type === "tx");
  const status = stopped ? "stopped" : incoming && !decided ? "calling" : risk ? "threat" : events.some((e) => e.type === "log" && e.tone === "wait") ? "checking" : "watching";
  const feedRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [feed.length]);

  const chip: Record<string, ReactNode> = {
    watching: (
      <>
        <span className="size-1.5 animate-pulse-dot rounded-full bg-safe" /> Watching
      </>
    ),
    checking: (
      <>
        <span className="size-1.5 animate-pulse-dot rounded-full bg-wait" /> Checking a withdrawal
      </>
    ),
    threat: (
      <>
        <span className="size-1.5 animate-pulse-dot rounded-full bg-threat" /> Theft suspected
      </>
    ),
    calling: (
      <>
        <Icon name="phone" size={13} /> Calling the owner
      </>
    ),
    stopped: (
      <>
        <Icon name="check" size={13} /> Stopped
      </>
    ),
  };

  return (
    <div id="argus-panel" className="scroll-mt-4 rounded-[28px] border border-line bg-white p-6 shadow-[0_30px_70px_-40px_rgba(23,37,84,0.35)] sm:p-8">
      <div className="flex items-center justify-between">
        <div className="text-[13px] font-medium tracking-[0.12em] text-faint uppercase">Argus</div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-medium ${status === "stopped" ? "bg-safe-bg text-safe" : status === "threat" || status === "calling" ? "bg-threat-bg text-threat" : "bg-panel text-muted"}`}>{chip[status]}</span>
      </div>

      {risk && (
        <div className="enter mt-5 rounded-2xl bg-panel p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-[14px] font-medium">Risk</span>
            <span className="num text-[22px] font-semibold text-threat">
              {risk.score}
              <span className="text-[13px] text-muted"> / 100 · {risk.level}</span>
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-threat transition-all duration-1000" style={{ width: `${risk.score}%` }} />
          </div>
          <p className="mt-3 text-[14px] leading-relaxed">{risk.reason}</p>
        </div>
      )}

      {incoming && (
        <div className="mt-4">
          <IncomingCall session={session} amount={incoming.amount} reason={incoming.reason} timeoutSecs={incoming.timeoutSecs} startedAt={incoming.t} decided={decided} />
        </div>
      )}

      <div className="mt-5 text-[15px] font-semibold">What Argus sees</div>
      <ol ref={feedRef} className="mt-2 max-h-[340px] space-y-0 overflow-y-auto">
        {feed.map((e, i) => (
          <li key={i} className="enter flex gap-3 border-b border-line-soft py-2.5 text-[13.5px] last:border-0">
            <span className="num w-[58px] shrink-0 text-[12px] text-faint">{new Date(e.t).toLocaleTimeString("en-GB")}</span>
            {e.type === "tx" ? (
              <span className="min-w-0 flex-1">
                <span className={e.by === "argus" ? "font-medium text-safe" : e.by === "you" ? "text-fg" : "text-muted"}>{e.label}</span>{" "}
                <a href={explorerTx(e.sig)} target="_blank" rel="noreferrer" className="font-mono text-[11.5px] text-faint hover:text-fg">
                  {shortAddr(e.sig, 4, 4)} ↗
                </a>
              </span>
            ) : (
              <span className={`min-w-0 flex-1 ${e.tone === "threat" ? "text-threat" : e.tone === "safe" ? "text-safe" : "text-fg"}`}>{e.text}</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------- outcome */

function Outcome({ session, thief, vault, onRestart }: { session: DemoSession; thief: string; vault: string; onRestart: () => void }) {
  const f = (v: string) => Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <div className="enter card-blue mb-6 overflow-hidden rounded-[28px] p-7 text-white sm:p-10">
      <h2 className="font-serif text-[40px] leading-none sm:text-[56px]">Argus stopped you.</h2>
      <p className="mt-5 max-w-[40rem] text-[17px] leading-relaxed text-white/90">
        You got <strong className="text-white">{f(thief)} dUSDC</strong>, the daily allowance and the most a stolen key can ever take. The other <strong className="text-white">{f(vault)} dUSDC</strong> never left the vault. It's frozen now, until the owner's guardians replace the stolen key.
      </p>
      <div className="mt-7 flex flex-wrap gap-3">
        <button type="button" onClick={onRestart} className="press rounded-xl bg-white px-5 py-2.5 text-[14.5px] font-medium text-[#1d4ed8] hover:bg-white/90">
          Try again with a new vault
        </button>
        <Link to="/#how" className="rounded-xl px-5 py-2.5 text-[14.5px] font-medium text-white ring-1 ring-white/50 hover:bg-white/10">
          How Argus works
        </Link>
        <a href={explorerAddr(session.vault)} target="_blank" rel="noreferrer" className="rounded-xl px-5 py-2.5 text-[14.5px] font-medium text-white/90 hover:text-white">
          See the vault on Explorer ↗
        </a>
      </div>
    </div>
  );
}

function Spinner({ dark }: { dark?: boolean }) {
  return <span className={`inline-block size-4 animate-spin rounded-full border-2 ${dark ? "border-line-strong border-t-fg" : "border-white/40 border-t-white"}`} />;
}
