import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { EBGaramond_500Medium } from '@expo-google-fonts/eb-garamond/500Medium';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono/400Regular';
import { Copy } from './src/components/ui';
import { Intro } from './src/components/Intro';
import { LiveApp } from './src/screens/LiveApp';
import { LiveDemo } from './src/screens/LiveDemo';
import { listenForAlerts } from './src/services/notifications';
import { colors as c } from './src/theme';

export default function App() {
  const [loaded, error] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, EBGaramond_500Medium, JetBrainsMono_400Regular });
  return <SafeAreaProvider><StatusBar style="dark" />
    {loaded ? <OpeningApp /> : <SafeAreaView style={s.loading}>
      {error ? <Copy>Unable to load the bundled fonts. Restart Argus to try again.</Copy> : <><ActivityIndicator color={c.fg} /><Copy>Opening Argus...</Copy></>}
    </SafeAreaView>}
  </SafeAreaProvider>;
}
function OpeningApp() {
  const [opened, setOpened] = useState(false);
  const finish = useCallback(() => setOpened(true), []);
  return opened ? <Experience /> : <Intro onDone={finish} />;
}
function Experience() {
  const [demo, setDemo] = useState(false);
  const [incoming, setIncoming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const handled = useCallback(() => setIncoming(null), []);
  useEffect(() => listenForAlerts(setIncoming, setLinkError), []);
  useEffect(() => { if (incoming && !busy) setDemo(false); }, [incoming, busy]);
  return <>
    {linkError && <Copy accessibilityRole="alert" style={{ padding: 16 }}>{linkError}</Copy>}
    <View style={{ flex: 1, display: demo ? 'none' : 'flex' }}><LiveApp active={!demo} incomingAlertId={incoming} onIncomingHandled={handled} onBusy={setBusy} onLiveDemo={() => setDemo(true)} /></View>
    {demo && <LiveDemo onBusy={setBusy} onExit={() => setDemo(false)} />}
  </>;
}
const s = StyleSheet.create({ loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, backgroundColor: c.ink } });
