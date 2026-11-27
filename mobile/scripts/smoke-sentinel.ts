import { strict as assert } from 'node:assert';
import { SentinelDemoClient, DemoEventDecoder, type DemoEvent } from '../src/sentinel/demo.ts';

// Disposable demo-owner signing only. No user wallet, AI key file, storage or secret output.
const base = process.argv[2] ?? 'http://127.0.0.1:8787';
const client = new SentinelDemoClient(base, fetch, true);
const abort = new AbortController();
const events: DemoEvent[] = [];
const checks: string[] = [];
try {
  await client.health();
  const session = await client.start();
  console.log(JSON.stringify({ session: session.session, setupTx: session.setupTx }));
  const stream = (async () => {
    const response = await fetch(`${client.base}/v1/demo/${session.session}/events`, { signal: abort.signal });
    assert(response.ok && response.body);
    const reader = response.body.getReader(); const text = new TextDecoder(); const decoder = new DemoEventDecoder(event => events.push(event));
    while (true) { const part = await reader.read(); if (part.done) break; decoder.feed(text.decode(part.value, { stream: true })); }
  })();
  // The rejection handler is attached immediately so deliberate stream cleanup is harmless.
  const finishedStream = stream.catch(error => { if (!abort.signal.aborted) throw error; });
  const drain = await client.attack('drain'); assert(!drain.ok && drain.error.code === 6004); checks.push('instant drain rejected: OverDailyLimit');
  const trusted = await client.attack('trusted'); assert(!trusted.ok && trusted.error.code === 6005); checks.push('untrusted transfer rejected: NotTrusted');
  assert((await client.attack('allowance')).ok); checks.push('daily allowance confirmed');
  assert((await client.attack('request')).ok); checks.push('delayed request confirmed');
  const callDeadline = Date.now() + 30_000;
  while (!events.some(e => e.type === 'incoming') && Date.now() < callDeadline) await new Promise(resolve => setTimeout(resolve, 250));
  assert(events.some(e => e.type === 'incoming'));
  await client.decide('cancel');
  const deadline = Date.now() + 90_000;
  while (!events.some(e => e.type === 'state' && e.frozen) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 500));
  assert(events.some(e => e.type === 'risk' && e.level === 'critical'));
  assert(events.some(e => e.type === 'tx' && e.by === 'argus' && /cancel/i.test(e.label))); checks.push('Sentinel cancellation confirmed');
  assert(events.some(e => e.type === 'state' && e.frozen)); checks.push('Sentinel freeze confirmed');
  const frozen = await client.attack('allowance'); assert(!frozen.ok && frozen.error.code === 6000); checks.push('post-freeze allowance rejected: Frozen');
  abort.abort(); await finishedStream;
  console.log(JSON.stringify({ passed: checks.length, checks, eventCount: events.length, submittedBy: 'disposable devnet demo owner; no MWA user wallet' }, null, 2));
} finally { abort.abort(); client.dispose(); }
