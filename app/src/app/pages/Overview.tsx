import { Link } from "react-router";
import { Icon } from "../../components/Icon";
import { Button, ButtonLink } from "../../components/ui";
import { formatAmount, formatDuration } from "../../lib/format";
import { Container } from "../Shell";
import { Group, LogList, SectionTitle, WithdrawalRow } from "../parts";
import { useVault } from "../store";

export default function Overview() {
  const { vault, freeze, role } = useVault();
  const flagged = vault.pending.filter((p) => p.risk === "high" || p.risk === "critical");
  const normal = vault.pending.filter((p) => !flagged.includes(p));
  const spent = vault.spentInWindow < vault.dailyLimit ? vault.spentInWindow : vault.dailyLimit;
  const left = vault.dailyLimit - spent;
  const used = vault.dailyLimit > 0n ? Number((spent * 1000n) / vault.dailyLimit) / 1000 : 1;


  return (
    <Container className="space-y-10 lg:pt-16">
      {/* balance */}
      <section className="relative overflow-hidden rounded-[28px] border border-line bg-white p-6 shadow-[0_24px_60px_-40px_rgba(23,37,84,0.35)] sm:p-9">

        <div className="text-[14px] text-muted">{vault.name} vault</div>

        <div className="relative mt-3 flex items-baseline gap-3">
          <span className="num text-[46px] leading-none font-medium tracking-[-0.035em] sm:text-[64px]">{formatAmount(vault.balance, vault.decimals)}</span>
          <span className="text-[18px] text-muted">{vault.symbol}</span>
        </div>

        {vault.frozen ? (
          <p className="relative mt-5 max-w-[34rem] text-[15px] leading-relaxed text-muted">Nothing can leave until {vault.threshold} guardians unfreeze it.</p>
        ) : (
          <div className="relative mt-7 max-w-[420px]">
            <div className="flex items-baseline justify-between text-[13.5px]">
              <span className="text-muted">Instant today</span>
              <span>
                <span className="num font-medium">{formatAmount(left, vault.decimals)}</span>
                <span className="num text-muted"> of {formatAmount(vault.dailyLimit, vault.decimals)}</span>
              </span>
            </div>
            <div className="mt-2 h-[6px] overflow-hidden rounded-full bg-panel ring-1 ring-line-soft">
              <div className="h-full rounded-full bg-brand" style={{ width: `${(1 - used) * 100}%`, transition: "width 800ms cubic-bezier(0.16,1,0.3,1)" }} />
            </div>
            <p className="mt-2.5 text-[13px] text-muted">Larger amounts wait {formatDuration(vault.delay)} and can be cancelled.</p>
          </div>
        )}

        <div className="relative mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-2">
          {role === "owner" && (
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <ButtonLink to="/app/send" variant="primary" size="lg">
                Send
              </ButtonLink>
              <Button variant="secondary" size="lg">
                Deposit
              </Button>
            </div>
          )}
          {!vault.frozen && (
            <button type="button" onClick={() => freeze()} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-[14px] text-muted transition-colors hover:bg-panel hover:text-fg sm:ml-1">
              <Icon name="snow" size={16} /> Freeze vault
            </button>
          )}
        </div>
      </section>

      {/* attention first */}
      {flagged.length > 0 && (
        <section>
          <SectionTitle>Needs your attention</SectionTitle>
          <Group>
            {flagged.map((w) => (
              <WithdrawalRow key={w.id} w={w} />
            ))}
          </Group>
        </section>
      )}

      {normal.length > 0 && (
        <section>
          <SectionTitle count={normal.length}>Waiting to leave</SectionTitle>
          <Group>
            {normal.map((w) => (
              <WithdrawalRow key={w.id} w={w} />
            ))}
          </Group>
        </section>
      )}

      <section>
        <SectionTitle
          right={
            <Link to="/app/activity" className="nudge inline-flex items-center gap-1.5 text-[13.5px] text-muted hover:text-fg">
              View all <Icon name="arrow-right" size={13} className="arrow" />
            </Link>
          }
        >
          Recent activity
        </SectionTitle>
        <Group>
          <LogList entries={vault.log} limit={5} />
        </Group>
      </section>
    </Container>
  );
}
