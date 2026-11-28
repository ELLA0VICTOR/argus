// Public-web evidence enrichment. It never selects accounts, signs, or declares
// an address safe. Exact mentions can concern victims as well as attackers.
import { PublicKey } from '@solana/web3.js';

export type ScamReports = { status: 'matches' | 'no_matches' | 'unavailable' | 'unconfigured'; checked_at: number;
  sources: { url: string; title: string }[] };
const endpoint = 'https://api.firecrawl.dev/v2/search';
const MAX_RESPONSE = 512_000;
const reportHosts = ['chainabuse.com', 'scam.sniffer.io', 'slowmist.com', 'slowmist.io', 'certik.com', 'rekt.news', 'blockaid.io'];
export function reportUrl(raw: unknown): string | null {
  try {
    const u = new URL(String(raw));
    if (u.protocol !== 'https:' || u.username || u.password || !reportHosts.some(h => u.hostname === h || u.hostname.endsWith('.' + h))) return null;
    u.hash = ''; return u.href;
  } catch { return null; }
}
export async function lookupScamReports(address: string, options: { apiKey?: string; fetcher?: typeof fetch; now?: number; timeoutMs?: number } = {}): Promise<ScamReports> {
  const canonical = new PublicKey(address).toBase58();
  if (canonical !== address) throw new Error('Expected a canonical recipient address.');
  const checked_at = Math.floor((options.now ?? Date.now()) / 1000);
  const result = (status: ScamReports['status'], sources: ScamReports['sources'] = []): ScamReports => ({ status, checked_at, sources });
  const apiKey = options.apiKey ?? process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return result('unconfigured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);
  try {
    const response = await (options.fetcher ?? fetch)(endpoint, { method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `"${address}" (scam OR drainer OR phishing OR exploit)`, limit: 5,
        includeDomains: reportHosts, scrapeOptions: { formats: ['markdown'], onlyMainContent: true } }) });
    if (!response.ok) return result('unavailable');
    const reader = response.body?.getReader(); if (!reader) return result('unavailable');
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length;
      if (size > MAX_RESPONSE) { await reader.cancel(); return result('unavailable'); } chunks.push(chunk.value); }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (data.success !== true || !Array.isArray(data.data?.web)) return result('unavailable');
    const sources: ScamReports['sources'] = [];
    const exact = new RegExp(`(^|[^1-9A-HJ-NP-Za-km-z])${address}($|[^1-9A-HJ-NP-Za-km-z])`);
    for (const entry of data.data.web.slice(0, 5)) {
      const url = reportUrl(entry.url); const text = [entry.title, entry.description, entry.markdown].filter(x => typeof x === 'string').join('\n');
      if (url && exact.test(text) && /scam|drain|phish|exploit|malicious/i.test(text) && !sources.some(s => s.url === url))
        sources.push({ url, title: String(entry.title ?? 'Public security report').slice(0, 160) });
    }
    return result(sources.length ? 'matches' : 'no_matches', sources);
  } catch { return result('unavailable'); }
  finally { clearTimeout(timer); }
}
