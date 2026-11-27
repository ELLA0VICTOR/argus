import { useEffect, useRef, useState } from "react";
import type { Conversation } from "@elevenlabs/client";
import { Icon } from "../components/Icon";
import { Logo } from "../components/Logo";
import { ELEVENLABS_AGENT_ID } from "../lib/config";
import { decide } from "../lib/sentinel";

/**
 * Argus calls the owner. The visitor switches roles: now they're the real owner,
 * and their "phone" rings. Answering opens a live voice conversation with the
 * Argus agent (ElevenLabs), whose cancel_withdrawal tool reports back to
 * Sentinel, which cancels and freezes on-chain.
 */
type Line = { who: "argus" | "you"; text: string };
type Phase = "ringing" | "connecting" | "live" | "ended";

export function IncomingCall({
  session,
  amount,
  reason,
  timeoutSecs,
  startedAt,
  decided,
}: {
  session: string;
  amount: string;
  reason: string;
  timeoutSecs: number;
  startedAt: number;
  decided: "cancel" | "allow" | "timeout" | null;
}) {
  const [phase, setPhase] = useState<Phase>("ringing");
  const [lines, setLines] = useState<Line[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const conv = useRef<Conversation | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  // Hang up our side when the page goes away.
  useEffect(() => () => void conv.current?.endSession(), []);

  // Once Sentinel has the answer and nobody's on the line, the call is over.
  useEffect(() => {
    if (decided && phase === "ringing") setPhase("ended");
  }, [decided, phase]);

  const left = Math.max(0, Math.ceil((startedAt + timeoutSecs * 1000 - now) / 1000));

  const answer = async () => {
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
          vault_name: "Savings",
          amount,
          destination: "a brand-new address",
          reason,
        },
        clientTools: {
          cancel_withdrawal: async () => {
            await decide(session, "cancel", "voice");
            return "Cancelled. Argus's guardian key is cancelling it on-chain and freezing the vault right now. The funds never left.";
          },
          allow_withdrawal: async () => {
            await decide(session, "allow", "voice");
            return "Recorded. The withdrawal will go through after the 24-hour wait unless a guardian cancels it.";
          },
        },
        onConnect: () => setPhase("live"),
        onDisconnect: () => setPhase("ended"),
        onModeChange: ({ mode }) => setSpeaking(mode === "speaking"),
        onMessage: ({ message, source }) => setLines((xs) => [...xs, { who: source === "ai" ? "argus" : "you", text: message }]),
        onError: (m) => setError(typeof m === "string" ? m : "The call dropped."),
      });
    } catch (e) {
      const msg = (e as Error).message || "";
      setError(/permission|denied|NotAllowed/i.test(msg) ? "Microphone access was blocked. Tap “Just cancel it” instead." : "Couldn't connect the call. Tap “Just cancel it” instead.");
      setPhase("ringing");
    }
  };

  const cancelByButton = async () => {
    try {
      await decide(session, "cancel", "button");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const hangUp = async () => {
    await conv.current?.endSession();
    setPhase("ended");
  };

  return (
    <div className="enter overflow-hidden rounded-2xl bg-[#202328] text-white shadow-[0_30px_60px_-30px_rgba(0,0,0,0.6)]">
      <div className="flex items-center gap-4 p-5">
        <span className={`relative grid size-14 shrink-0 place-items-center rounded-full bg-white/10 ${phase === "ringing" ? "ring-4 ring-white/10" : ""}`}>
          {phase === "ringing" && <span className="absolute inset-0 animate-ping rounded-full bg-white/10" />}
          <Logo size={26} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] text-white/55">{phase === "ringing" ? "Incoming call · you're the real owner now" : phase === "ended" ? "Call ended" : "On the call"}</div>
          <div className="text-[18px] font-semibold">Argus, your vault's guardian</div>
          {phase === "ringing" && !decided && <div className="mt-0.5 text-[12.5px] text-white/60">No answer in {left}s and Argus cancels anyway.</div>}
        </div>
        {(phase === "live" || phase === "connecting") && (
          <span className="flex h-5 items-center gap-[3px]" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <span key={i} className={`h-5 w-[2.5px] rounded-full bg-white/90 ${speaking ? "animate-wave" : "scale-y-[0.25]"}`} style={{ animationDelay: `${i * 110}ms` }} />
            ))}
          </span>
        )}
      </div>

      {lines.length > 0 && (
        <div className="max-h-[260px] space-y-2 overflow-y-auto border-t border-white/10 px-5 py-4">
          {lines.map((l, i) => (
            <div key={i} className={`enter flex ${l.who === "you" ? "justify-end" : ""}`}>
              <div className={`max-w-[88%] rounded-2xl px-3.5 py-2 text-[14px] leading-relaxed ${l.who === "you" ? "bg-[#2563eb]" : "bg-white/10"}`}>{l.text}</div>
            </div>
          ))}
        </div>
      )}

      {error && <div className="border-t border-white/10 px-5 py-3 text-[13px] text-[#fca5a5]">{error}</div>}

      <div className="flex flex-wrap gap-2 border-t border-white/10 p-4">
        {phase === "ringing" && !decided && (
          <>
            <button type="button" onClick={answer} className="press inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#16a34a] px-5 text-[14.5px] font-medium hover:bg-[#15803d]">
              <Icon name="phone" size={16} /> Answer
            </button>
            <button type="button" onClick={cancelByButton} className="press inline-flex min-h-11 items-center rounded-xl bg-white/10 px-5 text-[14.5px] font-medium hover:bg-white/15">
              Just cancel it
            </button>
          </>
        )}
        {phase === "connecting" && <span className="inline-flex min-h-11 items-center text-[14px] text-white/70">Connecting… allow the microphone if asked.</span>}
        {phase === "live" && (
          <>
            <span className="inline-flex min-h-11 flex-1 items-center text-[13.5px] text-white/70">Speak naturally. Try “No, that wasn't me. Cancel it.”</span>
            <button type="button" onClick={hangUp} className="press inline-flex min-h-11 items-center rounded-xl bg-[#dc2626] px-5 text-[14.5px] font-medium hover:bg-[#b91c1c]">
              Hang up
            </button>
          </>
        )}
        {phase === "ended" && (
          <span className="inline-flex min-h-11 items-center text-[13.5px] text-white/70">
            {decided === "allow" ? "You told Argus it was you." : decided === "timeout" ? "No answer, so Argus acted on its own." : "Argus heard “cancel”."}
          </span>
        )}
      </div>
      <div className="px-5 pb-4 text-[11.5px] text-white/40">A live AI voice call (ElevenLabs). In production, Argus rings the owner's real phone.</div>
    </div>
  );
}
