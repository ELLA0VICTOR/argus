/** Formatting helpers. Amounts are always bigint base units, never JS floats. */

export function formatAmount(base: bigint, decimals: number, maxFraction = 2): string {
  const neg = base < 0n;
  const v = neg ? -base : base;
  const unit = 10n ** BigInt(decimals);
  const whole = v / unit;
  const frac = v % unit;
  let fracStr = frac.toString().padStart(decimals, "0").slice(0, maxFraction);
  fracStr = fracStr.padEnd(maxFraction, "0");
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${wholeStr}${maxFraction > 0 ? "." + fracStr : ""}`;
}

export function shortAddr(addr: string, head = 4, tail = 4): string {
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

/** 86_399 → "23:59:59". Days roll into hours past 24h ("47:12:03"). */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
}

export function formatDuration(seconds: number): string {
  // Up to two days reads better in hours ("24h", "48h").
  if (seconds % 3_600 === 0 && seconds <= 48 * 3_600) return `${seconds / 3_600}h`;
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

export function clockTime(unix: number): string {
  const d = new Date(unix * 1000);
  return d.toLocaleTimeString("en-GB", { hour12: false });
}

export function explorerTx(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

export function explorerAddr(addr: string): string {
  return `https://explorer.solana.com/address/${addr}?cluster=devnet`;
}
