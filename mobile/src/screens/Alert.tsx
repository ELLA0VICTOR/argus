import { useState } from 'react';
import { Linking, View } from 'react-native';
import { Button, Copy, Label, Panel, Status, common } from '../components/ui';
import { SignalIcon } from '../components/SignalIcon';
import { countdown } from '../domain/demo';
import { sentinel } from '../sentinel/runtime';
import { formatTokenAmount } from '../sentinel/rules';
import { useResource } from '../sentinel/useResource';
import { colors as c, fonts as f } from '../theme';

export function ThreatAlert({ id, now, preview, frozen, onCancel, onFreeze, onBack }: {
  id: string; now: number; preview: boolean; frozen: boolean;
  onCancel: (id: string) => void; onFreeze: () => void; onBack: () => void;
}) {
  const resource = useResource(`alert:${sentinel.session?.wallet}:${id}`, () => sentinel.alert(id));
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const alert = resource.data;
  async function dismiss() {
    if (busy) return;
    setBusy(true); setActionError(null);
    try { await sentinel.dismiss(id); await resource.refresh(); }
    catch (e) { setActionError(e instanceof Error ? e.message : 'Could not dismiss the alert.'); }
    finally { setBusy(false); }
  }
  if (!alert) return <View style={common.stack}><Label>ALERT</Label>
    <Copy>{resource.error ?? 'Loading the alert from Sentinel…'}</Copy>
    <Button title="Retry" busy={resource.loading} onPress={() => { void resource.refresh(); }} /><Button title="Back to alerts" onPress={onBack} /></View>;
  const pending = ['open', 'dismissed'].includes(alert.status);
  const threat = pending && ['high', 'critical'].includes(alert.risk);
  const w = alert.withdrawal;
  return <View style={[common.stack, { flex: 1 }]}>
    <Status text={`${alert.risk.toUpperCase()} · ${alert.status.toUpperCase()}`}
      tone={threat ? 'threat' : pending ? 'wait' : ['cancelled', 'voided'].includes(alert.status) ? 'safe' : 'neutral'} />
    <Copy style={common.title}>{alert.status === 'cancelled' ? 'Your money stays in the vault.'
      : alert.status === 'voided' ? 'This withdrawal is no longer valid.' : alert.status === 'executed' ? 'This withdrawal was executed.'
        : alert.kind === 'freeze' ? 'Outgoing transfers are paused.' : threat ? 'Someone may be trying to move your money.' : 'A withdrawal is waiting.'}</Copy>
    <Copy style={common.muted}>{alert.reason}</Copy>
    {resource.error && <Copy accessibilityRole="alert">Refresh failed: {resource.error} Displaying the last received assessment.</Copy>}
    {w && <Panel>
      <Copy style={common.amount}>{formatTokenAmount(w.amount, alert.token)}</Copy>
      <Copy style={common.muted}>Token mint</Copy><Copy style={common.mono} selectable>{alert.token.mint}</Copy>
      <Copy style={common.muted}>Destination token account</Copy><Copy style={common.mono} selectable>{w.destination}</Copy>
      <Copy style={common.muted}>Destination owner</Copy><Copy style={common.mono} selectable>{w.destination_owner}</Copy>
      {pending && <View style={[common.divider, { gap: 8 }]}><Label>UNLOCKS IN</Label>
        <Copy style={common.countdown}>{countdown(w.executes_at * 1000, now)}</Copy>
        <Copy style={common.muted}>A frozen vault can still block execution after the delay ends.</Copy></View>}
    </Panel>}
    <Panel>
      <Label>RISK SIGNALS</Label>
      {alert.signals.length === 0 && <Copy style={common.muted}>No withdrawal signals for this alert.</Copy>}
      {alert.signals.map(signal => <View key={signal.id} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        <SignalIcon id={signal.id} threat={threat && signal.weight > 0} />
        <Copy style={{ flex: 1, lineHeight: 21 }}>{signal.label}</Copy>
      </View>)}
      <Copy style={[common.mono, { color: c.muted, fontSize: 12 }]}>Risk score: {alert.score} / 100</Copy>
    </Panel>
    <Panel><Label>GUARDIAN CALL</Label>
      <Copy>{preview ? 'Sample call status' : 'Call status'}: {alert.call.status.replace(/_/g, ' ')}</Copy>
      {alert.call.outcome === 'cancel_requested' && <Copy style={common.muted}>Cancellation requested on the call. Wait for an on-chain cancellation to confirm it stopped.</Copy>}
      {alert.call.transcript.map((line, i) => <Copy key={i} style={common.muted}>
        <Copy style={{ fontFamily: f.semibold }}>{line.speaker === 'agent' ? 'Argus' : 'You'}: </Copy>{line.text}
      </Copy>)}
    </Panel>
    {alert.resolution && <Panel><Copy>Resolved by: {alert.resolution.by_role}</Copy>
      <Button title="View resolution transaction" onPress={() => {
        void Linking.openURL(`https://explorer.solana.com/tx/${encodeURIComponent(alert.resolution!.tx)}?cluster=devnet`)
          .catch(() => setActionError('Could not open Explorer.'));
      }} /></Panel>}
    {alert.status === 'dismissed' && <Copy style={common.muted}>You dismissed this alert. Calls stop; the withdrawal and its delay are unchanged.</Copy>}
    {pending && w && <Button title={preview ? 'Cancel withdrawal (demo)' : 'Cancel withdrawal'} tone="threat"
      disabled={!preview || busy} onPress={() => { onCancel(alert.id); void resource.refresh(); }} />}
    {pending && <Button title={frozen ? 'Vault is frozen (demo)' : preview ? 'Freeze vault (demo)' : 'Freeze vault'} disabled={!preview || busy || frozen} onPress={onFreeze} />}
    {!preview && pending && <Copy style={common.muted}>Wallet actions become available after the program is deployed. Sentinel cannot sign these actions for you.</Copy>}
    {alert.status === 'open' && w && <Button title="It was me, let it through" tone="quiet" busy={busy} onPress={() => { void dismiss(); }} />}
    {pending && w && <Copy style={{ color: c.muted, textAlign: 'center', fontSize: 12 }}>Dismissal stops further calls. It does not cancel or speed up the withdrawal.</Copy>}
    {actionError && <Copy accessibilityRole="alert">{actionError}</Copy>}
    <Button title="Refresh alert" busy={resource.loading} onPress={() => { void resource.refresh(); }} />
    <Button title="Back to alerts" tone="quiet" onPress={onBack} />
  </View>;
}
