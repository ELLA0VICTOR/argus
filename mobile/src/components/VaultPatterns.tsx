import { Pressable, StyleSheet, View } from 'react-native';
import { Copy, Logo, common } from './ui';
import { countdown } from '../domain/demo';
import { waitFraction } from '../domain/vaultMetrics';
import { colors as c, fonts as f } from '../theme';

export function ProgressTrack({ fraction, label }: { fraction: number; label: string }) {
  const percent = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  return <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: percent }} style={s.track}>
    <View style={[s.fill, { width: `${percent}%` }]} />
  </View>;
}

export function AllowanceMeter({ remaining, total, fraction }: { remaining: string; total: string; fraction: number }) {
  return <View style={{ gap: 8 }}>
    <View style={common.row}><Copy style={[common.muted, { fontSize: 13 }]}>Instant today</Copy>
    <Copy style={[common.num, { fontSize: 13 }]}>{remaining} <Copy style={common.muted}>of {total}</Copy></Copy></View>
    <ProgressTrack fraction={fraction} label="Today's instant allowance remaining" />
  </View>;
}

export function WaitProgress({ requestedAt, executesAt, now }: { requestedAt: number; executesAt: number; now: number }) {
  const ready = now >= executesAt;
  return <View style={{ gap: 10 }}>
    <View style={common.row}><Copy style={common.muted}>{ready ? 'Wait complete' : 'Time remaining'}</Copy>
      <Copy style={[common.num, { color: ready ? c.safe : c.wait }]}>{ready ? 'Ready' : countdown(executesAt, now)}</Copy></View>
    <ProgressTrack fraction={waitFraction(requestedAt, executesAt, now)} label="Withdrawal wait elapsed" />
  </View>;
}

export type SendRoute = 'instant' | 'trusted' | 'delayed';
export function RouteIndicator({ selected, waitLabel, onSelect, disabled }: {
  selected: SendRoute | null; waitLabel: string; onSelect?: (route: SendRoute) => void; disabled: boolean;
}) {
  return <View accessibilityRole={onSelect ? 'radiogroup' : undefined} accessibilityLabel="Transfer route" style={s.routes}>
    {(['instant', 'trusted', 'delayed'] as const).map(route => <Pressable key={route} accessibilityRole={onSelect ? 'radio' : 'text'}
      accessibilityState={onSelect ? { checked: selected === route, disabled } : undefined} disabled={disabled || !onSelect} onPress={() => onSelect?.(route)}
      style={[s.route, selected === route && s.selected]}>
      <Copy style={{ fontFamily: f.medium, fontSize: 12, color: selected === route ? c.fg : c.muted }}>
        {route === 'delayed' ? `Waits ${waitLabel}` : route === 'instant' ? 'Instant' : 'Trusted'}
      </Copy>
    </Pressable>)}
  </View>;
}

export type TimelineEntry = { id: string; title: string; detail: string; done?: boolean; onPress?: () => void };
export function ActivityTimeline({ entries }: { entries: TimelineEntry[] }) {
  return <View>{entries.map((entry, i) => <View key={entry.id} style={s.event}>
    <View style={s.rail}>{i < entries.length - 1 && <View style={s.connector} />}<View style={[s.dot, { backgroundColor: entry.done ? c.safe : c.brand }]} /></View>
    <View style={{ flex: 1, paddingBottom: i < entries.length - 1 ? 22 : 0, gap: 5 }}>
      {entry.onPress ? <Pressable accessibilityRole="link" accessibilityLabel={`${entry.title}. ${entry.detail}. View transaction on Explorer`} style={{ minHeight: 44, justifyContent: 'center', gap: 5 }} onPress={entry.onPress}>
        <Copy style={{ fontFamily: f.medium }}>{entry.title}</Copy><Copy style={[common.muted, { fontSize: 12 }]}>{entry.detail} · View ↗</Copy>
      </Pressable> : <><Copy style={{ fontFamily: f.medium }}>{entry.title}</Copy><Copy style={[common.muted, { fontSize: 12 }]}>{entry.detail}</Copy></>}
    </View>
  </View>)}</View>;
}

export function KeyAvatar({ label, ai = false }: { label: string; ai?: boolean }) {
  return <View style={s.avatar} accessible accessibilityLabel={ai ? 'AI guardian' : label}>
    {ai ? <Logo markOnly /> : <Copy style={{ fontFamily: f.medium, color: c.brand }}>{label.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase()}</Copy>}
  </View>;
}

const s = StyleSheet.create({
  track: { height: 6, borderRadius: 3, backgroundColor: c.raised, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: c.brand },
  routes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, borderRadius: 14, backgroundColor: c.canvas, padding: 4 },
  route: { flex: 1, minWidth: 70, minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 10 },
  selected: { backgroundColor: c.ink },
  dot: { width: 7, height: 7, borderRadius: 4 },
  event: { flexDirection: 'row', gap: 12 }, rail: { width: 12, alignItems: 'center', paddingTop: 7 },
  connector: { position: 'absolute', width: 1, backgroundColor: c.line, top: 10, bottom: -7 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.panel, borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center' },
});
