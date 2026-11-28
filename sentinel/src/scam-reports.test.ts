import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupScamReports, reportUrl } from './scam-reports.ts';
const address = 'DDZHZxxtYEwjttMJMoipr7tXuyPy6BmCCu4ECUi8Jppm';
const reply = (web: unknown[]) => async () => new Response(JSON.stringify({ success: true, data: { web } }));
test('report evidence requires exact address and approved HTTPS source', async () => {
  const r = await lookupScamReports(address, { apiKey: 'test', fetcher: reply([
    { url: 'https://chainabuse.com/report/example', title: 'Reported phishing address', markdown: address },
    { url: 'https://chainabuse.com.evil.test/report', title: 'scam ' + address },
    { url: 'https://rekt.news/example', title: 'Scam involving ' + address + 'A' },
    { url: 'https://rekt.news/other', title: 'Unrelated scam' },
  ]) });
  assert.equal(r.status, 'matches'); assert.equal(r.sources.length, 1);
  assert.equal(reportUrl('javascript:alert(1)'), null); assert.equal(reportUrl('https://user:pass@chainabuse.com/x'), null);
});
test('missing service, no reports and service failure are distinct; none means safe', async () => {
  assert.equal((await lookupScamReports(address, { apiKey: '' })).status, 'unconfigured');
  assert.equal((await lookupScamReports(address, { apiKey: 'test', fetcher: reply([]) })).status, 'no_matches');
  assert.equal((await lookupScamReports(address, { apiKey: 'test', fetcher: async () => new Response('', { status: 429 }) })).status, 'unavailable');
  assert.equal((await lookupScamReports(address, { apiKey: 'test', fetcher: async () => { throw new Error('offline'); } })).status, 'unavailable');
});
test('invalid address and oversized response cannot become evidence', async () => {
  await assert.rejects(lookupScamReports('not a wallet', { apiKey: 'test' }));
  const r = await lookupScamReports(address, { apiKey: 'test', fetcher: async () => new Response('x'.repeat(512001)) });
  assert.equal(r.status, 'unavailable');
});
