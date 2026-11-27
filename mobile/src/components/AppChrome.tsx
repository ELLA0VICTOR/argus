import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Button, Copy, Logo } from './ui';
import { colors as c, fonts as f } from '../theme';

export const appTabs = ['Home', 'Send', 'Activity', 'Guardians', 'Settings'] as const;
export type AppTab = typeof appTabs[number];
const paths = {
  Home: 'M3 11 12 4l9 7v9H3z',
  Send: 'M3 11 21 3l-8 18-2-8-8-2Z',
  Activity: 'M3 12h4l3-8 4 16 3-8h4',
  Guardians: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 10v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6',
  Settings: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6',
};

export function AppHeader({ wallet, busy, onConnect, onAccount }: {
  wallet?: string; busy: boolean; onConnect: () => void; onAccount: () => void;
}) {
  return <View style={s.header}><Logo />
    {wallet ? <Pressable accessibilityRole="button" accessibilityLabel="Wallet account" disabled={busy}
      onPress={onAccount} style={s.account}>
      <Copy numberOfLines={1} style={s.address}>{wallet.slice(0, 4)}…{wallet.slice(-4)}</Copy>
    </Pressable> : <Button title="Connect" size="small" busy={busy} busyTitle="Connecting…" onPress={onConnect} />}
  </View>;
}

export function AppTabBar({ selected, onSelect, disabled = false }: { selected: AppTab; onSelect: (tab: AppTab) => void; disabled?: boolean }) {
  return <View accessibilityRole="tablist" style={s.nav}>{appTabs.map(tab => {
    const active = selected === tab;
    const color = active ? c.brand : c.muted;
    return <Pressable key={tab} accessibilityRole="tab" accessibilityState={{ selected: active, disabled }} disabled={disabled}
      style={s.tab} onPress={() => onSelect(tab)}>
      <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.5} accessible={false}>
        <Path d={paths[tab]} />
      </Svg><Copy style={{ color, fontFamily: active ? f.medium : f.body, fontSize: 10.5 }}>{tab}</Copy>
    </Pressable>;
  })}</View>;
}

const s = StyleSheet.create({
  header: { height: 60, paddingHorizontal: 20, backgroundColor: c.ink, borderBottomWidth: 1, borderBottomColor: c.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  account: { minHeight: 44, paddingHorizontal: 16, borderRadius: 12, backgroundColor: c.ink, borderWidth: 1, borderColor: c.line, justifyContent: 'center' },
  address: { color: c.fg, fontFamily: f.mono, fontSize: 12 },
  nav: { flexDirection: 'row', backgroundColor: c.ink, borderTopWidth: 1, borderTopColor: c.line },
  tab: { flex: 1, minHeight: 62, justifyContent: 'center', alignItems: 'center', gap: 5 },
});
