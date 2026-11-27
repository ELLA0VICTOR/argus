import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Address, Button } from "../../components/ui";
import { formatAmount, formatDuration } from "../../lib/format";
import { useNow } from "../../lib/hooks";
import { PROGRAM_ID } from "../../lib/config";
import { Container, PageHeader } from "../Shell";
import { SectionTitle } from "../parts";
import { useVault } from "../store";

export default function Rules() {
  const { vault } = useVault();
  const now = useNow();
  return (
    <>
      <PageHeader
        title="Settings"
        subtitle={
          <>
            These rules live on-chain. Changing them takes your guardians,{" "}
            <Link to="/app/guardians" className="text-fg underline-offset-4 hover:underline">
              through a proposal
            </Link>
            .
          </>
        }
      />
      <Container className="space-y-12">
        <section>
          <SectionTitle>Spending</SectionTitle>
          <Rows>
            <Row label="Instant allowance" hint="Spend this much per day without waiting.">
              <span className="num">
                {formatAmount(vault.dailyLimit, vault.decimals)} {vault.symbol}
              </span>
            </Row>
            <Row label="Delay for larger amounts" hint="Anyone protecting the vault can cancel during this time.">
              <span className="num">{formatDuration(vault.delay)}</span>
            </Row>
          </Rows>
        </section>

        <section>
          <SectionTitle count={vault.trusted.length}>Trusted addresses</SectionTitle>
          <p className="-mt-2 mb-4 text-[13.5px] text-muted">Sends to these go through instantly, at any amount. Adding one waits the full delay.</p>
          <Rows>
            {vault.trusted.map((t) => (
              <Row key={t.wallet} label={t.label} hint={<Address value={t.wallet} className="text-[12.5px] text-muted" />}>
                <span className="text-[13.5px] text-muted">{t.activeAt <= now ? "Active" : `Active in ${formatDuration(t.activeAt - now)}`}</span>
              </Row>
            ))}
          </Rows>
        </section>

        <section>
          <SectionTitle>Safe address</SectionTitle>
          <Rows>
            <Row label={vault.safe.label} hint="If something goes wrong, any guardian can move everything here.">
              <Address value={vault.safe.wallet} className="text-[13px] text-muted" />
            </Row>
          </Rows>
        </section>

        <Alerts />

        <section>
          <SectionTitle>On-chain</SectionTitle>
          <Rows>
            <Row label="Vault account">
              <Address value={vault.address} className="text-[13px] text-muted" />
            </Row>
            <Row label="Program">
              <Address value={PROGRAM_ID} className="text-[13px] text-muted" />
            </Row>
          </Rows>
        </section>
      </Container>
    </>
  );
}

function Rows({ children }: { children: ReactNode }) {
  return <div className="border-t border-line">{children}</div>;
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-b border-line py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <div className="text-[15px]">{label}</div>
        {hint && <div className="mt-0.5 text-[13.5px] text-muted">{hint}</div>}
      </div>
      <div className="shrink-0 text-[15px]">{children}</div>
    </div>
  );
}

/** Sentinel call contacts (docs/SENTINEL-API.md §3). Sample data until Sentinel is live. */
function Alerts() {
  const { role } = useVault();
  const [phones, setPhones] = useState([{ id: "ph_1", masked: "+234 ••• ••• 21", label: "Victor" }]);
  const [adding, setAdding] = useState(false);
  const [num, setNum] = useState("");
  const valid = /^\+[1-9]\d{7,14}$/.test(num.replace(/\s/g, ""));
  return (
    <section>
      <SectionTitle>Phone alerts</SectionTitle>
      <p className="-mt-2 mb-4 text-[13.5px] text-muted">Argus calls every number here when a withdrawal looks like theft. Only guardians can remove a number, so a thief can't silence you.</p>
      <Rows>
        {phones.map((p) => (
          <Row key={p.id} label={p.masked} hint={p.label}>
            {role === "guardian" ? (
              <button type="button" className="text-[13.5px] text-muted hover:text-fg" onClick={() => setPhones(phones.filter((x) => x.id !== p.id))}>
                Remove
              </button>
            ) : (
              <span className="text-[13px] text-faint">Guardians can remove</span>
            )}
          </Row>
        ))}
      </Rows>
      {adding ? (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <input value={num} onChange={(e) => setNum(e.target.value)} placeholder="+234 801 234 5621" inputMode="tel" autoFocus className="num flex-1 border-b border-line-strong bg-transparent pb-2.5 text-[15px] outline-none placeholder:text-faint focus:border-fg" />
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={!valid}
              onClick={() => {
                const d = num.replace(/\s/g, "");
                setPhones([...phones, { id: `ph_${phones.length + 2}`, masked: `${d.slice(0, 4)} ••• ••• ${d.slice(-2)}`, label: "Added just now" }]);
                setNum("");
                setAdding(false);
              }}
            >
              Add
            </Button>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="mt-4 text-[14px] text-muted hover:text-fg">
          + Add a number
        </button>
      )}
    </section>
  );
}
