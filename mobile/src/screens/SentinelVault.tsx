import { View } from 'react-native';
import { Button, Copy, Label, Panel, Status, common } from '../components/ui';
import { sentinel } from '../sentinel/runtime';
import { formatUnits, RESERVED_PROGRAM_ID } from '../sentinel/rules';
import { useResource } from '../sentinel/useResource';

export function SentinelVault({ vault, onAlerts, onChangeVault }: { vault: string; onAlerts: () => void; onChangeVault: () => void }) {
  const resource = useResource(`vault:${sentinel.session?.wallet}:${vault}`, async () => ({
    summary: await sentinel.vault(vault), log: await sentinel.watchlog(vault),
  }));
  const summary = resource.data?.summary;
  return <View style={common.stack}><Label>SENTINEL WATCH</Label><Copy style={common.title}>Your vault, in view.</Copy>
    {resource.error && <Copy accessibilityRole="alert">{resource.error}</Copy>}
    {summary && <Panel><Status text={summary.frozen ? 'VAULT FROZEN' : summary.watched ? 'SENTINEL WATCHING' : 'ALERTS ONLY · AI CANNOT ACT'} tone={summary.frozen ? 'wait' : summary.watched ? 'safe' : 'neutral'} />
      <Label>LAST SEEN BALANCE</Label><Copy style={common.amount}>{formatUnits(summary.balance, summary.decimals)} tokens</Copy>
      <Copy style={common.mono} selectable>{summary.vault}</Copy>
      <Copy>Role: {summary.role}</Copy><Copy style={common.mono}>Pending withdrawals: {summary.pending_withdrawals}</Copy>
      <Copy style={common.mono}>Open alerts: {summary.open_alerts}</Copy>
      <Copy style={common.muted}>Sentinel snapshot at <Copy style={common.mono}>{new Date(summary.last_scan_at * 1000).toLocaleTimeString()}</Copy>. The chain is the source of truth.</Copy>
    </Panel>}
    <Button title="Open alerts" onPress={onAlerts} /><Button title="Refresh" busy={resource.loading} onPress={() => { void resource.refresh(); }} />
    <Label>WATCH LOG</Label>
    {resource.data?.log.entries.map((entry, i) => <Panel key={`${entry.at}:${i}`}>
      <Copy style={common.mono}>{new Date(entry.at * 1000).toLocaleTimeString()}</Copy><Copy>{entry.text}</Copy>
    </Panel>)}
    <Panel><Label>PROGRAM AWAITING DEPLOYMENT</Label><Copy style={common.mono} selectable>{RESERVED_PROGRAM_ID}</Copy>
      <Copy style={common.muted}>Reserved program ID. Wallet actions will be enabled after the real IDL and devnet deployment are announced.</Copy></Panel>
    <Button title="Choose another vault" tone="quiet" onPress={onChangeVault} />
  </View>;
}
