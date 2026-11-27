import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Alert, BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { Syncopate_700Bold } from '@expo-google-fonts/syncopate/700Bold';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono/400Regular';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono/500Medium';
import { JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono/700Bold';
import { Button, Copy, Logo, Status } from './src/components/ui';
import { createDemo, demoReducer } from './src/domain/demo';
import { Connect } from './src/screens/Connect';
import { ThreatAlert } from './src/screens/Alert';
import { Alerts } from './src/screens/Alerts';
import { Vault } from './src/screens/Vault';
import { SentinelVault } from './src/screens/SentinelVault';
import { Pending } from './src/screens/Pending';
import { Guardians } from './src/screens/Guardians';
import { Settings } from './src/screens/Settings';
import { connectWallet, disconnectWallet, signSentinelChallenge, validateVaultAddress, type WalletSession } from './src/services/wallet';
import { listenForAlerts } from './src/services/notifications';
import { sentinel, mockSentinel } from './src/sentinel/runtime';
import { MOCK_VAULT, MOCK_WALLET } from './src/sentinel/mock';
import type { VaultList } from './src/sentinel/types';
import { colors as c, fonts as f } from './src/theme';

type Tab = 'vault' | 'pending' | 'alerts' | 'guardians' | 'settings';
type Route = Tab | 'connect' | 'alert';
const tabs: { id: Tab; title: string }[] = [
  { id: 'vault', title: 'Vault' }, { id: 'pending', title: 'Pending' }, { id: 'alerts', title: 'Alerts' },
  { id: 'guardians', title: 'Guardians' }, { id: 'settings', title: 'Settings' },
];

export default function App() {
  const [loaded, fontError] = useFonts({
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Syncopate_700Bold,
    JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_700Bold,
  });
  return <SafeAreaProvider><StatusBar style="light" />
    {loaded ? <Shell /> : <SafeAreaView style={[s.root, s.loading]}>
      {fontError ? <Copy>Unable to load the bundled fonts. Restart Argus to try again.</Copy>
        : <><ActivityIndicator color={c.fg} /><Copy>Opening Argus…</Copy></>}
    </SafeAreaView>}
  </SafeAreaProvider>;
}

function Shell() {
  const credential = useSyncExternalStore(sentinel.subscribe, () => sentinel.session);
  const [ready, setReady] = useState(false);
  const [route, setRoute] = useState<Route>('connect');
  const [state, dispatch] = useReducer(demoReducer, undefined, () => createDemo(Date.now()));
  const [now, setNow] = useState(Date.now());
  const [wallet, setWallet] = useState<WalletSession | null>(null);
  const [busy, setBusy] = useState(false);
  const authLock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [vault, setVault] = useState('');
  const [selectedVault, setSelectedVault] = useState('');
  const [vaults, setVaults] = useState<VaultList['vaults']>([]);
  const [preview, setPreview] = useState(false);
  const [alertId, setAlertId] = useState('al_9');
  const [pendingAlert, setPendingAlert] = useState<string | null>(null);

  useEffect(() => { void sentinel.restore().catch(e => setError(e instanceof Error ? e.message : 'Could not restore the secure session.')).finally(() => setReady(true)); }, []);
  const incomingAlert = useCallback((id: string) => { setPendingAlert(id); if (!sentinel.session) setRoute('connect'); }, []);
  useEffect(() => listenForAlerts(incomingAlert, setError), [incomingAlert]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);

  useEffect(() => {
    if (!ready) return;
    if (!credential) { setRoute('connect'); setPreview(false); setSelectedVault(''); setVaults([]); return; }
    let active = true;
    void sentinel.vaults().then(result => {
      if (!active) return;
      setVaults(result.vaults); setSelectedVault(current => current || result.vaults[0]?.vault || '');
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : 'Could not load your vaults.'); });
    return () => { active = false; };
  }, [credential, ready]);

  useEffect(() => {
    if (!ready || !credential || !pendingAlert) return;
    let active = true;
    void sentinel.alert(pendingAlert).then(alert => { if (active) setSelectedVault(alert.vault); })
      .catch(() => { /* The detail screen displays a retryable error without using payload data. */ })
      .finally(() => { if (active) { setAlertId(pendingAlert); setPendingAlert(null); setRoute('alert'); } });
    return () => { active = false; };
  }, [credential, ready, pendingAlert]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (route === 'connect') return false;
      setRoute(route === 'alert' ? (selectedVault ? 'alerts' : 'connect') : route === 'vault' ? 'connect' : 'vault'); return true;
    });
    return () => subscription.remove();
  }, [route, selectedVault]);

  async function signIn() {
    if (authLock.current) return;
    authLock.current = true; setBusy(true); setError(null); setPreview(false);
    try {
      const connected = wallet ?? await connectWallet(); setWallet(connected);
      await sentinel.signIn(connected.address, challenge => signSentinelChallenge(connected, challenge));
    } catch (e) { setError(e instanceof Error ? e.message : 'Wallet sign-in failed. Try again.'); }
    finally { authLock.current = false; setBusy(false); }
  }
  async function signOut() {
    if (authLock.current) throw new Error('Another wallet action is in progress. Please retry.');
    authLock.current = true; setBusy(true);
    try {
      await sentinel.logout(selectedVault || undefined);
      setPreview(false); setVault(''); setSelectedVault(''); setRoute('connect');
      if (wallet) {
        try { await disconnectWallet(wallet); setWallet(null); }
        catch { setWallet(null); setError('Signed out of Sentinel. Wallet authorization could not be revoked; revoke Argus in your wallet settings.'); }
      }
    } finally { authLock.current = false; setBusy(false); }
  }
  async function openVault(value: string) {
    if (authLock.current) return;
    authLock.current = true; setBusy(true); setError(null);
    try {
      const address = validateVaultAddress(value); await sentinel.vault(address);
      setSelectedVault(address); setRoute('vault');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not open this vault.'); }
    finally { authLock.current = false; setBusy(false); }
  }
  function enterDemo() {
    if (!mockSentinel) return;
    sentinel.enterDemo(MOCK_WALLET, mockSentinel.startPreview());
    setError(null); setPreview(true); setSelectedVault(MOCK_VAULT); setRoute('vault');
  }
  function cancel(alert: string) {
    if (!preview || !mockSentinel) return;
    mockSentinel.simulateCancel(alert);
    dispatch({ type: 'cancel', id: alert === 'al_9' ? 'WD-0042' : 'WD-0041', now: Date.now() });
  }
  function freeze() {
    if (!preview || !mockSentinel || state.frozen) return;
    Alert.alert('Freeze this demo vault?', 'Outgoing transfers will pause. In a live vault, unfreezing needs the guardian threshold.', [
      { text: 'Keep watching', style: 'cancel' }, { text: 'Freeze vault', onPress: () => {
        mockSentinel?.simulateFreeze(); dispatch({ type: 'freeze', now: Date.now() });
      } },
    ]);
  }
  const reset = () => { mockSentinel?.reset(); dispatch({ type: 'reset', now: Date.now() }); setRoute('vault'); };
  const showAlert = (id = 'al_9') => { setAlertId(id); setRoute('alert'); };
  const visibleRoute = !credential || (!selectedVault && route !== 'alert') ? 'connect' : route;
  let content;
  switch (visibleRoute) {
    case 'connect': content = <Connect wallet={credential?.wallet} busy={busy} error={null} vault={vault} vaults={vaults}
      demoAvailable={!!mockSentinel} onVault={setVault} onConnect={() => { void signIn(); }} onOpen={value => { void openVault(value); }}
      onSignOut={() => { void signOut().catch(e => setError(e instanceof Error ? e.message : 'Sign-out failed. Retry.')); }} onDemo={enterDemo} />; break;
    case 'vault': content = preview ? <Vault state={state} onAlert={() => showAlert()} onPending={() => setRoute('pending')}
      onSend={() => Alert.alert('Send is waiting for devnet', 'The real Anchor IDL and deployment have not landed. No transaction is built or sent.')} />
      : <SentinelVault vault={selectedVault} onAlerts={() => setRoute('alerts')} onChangeVault={() => setRoute('connect')} />; break;
    case 'pending': content = <Pending state={state} now={now} onCancel={id => cancel(id === 'WD-0042' ? 'al_9' : 'al_8')}
      onFreeze={freeze} onAlert={() => showAlert()} />; break;
    case 'alert': content = <ThreatAlert id={alertId} now={now} preview={preview} frozen={preview && state.frozen}
      onCancel={cancel} onFreeze={freeze} onBack={() => setRoute(selectedVault ? 'alerts' : 'connect')} />; break;
    case 'alerts': content = <Alerts vault={selectedVault} onOpen={showAlert} />; break;
    case 'guardians': content = <Guardians state={state} now={now} onVote={(type, id) => dispatch({ type, id, now: Date.now() })} />; break;
    case 'settings': content = <Settings vault={selectedVault} preview={preview} onSignOut={signOut} onReset={reset} onExit={() => setRoute('connect')} />; break;
  }
  const visibleTabs = preview ? tabs : tabs.filter(tab => ['vault', 'alerts', 'settings'].includes(tab.id));
  return <SafeAreaView style={s.root}>
    <View style={s.header}><Logo /><Status text="DEVNET" /></View>
    {sentinel.mock && <View style={s.demo}><Copy style={s.demoText}>LOCAL MOCK · SAMPLE DATA · NO REMOTE SERVICE</Copy></View>}
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView key={`${visibleRoute}:${selectedVault}:${alertId}:${credential?.wallet}`} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {error && <View style={{ gap: 8, marginBottom: 18 }}><Copy accessibilityRole="alert">{error}</Copy><Button title="Dismiss message" tone="quiet" onPress={() => setError(null)} /></View>}
        {pendingAlert && !credential && <Copy style={{ color: c.muted, marginBottom: 16 }}>Sign in to review the alert opened from your notification.</Copy>}
        {ready ? content : <ActivityIndicator color={c.fg} />}
      </ScrollView>
    </KeyboardAvoidingView>
    {credential && visibleRoute !== 'alert' && visibleRoute !== 'connect' && <View style={s.nav}>
      {visibleTabs.map(tab => <Pressable key={tab.id} accessibilityRole="tab" accessibilityState={{ selected: visibleRoute === tab.id }}
        onPress={() => setRoute(tab.id)} style={[s.tab, visibleRoute === tab.id && s.activeTab]}>
        <Copy style={{ fontFamily: visibleRoute === tab.id ? f.semibold : f.body, color: visibleRoute === tab.id ? c.fg : c.muted, fontSize: 11 }}>{tab.title}</Copy>
      </Pressable>)}
    </View>}
  </SafeAreaView>;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.ink },
  loading: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 18 },
  demo: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.line, paddingHorizontal: 24, paddingVertical: 10 },
  demoText: { fontFamily: f.mono, fontSize: 9, color: c.muted, letterSpacing: 0.3 },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 22, paddingBottom: 24 },
  nav: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.panel },
  tab: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', borderTopWidth: 2, borderTopColor: 'transparent' },
  activeTab: { borderTopColor: c.fg },
});
