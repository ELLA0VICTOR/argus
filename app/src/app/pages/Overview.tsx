import { Link } from "react-router";
import { Icon } from "../../components/Icon";
import { Button, ButtonLink } from "../../components/ui";
import { formatAmount, formatDuration } from "../../lib/format";
import { Container } from "../Shell";
import { LogList, SectionTitle, WithdrawalRow } from "../parts";
import { useVault } from "../store";

export default function Overview() {
  const { vault, freeze, role } = useVault();
  const flagged = vault.pending.filter((p) => p.risk === "high" || p.risk === "critical");
  const normal = vault.pending.filter((p) => !flagged.includes(p));
  const left = vault.dailyLimit > vault.spentInWindow ? vault.dailyLimit - vault.spentInWindow : 0n;

  return (
    <Container className="lg:pt-14">
      {/* balance */}
      <section>
        <div className="text-[14px] text-muted">{vault.name} vault</div>
        <div className="mt-2 flex items-baseline gap-3">
          <span className="num text-[46px] leading-none font-medium tracking-[-0.03em] sm:text-[60px]">{formatAmount(vault.balance, vault.decimals)}</span>
          <span className="text-[18px] text-muted">{vault.symbol}</span>
        </div>
        <p className="mt-4 max-w-[34rem] text-[15px] leading-relaxed text-muted">
          {vault.frozen ? (
            <>The vault is frozen. Nothing can leave until {vault.threshold} guardians unfreeze it.</>
          ) : (
            <>
              You can spend <span className="num text-fg">{formatAmount(left, vault.decimals)}</span> instantly today. Larger amounts wait {formatDuration(vault.delay)} and can be cancelled.
            </>
          )}
        </p>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-2">
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
            <button type="button" onClick={() => freeze()} className="ml-1 inline-flex min-h-11 items-center gap-2 px-3 text-[14px] text-muted hover:text-fg">
              <Icon name="snow" size={16} /> Freeze vault
            </button>
          )}
        </div>
      </section>

      {/* attention first */}
      {flagged.length > 0 && (
        <section className="mt-14">
          <SectionTitle>Needs your attention</SectionTitle>
          <div className="border-t border-line">
            {flagged.map((w) => (
              <WithdrawalRow key={w.id} w={w} />
            ))}
          </div>
        </section>
      )}

      {normal.length > 0 && (
        <section className="mt-12">
          <SectionTitle count={normal.length}>Waiting to leave</SectionTitle>
          <div className="border-t border-line">
            {normal.map((w) => (
              <WithdrawalRow key={w.id} w={w} />
            ))}
          </div>
        </section>
      )}

      <section className="mt-12">
        <SectionTitle
          right={
            <Link to="/app/activity" className="nudge inline-flex items-center gap-1.5 text-[13.5px] text-muted hover:text-fg">
              View all <Icon name="arrow-right" size={13} className="arrow" />
            </Link>
          }
        >
          Recent activity
        </SectionTitle>
        <div className="border-t border-line">
          <LogList entries={vault.log} limit={5} />
        </div>
      </section>

    </Container>
  );
}
