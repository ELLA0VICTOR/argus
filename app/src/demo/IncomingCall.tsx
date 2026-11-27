import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Conversation } from "@elevenlabs/client";
import { Logo } from "../components/Logo";
import { ELEVENLABS_AGENT_ID } from "../lib/config";
import { decide, relayCall } from "../lib/sentinel";

/**
 * Argus calls the owner, shown as a phone ringing. The visitor switches roles:
 * now they're the real owner. Accepting opens a live voice conversation with the
 * Argus agent (ElevenLabs), whose cancel_withdrawal tool reports back to
 * Sentinel, which cancels and freezes on-chain.
 *
 * Three ways to show it:
 *  - default: a phone mock-up on the demo page, answered right there;
 *  - `device`: full screen on the visitor's real phone (QR handoff), which
 *    relays the call's progress to Sentinel;
 *  - `remote`: the mock-up on the laptop mirrors a call taking place on the phone.
 */
export type Line = { who: "argus" | "you"; text: string };
export type RemoteCall = { status: "ringing" | "connected" | "ended"; lines: Line[] };

/**
 * Overrides for a real vault (not the demo): what the voice agent's tools and
 * the Decline button do, plus the words around the call. Each tool returns the
 * sentence the agent should hear back.
 */
export type CallActions = {
  cancel: () => Promise<string>;
  allow: () => Promise<string>;
  decline: () => Promise<void>;
  vaultName: string;
  destination: string;
  footnote: string;
  noAnswerText: string;
};
type Phase = "ringing" | "connecting" | "live" | "ended";

