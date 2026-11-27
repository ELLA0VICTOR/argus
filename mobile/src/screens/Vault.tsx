import { View } from 'react-native';
import { Button, Copy, Label, Panel, Status, common } from '../components/ui';
import type { DemoState } from '../domain/demo';
import { colors as c, fonts as f } from '../theme';

export function Vault({ state, onAlert, onPending, onSend }: {
  state: DemoState; onAlert: () => void; onPending: () => void; onSend: () => void;
}) {
  const threats = state.withdrawals.filter(w => w.flagged && w.status === 'pending').length;
  return <View style={common.stack}>
    <View style={{ gap: 8 }}><Label>PERSONAL VAULT</Label><Copy style={common.title}>Your watch starts here.</Copy></View>
    {state.frozen ? <Status text="VAULT FROZEN · TRANSFERS PAUSED" tone="wait" />
      : threats > 0 ? <Panel style={{ borderColor: c.threat }}>
        <Copy style={{ color: c.threatSoft, fontFamily: f.semibold }}>A withdrawal needs your attention.</Copy>
        <Button title="Review threat" tone="threat" onPress={onAlert} />
      </Panel> : <Status text="FLAGGED WITHDRAWAL CANCELLED" tone="safe" />}
    <Panel>
      <Label>VAULT BALANCE</Label>
      <Copy style={{ fontFamily: f.monoMedium, fontSize: 34 }}>2,450.00</Copy>
      <Copy style={{ color: c.muted, fontFamily: f.mono }}>USDC · SAMPLE FUNDS</Copy>
      <View style={[common.divider, { gap: 14 }]}>
        <View style={common.row}><Copy style={common.muted}>Instant allowance left</Copy><Copy style={common.mono}>50.00 USDC</Copy></View>
        <View style={common.row}><Copy style={common.muted}>Withdrawal delay</Copy><Copy style={common.mono}>24 hours</Copy></View>
        <View style={common.row}><Copy style={common.muted}>Trusted addresses</Copy><Copy style={common.mono}>3</Copy></View>
      </View>
      <Button title="Send" onPress={onSend} disabled={state.frozen} />
    </Panel>
    <Button title="Review pending withdrawals" onPress={onPending} />
    <Label>WATCH LOG</Label>
    <Panel>
      {state.log.map(entry => <View key={entry.id} style={{ gap: 6 }}>
        <Copy style={{ fontFamily: f.mono, fontSize: 11, color: c.muted }}>{new Date(entry.at).toLocaleTimeString('en-GB', { hour12: false })} · DEMO</Copy>
        <Copy style={{ fontFamily: f.mono, fontSize: 12, lineHeight: 19 }}>{entry.message}</Copy>
      </View>)}
    </Panel>
  </View>;
}
