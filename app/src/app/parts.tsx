import { useState, type ReactNode } from "react";
import { Icon } from "../components/Icon";
import { Address, Button } from "../components/ui";
import { clockTime, explorerTx, formatAmount, formatCountdown, shortAddr } from "../lib/format";
import { useNow } from "../lib/hooks";
import { useVault, type LogEntry, type Withdrawal } from "./store";

/**
 * App design rule: mostly monochrome, white cards on a soft canvas. Colour is
 * reserved for action: red only for a suspicious withdrawal and its Cancel,
 * amber only for countdowns, green only for "done" and "protected".
 * Labels are plain sentence case. Mono is for addresses only.
 */

export function SectionTitle({ children, right, count }: { children: ReactNode; right?: ReactNode; count?: number }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4 px-1">
      <h2 className="text-[15px] font-semibold tracking-[-0.01em]">
        {children}
        {count !== undefined && count > 0 && <span className="num ml-2 rounded-full bg-raised px-2 py-0.5 text-[12px] font-medium text-muted">{count}</span>}
      </h2>
      {right}
    </div>
  );
}

/** A white rounded card holding rows separated by hairlines. */
export function Group({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`overflow-hidden rounded-[20px] border border-line bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] ${className}`}>{children}</div>;
}

/** One row in a Group: label and hint on the left, value on the right. */
export function GroupRow({ label, hint, lead, children }: { label: ReactNode; hint?: ReactNode; lead?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-line-soft px-5 py-4 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="flex min-w-0 items-center gap-3.5">
        {lead}
        <div className="min-w-0">
          <div className="text-[15px]">{label}</div>
          {hint && <div className="mt-0.5 text-[13.5px] leading-snug text-muted">{hint}</div>}
        </div>
      </div>
      {children !== undefined && <div className="shrink-0 text-[15px] sm:text-right">{children}</div>}
    </div>
  );
}

/** Round initials badge for people and keys. */
export function Avatar({ name, children }: { name?: string; children?: ReactNode }) {
  const initials = (name ?? "")
    .replace(/\([^)]*\)/g, "")
    .split(/\s+/)
    .filter((w) => /^[a-z]/i.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return <span className="grid size-10 shrink-0 place-items-center rounded-full bg-panel text-[13px] font-semibold text-muted ring-1 ring-line">{children ?? initials}</span>;
}

export function TextLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <a href={to} className="nudge inline-flex items-center gap-1.5 text-[13.5px] text-muted hover:text-fg">
      {children} <Icon name="arrow-right" size={13} className="arrow" />
    </a>
  );
}

/** 38 → "0:38", 75 → "1:15". */
const mmss = (secs: number) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

