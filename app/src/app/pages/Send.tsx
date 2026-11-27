import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Icon } from "../../components/Icon";
import { Button } from "../../components/ui";
import { formatAmount, formatDuration, shortAddr } from "../../lib/format";
import { Container, PageHeader } from "../Shell";
import { useVault, type SendPath } from "../store";

const ROUTES: { id: SendPath; label: string; hint: string }[] = [
  { id: "instant", label: "Instant", hint: "Within today's allowance" },
  { id: "trusted", label: "Trusted", hint: "To an address you trust" },
  { id: "delayed", label: "Waits", hint: "Cancellable until it leaves" },
];

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** "12.5" → 12_500_000n (6 decimals). null if invalid. */
function parseAmount(s: string, decimals: number): bigint | null {
  const t = s.replace(/,/g, "").trim();
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return null;
  const [w, f = ""] = t.split(".");
  if (f.length > decimals) return null;
  return BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
}

export default function Send() {
  const { vault, send, role, txs } = useVault();
  const [amountStr, setAmountStr] = useState("");
  const [dest, setDest] = useState("");
  const [review, setReview] = useState(false);
  const [done, setDone] = useState<SendPath | null>(null);

  const amount = parseAmount(amountStr, vault.decimals);
  const remaining = vault.dailyLimit > vault.spentInWindow ? vault.dailyLimit - vault.spentInWindow : 0n;
  const trusted = vault.trusted.find((t) => t.wallet === dest.trim() && t.activeAt <= Date.now() / 1000);
  const destValid = BASE58.test(dest.trim());

  const path: SendPath | null = useMemo(() => {
    if (!amount || amount <= 0n || !destValid) return null;
    if (trusted) return "trusted";
    if (amount <= remaining) return "instant";
    return "delayed";
  }, [amount, destValid, trusted, remaining]);

  let error = "";
  if (amountStr && amount === null) error = `Enter a number with up to ${vault.decimals} decimals.`;
  else if (amount !== null && amount > vault.balance) error = "That's more than the vault holds.";
  else if (dest && !destValid) error = "That doesn't look like a Solana address.";
  else if (dest.trim() === vault.address) error = "You can't send the vault to itself.";
  const busy = txs.some((t) => t.state === "pending");

  if (role !== "owner" || vault.frozen) {
    return (
      <>
        <PageHeader title="Send" />
        <Container>
          <p className="max-w-[32rem] text-[15px] leading-relaxed text-muted">
            {vault.frozen
              ? `The vault is frozen, so nothing can leave. Unfreezing takes ${vault.threshold} guardians.`
              : "Only the owner key can send. Guardians can't move funds anywhere except a sweep to your safe address, which keeps a single compromised guardian harmless."}
          </p>
        </Container>
      </>
    );
  }

  if (done) {
    return (
      <>
        <PageHeader title={done === "delayed" ? "Withdrawal requested" : "Sent"} />
        <Container>
          <p className="max-w-[32rem] text-[15px] leading-relaxed text-muted">
            {done === "delayed"
              ? `It leaves in ${formatDuration(vault.delay)}. Until then you, a guardian or the AI can cancel it from Home.`
              : `${formatAmount(amount!, vault.decimals)} ${vault.symbol} is on its way to ${trusted?.label ?? shortAddr(dest)}.`}
          </p>
          <div className="mt-8 flex gap-2">
            <Link to="/app" className="press inline-flex min-h-11 items-center rounded-xl border border-line-strong px-5 text-[14px] hover:bg-panel">
              Back home
            </Link>
            <Button
              variant="ghost"
              onClick={() => {
                setDone(null);
                setReview(false);
                setAmountStr("");
                setDest("");
              }}
            >
              Send another
            </Button>
          </div>
        </Container>
      </>
    );
  }

  const explain =
    path === "trusted"
      ? "Goes now. This is one of your trusted addresses."
      : path === "instant"
        ? "Goes now. It fits within today's allowance."
        : path === "delayed"
          ? (
              <>
                Waits <span className="num text-wait">{formatDuration(vault.delay)}</span>, then goes. You can cancel it until then.
              </>
            )
          : null;

  return (
    <>
      <PageHeader title="Send" />
      <Container>
        <div className="max-w-[600px] rounded-[28px] border border-line bg-white p-6 shadow-[0_24px_60px_-40px_rgba(23,37,84,0.35)] sm:p-8">
          {/* amount */}
          <label className="block">
            <span className="text-[13.5px] text-muted">Amount</span>
            <div className="mt-2 flex items-baseline gap-3 border-b border-line-strong pb-3 focus-within:border-fg">
              <input
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={amountStr}
                disabled={review}
                onChange={(e) => setAmountStr(e.target.value)}
                className="num w-full min-w-0 bg-transparent text-[44px] leading-none font-medium outline-none placeholder:text-line-strong"
              />
              <span className="text-[17px] text-muted">{vault.symbol}</span>
            </div>
          </label>
          <div className="mt-2.5 flex justify-between text-[13px] text-muted">
            <span>
              Instant today: <span className="num text-fg">{formatAmount(remaining, vault.decimals)}</span>
            </span>
            <button type="button" disabled={review} onClick={() => setAmountStr(formatAmount(vault.balance, vault.decimals, vault.decimals).replace(/,/g, ""))} className="hover:text-fg">
              Max {formatAmount(vault.balance, vault.decimals)}
            </button>
          </div>

          {/* destination */}
          <label className="mt-10 block">
            <span className="text-[13.5px] text-muted">To</span>
            <input
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste a Solana address"
              value={dest}
              disabled={review}
              onChange={(e) => setDest(e.target.value)}
              className="mt-2 w-full border-b border-line-strong bg-transparent pb-3 font-mono text-[15px] outline-none placeholder:font-sans placeholder:text-faint focus:border-fg"
            />
          </label>
          {vault.trusted.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {vault.trusted.map((t) => (
                <button
                  key={t.wallet}
                  type="button"
                  disabled={review}
                  onClick={() => setDest(t.wallet)}
                  className={`press inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[13px] ${dest === t.wallet ? "border-brand bg-brand-soft text-brand" : "border-line text-muted hover:text-fg"}`}
                >
                  {dest === t.wallet && <Icon name="check" size={13} />}
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {/* how it'll go */}
          <div className="mt-10 rounded-2xl bg-panel p-4">
            <div className="grid grid-cols-3 gap-1.5" aria-hidden="true">
              {ROUTES.map((r) => {
                const on = path === r.id;
                return (
                  <div key={r.id} className={`rounded-xl px-2.5 py-2.5 transition-all sm:px-3 duration-300 ${on ? "bg-white shadow-[0_6px_20px_-10px_rgba(23,37,84,0.35)] ring-1 ring-line" : ""}`}>
                    <div className={`text-[13px] font-medium ${on ? (r.id === "delayed" ? "text-wait" : "text-fg") : "text-faint"}`}>{r.id === "delayed" ? `Waits ${formatDuration(vault.delay)}` : r.label}</div>
                    <div className={`mt-0.5 hidden text-[12px] leading-snug sm:block ${on ? "text-muted" : "text-faint/80"}`}>{r.hint}</div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 min-h-[22px] px-1">
              {error ? (
                <p className="text-[14px] text-threat-soft">{error}</p>
              ) : explain ? (
                <p key={path} className="fade-in text-[14.5px]">
                  {explain}
                </p>
              ) : (
                <p className="text-[14px] text-muted">Argus tells you how it'll go before you sign anything.</p>
              )}
            </div>
          </div>

          <div className="mt-7 flex gap-2">
            {!review ? (
              <Button variant="primary" size="lg" disabled={!path || !!error} onClick={() => setReview(true)}>
                Continue
              </Button>
            ) : (
              <>
                <Button
                  variant="primary"
                  size="lg"
                  disabled={busy}
                  onClick={async () => {
                    await send({ amount: amount!, destination: dest.trim(), path: path! });
                    setDone(path);
                  }}
                >
                  {busy ? "Confirm in your wallet…" : path === "delayed" ? `Request ${formatAmount(amount!, vault.decimals)} ${vault.symbol}` : `Send ${formatAmount(amount!, vault.decimals)} ${vault.symbol}`}
                </Button>
                <Button variant="ghost" size="lg" disabled={busy} onClick={() => setReview(false)}>
                  Edit
                </Button>
              </>
            )}
          </div>
        </div>
      </Container>
    </>
  );
}
