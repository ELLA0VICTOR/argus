import { useEffect, useRef, useState } from "react";
import { Logo } from "../components/Logo";
import { Icon } from "../components/Icon";

/**
 * The product, floating over a colourful wallpaper: the Argus web app in a
 * window, with a frosted overlay that replays the core story on a loop.
 * Request, then flagged, then Argus calls, then "Cancel it", then cancelled on-chain.
 */
type Phase = "calm" | "request" | "call" | "cancelled";
const SCRIPT: { phase: Phase; ms: number }[] = [
  { phase: "calm", ms: 1800 },
  { phase: "request", ms: 2400 },
  { phase: "call", ms: 4200 },
  { phase: "cancelled", ms: 3600 },
];

function useLoop() {
  const [i, setI] = useState(0);
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    const id = setTimeout(() => setI((n) => (n + 1) % SCRIPT.length), SCRIPT[i].ms);
    return () => clearTimeout(id);
  }, [i, visible]);
  return { ref, phase: SCRIPT[i].phase };
}

export function ProductShot() {
  const { ref, phase } = useLoop();
  const [secs, setSecs] = useState(86_380);
  useEffect(() => {
    const id = setInterval(() => setSecs((s) => (s <= 86_300 ? 86_380 : s - 1)), 1000);
    return () => clearInterval(id);
  }, []);
  const flagged = phase === "request" || phase === "call";
  const t = `${String(Math.floor(secs / 3600)).padStart(2, "0")}:${String(Math.floor((secs % 3600) / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;

  return (
    <div ref={ref} className="wallpaper relative overflow-hidden rounded-[28px] px-3 pt-8 pb-10 sm:px-10 sm:pt-14 sm:pb-16 lg:px-20">
      {/* the app window */}
      <div className="shadow-float relative mx-auto max-w-[980px] overflow-hidden rounded-2xl bg-white">
        <div className="flex h-9 items-center gap-2 border-b border-line bg-[#f7f8fa] px-4">
          <span className="size-3 rounded-full bg-[#ff5f57]" />
          <span className="size-3 rounded-full bg-[#febc2e]" />
          <span className="size-3 rounded-full bg-[#28c840]" />
          <span className="mx-auto hidden rounded-md bg-white px-16 py-0.5 text-[11px] text-faint sm:block">argus.app/app</span>
        </div>

        <div className="grid min-h-[380px] sm:grid-cols-[170px_1fr]">
          <aside className="hidden border-r border-line bg-[#fbfcfd] p-4 sm:block">
            <div className="flex items-center gap-2 text-fg">
              <Logo size={18} alert={flagged} />
              <span className="text-[13px] font-semibold">Argus</span>
            </div>
            <div className="mt-5 space-y-1 text-[12.5px]">
              {["Home", "Send", "Activity", "Guardians", "Settings"].map((n, i) => (
                <div key={n} className={`rounded-lg px-2.5 py-1.5 ${i === 0 ? "bg-panel font-medium text-fg" : "text-muted"}`}>
                  {n}
                </div>
              ))}
            </div>
          </aside>

          <div className="p-5 sm:p-7">
            <div className="text-[12px] text-muted">Savings vault</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-[34px] font-semibold tracking-[-0.03em] sm:text-[40px]">12,480.50</span>
              <span className="text-[14px] text-muted">USDC</span>
            </div>
            <div className="mt-1 text-[12.5px] text-muted">You can spend 81.50 instantly today. Larger amounts wait 24h.</div>

            <div className="mt-6 text-[13px] font-semibold">{flagged || phase === "cancelled" ? "Needs your attention" : "Waiting to leave"}</div>
            <div className="mt-2 rounded-xl border border-line">
              {phase === "calm" ? (
                <div className="flex items-center justify-between p-3.5 text-[12.5px] text-muted">
                  <span>Nothing waiting. Argus is watching.</span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-1.5 animate-pulse-dot rounded-full bg-safe" /> live
                  </span>
                </div>
              ) : (
                <div key="row" className="enter flex items-center justify-between gap-3 p-3.5">
                  <div className="min-w-0">
                    {phase === "cancelled" ? (
                      <div className="text-[11.5px] font-medium text-safe">Cancelled · funds never left</div>
                    ) : (
                      <div className="text-[11.5px] font-medium text-threat">Looks suspicious · Argus is calling you</div>
                    )}
                    <div className={`text-[16px] font-semibold ${phase === "cancelled" ? "text-faint line-through" : ""}`}>12,000.00 USDC</div>
                    <div className="font-mono text-[11px] text-muted">to 9WzD…AwfM</div>
                  </div>
                  <div className="flex items-center gap-3">
                    {phase !== "cancelled" && (
                      <div className="text-right">
                        <div className="text-[10.5px] text-muted">Leaves in</div>
                        <div className="num text-[13px] text-wait">{t}</div>
                      </div>
                    )}
                    <span className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold ${phase === "cancelled" ? "bg-safe-bg text-safe" : "bg-threat text-white"}`}>
                      {phase === "cancelled" ? "Done" : "Cancel"}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-6 text-[13px] font-semibold">Recent activity</div>
            <div className="mt-2 space-y-2 text-[12px] text-muted">
              <div>Argus checked a 200.00 USDC payment: low risk</div>
              <div>Ada proposed trusting “Savings account”</div>
            </div>
          </div>
        </div>
      </div>

      {/* the frosted Argus overlay */}
      <div
        className={`glass-dark relative mx-auto mt-4 w-full max-w-[560px] rounded-2xl p-4 text-white transition-all duration-700 sm:absolute sm:top-[18%] sm:left-1/2 sm:mt-0 sm:w-[92%] sm:-translate-x-1/2 sm:p-5 ${
          phase === "call" || phase === "cancelled" ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
        }`}
        style={{ transitionTimingFunction: "cubic-bezier(0.16,1,0.3,1)" }}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-[13px] text-white/80">
            <Icon name="phone" size={14} />
            {phase === "cancelled" ? "Call ended" : "Argus is calling you"}
          </span>
          {phase === "call" ? (
            <span className="flex h-4 items-center gap-[3px]" aria-hidden="true">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <span key={i} className="animate-wave h-4 w-[2px] rounded-full bg-white/90" style={{ animationDelay: `${i * 110}ms` }} />
              ))}
            </span>
          ) : (
            <span className="rounded-full bg-[#2563eb] px-3 py-1 text-[12px] font-medium">Cancelled on-chain</span>
          )}
        </div>
        <p className="mt-3 text-[14px] leading-relaxed text-white/95 sm:text-[15px]">“12,000 USDC is about to leave your vault for an address created 14 minutes ago. Was this you?”</p>
        <p className={`mt-2 text-[14px] font-medium transition-opacity duration-500 sm:text-[15px] ${phase === "call" || phase === "cancelled" ? "opacity-100" : "opacity-0"}`}>You: “No. Cancel it.”</p>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/10 pt-3 text-[12.5px] text-white/75">
          <span className="flex items-center gap-1.5">
            <Icon name="x" size={13} /> Cancel withdrawal
          </span>
          <span className="flex items-center gap-1.5">
            <Icon name="snow" size={13} /> Freeze vault
          </span>
          <span className="flex items-center gap-1.5">
            <Icon name="check" size={13} /> It was me
          </span>
        </div>
      </div>
    </div>
  );
}
