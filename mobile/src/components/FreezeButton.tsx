import { Pressable, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Copy } from './ui';
import { colors as c, fonts as f } from '../theme';

export function FreezeButton({ onPress, disabled = false, frozen = false }: {
  onPress: () => void; disabled?: boolean; frozen?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: disabled || frozen }} disabled={disabled || frozen}
    onPress={onPress} style={({ pressed }) => [s.button, (disabled || frozen) && { opacity: 0.45 }, pressed && { backgroundColor: c.raised }]}>
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={c.muted} strokeWidth={1.5} accessible={false}>
      <Path d="M12 2v20M3.3 7l17.4 10M20.7 7 3.3 17M9 4l3 2 3-2M9 20l3-2 3 2" />
    </Svg><Copy style={s.label}>{frozen ? 'Vault is paused' : 'Freeze vault'}</Copy>
  </Pressable>;
}

const s = StyleSheet.create({
  button: { alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12,
    borderWidth: 1, borderColor: c.line, backgroundColor: c.panel, flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { color: c.muted, fontFamily: f.medium, fontSize: 14 },
});
