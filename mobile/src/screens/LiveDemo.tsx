import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, BackHandler, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Copy, Label, Logo, Panel, Status, common } from '../components/ui';
import { DawnHero } from '../components/DawnHero';
import { GuardianCall } from '../components/GuardianCall';
import { makeDemoClient, sentinelDemoUrl } from '../sentinel/demoRuntime';
import type { AttackKind, AttackResult, DemoEvent, DemoSession, SentinelDemoClient } from '../sentinel/demo';
import { listenForDemoEvents } from '../services/demoEvents';
import { transactionUrl } from '../program/transactions';
import { colors as c } from '../theme';

const moves: { kind: AttackKind; title: string; body: string }[] = [
  { kind: 'drain', title: 'Take everything now', body: 'Try moving the whole balance instantly.' },
  { kind: 'trusted', title: 'Try a trusted transfer', body: 'Try bypassing the delay with an untrusted wallet.' },
  { kind: 'allowance', title: 'Take the daily allowance', body: 'Small spending can leave within the daily limit.' },
  { kind: 'request', title: 'Request the remaining balance', body: 'Start the real countdown and watch Sentinel respond.' },
];
const decimal = (value: string) => { const [whole, fraction = '00'] = value.split('.'); return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`; };

export function LiveDemo({ onExit, onBusy }: { onExit: () => void; onBusy: (busy: boolean) => void }) {
  const client = useRef<SentinelDemoClient | null>(null);
  const [session, setSession] = useState<DemoSession | null>(null);
  const [events, setEvents] = useState<DemoEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState('Waiting to start');
  const [results, setResults] = useState<Partial<Record<AttackKind, AttackResult>>>({});
  const [dismissedCall, setDismissedCall] = useState('');
  useEffect(() => { const sub = BackHandler.addEventListener('hardwareBackPress', () => { if (!busy) onExit(); return true; }); return () => sub.remove(); }, [busy, onExit]);
  const state = [...events].reverse().find((event): event is Extract<DemoEvent, { type: 'state' }> => event.type === 'state');
  const risk = [...events].reverse().find((event): event is Extract<DemoEvent, { type: 'risk' }> => event.type === 'risk');
  const incoming = [...events].reverse().find((event): event is Extract<DemoEvent, { type: 'incoming' }> => event.type === 'incoming');
  const decision = incoming ? [...events].reverse().find((event): event is Extract<DemoEvent, { type: 'decision' }> => event.type === 'decision' && event.t >= incoming.t) : undefined;
  const decisionMade = !!decision;
  const callId = session && incoming ? `demo:${session.session}:${incoming.t}` : '';
  const callOpen = !!session && !!incoming && callId !== dismissedCall;
  useEffect(() => { onBusy(busy || callOpen); }, [busy, callOpen, onBusy]);
  useEffect(() => () => { client.current?.dispose(); client.current = null; }, []);
  useEffect(() => {
    if (!session || !client.current) return;
    return listenForDemoEvents(client.current.base, session.session, event => setEvents(previous => [...previous, event].slice(-500)), setStream);
  }, [session]);
  useEffect(() => { const subscription = AppState.addEventListener('change', state => { if (state === 'background') setStream('Live events pause while Argus is in the background.'); }); return () => subscription.remove(); }, []);

  async function start() {
    if (locked.current) return; locked.current = true; setBusy(true); setError(null); setSession(null); setEvents([]); setResults({});
    try {
      client.current?.dispose(); const api = makeDemoClient(); client.current = api;
      const current = await api.start(); setSession(current); setEvents([]); setResults({});
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not start the live demo.'); }
    finally { locked.current = false; setBusy(false); }
  }
  async function play(kind: AttackKind) {
    if (locked.current || !client.current) return; locked.current = true; setBusy(true); setError(null);
    try { const result = await client.current.attack(kind); setResults(previous => ({ ...previous, [kind]: result })); }
    catch (e) { setError(e instanceof Error ? e.message : 'This move did not complete. Check the live log before trying again.'); }
    finally { locked.current = false; setBusy(false); }
  }
  async function decide(value: 'cancel' | 'allow') {
    if (locked.current || !client.current) return; locked.current = true; setBusy(true); setError(null);
    try { await client.current.decide(value); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not deliver your demo decision.'); }
    finally { locked.current = false; setBusy(false); }
  }
  return <SafeAreaView style={s.root}><View style={s.header}><Logo threat={!!risk && !state?.frozen && ['high', 'critical'].includes(risk.level)} /><Status text="Live devnet demo" /></View>
    <ScrollView contentContainerStyle={s.content}>
      <DawnHero /><Copy style={common.title}>Try stealing this vault.</Copy>
      <Copy style={common.muted}>Real devnet transactions, test tokens only. This demo uses a disposable owner key in memory. Your connected wallet is never used. When Argus calls, answer over the internet or use the decision buttons.</Copy>
      <Button title={session ? 'Create another demo vault' : 'Start the live demo'} busy={busy && !session} disabled={busy} onPress={() => { void start(); }} />
      {!sentinelDemoUrl && <Copy style={common.muted}>Configure a phone-reachable Sentinel demo URL to start.</Copy>}
      {error && <Panel><Copy accessibilityRole="alert">{error}</Copy></Panel>}
      {session && <>
        {incoming && !decisionMade && !state?.frozen && <Panel style={{ borderColor: c.threat }}><Label>Argus is checking with you</Label>
          <Copy style={common.amount}>{incoming.amount}</Copy><Copy style={common.muted}>{incoming.reason}</Copy>
          <Copy>Now play the vault owner. Did you request this withdrawal? If nobody answers, Sentinel will cancel automatically.</Copy>
          <Button title="Cancel this demo withdrawal" tone="threat" disabled={busy} onPress={() => { void decide('cancel'); }} />
          <Button title="Yes, this was me" tone="quiet" disabled={busy} onPress={() => Alert.alert('Was this your withdrawal?', 'Allowing it leaves the request pending for its original 24-hour delay. It does not execute it now.', [{ text: 'Go back', style: 'cancel' }, { text: 'Confirm it was me', onPress: () => { void decide('allow'); } }])} />
        </Panel>}
        <Panel><Label>Your demo vault</Label><Copy selectable style={common.mono}>{session.vault}</Copy>
          <Copy style={common.amount}>{decimal(state?.vault ?? '12000')} dUSDC</Copy>
          <Copy style={common.muted}>Moved to the attacker: {decimal(state?.thief ?? '0')} dUSDC</Copy>
          <Status text={state?.frozen ? 'Frozen on-chain' : stream} tone={state?.frozen ? 'safe' : 'neutral'} />
        </Panel>
        {moves.map(move => <Panel key={move.kind}><Copy style={{ fontSize: 19 }}>{move.title}</Copy><Copy style={common.muted}>{move.body}</Copy>
          <Button title="Try this move" tone="secondary" disabled={busy} onPress={() => { void play(move.kind); }} />
          {results[move.kind] && <Copy accessibilityRole="alert">{results[move.kind]!.ok ? 'Transaction confirmed. See the live log.' : (results[move.kind] as Extract<AttackResult, { ok: false }>).error.msg}</Copy>}
        </Panel>)}
        {risk && <Panel><Label>Sentinel’s assessment</Label><Copy>{risk.score}/100 · {risk.level}</Copy><Copy style={common.muted}>{risk.reason}</Copy>{risk.signals.map((signal, index) => <Copy key={index}>{signal.label}</Copy>)}</Panel>}
        <Label>Live watch log</Label><Copy style={common.muted}>{stream}</Copy>
        {events.map((event, index) => <Panel key={index}><Copy style={common.num}>{new Date(event.t).toLocaleTimeString()}</Copy>
          {event.type === 'tx' ? <><Copy>{event.label}</Copy><Button title="View confirmed transaction" tone="quiet" onPress={() => { void Linking.openURL(transactionUrl(event.sig)).catch(() => setError('Could not open Explorer.')); }} /></>
            : event.type === 'log' ? <Copy>{event.text}</Copy> : event.type === 'call' ? <Copy>{event.who === 'argus' ? 'Argus' : 'Owner'}: {event.text}</Copy>
            : event.type === 'attack' ? <Copy>{event.ok ? 'Move confirmed on devnet.' : event.error?.msg ?? 'The program rejected this move.'}</Copy>
            : event.type === 'state' ? <Copy>{event.frozen ? 'Outgoing transfers are frozen.' : `${event.pending} pending requests.`}</Copy>
            : event.type === 'incoming' ? <Copy>Argus is asking the owner about {event.amount}.</Copy>
            : event.type === 'decision' ? <Copy>{event.decision === 'cancel' ? 'The owner asked to cancel.' : event.decision === 'timeout' ? 'No answer. Sentinel is taking the protective action.' : 'The owner recognised the withdrawal; its delay still applies.'}</Copy>
            : event.type === 'phone' ? <Copy>The owner’s phone is ready.</Copy>
            : <Copy>{event.reason}</Copy>}
        </Panel>)}
      </>}
      <Button title="Back to your devnet vaults" tone="quiet" disabled={busy} onPress={onExit} />
    </ScrollView>
    {callOpen && session && incoming && <GuardianCall key={callId} request={{ id: callId, ownerName: 'there', vaultName: 'Demo savings',
      amount: incoming.amount, destination: session.thief, reason: incoming.reason, expiresAt: incoming.t + incoming.timeoutSecs * 1000, demo: true }}
      outcome={decision?.decision ?? (state?.frozen ? 'closed' : undefined)}
      submit={async (value, via) => {
        if (!client.current) throw new Error('The demo session ended.');
        await client.current.decide(value, via);
        return value === 'cancel' ? 'Sentinel received your cancellation request. Check the live log for confirmation on-chain.' : 'You recognised the withdrawal. Its original delay still applies.';
      }} relay={line => client.current?.relayCall(line) ?? Promise.resolve()} onClose={() => setDismissedCall(callId)} />}
  </SafeAreaView>;
}
const s = StyleSheet.create({ root: { flex: 1, backgroundColor: c.canvas }, header: { backgroundColor: c.ink, padding: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, content: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 32, gap: 20 } });
