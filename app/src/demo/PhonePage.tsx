import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams } from "react-router";
import { Logo } from "../components/Logo";
import { phoneReady, streamEvents, type DemoEvent } from "../lib/sentinel";
import { IncomingCall } from "./IncomingCall";

/**
 * The owner's phone, for the live demo. The visitor scans a QR code on /demo
 * and this page stands by. When Argus flags the withdrawal, it rings: a full
 * screen call with a ringtone and vibration. Accepting starts the live voice
 * call with the Argus agent, and the laptop follows along.
 */
type Stage = "join" | "joining" | "standby";

export default function PhonePage() {
  const { session = "" } = useParams();
  const [stage, setStage] = useState<Stage>("join");
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<DemoEvent[]>([]);
  const [now, setNow] = useState(new Date());
  const ring = useRef<Ringer | null>(null);

  useEffect(() => {
    document.title = "Argus · owner's phone";
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (stage !== "standby") return;
    return streamEvents(session, (e) => setEvents((xs) => [...xs, e]));
  }, [stage, session]);

  const incoming = useMemo(() => [...events].reverse().find((e) => e.type === "incoming") as Extract<DemoEvent, { type: "incoming" }> | undefined, [events]);
  const decision = events.find((e) => e.type === "decision") as Extract<DemoEvent, { type: "decision" }> | undefined;
  const timedOut = events.some((e) => e.type === "log" && e.text.startsWith("No answer"));
  const decided = decision?.decision ?? (timedOut ? "timeout" : null);
  const expired = events.some((e) => e.type === "log" && e.text.startsWith("This demo has expired"));

  // Ring while the call is waiting for an answer.
  useEffect(() => {
    if (incoming && !decided) ring.current?.start();
    else ring.current?.stop();
  }, [incoming, decided]);
  useEffect(() => () => ring.current?.stop(), []);

  const join = async () => {
    setStage("joining");
    setError(null);
    // This tap unlocks sound and asks for the microphone now, so answering
    // later is instant.
    ring.current = new Ringer();
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      mic.getTracks().forEach((t) => t.stop());
    } catch {
      setError("Allow the microphone so you can talk to Argus. You can still decline the call without it.");
    }
    try {
      await phoneReady(session);
      setStage("standby");
    } catch (e) {
      setError((e as Error).message);
      setStage("join");
    }
  };

  if (incoming && stage === "standby") {
    return <IncomingCall device session={session} amount={incoming.amount} reason={incoming.reason} timeoutSecs={incoming.timeoutSecs} startedAt={incoming.t} decided={decided} onAnswered={() => ring.current?.stop()} />;
  }

  const time = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const date = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="fixed inset-0 overflow-hidden bg-black text-white" style={{ fontFamily: '-apple-system, "SF Pro Text", "SF Pro Display", Inter, system-ui, sans-serif' }}>
      <img src="/img/hero-dawn.webp" alt="" className="absolute inset-0 h-full w-full object-cover object-[30%_60%]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,20,50,0.35),rgba(10,20,50,0.15)_40%,rgba(10,20,50,0.55))]" />

      <div className="relative mx-auto flex h-full max-w-[460px] flex-col px-5 pt-[max(env(safe-area-inset-top),20px)] pb-[max(env(safe-area-inset-bottom),20px)]">
        {/* lock screen clock */}
        <div className="mt-[8vh] text-center">
          <div className="text-[17px] font-medium text-white/90">{date}</div>
          <div className="num text-[86px] leading-none font-semibold tracking-[-0.03em] drop-shadow-[0_2px_24px_rgba(10,20,50,0.25)]">{time}</div>
        </div>

        <div className="mt-auto space-y-3">
          {stage === "standby" ? (
            <Notice title="Argus" when="now">
              {expired ? "This demo has expired. Start a new one on the laptop." : "Watching your Savings vault. If someone tries to move the money, I'll call you right here."}
            </Notice>
          ) : (
            <Notice title="Argus" when="now">
              You're the vault's owner now. Tap below and this phone becomes the one Argus calls when something looks wrong.
            </Notice>
          )}
          {error && <div className="rounded-[18px] bg-[#ff453a]/25 px-4 py-3 text-[13.5px] leading-snug backdrop-blur-xl">{error}</div>}
          {stage !== "standby" ? (
            <button type="button" onClick={join} disabled={stage === "joining"} className="press w-full rounded-[18px] bg-white py-4 text-[16px] font-semibold text-black disabled:opacity-70">
              {stage === "joining" ? "Connecting…" : "Use this phone as the owner's"}
            </button>
          ) : (
            <div className="flex items-center justify-center gap-2 py-3 text-[13px] text-white/80">
              <span className="size-1.5 animate-pulse-dot rounded-full bg-[#34c759]" /> Connected. Now play the thief on the laptop.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Notice({ title, when, children }: { title: string; when: string; children: ReactNode }) {
  return (
    <div className="enter rounded-[22px] bg-white/20 p-4 backdrop-blur-2xl">
      <div className="flex items-center gap-2.5">
        <span className="grid size-[22px] place-items-center rounded-[6px] bg-white text-black">
          <Logo size={14} />
        </span>
        <span className="flex-1 text-[13px] font-semibold tracking-wide text-white/90 uppercase">{title}</span>
        <span className="text-[12.5px] text-white/60">{when}</span>
      </div>
      <p className="mt-2 text-[15px] leading-snug">{children}</p>
    </div>
  );
}

/**
 * A soft two-tone ringtone with Web Audio, plus vibration where supported.
 * Created inside a tap so the browser lets it play later.
 */
class Ringer {
  ctx: AudioContext | null;
  timer: number | null = null;
  constructor() {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    this.ctx = AC ? new AC() : null;
    void this.ctx?.resume();
  }
  private burst() {
    const ctx = this.ctx;
    if (ctx) {
      const t0 = ctx.currentTime;
      for (let i = 0; i < 2; i++) {
        const start = t0 + i * 0.42;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.18, start + 0.03);
        gain.gain.setValueAtTime(0.18, start + 0.3);
        gain.gain.linearRampToValueAtTime(0, start + 0.38);
        gain.connect(ctx.destination);
        for (const f of [880, 1318.5]) {
          const o = ctx.createOscillator();
          o.type = "sine";
          o.frequency.value = f;
          o.connect(gain);
          o.start(start);
          o.stop(start + 0.4);
        }
      }
    }
    navigator.vibrate?.([400, 200, 400]);
  }
  start() {
    if (this.timer !== null) return;
    this.burst();
    this.timer = window.setInterval(() => this.burst(), 2600);
  }
  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    navigator.vibrate?.(0);
  }
}
