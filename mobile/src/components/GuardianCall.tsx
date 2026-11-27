import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Alert, AppState, Modal, ScrollView, StyleSheet, Vibration, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Copy, Label, Logo, Panel, Status, common } from './ui';
import { CallDecisionGate, VoiceAttempt, type CallDecision, type CallLine, type CallRelay, type DecisionVia, type GuardianCallRequest } from '../domain/guardianCall';
import { requestCallMicrophone, type NativeVoiceProps } from '../services/voice';
import { colors as c } from '../theme';
import { countdown } from '../domain/demo';
import { userMessage } from '../domain/userMessage';

export function GuardianCall({ request, submit, relay, outcome, onClose }: {
  request: GuardianCallRequest; submit: (decision: CallDecision, via: DecisionVia) => Promise<string>;
  relay?: (line: CallRelay) => Promise<void>; outcome?: 'cancel' | 'allow' | 'timeout' | 'closed'; onClose: () => void;
}) {
  const latest = useRef({ submit, relay }); latest.current = { submit, relay };
  const [gate] = useState(() => new CallDecisionGate(request.expiresAt, (decision, via) => latest.current.submit(decision, via)));
  const [phase, setPhase] = useState<'ringing' | 'connecting' | 'live' | 'fallback' | 'resolved' | 'expired'>('ringing');
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [lines, setLines] = useState<CallLine[]>([]);
  const [NativeVoice, setNativeVoice] = useState<ComponentType<NativeVoiceProps> | null>(null);
  const mounted = useRef(true); const voice = useRef<VoiceAttempt | null>(null);
  const attemptStarted = useRef(false); const relayCount = useRef(0);
  const relayedConnected = useRef(false);
  const connectionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const relayLine = (line: CallRelay) => {
    if (relayCount.current >= ('text' in line ? 79 : 80)) return; // Reserve a slot for ended.
    relayCount.current++; void latest.current.relay?.(line).catch(() => {});
  };
  const stopVoice = () => {
    clearTimeout(connectionTimer.current); const attempt = voice.current; voice.current = null;
    void attempt?.close().catch(() => {}); if (mounted.current) setNativeVoice(null); Vibration.cancel();
    if (relayedConnected.current) { relayedConnected.current = false; relayLine({ status: 'ended' }); }
  };
  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { mounted.current = false; clearInterval(timer); gate.close(); stopVoice(); };
  }, [gate]);
  useEffect(() => {
    if (phase !== 'ringing') return;
    Vibration.vibrate([0, 350, 600, 350], true);
    return () => Vibration.cancel();
  }, [phase]);
  useEffect(() => {
    if (!outcome) return;
    gate.close(); stopVoice(); setPhase('resolved');
    setResult(outcome === 'allow' ? 'You recognised the withdrawal. Its original delay still applies.'
      : outcome === 'cancel' ? 'Cancellation was requested. Check the alert or live log for confirmation on-chain.'
        : outcome === 'timeout' ? 'The response window ended. Check the live log for Sentinel’s protective action.' : 'This request is no longer open. Check the alert for its on-chain result.');
  }, [outcome, gate]);
  useEffect(() => {
    if (now < request.expiresAt || ['resolved', 'expired'].includes(phase)) return;
    gate.close(); stopVoice(); setPhase('expired');
  }, [now, request.expiresAt, phase, gate]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'background' && voice.current) {
        stopVoice(); if (mounted.current) { setPhase('fallback'); setError('The call paused when Argus left the foreground. Use the buttons to answer.'); }
      }
    });
    return () => subscription.remove();
  }, []);

  async function decide(decision: CallDecision, via: DecisionVia): Promise<string> {
    if (mounted.current) { setDeciding(true); setError(null); if (phase === 'ringing') setPhase('fallback'); }
    try {
      const message = await gate.submit(decision, via);
      if (mounted.current) { stopVoice(); setResult(message); setPhase('resolved'); }
      return message;
    } catch (e) {
      if (mounted.current) setError(userMessage(e, 'Your answer was not confirmed. Check the withdrawal before retrying.'));
      throw e;
    } finally { if (mounted.current) setDeciding(false); }
  }
  function useButtons() { stopVoice(); setPhase('fallback'); }
  async function accept() {
    if (attemptStarted.current || Date.now() >= request.expiresAt) return;
    attemptStarted.current = true; setPhase('connecting'); setError(null);
    const attempt = new VoiceAttempt(); voice.current = attempt;
    connectionTimer.current = setTimeout(() => { if (attempt.active && mounted.current) { stopVoice(); setPhase('fallback'); setError('Voice took too long to connect. Use the buttons to answer.'); } }, 25_000);
    try {
      await requestCallMicrophone();
      if (!attempt.active || !mounted.current) return;
      const module = await import('./NativeVoice');
      if (attempt.active && mounted.current) setNativeVoice(() => module.default);
    } catch (e) {
      if (mounted.current && attempt.active) { stopVoice(); setPhase('fallback'); setError(e instanceof Error && /Microphone access is off/.test(e.message) ? e.message : 'Could not start voice. Use an updated development APK or answer with the buttons.'); }
    }
  }
  const finished = phase === 'resolved' || phase === 'expired';
  return <Modal visible presentationStyle="fullScreen" animationType="none" onRequestClose={() => { if (finished) onClose(); else useButtons(); }}>
    {NativeVoice && voice.current && <NativeVoice attempt={voice.current} request={request} callbacks={{
      cancel: () => decide('cancel', 'voice'), allow: () => decide('allow', 'voice'),
      connected: () => { clearTimeout(connectionTimer.current); setPhase('live'); if (!relayedConnected.current) { relayedConnected.current = true; relayLine({ status: 'connected' }); } },
      disconnected: () => { stopVoice(); setPhase('fallback'); }, mode: setSpeaking,
      line: line => { setLines(previous => [...previous, line].slice(-80)); relayLine(line); },
      error: message => { stopVoice(); setPhase('fallback'); setError(previous => previous ?? userMessage(message, 'Voice is unavailable. Please answer with the buttons.')); },
    }} />}
    <SafeAreaView style={s.root}><ScrollView contentContainerStyle={s.content}>
      <View style={s.identity}><Logo /><Status text={request.demo ? 'Live devnet demo' : 'Vault alert'} /></View>
      <View style={s.caller}><View style={s.avatar}><Logo markOnly /></View><Label>Internet call</Label>
        <Copy style={[common.title, { textAlign: 'center' }]}>Argus · Vault guardian</Copy>
        <Copy style={common.muted}>{phase === 'ringing' ? 'Incoming call' : phase === 'connecting' ? 'Connecting securely…' : phase === 'live' ? speaking ? 'Argus is speaking' : muted ? 'Microphone muted' : 'Argus is listening' : finished ? 'Call ended' : 'Answer with the buttons'}</Copy>
      </View>
      <Panel><Copy style={common.amount}>{request.amount}</Copy><Copy style={common.muted}>{request.reason}</Copy>
        <Label>Destination wallet</Label><Copy selectable style={[common.mono, { fontSize: 12 }]}>{request.destination}</Copy>
        {!finished && <Copy style={[common.num, { color: c.wait }]}>{request.demo ? `${Math.max(0, Math.ceil((request.expiresAt - now) / 1000))}s to respond` : `Withdrawal delay remaining: ${countdown(request.expiresAt, now)}`}</Copy>}
      </Panel>
      {result && <Copy accessibilityRole="alert" style={common.muted}>{result}</Copy>}
      {phase === 'expired' && <Copy accessibilityRole="alert" style={common.muted}>The response window ended. Check the withdrawal’s status. Closing this screen does not confirm cancellation.</Copy>}
      {error && <Copy accessibilityRole="alert" style={common.muted}>{error}</Copy>}
      {phase === 'ringing' && <Button title="Accept" onPress={() => { void accept(); }} disabled={deciding} />}
      {!finished && <>
        <Button title={phase === 'ringing' ? 'Decline · Cancel withdrawal' : 'Cancel withdrawal'} tone="threat" busy={deciding} busyTitle="Sending your answer…" onPress={() => { void decide('cancel', 'button').catch(() => {}); }} />
        {phase !== 'ringing' && <Button title="Yes, this was me" tone="secondary" disabled={deciding} onPress={() => Alert.alert('Was this your withdrawal?', 'This preserves the original withdrawal delay. It does not send funds now.', [{ text: 'Go back', style: 'cancel' }, { text: 'Confirm it was me', onPress: () => { void decide('allow', 'button').catch(() => {}); } }])} />}
        {phase === 'live' && <Button title={muted ? 'Unmute microphone' : 'Mute microphone'} tone="quiet" onPress={() => { voice.current?.mute(!muted); setMuted(!muted); }} />}
        {['ringing', 'connecting', 'live'].includes(phase) && <Button title="Use decision buttons instead" tone="quiet" onPress={useButtons} />}
        <Copy style={[common.muted, { fontSize: 12 }]}>{request.demo ? 'If nobody answers, Sentinel takes its protective action. Check the live log for confirmation.' : 'Cancel opens your wallet for an MWA signature. Argus cannot move your funds. Confirming it was you only dismisses the alert.'}</Copy>
      </>}
      {lines.length > 0 && <Panel><Label>Call transcript</Label>{lines.map((line, i) => <Copy key={i} style={common.muted}>{line.who === 'argus' ? 'Argus' : 'You'}: {line.text}</Copy>)}</Panel>}
      {(finished || phase === 'fallback') && <Button title={finished ? 'Return to the vault' : 'Back to alert details'} tone="quiet" disabled={deciding} onPress={onClose} />}
    </ScrollView></SafeAreaView>
  </Modal>;
}
const s = StyleSheet.create({ root: { flex: 1, backgroundColor: c.canvas }, content: { padding: 22, gap: 20, flexGrow: 1 },
  identity: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  caller: { alignItems: 'center', gap: 12, paddingVertical: 20 },
  avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: c.brandSoft, alignItems: 'center', justifyContent: 'center' },
});
