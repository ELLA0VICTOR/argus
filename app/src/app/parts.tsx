import { useState, type ReactNode } from "react";
import { Icon } from "../components/Icon";
import { Address, Button } from "../components/ui";
import { clockTime, explorerTx, formatAmount, formatCountdown, shortAddr } from "../lib/format";
import { useNow } from "../lib/hooks";
import { useVault, type LogEntry, type Withdrawal } from "./store";

/**
 * App design rule: mostly monochrome. Colour is reserved for action:
 * red only for cancelling a suspicious withdrawal, amber only for countdown
 * digits, teal only for "done". Labels are plain sentence case. Mono is
 * for numbers and addresses only.
 */

export function SectionTitle({ children, right, count }: { children: ReactNode; right?: ReactNode; count?: number }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-4">
      <h2 className="text-[16px] font-semibold tracking-[-0.01em]">
        {children}
        {count !== undefined && count > 0 && <span className="num ml-2 text-[13px] font-normal text-muted">{count}</span>}
      </h2>
      {right}
    </div>
  );
}

export function TextLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <a href={to} className="nudge inline-flex items-center gap-1.5 text-[13.5px] text-muted hover:text-fg">
      {children} <Icon name="arrow-right" size={13} className="arrow" />
    </a>
  );
}

/** A pending withdrawal. Calm by default. A suspicious one gets a thin red edge and a red Cancel. */
export function WithdrawalRow({ w }: { w: Withdrawal }) {
  const { vault, cancel, txs } = useVault();
  const now = useNow();
  const flagged = w.risk === "critical" || w.risk === "high";
  const [open, setOpen] = useState(false);
  const left = w.executesAt - now;
  const busy = txs.some((t) => t.state === "pending" && t.label.includes(`#${w.id}`));

  return (
    <div className={`enter relative border-b border-line last:border-0 ${flagged ? "pl-4" : ""}`}>
      {flagged && <span className="absolute top-5 bottom-5 left-0 w-[2px] bg-threat" aria-hidden="true" />}
      <div className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          {flagged && <div className="mb-1.5 text-[13px] font-medium text-threat-soft">Looks suspicious · Argus is calling you</div>}
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="num text-[20px] font-medium">{formatAmount(w.amount, vault.decimals)}</span>
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
            <div className="num text-[17px] text-wait">{left > 0 ? formatCountdown(left) : "now"}</div>
          </div>
          <Button variant={flagged ? "danger" : "secondary"} size="md" onClick={() => cancel(w)} disabled={busy} className="min-w-[104px]">
            {busy ? "Cancelling" : "Cancel"}
          </Button>
        </div>
      </div>

      {(w.reason || w.signals.length > 0) && (
        <>
          <button type="button" onClick={() => setOpen(!open)} className="-mt-2 mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg" aria-expanded={open}>
            {open ? "Hide details" : flagged ? "Why Argus flagged this" : "Details"}
            <Icon name="chevron-down" size={14} className={`transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
          </button>
          <div className={`grid transition-all duration-500 ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`} style={{ transitionTimingFunction: "cubic-bezier(0.16,1,0.3,1)" }}>
            <div className="overflow-hidden">
              <div className="mb-5 max-w-[640px] space-y-3 text-[14px] leading-relaxed text-muted">
                {w.reason && <p className="text-fg">{w.reason}</p>}
                {w.signals.length > 0 && (
                  <ul className="space-y-1">
                    {w.signals.map((s) => (
                      <li key={s.id}>· {s.label}</li>
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
  );
}

/** Plain activity list: time and text, no colour. */
export function LogList({ entries, limit }: { entries: LogEntry[]; limit?: number }) {
  const rows = [...entries].sort((a, b) => b.at - a.at).slice(0, limit);
  return (
    <ol>
      {rows.map((e) => (
        <li key={`${e.at}-${e.text}`} className="flex gap-5 border-b border-line-soft py-3.5 text-[14px] last:border-0">
          <span className="num w-[68px] shrink-0 text-[13px] text-faint">{clockTime(e.at)}</span>
          <span className="min-w-0 flex-1">{e.text}</span>
          {e.tx && (
            <a href={explorerTx(e.tx)} target="_blank" rel="noreferrer" className="shrink-0 text-faint hover:text-fg" title={e.tx} aria-label="View transaction">
              <Icon name="arrow-up-right" size={14} />
            </a>
          )}
        </li>
      ))}
    </ol>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="py-10 text-center">
      <div className="text-[15px] font-medium">{title}</div>
      <div className="mx-auto mt-1 max-w-[26rem] text-[14px] text-muted">{body}</div>
    </div>
  );
}

export { shortAddr };
