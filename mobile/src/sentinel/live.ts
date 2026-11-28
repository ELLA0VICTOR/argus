import { PublicKey } from '@solana/web3.js';
import type { SentinelAlert, WatchLog } from './types.ts';
import { RESERVED_PROGRAM_ID, signatureFromSignedPayload } from './rules.ts';

export const HOSTED_SENTINEL_URL = 'https://argus-sentinel-six.vercel.app';
export type LiveAlert = SentinelAlert & { act_at: number | null };
const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;
const uint = (value: unknown): value is string => typeof value === 'string' && value.length <= 20 && /^\d+$/.test(value) && BigInt(value) <= (1n << 64n) - 1n;
const time = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const address = (value: unknown): value is string => {
  try { return typeof value === 'string' && new PublicKey(value).toBase58() === value; } catch { return false; }
};

/** Only the live public-read/signed-dismissal API; never silently fall back to sample data. */
export class LiveSentinel {
  readonly base: string;
  private fetcher: typeof fetch;
  constructor(base = HOSTED_SENTINEL_URL, fetcher: typeof fetch = fetch) {
    const parsed = new URL(base);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Use an HTTPS Sentinel address.');
    this.base = parsed.toString().replace(/\/$/, '');
    this.fetcher = fetcher;
  }
  private async request(path: string, body?: unknown): Promise<any> {
    const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), path === '/v1/faucet' ? 45_000 : 15_000);
    try {
      const response = await this.fetcher(this.base + path, { method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json' }, signal: abort.signal, redirect: 'error',
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data?.error?.message === 'string' ? data.error.message : 'Argus could not complete this request.');
      return data;
    } finally { clearTimeout(timer); }
  }
  async health() {
    const data = await this.request('/v1/health');
    if (data.ok !== true || data.cluster !== 'devnet' || data.program_id !== RESERVED_PROGRAM_ID || !address(data.ai_guardian) || !address(data.test_mint)) throw new Error('Sentinel does not match the devnet app.');
    return data as { ok: true; cluster: 'devnet'; program_id: string; ai_guardian: string; test_mint: string };
  }
  async alerts(vault: string, all = false): Promise<LiveAlert[]> {
    if (!address(vault)) throw new Error('Invalid vault address.');
    const data = await this.request(`/v1/vaults/${vault}/alerts?status=${all ? 'all' : 'open'}`);
    if (!Array.isArray(data?.alerts) || data.alerts.length > 100) throw new Error('Argus returned an invalid alert list.');
    return data.alerts.map((a: any) => {
      const w = a?.withdrawal; const t = a?.token;
      if (!idPattern.test(a?.id ?? '') || a.vault !== vault || a.kind !== 'withdrawal' || !w || !t ||
        !address(w.pda) || !uint(w.id) || !uint(w.amount) || !address(w.destination) || !address(w.destination_owner) ||
        !time(w.requested_at) || !time(w.executes_at) || w.executes_at < w.requested_at || !time(a.created_at) ||
        !address(t.mint) || !Number.isInteger(t.decimals) || t.decimals < 0 || t.decimals > 255 || (t.symbol !== null && typeof t.symbol !== 'string') ||
        !['low', 'medium', 'high', 'critical'].includes(a.risk) || !['open', 'cancelled', 'executed', 'dismissed', 'voided'].includes(a.status) ||
        !Number.isFinite(a.score) || a.score < 0 || a.score > 100 || typeof a.reason !== 'string' || a.reason.length > 4000 ||
        !Array.isArray(a.signals) || a.signals.length > 20 || a.signals.some((s: any) => typeof s?.id !== 'string' || typeof s.label !== 'string' || s.label.length > 500 || !Number.isFinite(s.weight)) ||
        (a.act_at != null && !time(a.act_at))) throw new Error('Argus returned an invalid alert.');
      return { ...a, act_at: a.act_at ?? null, actions: a.actions ?? [], call: a.call ?? { status: 'none', outcome: 'none', transcript: [] } } as LiveAlert;
    });
  }
  async watchlog(vault: string): Promise<WatchLog['entries']> {
    if (!address(vault)) throw new Error('Invalid vault address.');
    const data = await this.request(`/v1/vaults/${vault}/watchlog`);
    if (!Array.isArray(data?.entries) || data.entries.length > 100 || data.entries.some((e: any) => !time(e?.at) || typeof e.type !== 'string' || typeof e.text !== 'string' || e.text.length > 4000)) throw new Error('Argus returned an invalid activity list.');
    return data.entries;
  }
  async dismiss(vault: string, id: string, wallet: string, sign: (message: Uint8Array) => Promise<Uint8Array>, now = Date.now(), validate?: (alert: LiveAlert) => boolean) {
    if (!address(wallet) || !idPattern.test(id)) throw new Error('Invalid alert decision.');
    // Fetch by the vault, not untrusted notification fields. The server rechecks membership and critical-alert role.
    const alert = (await this.alerts(vault)).find(a => a.id === id && a.status === 'open');
    if (!alert || (validate && !validate(alert))) throw new Error('This alert is no longer open or its withdrawal changed.');
    const ts = Math.floor(now / 1000);
    const text = new TextEncoder().encode(`Argus: it was me. Dismiss alert ${id} at ${ts}`);
    const payload = await sign(text);
    const signature = signatureFromSignedPayload(payload, text, wallet);
    return this.request(`/v1/alerts/${id}/dismiss`, { wallet, signature, ts });
  }
  async faucet(wallet: string) {
    if (!address(wallet)) throw new Error('Invalid wallet address.');
    await this.health();
    const data = await this.request('/v1/faucet', { wallet });
    if (data?.ok !== true || typeof data.sig !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(data.sig)) throw new Error('Could not verify the faucet response. Check your wallet before retrying.');
    return data as { ok: true; sig: string; dusdc: string; sol: number };
  }
}
