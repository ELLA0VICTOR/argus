/** The program uses a reset window, not a rolling allowance. Amounts stay in base units. */
export function allowanceRemaining(limit: bigint, spent: bigint, windowStart: bigint, now: bigint): bigint {
  if (now >= windowStart + 86_400n) return limit;
  return spent >= limit ? 0n : limit - spent;
}

export function allowanceFraction(remaining: bigint, limit: bigint): number {
  if (limit <= 0n || remaining <= 0n) return 0;
  if (remaining >= limit) return 1;
  return Number(remaining * 10_000n / limit) / 10_000;
}

export function waitFraction(requestedAt: number, executesAt: number, now: number): number {
  if (now >= executesAt) return 1;
  if (now <= requestedAt || executesAt <= requestedAt) return 0;
  return (now - requestedAt) / (executesAt - requestedAt);
}

export function delayLabel(seconds: bigint): string {
  if (seconds % 86_400n === 0n && seconds !== 86_400n) return `${seconds / 86_400n}d`;
  if (seconds % 3_600n === 0n) return `${seconds / 3_600n}h`;
  if (seconds % 60n === 0n) return `${seconds / 60n}m`;
  return `${seconds}s`;
}
