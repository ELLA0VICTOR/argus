import { useState } from 'react';
import { View } from 'react-native';
import { Button, Copy, Label, Panel, Status, common } from '../components/ui';
import { sentinel } from '../sentinel/runtime';
import { useResource } from '../sentinel/useResource';
import { formatTokenAmount } from '../sentinel/rules';
import type { AlertPage } from '../sentinel/types';
import { colors as c } from '../theme';

export function Alerts({ vault, onOpen }: { vault: string; onOpen: (id: string) => void }) {
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [older, setOlder] = useState<AlertPage>({ alerts: [], next_before: null });
  const resource = useResource(`${sentinel.session?.wallet}:${vault}:${onlyOpen}`, () => sentinel.alerts(vault, undefined, onlyOpen ? 'open' : undefined));
  const seen = new Set<string>();
  const alerts = [...(resource.data?.alerts ?? []), ...older.alerts].filter(a => !seen.has(a.id) && !!seen.add(a.id));
  const cursor = older.alerts.length ? older.next_before : resource.data?.next_before;
  async function loadMore() {
    if (!cursor || more) return;
    setMore(true); setPageError(null);
    try {
      const page = await sentinel.alerts(vault, cursor, onlyOpen ? 'open' : undefined);
      setOlder(previous => ({ alerts: [...previous.alerts, ...page.alerts], next_before: page.next_before }));
    } catch (e) { setPageError(e instanceof Error ? e.message : 'Could not load older alerts.'); }
    finally { setMore(false); }
  }
  return <View style={common.stack}>
    <Label>SENTINEL ALERTS</Label><Copy style={common.title}>Every signal, in view.</Copy>
    <Copy style={common.muted}>Sentinel’s latest assessment. Only the program can confirm that a withdrawal was stopped.</Copy>
    <Button title={onlyOpen ? 'Show all alerts' : 'Show open alerts only'} disabled={more} onPress={() => {
      setOlder({ alerts: [], next_before: null }); setPageError(null); setOnlyOpen(!onlyOpen);
    }} />
    {resource.error && <Copy accessibilityRole="alert">{resource.error}</Copy>}
    <Button title="Refresh alerts" busy={resource.loading} onPress={() => { setOlder({ alerts: [], next_before: null }); void resource.refresh(); }} />
    {!resource.loading && !resource.error && alerts.length === 0 && <Panel><Copy>No {onlyOpen ? 'open ' : ''}alerts for this vault.</Copy></Panel>}
    {alerts.map(alert => {
      const threat = ['high', 'critical'].includes(alert.risk) && ['open', 'dismissed'].includes(alert.status);
      return <Panel key={alert.id} style={threat ? { borderColor: c.threat } : undefined}>
        <Status text={`${alert.risk.toUpperCase()} · ${alert.status.toUpperCase()}`}
          tone={threat ? 'threat' : ['cancelled', 'voided'].includes(alert.status) ? 'safe' : alert.status === 'open' || alert.status === 'dismissed' ? 'wait' : 'neutral'} />
        <Copy style={common.amount}>{alert.withdrawal ? formatTokenAmount(alert.withdrawal.amount, alert.token) : 'Vault frozen'}</Copy>
        <Copy style={common.muted}>{alert.reason}</Copy>
        <Copy style={[common.num, { color: c.muted, fontSize: 12 }]}>{new Date(alert.created_at * 1000).toLocaleString()} · {alert.id}</Copy>
        <Button title="Review alert" onPress={() => onOpen(alert.id)} />
      </Panel>;
    })}
    {pageError && <Copy accessibilityRole="alert">{pageError}</Copy>}
    {!!cursor && <Button title="Load older alerts" busy={more} onPress={() => { void loadMore(); }} />}
  </View>;
}
