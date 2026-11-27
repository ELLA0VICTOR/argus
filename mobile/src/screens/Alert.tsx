import { useEffect, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import { Button, Copy, Label, Panel, Status, common } from '../components/ui';
import { SignalIcon } from '../components/SignalIcon';
import { countdown } from '../domain/demo';
import { sentinel } from '../sentinel/runtime';
import { formatTokenAmount } from '../sentinel/rules';
import { useResource } from '../sentinel/useResource';
import { colors as c, fonts as f } from '../theme';
import { GuardianCall } from '../components/GuardianCall';
import { callFromAlert, type GuardianCallRequest } from '../domain/guardianCall';

export function ThreatAlert({ id, now, preview, frozen, liveActions = false, actionBusy = false, onCancel, onFreeze, onBack, onThreat, autoCall = false, onCallActive, onCallCancel }: {
  id: string; now: number; preview: boolean; frozen: boolean; liveActions?: boolean; actionBusy?: boolean;
  onCancel: (id: string) => void; onFreeze: () => void; onBack: () => void;
  onThreat?: (active: boolean) => void;
  autoCall?: boolean; onCallActive?: (active: boolean) => void; onCallCancel?: (id: string) => Promise<string>;
}) {
  const resource = useResource(`alert:${sentinel.session?.wallet}:${id}`, () => sentinel.alert(id));
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const alert = resource.data;
  const [call, setCall] = useState<GuardianCallRequest | null>(null);
  const called = useRef(new Set<string>());
  useEffect(() => { onCallActive?.(!!call); return () => onCallActive?.(false); }, [!!call, onCallActive]);
  useEffect(() => {
    if (!autoCall || !alert || preview || !liveActions || called.current.has(alert.id)) return;
    let active = true;
    void sentinel.vault(alert.vault).then(summary => {
      if (!active) return;
      const request = callFromAlert(alert, summary.role, Date.now());
      if (request) { called.current.add(alert.id); setCall(request); }
    }).catch(() => { if (active) setActionError('Could not prepare the incoming call. The alert buttons are still available.'); });
    return () => { active = false; };
  }, [autoCall, alert?.id, alert?.status, alert?.risk, preview, liveActions]);
  useEffect(() => {
    onThreat?.(!!alert && ['open', 'dismissed'].includes(alert.status) && ['high', 'critical'].includes(alert.risk));
    return () => onThreat?.(false);
  }, [alert?.id, alert?.status, alert?.risk, onThreat]);
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
    <Status text={`${alert.risk} · ${alert.status}`}
      tone={threat ? 'threat' : pending ? 'wait' : ['cancelled', 'voided'].includes(alert.status) ? 'safe' : 'neutral'} />
    <Copy style={common.title}>{alert.status === 'cancelled' ? 'Your money stays in the vault.'
      : alert.status === 'voided' ? 'This withdrawal is no longer valid.' : alert.status === 'executed' ? 'This withdrawal was executed.'
        : alert.kind === 'freeze' ? 'Outgoing transfers are paused.' : threat ? 'Someone may be trying to move your money.' : 'A withdrawal is waiting.'}</Copy>
    <Copy style={common.muted}>{alert.reason}</Copy>
    {resource.error && <Copy accessibilityRole="alert">Refresh failed: {resource.error} Displaying the last received assessment.</Copy>}
    {w && <Panel style={threat ? { borderColor: c.threat } : undefined}>
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
      <Copy style={[common.num, { color: c.muted, fontSize: 12 }]}>Risk score: {alert.score} / 100</Copy>
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
      disabled={(!preview && !liveActions) || busy || actionBusy} onPress={() => { onCancel(alert.id); void resource.refresh(); }} />}
    {pending && <Button tone="quiet" title={frozen ? 'Vault is frozen (demo)' : preview ? 'Freeze vault (demo)' : 'Freeze vault'} disabled={(!preview && !liveActions) || busy || actionBusy || frozen} onPress={onFreeze} />}
    {!preview && pending && <Copy style={common.muted}>{liveActions ? 'Your wallet signs Cancel and Freeze directly on Solana devnet.' : 'These are sample alerts. Open your devnet vault for live wallet actions.'}</Copy>}
    {alert.status === 'open' && w && <Button title="It was me, let it through" tone="quiet" busy={busy} onPress={() => { void dismiss(); }} />}
    {pending && w && <Copy style={{ color: c.muted, textAlign: 'center', fontSize: 12 }}>Dismissal stops further calls. It does not cancel or speed up the withdrawal.</Copy>}
    {actionError && <Copy accessibilityRole="alert">{actionError}</Copy>}
    <Button title="Refresh alert" busy={resource.loading} onPress={() => { void resource.refresh(); }} />
    <Button title="Back to alerts" tone="quiet" onPress={onBack} />
    {call && <GuardianCall key={call.id} request={call}
      outcome={alert.status === 'dismissed' ? 'allow' : ['cancelled', 'executed', 'voided'].includes(alert.status) ? 'closed' : undefined}
      submit={async decision => {
        if (actionBusy) throw new Error('Check the current wallet transaction before answering again.');
        const latest = await sentinel.alert(id); const summary = await sentinel.vault(latest.vault);
        if (!callFromAlert(latest, summary.role, Date.now())) throw new Error('This owner alert is no longer open. Refresh its status.');
        if (latest.withdrawal?.pda !== alert.withdrawal?.pda || latest.withdrawal?.amount !== alert.withdrawal?.amount || latest.withdrawal?.destination !== alert.withdrawal?.destination) throw new Error('The withdrawal changed. Review the alert before answering.');
        if (decision === 'cancel') {
          if (!onCallCancel) throw new Error('Open the alert to cancel with your wallet.');
          const result = await onCallCancel(id); void resource.refresh(); return result;
        }
        await sentinel.dismiss(id); void resource.refresh();
        return 'You recognised the withdrawal. Its original delay still applies.';
      }} onClose={() => setCall(null)} />}
  </View>;
}
