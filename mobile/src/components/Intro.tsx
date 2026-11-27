import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { Copy } from './ui';
import { colors as c, fonts as f } from '../theme';

const InkPath = Animated.createAnimatedComponent(Path);
export function Intro({ onDone }: { onDone: () => void }) {
  const progress = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void AccessibilityInfo.isReduceMotionEnabled().then(reduce => {
      if (!active) return;
      if (reduce) { timer = setTimeout(onDone, 150); return; }
      Animated.sequence([
        Animated.timing(progress, { toValue: 1, duration: 3100, useNativeDriver: false }),
        Animated.timing(opacity, { toValue: 0, duration: 350, useNativeDriver: false }),
      ]).start(({ finished }) => { if (finished && active) onDone(); });
    }).catch(onDone);
    return () => { active = false; if (timer) clearTimeout(timer); progress.stopAnimation(); opacity.stopAnimation(); };
  }, [onDone, opacity, progress]);
  return <Animated.View style={[s.root, { opacity }]} accessibilityLabel="Opening Argus">
    <Svg width={88} height={88} viewBox="0 0 40 40" fill="none" accessible={false}>
      <InkPath d="M20 4.5 L35.5 34.5 H4.5 Z" stroke={c.fg} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round"
        strokeDasharray="101" strokeDashoffset={progress.interpolate({ inputRange: [0, 1], outputRange: [101, 0] })} />
      <Path d="M11 24.5 Q20 16.5 29 24.5 Q20 32.5 11 24.5 Z" stroke={c.fg} strokeWidth={2.1} strokeLinejoin="round" />
      <Circle cx={20} cy={24.5} r={3} fill={c.fg} />
    </Svg>
    <Animated.View style={{ transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>
      <Copy style={s.name}>Argus</Copy>
    </Animated.View>
    <View style={s.track}><Animated.View style={[s.progress, { width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} /></View>
  </Animated.View>;
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center', gap: 18 },
  name: { fontFamily: f.semibold, fontSize: 36, letterSpacing: -1 }, track: { height: 2, width: 140, backgroundColor: c.lineSoft, marginTop: 22 },
  progress: { height: 2, backgroundColor: c.brand },
});
