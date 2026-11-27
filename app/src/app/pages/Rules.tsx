import { useState } from "react";
import { Link } from "react-router";
import { Address, Button } from "../../components/ui";
import { formatAmount, formatDuration } from "../../lib/format";
import { useNow } from "../../lib/hooks";
import { PROGRAM_ID } from "../../lib/config";
import { Container, PageHeader } from "../Shell";
import { Avatar, Group, GroupRow, SectionTitle } from "../parts";
import { Icon } from "../../components/Icon";
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
      <Container className="space-y-10">
        <section>
          <SectionTitle>Spending</SectionTitle>
          <Group>
            <GroupRow label="Instant allowance" hint="Spend this much per day without waiting.">
              <span className="num font-medium">
                {formatAmount(vault.dailyLimit, vault.decimals)} {vault.symbol}
              </span>
            </GroupRow>
            <GroupRow label="Delay for larger amounts" hint="Anyone protecting the vault can cancel during this time.">
              <span className="num font-medium">{formatDuration(vault.delay)}</span>
            </GroupRow>
          </Group>
        </section>

        <section>
          <SectionTitle count={vault.trusted.length}>Trusted addresses</SectionTitle>
          <p className="-mt-1 mb-3 px-1 text-[13.5px] leading-relaxed text-muted">Sends to these go through instantly, at any amount. Adding one waits the full delay.</p>
          <Group>
            {vault.trusted.map((t) => (
              <GroupRow key={t.wallet} lead={<Avatar name={t.label} />} label={t.label} hint={<Address value={t.wallet} className="text-[12.5px] text-muted" />}>
                {t.activeAt <= now ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-safe-bg px-2.5 py-0.5 text-[12.5px] font-medium text-safe-soft">
                    <span className="size-1.5 rounded-full bg-safe" /> Active
                  </span>
                ) : (
                  <span className="num text-[13.5px] text-wait">Active in {formatDuration(t.activeAt - now)}</span>
                )}
              </GroupRow>
            ))}
          </Group>
        </section>

        <section>
          <SectionTitle>Safe address</SectionTitle>
          <Group>
            <GroupRow lead={<Avatar><Icon name="lock" size={16} /></Avatar>} label={vault.safe.label} hint="If something goes wrong, any guardian can move everything here.">
              <Address value={vault.safe.wallet} className="text-[13px] text-muted" />
            </GroupRow>
          </Group>
        </section>

        <Alerts />

        <section>
          <SectionTitle>On-chain</SectionTitle>
          <Group>
            <GroupRow label="Vault account">
              <Address value={vault.address} className="text-[13px] text-muted" />
            </GroupRow>
            <GroupRow label="Program">
              <Address value={PROGRAM_ID} className="text-[13px] text-muted" />
            </GroupRow>
          </Group>
        </section>
      </Container>
    </>
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
      <p className="-mt-1 mb-3 px-1 text-[13.5px] leading-relaxed text-muted">Argus calls every number here when a withdrawal looks like theft. Only guardians can remove a number, so a thief can't silence you.</p>
      <Group>
        {phones.map((p) => (
          <GroupRow key={p.id} lead={<Avatar><Icon name="phone" size={16} /></Avatar>} label={<span className="num">{p.masked}</span>} hint={p.label}>
            {role === "guardian" ? (
              <button type="button" className="text-[13.5px] text-muted hover:text-fg" onClick={() => setPhones(phones.filter((x) => x.id !== p.id))}>
                Remove
              </button>
            ) : (
              <span className="text-[13px] text-faint">Guardians can remove</span>
            )}
          </GroupRow>
        ))}
      </Group>
      {adding ? (
        <div className="mt-3 flex flex-col gap-3 rounded-[20px] border border-line bg-white p-4 sm:flex-row sm:items-end">
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
        <button type="button" onClick={() => setAdding(true)} className="press mt-3 inline-flex h-10 items-center gap-2 rounded-xl px-3 text-[14px] text-muted transition-colors hover:bg-white hover:text-fg">
          <Icon name="plus" size={15} /> Add a number
        </button>
      )}
    </section>
  );
}
