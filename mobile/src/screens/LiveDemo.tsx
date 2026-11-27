import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, BackHandler, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Copy, Label, Logo, Panel, Status, common } from '../components/ui';
import { DawnHero } from '../components/DawnHero';
import { GuardianCall } from '../components/GuardianCall';
import { ActivityTimeline } from '../components/VaultPatterns';
import { makeDemoClient } from '../sentinel/demoRuntime';
import { userMessage } from '../domain/userMessage';
import type { AttackKind, AttackResult, DemoEvent, DemoSession, SentinelDemoClient } from '../sentinel/demo';
import { listenForDemoEvents } from '../services/demoEvents';
import { transactionUrl } from '../program/transactions';
import { colors as c, fonts as f } from '../theme';

const moves: { kind: AttackKind; title: string; body: string }[] = [
  { kind: 'drain', title: 'Take everything, right now', body: 'Withdraw all 12,000 instantly.' },
  { kind: 'trusted', title: 'Send it to a “trusted” address', body: 'Trusted sends skip the wait. Is your wallet trusted?' },
  { kind: 'allowance', title: 'Take the daily allowance', body: 'Small spending goes through instantly.' },
  { kind: 'request', title: 'Request a withdrawal of everything', body: "The real heist. It has to wait 24 hours, so let's see if anyone notices." },
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
    } catch (e) { setError(userMessage(e, 'Could not start the live demo. Please try again.')); }
    finally { locked.current = false; setBusy(false); }
  }
  async function play(kind: AttackKind) {
    if (locked.current || !client.current) return; locked.current = true; setBusy(true); setError(null);
    try { const result = await client.current.attack(kind); setResults(previous => ({ ...previous, [kind]: result })); }
    catch (e) { setError(userMessage(e, 'This move did not complete. Check the activity before trying again.')); }
    finally { locked.current = false; setBusy(false); }
  }
  async function decide(value: 'cancel' | 'allow') {
    if (locked.current || !client.current) return; locked.current = true; setBusy(true); setError(null);
    try { await client.current.decide(value); }
    catch (e) { setError(userMessage(e, 'Could not deliver your decision. Please try again.')); }
    finally { locked.current = false; setBusy(false); }
  }
  return <SafeAreaView style={s.root}><View style={s.header}><Logo threat={!!risk && !state?.frozen && ['high', 'critical'].includes(risk.level)} /><Pressable accessibilityRole="button" disabled={busy || callOpen} onPress={onExit} style={{ minHeight: 44, justifyContent: 'center' }}><Copy style={{ color: c.muted, fontFamily: f.medium }}>Open app</Copy></Pressable></View>
    <ScrollView contentContainerStyle={s.content}>
      <DawnHero demo><Button title={session ? 'Start over with a new vault' : 'Hand me the stolen key'} busy={busy && !session} busyTitle="Creating your vault on devnet…" disabled={busy || callOpen} onPress={() => { void start(); }} />
        <Copy style={{ color: '#ffffff', textAlign: 'center', fontSize: 13 }}>No wallet or sign-up needed. Test tokens only.</Copy>
      </DawnHero>
      {error && <Copy accessibilityRole="alert" style={common.muted}>{error}</Copy>}
      {session && <>
        {incoming && !decisionMade && !state?.frozen && <Panel style={{ borderColor: c.threat }}><Label>Argus is checking with you</Label>
          <Copy style={common.amount}>{incoming.amount}</Copy><Copy style={common.muted}>{incoming.reason}</Copy>
          <Copy>Now play the vault owner. Did you request this withdrawal? If nobody answers, Sentinel will cancel automatically.</Copy>
          <Button title="Cancel this demo withdrawal" tone="threat" disabled={busy} onPress={() => { void decide('cancel'); }} />
          <Button title="Yes, this was me" tone="quiet" disabled={busy} onPress={() => Alert.alert('Was this your withdrawal?', 'Allowing it leaves the request pending for its original 24-hour delay. It does not execute it now.', [{ text: 'Go back', style: 'cancel' }, { text: 'Confirm it was me', onPress: () => { void decide('allow'); } }])} />
        </Panel>}
        <Label>You, the thief</Label>
        <View style={common.row}>{[{ label: 'In the vault', value: state?.vault ?? '12000' }, { label: 'In your pocket', value: state?.thief ?? '0' }].map(balance => <Panel key={balance.label} style={{ flex: 1, padding: 16, gap: 8 }}><Copy style={[common.muted, { fontSize: 12 }]}>{balance.label}</Copy><Copy style={[common.num, { fontSize: 24 }]}>{decimal(balance.value)}</Copy><Copy style={[common.muted, { fontSize: 12 }]}>dUSDC</Copy></Panel>)}</View>
        <Copy style={{ fontFamily: f.semibold, fontSize: 15 }}>Your moves</Copy>
        {moves.map(move => <Panel key={move.kind} style={{ padding: 16, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}><View style={{ flex: 1, gap: 6 }}><Copy style={{ fontFamily: f.medium, fontSize: 15 }}>{move.title}</Copy><Copy style={[common.muted, { fontSize: 13 }]}>{move.body}</Copy></View>
            <Button title={results[move.kind] ? 'Again' : 'Try it'} tone={move.kind === 'request' ? 'neutral' : 'secondary'} disabled={busy || callOpen} onPress={() => { void play(move.kind); }} />
          </View>
          {results[move.kind] && <Copy accessibilityRole="alert" style={{ fontSize: 13 }}>{results[move.kind]!.ok ? 'It went through.' : `Blocked by the Argus program. ${userMessage((results[move.kind] as Extract<AttackResult, { ok: false }>).error.msg, 'This move was rejected.')}`}</Copy>}
        </Panel>)}
        {risk && <Panel><Label>Argus, the guardian</Label><Copy>{risk.score}/100 · {risk.level}</Copy><Copy style={common.muted}>{userMessage(risk.reason, 'Argus flagged this withdrawal.')}</Copy>{risk.signals.map((signal, index) => <Copy key={index}>{signal.label}</Copy>)}</Panel>}
        <View style={common.row}><Label>Live watch log</Label><Copy style={[common.muted, { fontSize: 12 }]}>{state?.frozen ? 'Vault frozen' : stream === 'Connected to Sentinel' ? 'Watching' : 'Connecting…'}</Copy></View>
        <Panel><ActivityTimeline entries={events.flatMap((event, index) => {
          const title = event.type === 'tx' ? event.label : event.type === 'log' ? event.text : event.type === 'call' ? `${event.who === 'argus' ? 'Argus' : 'You'}: ${event.text}`
            : event.type === 'decision' ? event.decision === 'allow' ? 'The owner recognised the withdrawal; its delay still applies.' : event.decision === 'timeout' ? 'No answer. Argus is protecting the vault.' : 'The owner asked to cancel.' : null;
          return title ? [{ id: String(index), title: userMessage(title, 'Argus checked the vault.'), detail: new Date(event.t).toLocaleTimeString(), done: event.type === 'tx',
            ...(event.type === 'tx' ? { onPress: () => { void Linking.openURL(transactionUrl(event.sig)).catch(() => setError('Could not open Explorer.')); } } : {}) }] : [];
        }).reverse()} /></Panel>
      </>}
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
const s = StyleSheet.create({ root: { flex: 1, backgroundColor: c.canvas }, header: { backgroundColor: c.ink, paddingHorizontal: 20, height: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32, gap: 20 } });
