import { View } from 'react-native';
import { Button, Copy, Label, Panel, Status, common } from '../components/ui';
import { ActivityTimeline, AllowanceMeter, WaitProgress } from '../components/VaultPatterns';
import type { DemoState } from '../domain/demo';
import { colors as c, fonts as f } from '../theme';

export function Vault({ state, now, onAlert, onPending, onSend }: {
  state: DemoState; now: number; onAlert: () => void; onPending: () => void; onSend: () => void;
}) {
  const threats = state.withdrawals.filter(w => w.flagged && w.status === 'pending').length;
  return <View style={common.stack}>
    <View style={{ gap: 8 }}><Label>PERSONAL VAULT</Label><Copy style={common.title}>Your watch starts here.</Copy></View>
    <Panel style={{ borderRadius: 28 }}>
      <View style={common.row}><Label>Vault balance</Label><Status text={state.frozen ? 'Frozen' : threats ? 'Argus is on it' : 'Protected'} tone={state.frozen ? 'brand' : threats ? 'threat' : 'safe'} /></View>
      <Copy style={{ fontFamily: f.monoMedium, fontSize: 34 }}>2,450.00</Copy>
      <Copy style={{ color: c.muted, fontFamily: f.body }}>USDC · Sample funds</Copy>
      <AllowanceMeter remaining="50.00 USDC" total="100.00 USDC" fraction={0.5} />
      <View style={{ gap: 14 }}>
        <View style={common.row}><Copy style={common.muted}>Withdrawal delay</Copy><Copy style={common.num}>24 hours</Copy></View>
        <View style={common.row}><Copy style={common.muted}>Trusted addresses</Copy><Copy style={common.num}>3</Copy></View>
      </View>
      <Button title="Send" onPress={onSend} disabled={state.frozen} />
    </Panel>
    {threats > 0 && <Panel style={{ borderLeftWidth: 3, borderLeftColor: c.threat }}>
      <Label>Needs your attention</Label><Copy style={{ fontFamily: f.semibold }}>A withdrawal needs your attention.</Copy>
      <Button title="Review withdrawal" tone="secondary" onPress={onAlert} />
    </Panel>}
    <Panel><Label>Waiting to leave</Label>
      {state.withdrawals.filter(w => w.status === 'pending').map((w, i) => <View key={w.id} style={[i > 0 && common.divider, { gap: 12 }]}>
        <View style={common.row}><Copy style={common.num}>{w.amount} USDC</Copy><Copy style={common.muted}>{w.id}</Copy></View>
        <WaitProgress requestedAt={w.requestedAt} executesAt={w.unlocksAt} now={now} />
      </View>)}
      {state.withdrawals.every(w => w.status !== 'pending') && <Copy style={common.muted}>No pending requests.</Copy>}
      <Button title="Review pending withdrawals" tone="quiet" onPress={onPending} />
    </Panel>
    <Panel><Label>Recent activity</Label><ActivityTimeline entries={state.log.map(entry => ({ id: String(entry.id), title: entry.message,
      detail: `${new Date(entry.at).toLocaleTimeString('en-GB', { hour12: false })} · Sample`, done: /cancelled|frozen|recorded|vetoed/.test(entry.message),
    }))} /></Panel>
  </View>;
}