export function IncomingCall({
  session,
  amount,
  reason,
  timeoutSecs,
  startedAt,
  decided,
  device = false,
  remote = null,
  onAnswered,
  actions,
}: {
  session: string;
  amount: string;
  reason: string;
  timeoutSecs: number;
  startedAt: number;
  decided: "cancel" | "allow" | "timeout" | null;
  device?: boolean;
  remote?: RemoteCall | null;
  /** Called when the owner accepts or declines (stops the ringtone). */
  onAnswered?: () => void;
  actions?: CallActions;
}) {
  const [localPhase, setPhase] = useState<Phase>("ringing");
  const [localLines, setLines] = useState<Line[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const conv = useRef<Conversation | null>(null);
  const captions = useRef<HTMLDivElement>(null);

  // Mirroring a call on the phone: phase and transcript come from Sentinel.
  const remotePhase: Phase = remote ? (remote.status === "connected" ? "live" : remote.status === "ended" || (decided && remote.status === "ringing") ? "ended" : "ringing") : "ringing";
  const phase = remote ? remotePhase : localPhase;
  const lines = remote ? remote.lines : localLines;
  useEffect(() => {
    if (!remote) return;
    if (remote.status === "connected") setConnectedAt((t) => t ?? Date.now());
    if (remotePhase === "ended") setEndedAt((t) => t ?? Date.now());
  }, [remote?.status, remotePhase]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  // Hang up our side when the page goes away.
  useEffect(() => () => void conv.current?.endSession(), []);

  // Once Sentinel has the answer and nobody's on the line, the call is over.
  useEffect(() => {
    if (decided && phase === "ringing") end();
  }, [decided, phase]);

  useEffect(() => {
    captions.current?.scrollTo({ top: captions.current.scrollHeight, behavior: "smooth" });
  }, [lines.length]);

  const end = () => {
    setPhase("ended");
    setEndedAt((t) => t ?? Date.now());
  };

  const left = Math.max(0, Math.ceil((startedAt + timeoutSecs * 1000 - now) / 1000));
  const elapsed = connectedAt ? Math.max(0, Math.floor(((endedAt ?? now) - connectedAt) / 1000)) : 0;
  const clock = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  const time = new Date(now).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  const accept = async () => {
    onAnswered?.();
    setPhase("connecting");
    setError(null);
    try {
      // Loaded on demand: the voice SDK (WebRTC) is large and only needed once answered.
      const { Conversation } = await import("@elevenlabs/client");
      conv.current = await Conversation.startSession({
        agentId: ELEVENLABS_AGENT_ID,
        connectionType: "webrtc",
        dynamicVariables: {
          owner_name: "there",
          vault_name: actions?.vaultName ?? "Savings",
          amount,
          destination: actions?.destination ?? "a brand-new address",
          reason,
        },
        clientTools: {
          cancel_withdrawal: async () => {
            if (actions) return actions.cancel();
            await decide(session, "cancel", "voice");
            return "Cancelled. Argus's guardian key is cancelling it on-chain and freezing the vault right now. The funds never left.";
          },
          allow_withdrawal: async () => {
            if (actions) return actions.allow();
            await decide(session, "allow", "voice");
            return "Recorded. The withdrawal will go through after the 24-hour wait unless a guardian cancels it.";
          },
        },
        onConnect: () => {
          setPhase("live");
          setConnectedAt(Date.now());
          if (device) relayCall(session, { status: "connected" });
        },
        onDisconnect: () => {
          end();
          if (device) relayCall(session, { status: "ended" });
        },
        onModeChange: ({ mode }) => setSpeaking(mode === "speaking"),
        onMessage: ({ message, source }) => {
          setLines((xs) => [...xs, { who: source === "ai" ? "argus" : "you", text: message }]);
          if (device) relayCall(session, { who: source === "ai" ? "argus" : "owner", text: message });
        },
        onError: (m) => setError(typeof m === "string" ? m : "The call dropped."),
      });
    } catch (e) {
      const msg = (e as Error).message || "";
      setError(/permission|denied|NotAllowed/i.test(msg) ? "Microphone blocked. Decline instead: Argus cancels anyway." : "Couldn't connect. Decline instead: Argus cancels anyway.");
      setPhase("ringing");
    }
  };

  // Declining is a safe answer: Argus treats it like "cancel".
  const decline = async () => {
    onAnswered?.();
    try {
      if (actions) {
        await actions.decline();
        end();
      } else await decide(session, "cancel", "button");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const hangUp = async () => {
    await conv.current?.endSession();
    end();
  };

  const toggleMute = () => {
    const next = !muted;
    conv.current?.setMicMuted(next);
    setMuted(next);
  };

  const outcome =
    decided === "allow"
      ? { title: "You confirmed it", body: "The withdrawal keeps its 24-hour wait. A guardian can still cancel it." }
      : decided === "timeout"
        ? { title: "No answer", body: "Argus acted on its own: cancelled on-chain and froze the vault." }
        : decided === "cancel"
          ? { title: "Cancelled on-chain", body: "Argus's cancel-only key stopped the withdrawal and froze the vault." }
          : null;

  const screen = (
        <div className={`relative h-full w-full overflow-hidden text-white ${device ? "" : "rounded-[42px]"}`} style={{ fontFamily: '-apple-system, "SF Pro Text", "SF Pro Display", Inter, system-ui, sans-serif' }}>
          {/* wallpaper */}
          <div className="absolute inset-0 scale-125 bg-cover bg-center blur-2xl" style={{ backgroundImage: "url(/img/hero-dawn.webp)" }} />
          <div className={`absolute inset-0 transition-colors duration-700 ${phase === "ringing" ? "bg-[#0b1020]/45" : "bg-[#0b1020]/70"}`} />

          {/* status bar + island (a real phone has its own) */}
          {device ? (
            <div className="h-[max(env(safe-area-inset-top),16px)]" />
          ) : (
          <div className="relative z-10 flex h-[46px] items-center justify-between px-7 pt-1 text-[14px] font-semibold">
            <span className="num w-12">{time}</span>
            <span className="h-[26px] w-[86px] rounded-full bg-black" />
            <span className="flex w-12 items-center justify-end gap-1">
              <Bars />
              <Battery />
            </span>
          </div>
          )}

          <div className={`relative z-10 mx-auto flex max-w-[460px] flex-col px-6 pb-3 ${device ? "h-[calc(100%-max(env(safe-area-inset-top),16px))] pb-[max(env(safe-area-inset-bottom),12px)]" : "h-[calc(100%-46px)]"}`}>
            {/* caller */}
            <div className={`flex flex-col items-center text-center ${device ? "mt-[9vh]" : "mt-6"}`}>
              {phase === "ringing" && <div className="text-[13px] text-white/70">{remote ? "Calling your phone…" : actions ? "Incoming call" : "Incoming call · you're the owner now"}</div>}
              {phase !== "ringing" && (
                <div className="num text-[14px] text-white/70">{phase === "connecting" ? "connecting…" : phase === "live" ? clock : connectedAt ? `Call ended · ${clock}` : "Call ended"}</div>
              )}
              <div className="mt-1 text-[34px] leading-tight font-semibold tracking-[-0.01em]">Argus</div>
              <div className="text-[14px] text-white/70">Vault guardian</div>
              <span className="relative mt-6 grid size-[84px] place-items-center rounded-full bg-white/15 backdrop-blur-xl">
                {phase === "ringing" && !decided && <span className="absolute inset-0 animate-ping rounded-full bg-white/15 [animation-duration:1.8s]" />}
                <Logo size={38} />
              </span>
              <div className="mt-4 flex h-5 items-center gap-[3px]" aria-hidden="true">
                {phase === "live" &&
                  [0, 1, 2, 3, 4, 5, 6].map((i) => (
                    <span key={i} className={`h-5 w-[3px] rounded-full bg-white/90 ${speaking || remote ? "animate-wave" : "scale-y-[0.2]"}`} style={{ animationDelay: `${i * 100}ms` }} />
                  ))}
              </div>
            </div>

            {/* middle: what's at stake, live captions, or the outcome */}
            <div className="mt-3 flex min-h-0 flex-1 flex-col justify-end">
              {phase === "ringing" && !decided && (
                <div className="enter rounded-[20px] bg-white/12 p-3.5 text-[13px] leading-snug backdrop-blur-xl">
                  <div className="font-semibold">Withdrawal on hold</div>
                  <div className="num mt-0.5 text-white/80">{amount} to {actions?.destination ?? "a brand-new address"}</div>
                  <div className="mt-2 text-[12px] text-white/60">{actions ? actions.noAnswerText.replace("{s}", String(left)) : `No answer in ${left}s and Argus cancels anyway.`}</div>
                </div>
              )}
              {(phase === "live" || phase === "connecting" || (phase === "ended" && lines.length > 0)) && (
                <div ref={captions} className="max-h-full space-y-1.5 overflow-y-auto pt-4 pb-1 [mask-image:linear-gradient(to_bottom,transparent,black_16px)] [scrollbar-width:none]">
                  {lines.map((l, i) => (
                    <div key={i} className={`enter flex ${l.who === "you" ? "justify-end" : ""}`}>
                      <div className={`max-w-[85%] rounded-[18px] px-3 py-1.5 text-[13px] leading-snug ${l.who === "you" ? "bg-[#0a84ff]" : "bg-white/15 backdrop-blur-xl"}`}>{l.text}</div>
                    </div>
                  ))}
                </div>
              )}
              {phase === "ended" && outcome && (
                <div className="enter mt-2 flex gap-3 rounded-[20px] bg-white/12 p-3.5 backdrop-blur-xl">
                  <span className={`grid size-7 shrink-0 place-items-center rounded-full ${decided === "allow" ? "bg-white/25" : "bg-[#30d158]"}`}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m5 12.5 4.5 4.5L19 7.5" />
                    </svg>
                  </span>
                  <div className="text-[13px] leading-snug">
                    <div className="font-semibold">{outcome.title}</div>
                    <div className="mt-0.5 text-white/75">{outcome.body}</div>
                  </div>
                </div>
              )}
              {error && <div className="mt-2 rounded-[14px] bg-[#ff453a]/20 px-3 py-2 text-[12px] leading-snug text-[#ffd0cc]">{error}</div>}
            </div>

            {/* controls */}
            <div className="mt-4 mb-4">
              {phase === "ringing" && !decided && remote && (
                <div className="flex items-center justify-center gap-2 rounded-full bg-white/12 py-3 text-[13px] backdrop-blur-xl">
                  <span className="size-1.5 animate-pulse-dot rounded-full bg-[#34c759]" /> Ringing on your phone. Answer it there.
                </div>
              )}
              {phase === "ringing" && !decided && !remote && (
                <div className={`flex justify-between ${device ? "px-6" : "px-3"}`}>
                  <CallButton label="Decline" tone="red" onClick={decline} />
                  <CallButton label="Accept" tone="green" onClick={accept} ring />
                </div>
              )}
              {phase === "connecting" && <div className="text-center text-[12.5px] text-white/70">Allow the microphone if asked.</div>}
              {phase === "live" && remote && <div className="text-center text-[12.5px] text-white/65">Live on your phone. Captions appear here as you talk.</div>}
              {phase === "live" && !remote && (
                <>
                  <div className="mb-4 text-center text-[12.5px] text-white/65">Try: “No, that wasn't me. Cancel it.”</div>
                  <div className="flex items-start justify-center gap-10">
                    <CallButton label={muted ? "Unmute" : "Mute"} tone={muted ? "light" : "glass"} onClick={toggleMute} icon={<MicIcon off={muted} />} />
                    <CallButton label="End" tone="red" onClick={hangUp} />
                  </div>
                </>
              )}
            </div>
            {!device && <div className="mx-auto h-[5px] w-[120px] rounded-full bg-white/80" />}
          </div>
        </div>
  );

  if (device) return <div className="fixed inset-0 bg-black">{screen}</div>;

  return (
    <div className="flex flex-col items-center">
      <div className="phone relative aspect-[9/19.2] w-full max-w-[300px] rounded-[52px] bg-[#0b0b0d] p-[11px] shadow-[0_40px_80px_-30px_rgba(15,23,42,0.55),inset_0_0_0_1.5px_#2c2c31]">
        {/* side buttons */}
        <span className="absolute top-[22%] -left-[3px] h-14 w-[3px] rounded-l bg-[#2c2c31]" />
        <span className="absolute top-[33%] -left-[3px] h-14 w-[3px] rounded-l bg-[#2c2c31]" />
        <span className="absolute top-[27%] -right-[3px] h-20 w-[3px] rounded-r bg-[#2c2c31]" />
        {screen}
      </div>
      <p className="mt-4 max-w-[300px] text-center text-[12px] leading-relaxed text-faint">
        {actions ? actions.footnote : remote ? "The call is happening on your phone: a live AI voice agent (ElevenLabs). This screen follows along." : "A live AI voice call (ElevenLabs), right in your browser. Scan the code above to take it on your phone instead."}
      </p>
    </div>
  );
}

function CallButton({ label, tone, onClick, icon, ring }: { label: string; tone: "red" | "green" | "glass" | "light"; onClick: () => void; icon?: ReactNode; ring?: boolean }) {
  const bg = { red: "bg-[#ff3b30] hover:bg-[#e6352b]", green: "bg-[#34c759] hover:bg-[#2fb350]", glass: "bg-white/20 backdrop-blur-xl hover:bg-white/30", light: "bg-white text-black" }[tone];
  return (
    <button type="button" onClick={onClick} className="press flex flex-col items-center gap-1.5">
      <span className={`relative grid size-[64px] place-items-center rounded-full transition-colors ${bg}`}>
        {ring && <span className="absolute inset-0 animate-ping rounded-full bg-[#34c759]/40 [animation-duration:1.6s]" />}
        {icon ?? <HandsetIcon down={tone === "red"} />}
      </span>
      <span className="text-[12.5px] text-white/90">{label}</span>
    </button>
  );
}

function HandsetIcon({ down }: { down?: boolean }) {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" className={`relative ${down ? "rotate-[135deg]" : ""}`} aria-hidden="true">
      <path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1L6.6 10.8Z" />
    </svg>
  );
}

function MicIcon({ off }: { off?: boolean }) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" stroke="none" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
      {off && <path d="M4 4l16 16" strokeWidth="2.2" />}
    </svg>
  );
}

function Bars() {
  return (
    <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor" aria-hidden="true">
      <rect x="0" y="7" width="3" height="4" rx="0.8" />
      <rect x="4.5" y="5" width="3" height="6" rx="0.8" />
      <rect x="9" y="2.5" width="3" height="8.5" rx="0.8" />
      <rect x="13.5" y="0" width="3" height="11" rx="0.8" />
    </svg>
  );
}

function Battery() {
  return (
    <svg width="25" height="12" viewBox="0 0 25 12" fill="none" aria-hidden="true">
      <rect x="0.5" y="0.5" width="21" height="11" rx="3.2" stroke="currentColor" opacity="0.4" />
      <rect x="2" y="2" width="15" height="8" rx="2" fill="currentColor" />
      <path d="M23 4v4c.8-.3 1.3-1 1.3-2S23.8 4.3 23 4Z" fill="currentColor" opacity="0.4" />
    </svg>
  );
}
