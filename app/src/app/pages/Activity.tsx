import { useState } from "react";
import { Container, PageHeader } from "../Shell";
import { EmptyState, LogList } from "../parts";
import { useVault, type LogEntry } from "../store";

const FILTERS: { id: string; label: string; match: (e: LogEntry) => boolean }[] = [
  { id: "all", label: "All", match: () => true },
  { id: "money", label: "Money", match: (e) => e.kind === "chain" || e.kind === "send" || e.kind === "cancel" },
  { id: "alerts", label: "Alerts", match: (e) => e.kind === "scored" || e.kind === "call" },
  { id: "gov", label: "Changes", match: (e) => e.kind === "gov" || e.kind === "freeze" },
];

export default function Activity() {
  const { vault } = useVault();
  const [f, setF] = useState("all");
  const rows = vault.log.filter(FILTERS.find((x) => x.id === f)!.match);
  return (
    <>
      <PageHeader title="Activity" subtitle="Everything Argus saw and did, newest first." />
      <Container>
        <div className="mb-6 flex gap-5 border-b border-line" role="tablist">
          {FILTERS.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={f === x.id}
              onClick={() => setF(x.id)}
              className={`-mb-px border-b pb-3 text-[14px] transition-colors ${f === x.id ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg"}`}
            >
              {x.label}
            </button>
          ))}
        </div>
        {rows.length === 0 ? <EmptyState title="Nothing here yet" body="Events appear as soon as Argus sees them on-chain." /> : <LogList entries={rows} />}
      </Container>
    </>
  );
}
