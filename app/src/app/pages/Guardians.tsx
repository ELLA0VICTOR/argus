import { useState } from "react";
import { Address, Button } from "../../components/ui";
import { formatAmount, formatCountdown, formatDuration, shortAddr } from "../../lib/format";
import { useNow } from "../../lib/hooks";
import { Container, PageHeader } from "../Shell";
import { Avatar, EmptyState, Group, GroupRow, SectionTitle } from "../parts";
import { Logo } from "../../components/Logo";
import { describeAction, isVetoable, PROPOSAL_TTL, timelock, useVault, type Proposal, type ProposalAction } from "../store";

export default function Guardians() {
  const { vault, role } = useVault();
  const [composing, setComposing] = useState(false);
  return (
    <>
      <PageHeader
        title="Guardians"
        subtitle={`Any one guardian can cancel, freeze, or move everything to your safe address. ${vault.threshold} of ${vault.guardians.length} are needed to change keys or rules.`}
        actions={
          role === "guardian" && !composing ? (
            <Button variant="primary" onClick={() => setComposing(true)}>
              New proposal
            </Button>
          ) : undefined
        }
      />
      <Container className="space-y-10">
        {composing && <Composer onClose={() => setComposing(false)} />}

        <section>
          <SectionTitle count={vault.proposals.length}>Proposals</SectionTitle>
          <Group>
            {vault.proposals.length === 0 ? (
              <EmptyState title="No open proposals" body="Changes to keys, limits or trusted addresses show up here for guardians to approve." />
            ) : (
              vault.proposals.map((p) => <ProposalRow key={p.id} p={p} />)
            )}
          </Group>
          {role === "owner" && <p className="mt-3 px-1 text-[13.5px] leading-relaxed text-muted">You can see proposals as the owner, but only guardians vote. That way a stolen owner key can't change any rule.</p>}
        </section>

        <section>
          <SectionTitle>Who's protecting this vault</SectionTitle>
          <Group>
            {vault.guardians.map((g) => (
              <GroupRow
                key={g.key}
                lead={<Avatar name={g.name} />}
                label={
                  <>
                    {g.name}
                    {g.you && role === "guardian" && <span className="ml-2 text-[13px] text-muted">(you)</span>}
                  </>
                }
                hint={g.note}
              >
                <Address value={g.key} className="text-[12.5px] text-muted" />
              </GroupRow>
            ))}
            <GroupRow
              lead={
                <Avatar>
                  <span className="text-fg">
                    <Logo size={20} />
                  </span>
                </Avatar>
              }
              label="AI guardian"
              hint="Can cancel and freeze. Can never move funds or vote."
            >
              <span className="inline-flex items-center gap-1.5 rounded-full bg-safe-bg px-2.5 py-0.5 text-[12.5px] font-medium text-safe-soft">
                <span className="size-1.5 animate-pulse-dot rounded-full bg-safe" /> Watching
              </span>
            </GroupRow>
          </Group>
        </section>
      </Container>
    </>
  );
}

function ProposalRow({ p }: { p: Proposal }) {
  const { vault, role, me, approve, veto, executeProposal, txs } = useVault();
  const now = useNow();
  const busy = txs.some((t) => t.state === "pending");
  const need = Math.max(0, vault.threshold - p.approvals.length);
  const ready = p.eta !== 0 && now >= p.eta;
  const waiting = p.eta !== 0 && now < p.eta;
  const expiresIn = Math.max(0, p.createdAt + PROPOSAL_TTL - now);
  const iApproved = p.approvals.includes(me);
  const isGuardian = role === "guardian";
  const proposer = vault.guardians.find((g) => g.key === p.proposer);

  let status: React.ReactNode;
  if (ready) status = "Approved. Ready to apply.";
  else if (waiting)
    status = (
      <>
        Approved. Takes effect in <span className="num text-wait">{formatCountdown(p.eta - now)}</span>, and any guardian can still veto.
      </>
    );
  else
    status = `Needs ${need} more approval${need === 1 ? "" : "s"}. Expires in ${Math.floor(expiresIn / 86_400)}d ${Math.floor((expiresIn % 86_400) / 3600)}h.`;

  return (
    <div className="enter flex flex-col gap-4 border-b border-line-soft px-5 py-5 last:border-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="text-[16px] font-medium">{describeAction(p.action)}</div>
        <Detail a={p.action} />
        <div className="mt-2 text-[13.5px] text-muted">{status}</div>
        <div className="mt-1 text-[12.5px] text-faint">
          Proposed by {proposer?.name ?? shortAddr(p.proposer)} · {p.approvals.length} of {vault.threshold} approvals
          {p.eta === 0 && timelock(p.action, vault) > 0 && ` · then waits ${formatDuration(timelock(p.action, vault))}`}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        {ready && (
          <Button variant="primary" disabled={busy} onClick={() => executeProposal(p)}>
            Apply
          </Button>
        )}
        {isGuardian && !iApproved && p.eta === 0 && (
          <Button variant="primary" disabled={busy} onClick={() => approve(p)}>
            Approve
          </Button>
        )}
        {isGuardian && isVetoable(p.action) && (
          <Button variant="secondary" disabled={busy} onClick={() => veto(p)}>
            Veto
          </Button>
        )}
      </div>
    </div>
  );
}

function Detail({ a }: { a: ProposalAction }) {
  const { vault } = useVault();
  if (a.kind === "AddTrusted" || a.kind === "RemoveTrusted") return <Address value={a.wallet} className="mt-1 text-[13px] text-muted" />;
  if (a.kind === "RotateOwner") return <div className="mt-1 text-[13px] text-muted">New owner <Address value={a.newOwner} className="text-[13px] text-muted" /></div>;
  if (a.kind === "SetSafeAddress") return <Address value={a.wallet} className="mt-1 text-[13px] text-muted" />;
  if (a.kind === "SetGuardians")
    return (
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {a.guardians.map((g) => (
          <Address key={g} value={g} className="text-[13px] text-muted" />
        ))}
      </div>
    );
  if (a.kind === "SetAiGuardian") return a.key === "11111111111111111111111111111111" ? null : <Address value={a.key} className="mt-1 text-[13px] text-muted" />;
  if (a.kind === "LoosenLimits" || a.kind === "TightenLimits")
    return (
      <div className="num mt-1 text-[13px] text-muted">
        {formatAmount(a.dailyLimit, vault.decimals)} {vault.symbol} a day · {formatDuration(a.delay)} delay
      </div>
    );
  return null;
}

const KINDS: { kind: ProposalAction["kind"]; label: string; hint: string }[] = [
  { kind: "RotateOwner", label: "Replace the owner key", hint: "For a lost or stolen key. Applies right away and cancels everything the old key requested." },
  { kind: "Unfreeze", label: "Unfreeze the vault", hint: "Applies right away." },
  { kind: "AddTrusted", label: "Trust an address", hint: "Sends to it go through instantly. Waits the full delay first, and any guardian can veto." },
  { kind: "TightenLimits", label: "Tighten limits", hint: "Halve the daily allowance and double the delay. Applies right away." },
];

function Composer({ onClose }: { onClose: () => void }) {
  const { vault, propose } = useVault();
  const [kind, setKind] = useState<ProposalAction["kind"]>("RotateOwner");
  const [addr, setAddr] = useState("");
  const [label, setLabel] = useState("");
  const needsAddr = kind === "RotateOwner" || kind === "AddTrusted";
  const valid = !needsAddr || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr.trim());

  const build = (): ProposalAction => {
    if (kind === "RotateOwner") return { kind, newOwner: addr.trim() };
    if (kind === "AddTrusted") return { kind, wallet: addr.trim(), label: label || "Trusted address" };
    if (kind === "TightenLimits") return { kind, dailyLimit: vault.dailyLimit / 2n, delay: vault.delay * 2 };
    return { kind: "Unfreeze" };
  };

  return (
    <section className="enter rounded-[24px] border border-line bg-white p-5 shadow-[0_24px_60px_-40px_rgba(23,37,84,0.35)] sm:p-7">
      <SectionTitle>New proposal</SectionTitle>
      <div role="radiogroup" className="space-y-1">
        {KINDS.map((k) => (
          <label key={k.kind} className={`flex cursor-pointer gap-3 rounded-xl px-3 py-3 transition-colors ${kind === k.kind ? "bg-panel" : "hover:bg-panel/50"}`}>
            <input type="radio" name="kind" checked={kind === k.kind} onChange={() => setKind(k.kind)} className="mt-1 accent-[#2563eb]" />
            <span>
              <span className="block text-[14.5px]">{k.label}</span>
              <span className="block text-[13px] text-muted">{k.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {needsAddr && (
        <div className="mt-5 space-y-4">
          <input
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            placeholder={kind === "RotateOwner" ? "New owner address" : "Address to trust"}
            spellCheck={false}
            className="w-full border-b border-line-strong bg-transparent pb-3 font-mono text-[14px] outline-none placeholder:font-sans placeholder:text-faint focus:border-fg"
          />
          {kind === "AddTrusted" && (
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name, e.g. Savings account" className="w-full border-b border-line-strong bg-transparent pb-3 text-[14px] outline-none placeholder:text-faint focus:border-fg" />
          )}
        </div>
      )}
      <div className="mt-6 flex gap-2">
        <Button
          variant="primary"
          disabled={!valid}
          onClick={async () => {
            await propose(build());
            onClose();
          }}
        >
          Propose
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
