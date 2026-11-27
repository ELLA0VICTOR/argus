import type { PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type TextProps, type ViewStyle } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { colors as c, fonts as f } from '../theme';

export function Copy({ style, ...props }: TextProps) {
  return <Text {...props} style={[s.copy, style]} />;
}

export function Label({ children }: PropsWithChildren) {
  return <Copy style={s.label}>{typeof children === 'string' ? sentenceCase(children) : children}</Copy>;
}

const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase().replace(/\bai\b/g, 'AI');

export function Panel({ children, style }: PropsWithChildren<{ style?: ViewStyle }>) {
  return <View style={[s.panel, style]}>{children}</View>;
}

export function Button({ title, onPress, tone = 'neutral', disabled = false, busy = false, busyTitle = 'Working…' }: {
  title: string; onPress: () => void; tone?: 'neutral' | 'threat' | 'quiet' | 'secondary'; disabled?: boolean; busy?: boolean; busyTitle?: string;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: disabled || busy, busy }}
    disabled={disabled || busy} onPress={onPress}
    style={({ pressed }) => [s.button, tone === 'threat' && s.threatButton, tone === 'quiet' && s.quietButton,
      tone === 'secondary' && s.secondaryButton,
      (disabled || busy) && s.disabled, pressed && { opacity: 0.7 }]}>
    {tone === 'neutral' && <LinearGradient colors={[c.brand, c.brand2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
    <Copy style={[s.buttonText, { color: tone === 'quiet' || tone === 'secondary' ? c.brand : '#ffffff' }]}>
      {busy ? busyTitle : title}
    </Copy>
  </Pressable>;
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return <View style={{ gap: 8 }}>
    <Copy style={{ color: c.muted, fontSize: 13 }}>{label}</Copy>
    <TextInput {...props} accessibilityLabel={label} placeholderTextColor={c.muted}
      selectionColor={c.brand} style={[s.input, props.style]} />
  </View>;
}

export function Status({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'threat' | 'wait' | 'safe' }) {
  const color = tone === 'safe' ? c.safe : c.muted;
  return <View style={[s.status, { borderColor: tone === 'threat' ? c.threat : c.line }]}>
    <Copy style={{ fontFamily: f.medium, fontSize: 12, color }}>{sentenceCase(text)}</Copy>
  </View>;
}

export function Logo({ threat = false }: { threat?: boolean }) {
  return <View style={s.brand} accessibilityLabel="Argus">
    <Svg width={28} height={28} viewBox="0 0 40 40" fill="none" accessible={false}>
      <Path d="M20 4.5 L35.5 34.5 H4.5 Z" stroke={c.fg} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
      <Path d="M11 24.5 Q20 16.5 29 24.5 Q20 32.5 11 24.5 Z" stroke={c.fg} strokeWidth={2.1} strokeLinejoin="round" />
      <Circle cx={20} cy={24.5} r={threat ? 4.05 : 3} fill={threat ? c.threat : c.fg} />
    </Svg>
    <Copy style={{ fontFamily: f.semibold, fontSize: 24, letterSpacing: -0.5 }}>Argus</Copy>
  </View>;
}

export const common = StyleSheet.create({
  stack: { gap: 20 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { fontFamily: f.semibold, fontSize: 30, lineHeight: 37, letterSpacing: -1 },
  muted: { color: c.muted, lineHeight: 23 },
  mono: { fontFamily: f.mono },
  divider: { borderTopWidth: 1, borderTopColor: c.line, paddingTop: 16 },
  amount: { fontFamily: f.semibold, fontVariant: ['tabular-nums'], fontSize: 32, letterSpacing: -1 },
  num: { fontFamily: f.medium, fontVariant: ['tabular-nums'] },
  countdown: { fontFamily: f.semibold, fontVariant: ['tabular-nums'], color: c.wait, fontSize: 32 },
});

const s = StyleSheet.create({
  copy: { color: c.fg, fontFamily: f.body, fontSize: 14 },
  label: { fontFamily: f.semibold, fontSize: 13, lineHeight: 20, color: c.muted },
  panel: { backgroundColor: c.panel, borderWidth: 1, borderColor: c.lineSoft, borderRadius: 24, padding: 22, gap: 16 },
  button: { minHeight: 52, paddingHorizontal: 16, paddingVertical: 15, borderWidth: 1, borderColor: c.lineStrong,
    borderRadius: 12, overflow: 'hidden', backgroundColor: c.brand, alignItems: 'center', justifyContent: 'center',
    boxShadow: '0px 5px 18px rgba(37,99,235,0.13)' },
  buttonText: { fontFamily: f.semibold, fontSize: 15, textAlign: 'center' },
  threatButton: { backgroundColor: c.threat, borderColor: c.threat },
  quietButton: { borderColor: 'transparent', minHeight: 44, paddingVertical: 12, backgroundColor: 'transparent', boxShadow: 'none' },
  secondaryButton: { backgroundColor: c.brandSoft, borderColor: c.brandSoft, boxShadow: 'none' },
  disabled: { opacity: 0.45 },
  input: { minHeight: 52, paddingVertical: 14, paddingHorizontal: 0, borderBottomWidth: 1, borderColor: c.lineStrong, color: c.fg,
    backgroundColor: 'transparent', fontFamily: f.body, fontSize: 15 },
  status: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 999, backgroundColor: c.ink, paddingVertical: 7, paddingHorizontal: 12 },
  brand: { flexDirection: 'row', gap: 10, alignItems: 'center' },
});