/** A pending withdrawal. Calm by default. A suspicious one gets a red band and a red Cancel. */
export function WithdrawalRow({ w }: { w: Withdrawal }) {
  const { vault, cancel, execute, dismiss, txs } = useVault();
  const [dismissError, setDismissError] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState(false);
  const now = useNow();
  const flagged = w.risk === "critical" || w.risk === "high";
  const [open, setOpen] = useState(false);
  const left = w.executesAt - now;
  const total = Math.max(1, w.executesAt - w.requestedAt);
  const passed = Math.min(1, Math.max(0, (now - w.requestedAt) / total));
  const busy = txs.some((t) => t.state === "pending" && t.label.startsWith("Cancel") && t.label.includes(`#${w.id}`));
  const releasing = txs.some((t) => t.state === "pending" && t.label.startsWith("Release") && t.label.includes(`#${w.id}`));

  return (
    <div className="enter border-b border-line-soft last:border-0">
      {flagged && (
        <div className="flex items-center gap-2 border-b border-line-soft px-5 py-2.5 text-[13px] text-muted">
          <span className="size-1.5 rounded-full bg-threat" />
          {w.actAt && w.actAt > now * 1000
            ? `Looks like theft. Argus cancels it in ${mmss(Math.ceil((w.actAt - now * 1000) / 1000))} unless someone confirms it.`
            : w.actAt
              ? "Looks like theft. Argus is cancelling it."
              : "Looks suspicious. Argus is calling you."}
        </div>
      )}
      <div className="px-5 pt-5 pb-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="num text-[22px] font-medium tracking-[-0.02em]">{formatAmount(w.amount, vault.decimals)}</span>
              <span className="text-[14px] text-muted">{vault.symbol}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[13.5px] text-muted">
              to <Address value={w.destination} className="text-[13px] text-muted" />
              {w.destinationLabel && <span>· {w.destinationLabel}</span>}
            </div>
          </div>
          <div className="flex items-center justify-between gap-5 sm:justify-end">
            <div className="sm:text-right">
              <div className="text-[12.5px] text-muted">{left > 0 ? "Leaves in" : "Ready"}</div>
              <div className="num text-[17px] font-medium text-wait">{left > 0 ? formatCountdown(left) : "now"}</div>
            </div>
            {/* Devnet's clock can trail ours by a few seconds: offer Release once the chain agrees. */}
            {left <= -20 && !flagged && (
              <Button variant="primary" size="md" onClick={() => execute(w)} disabled={releasing} className="min-w-[104px]">
                {releasing ? "Releasing" : "Release"}
              </Button>
            )}
            <Button variant={flagged ? "danger" : "secondary"} size="md" onClick={() => cancel(w)} disabled={busy} className="min-w-[104px]">
              {busy ? "Cancelling" : "Cancel"}
            </Button>
          </div>
        </div>

        {/* how much of the wait has passed */}
        <div className="mt-4 h-[3px] overflow-hidden rounded-full bg-line-soft" aria-hidden="true">
          <div className={`h-full rounded-full bg-wait/60`} style={{ width: `${passed * 100}%`, transition: "width 800ms cubic-bezier(0.16,1,0.3,1)" }} />
        </div>

        {flagged && dismiss && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            <button
              type="button"
              disabled={dismissing}
              onClick={async () => {
                setDismissing(true);
                setDismissError(await dismiss(w));
                setDismissing(false);
              }}
              className="font-medium text-fg underline-offset-4 hover:underline disabled:opacity-50"
            >
              {dismissing ? "Confirm in your wallet…" : "It was me"}
            </button>
            <span className="text-muted">{w.risk === "critical" ? "For a withdrawal this risky, a guardian has to confirm." : "Sign to let it through."}</span>
            {dismissError && <span className="w-full text-threat-soft">{dismissError}</span>}
          </div>
        )}

        {(w.reason || w.signals.length > 0) && (
          <>
            <button type="button" onClick={() => setOpen(!open)} className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg" aria-expanded={open}>
              {open ? "Hide details" : flagged ? "Why Argus flagged this" : "Details"}
              <Icon name="chevron-down" size={14} className={`transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
            </button>
            <div className={`grid transition-all duration-500 ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`} style={{ transitionTimingFunction: "cubic-bezier(0.16,1,0.3,1)" }}>
              <div className="overflow-hidden">
                <div className="mt-3 max-w-[640px] space-y-3 rounded-2xl bg-panel p-4 text-[14px] leading-relaxed text-muted">
                  {w.reason && <p className="text-fg">{w.reason}</p>}
                  {w.signals.length > 0 && (
                    <ul className="space-y-1.5">
                      {w.signals.map((s) => (
                        <li key={s.id} className="flex gap-2.5">
                          <span className="mt-[9px] size-1 shrink-0 rounded-full bg-faint" />
                          {s.label}
                        </li>
                      ))}
                    </ul>
                  )}
                  {w.call && (
                    <p>
                      <span className="text-fg">Phone call:</span> “{w.call.transcript[w.call.transcript.length - 1].text}”
                    </p>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const DOT: Record<LogEntry["kind"], string> = {
  chain: "bg-line-strong",
  send: "bg-line-strong",
  scored: "bg-faint",
  call: "bg-faint",
  gov: "bg-line-strong",
  heartbeat: "bg-line",
  cancel: "bg-safe",
  freeze: "bg-safe",
};

/** Activity as a quiet timeline: a hairline spine, a dot per event, time on the right. */
export function LogList({ entries, limit }: { entries: LogEntry[]; limit?: number }) {
  const rows = [...entries].sort((a, b) => b.at - a.at).slice(0, limit);
  return (
    <ol className="relative px-5 py-2">
      <span className="absolute top-6 bottom-6 left-[27px] w-px bg-line" aria-hidden="true" />
      {rows.map((e) => (
        <li key={`${e.at}-${e.text}`} className="relative flex items-start gap-4 py-3 text-[14px]">
          <span className="relative z-10 mt-[5px] grid size-[15px] shrink-0 place-items-center rounded-full bg-white">
            <span className={`size-[7px] rounded-full ${e.tone === "threat" ? "bg-threat" : DOT[e.kind]}`} />
          </span>
          <span className="min-w-0 flex-1 leading-relaxed">{e.text}</span>
          <span className="num shrink-0 pt-px text-[12.5px] text-faint">{clockTime(e.at)}</span>
          {e.tx ? (
            <a href={explorerTx(e.tx)} target="_blank" rel="noreferrer" className="shrink-0 pt-0.5 text-faint hover:text-fg" title={e.tx} aria-label="View transaction">
              <Icon name="arrow-up-right" size={14} />
            </a>
          ) : (
            <span className="w-[14px] shrink-0" />
          )}
        </li>
      ))}
    </ol>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-6 py-12 text-center">
      <div className="text-[15px] font-medium">{title}</div>
      <div className="mx-auto mt-1 max-w-[26rem] text-[14px] text-muted">{body}</div>
    </div>
  );
}

export { shortAddr };
