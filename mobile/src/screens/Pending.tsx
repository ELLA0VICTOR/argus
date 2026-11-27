import { View } from 'react-native';
import { Button, Copy, Label, Panel, Status, common } from '../components/ui';
import { countdown, type DemoState } from '../domain/demo';
import { colors as c } from '../theme';

export function Pending({ state, now, onCancel, onFreeze, onAlert }: {
  state: DemoState; now: number; onCancel: (id: string) => void; onFreeze: () => void; onAlert: () => void;
}) {
  return <View style={common.stack}>
    <Label>PENDING WITHDRAWALS</Label>
    <Copy style={common.title}>Time is on your side.</Copy>
    <Copy style={common.muted}>A request stays locked until its delay ends. Cancel it to keep the funds here.</Copy>
    {state.withdrawals.map(w => <Panel key={w.id}>
      <View style={common.row}><Copy style={common.mono}>{w.id}</Copy>
        <Status text={w.status === 'cancelled' ? 'CANCELLED' : w.flagged ? 'FLAGGED' : 'WAITING'}
          tone={w.status === 'cancelled' ? 'safe' : w.flagged ? 'threat' : 'wait'} /></View>
      <Copy style={common.amount}>{w.amount} USDC</Copy>
      <Copy style={common.muted}>to <Copy style={common.mono}>{w.destination}</Copy></Copy>
      {w.status === 'pending' ? <>
        <Copy style={common.countdown}>{countdown(w.unlocksAt, now)}</Copy>
        {state.frozen && <Copy style={{ color: c.wait }}>Vault frozen. Execution remains blocked.</Copy>}
        {w.flagged && <Button title="Review threat details" onPress={onAlert} />}
        <Button title="Cancel withdrawal" tone="threat" onPress={() => onCancel(w.id)} />
      </> : <Copy style={{ color: c.safe }}>Cancelled in the demo. Funds stay in the vault.</Copy>}
    </Panel>)}
    <Button title={state.frozen ? 'Vault is frozen' : 'Freeze vault'} disabled={state.frozen} onPress={onFreeze} />
    <Copy style={common.muted}>One owner or guardian can freeze. Unfreezing requires the guardian threshold.</Copy>
  </View>;
}
