import { useState } from "react";
import { Link } from "react-router";
import { Icon } from "../../components/Icon";
import { Button, ButtonLink } from "../../components/ui";
import { formatAmount, formatDuration } from "../../lib/format";
import { Container } from "../Shell";
import { Group, LogList, SectionTitle, WithdrawalRow } from "../parts";
import { useVault } from "../store";
import { useConnectModal } from "../wallet";
import { AmountInput, amountForInput, parseAmountInput } from "../../components/AmountInput";

export default function Overview() {
  const { vault, freeze, role, mode, deposit, faucet, walletBalance } = useVault();
  const { open: connect } = useConnectModal();
  const [depositing, setDepositing] = useState(false);
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
              <Button variant="secondary" size="lg" onClick={() => (mode === "live" ? setDepositing(true) : connect())}>
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
        {mode === "sample" && (
          <p className="relative mt-6 border-t border-line-soft pt-4 text-[13px] text-muted">
            This is a preview.{" "}
            <button type="button" onClick={connect} className="font-medium text-fg underline-offset-4 hover:underline">
              Connect a wallet
            </button>{" "}
            to open your own vault on devnet.
          </p>
        )}
      </section>

      {depositing && deposit && faucet && <DepositSheet balance={walletBalance ?? null} decimals={vault.decimals} onDeposit={deposit} onFaucet={faucet} onClose={() => setDepositing(false)} />}

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

/** Move test dUSDC from the wallet into the vault, with a faucet button for test money. */
function DepositSheet({ balance, decimals, onDeposit, onFaucet, onClose }: { balance: bigint | null; decimals: number; onDeposit: (a: bigint) => Promise<unknown>; onFaucet: () => Promise<unknown>; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const parsed = parseAmountInput(amount, decimals);
  const tooMuch = parsed !== null && balance !== null && parsed > balance;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-[#0b1020]/35 p-3 backdrop-blur-sm sm:items-center" onClick={onClose} role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="deposit-title" onClick={(e) => e.stopPropagation()} className="enter w-full max-w-[420px] rounded-[28px] bg-white p-6 shadow-[0_40px_80px_-30px_rgba(15,23,42,0.5)] sm:p-7">
        <div className="flex items-start justify-between">
          <h2 id="deposit-title" className="font-serif text-[30px] leading-tight">
            Deposit
          </h2>
          <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-full text-muted hover:bg-panel hover:text-fg" aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>
        <p className="mt-1 text-[14px] text-muted">Move test dUSDC from your wallet into the vault.</p>

        <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl bg-panel px-4 py-3">
          <div>
            <div className="text-[12.5px] text-muted">In your wallet</div>
            <div className="num text-[17px] font-medium">{balance === null ? "…" : formatAmount(balance, decimals)} dUSDC</div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onFaucet();
              setBusy(false);
            }}
          >
            <Icon name="plus" size={13} /> Get 1,000 test dUSDC
          </Button>
        </div>

        <label className="mt-5 block">
          <span className="text-[13.5px] text-muted">Amount</span>
          <div className="mt-1.5 flex items-baseline gap-3 border-b border-line-strong pb-2.5 focus-within:border-fg">
            <AmountInput value={amount} onValue={setAmount} decimals={decimals} placeholder="0" autoFocus className="num w-full min-w-0 bg-transparent text-[36px] leading-none font-medium outline-none placeholder:text-line-strong" />
            {balance !== null && balance > 0n && (
              <button type="button" onClick={() => setAmount(amountForInput(formatAmount(balance, decimals, decimals)))} className="text-[13px] text-muted hover:text-fg">
                Max
              </button>
            )}
          </div>
        </label>
        {tooMuch && <p className="mt-2 text-[13px] text-threat-soft">That is more than your wallet holds.</p>}

        <Button
          variant="primary"
          size="lg"
          className="mt-6 w-full"
          disabled={!parsed || parsed <= 0n || tooMuch || busy}
          onClick={async () => {
            setBusy(true);
            await onDeposit(parsed!);
            setBusy(false);
            onClose();
          }}
        >
          {busy ? "Approve in your wallet…" : "Deposit"}
        </Button>
      </div>
    </div>
  );
}
