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
    {summary && <Panel><Status text={summary.frozen ? 'Vault frozen' : summary.watched ? 'Sentinel watching' : 'Alerts only · AI cannot act'} />
      <Label>LAST SEEN BALANCE</Label><Copy style={common.amount}>{formatUnits(summary.balance, summary.decimals)} tokens</Copy>
      <Copy style={common.mono} selectable>{summary.vault}</Copy>
      <Copy>Role: {summary.role}</Copy><Copy style={common.num}>Pending withdrawals: {summary.pending_withdrawals}</Copy>
      <Copy style={common.num}>Open alerts: {summary.open_alerts}</Copy>
      <Copy style={common.muted}>Sentinel snapshot at <Copy style={common.num}>{new Date(summary.last_scan_at * 1000).toLocaleTimeString()}</Copy>. The chain is the source of truth.</Copy>
    </Panel>}
    <Button title="Open alerts" onPress={onAlerts} /><Button title="Refresh" busy={resource.loading} onPress={() => { void resource.refresh(); }} />
    <Label>WATCH LOG</Label>
    {resource.data?.log.entries.map((entry, i) => <Panel key={`${entry.at}:${i}`}>
      <Copy style={common.num}>{new Date(entry.at * 1000).toLocaleTimeString()}</Copy><Copy>{entry.text}</Copy>
    </Panel>)}
    <Panel><Label>Live on Solana devnet</Label><Copy style={common.mono} selectable>{RESERVED_PROGRAM_ID}</Copy>
      <Copy style={common.muted}>This screen shows Sentinel’s assessment. Open Devnet vaults to read the chain and sign wallet actions.</Copy></Panel>
    <Button title="Choose another vault" tone="quiet" onPress={onChangeVault} />
  </View>;
}
