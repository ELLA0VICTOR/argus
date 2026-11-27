import { strict as assert } from 'node:assert';
import { HOSTED_SENTINEL_DEMO_URL, SentinelDemoClient, DemoEventCursor, type DemoEvent } from '../src/sentinel/demo.ts';

// Disposable demo-owner signing only. No user wallet, AI key file, storage or secret output.
const base = process.argv[2] ?? HOSTED_SENTINEL_DEMO_URL;
const client = new SentinelDemoClient(base, fetch, true);
const abort = new AbortController();
const events: DemoEvent[] = [];
const checks: string[] = [];
let reconnect: AbortController | undefined; let connections = 0; let streamError: unknown;
const cursor = new DemoEventCursor(event => events.push(event));
try {
  await client.health();
  const session = await client.start();
  console.log(JSON.stringify({ session: session.session, setupTx: session.setupTx }));
  const stream = (async () => {
    while (!abort.signal.aborted) {
      reconnect = new AbortController();
      try {
        const response = await fetch(cursor.url(client.base, session.session), { signal: AbortSignal.any([abort.signal, reconnect.signal]) });
        assert(response.ok && response.body); connections++;
        const reader = response.body.getReader(); const text = new TextDecoder(); const decoder = cursor.decoder();
        while (true) { const part = await reader.read(); if (part.done) break; decoder.feed(text.decode(part.value, { stream: true })); }
      } catch (error) { if (!abort.signal.aborted && !reconnect.signal.aborted) throw error; }
    }
  })();
  // The rejection handler is attached immediately so deliberate stream cleanup is harmless.
  const finishedStream = stream.catch(error => { if (!abort.signal.aborted) streamError = error; });
  const drain = await client.attack('drain'); assert(!drain.ok && drain.error.code === 6004); checks.push('instant drain rejected: OverDailyLimit');
  const trusted = await client.attack('trusted'); assert(!trusted.ok && trusted.error.code === 6005); checks.push('untrusted transfer rejected: NotTrusted');
  assert((await client.attack('allowance')).ok); checks.push('daily allowance confirmed');
  const resumeDeadline = Date.now() + 15_000;
  while (!cursor.lastId && Date.now() < resumeDeadline && !streamError) await new Promise(resolve => setTimeout(resolve, 250));
  if (streamError) throw streamError;
  assert(cursor.lastId, 'hosted SSE must provide numbered events');
  const resumeFrom = cursor.lastId; reconnect?.abort();
  while (connections < 2 && Date.now() < resumeDeadline && !streamError) await new Promise(resolve => setTimeout(resolve, 250));
  if (streamError) throw streamError;
  assert(connections >= 2); checks.push(`numbered live stream reconnected after event ${resumeFrom}`);
  assert((await client.attack('request')).ok); checks.push('delayed request confirmed');
  const callDeadline = Date.now() + 30_000;
  while (!events.some(e => e.type === 'incoming') && Date.now() < callDeadline) await new Promise(resolve => setTimeout(resolve, 250));
  if (streamError) throw streamError;
  assert(events.some(e => e.type === 'incoming'));
  await client.decide('cancel');
  const deadline = Date.now() + 90_000;
  while (!events.some(e => e.type === 'state' && e.frozen) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 500));
  if (streamError) throw streamError;
  assert(events.some(e => e.type === 'risk' && e.level === 'critical'));
  assert(events.some(e => e.type === 'tx' && e.by === 'argus' && /cancel/i.test(e.label))); checks.push('Sentinel cancellation confirmed');
  assert(events.some(e => e.type === 'state' && e.frozen)); checks.push('Sentinel freeze confirmed');
  const frozen = await client.attack('allowance'); assert(!frozen.ok && frozen.error.code === 6000); checks.push('post-freeze allowance rejected: Frozen');
  abort.abort(); await finishedStream;
  console.log(JSON.stringify({ passed: checks.length, checks, eventCount: events.length, streamConnections: connections, lastEventId: cursor.lastId, submittedBy: 'disposable devnet demo owner; no MWA user wallet' }, null, 2));
} finally { abort.abort(); client.dispose(); }
