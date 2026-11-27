import { ImageBackground, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Copy } from './ui';
import { fonts as f } from '../theme';

export function DawnHero() {
  return <ImageBackground source={require('../../assets/hero-dawn.webp')} resizeMode="cover" style={s.hero} imageStyle={{ borderRadius: 28 }}>
    <LinearGradient colors={['rgba(15,40,78,0.58)', 'rgba(15,40,78,0.12)']} style={StyleSheet.absoluteFill} />
    <View style={s.copy}>
      <Copy style={s.eyebrow}>A little time. A lot of peace.</Copy>
      <Copy accessibilityRole="header" style={s.title}>Crypto has no undo.{ '\n' }Argus gives it{ '\n' }24 hours.</Copy>
      <Copy style={s.subtitle}>Your vault. Your guardians. Time to stop a theft.</Copy>
    </View>
  </ImageBackground>;
}
const s = StyleSheet.create({
  hero: { minHeight: 380, borderRadius: 28, overflow: 'hidden', justifyContent: 'flex-start', backgroundColor: '#3875aa' },
  copy: { padding: 26, gap: 18 }, eyebrow: { color: '#ffffff', fontSize: 12, fontFamily: f.medium },
  title: { fontFamily: f.display, fontSize: 47, lineHeight: 48, color: '#ffffff', letterSpacing: -1.2 },
  subtitle: { color: '#ffffff', fontSize: 14, lineHeight: 22, maxWidth: 250 },
});
