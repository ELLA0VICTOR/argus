import { View } from 'react-native';
import { Button, Copy, Label, Panel, Status, common } from '../components/ui';
import { countdown, type DemoState } from '../domain/demo';
import { colors as c, fonts as f } from '../theme';
import { KeyAvatar } from '../components/VaultPatterns';

export function Guardians({ state, now, onVote }: {
  state: DemoState; now: number; onVote: (type: 'approve' | 'veto', id: string) => void;
}) {
  return <View style={common.stack}>
    <Label>GUARDIAN APPROVALS</Label>
    <Copy style={common.title}>Separate keys.{ '\n' }Shared protection.</Copy>
    <Copy style={common.muted}>Any guardian can stop a threat. Changes to your rules need threshold approval and a delay.</Copy>
    <Panel>
      <View style={common.row}><Label>Your guardians</Label><Copy style={common.num}>2 of 3</Copy></View>
      {['You · backup wallet', 'Guardian 02', 'Guardian 03'].map((name, i) => <View key={name} style={common.row}>
        <KeyAvatar label={name} /><View style={{ flex: 1, gap: 4 }}><Copy>{name}</Copy><Copy style={{ fontFamily: f.mono, color: c.muted }}>{['B7jQ…c2Vt', '3fUk…N8pR', '6aHd…t5Wq'][i]}</Copy></View>
      </View>)}
      <Copy style={[common.muted, common.divider, { fontSize: 12 }]}>Demo role: you are signing as a backup guardian.</Copy>
    </Panel>
    <Label>OPEN PROPOSALS</Label>
    {state.proposals.map(p => <Panel key={p.id}>
      <Copy style={common.num}>{p.id}</Copy>
      <Copy style={{ fontFamily: f.semibold, fontSize: 18 }}>{p.title}</Copy>
      <Copy style={common.muted}>{p.description}</Copy>
      <Copy style={common.num}>{p.approvals} / {p.threshold} approvals</Copy>
      <Status text={p.decision === 'vetoed' ? 'VETOED' : p.decision === 'approved' ? 'APPROVAL RECORDED · DELAY APPLIES' : 'AWAITING APPROVAL'}
        tone={p.decision === 'vetoed' ? 'safe' : 'wait'} />
      {p.decision !== 'vetoed' && <Copy style={common.countdown}>{countdown(p.unlocksAt, now)}</Copy>}
      {p.decision === 'open' && <Button title="Approve proposal" onPress={() => onVote('approve', p.id)} />}
      {p.decision !== 'vetoed' && <Button title="Veto proposal" tone="quiet" onPress={() => onVote('veto', p.id)} />}
    </Panel>)}
    <Panel><View style={[common.row, { justifyContent: 'flex-start' }]}><KeyAvatar label="AI guardian" ai /><Label>AI guardian</Label></View><Copy>Cancel and freeze only.</Copy><Copy style={common.muted}>The AI cannot withdraw funds or change your rules.</Copy></Panel>
  </View>;
}
