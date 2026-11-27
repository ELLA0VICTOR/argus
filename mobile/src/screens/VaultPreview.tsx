import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, Copy, Field, Panel, common } from '../components/ui';
import { ActivityTimeline, AllowanceMeter, KeyAvatar, ProgressTrack, RouteIndicator } from '../components/VaultPatterns';
import type { AppTab } from '../components/AppChrome';
import { colors as c, fonts as f } from '../theme';
import { countdown } from '../domain/demo';
import { FreezeButton } from '../components/FreezeButton';
import { sendRoute } from '../domain/vaultMetrics';
import { formatTypedAmount } from '../domain/amountInput';

/** The same read-only preview shown by the web app before a wallet connects.
 * Preview actions open MWA; they never simulate a successful transaction or call.
 */
export function VaultPreview({ tab, onTab, onConnect, onDemo, busy }: {
  tab: AppTab; onTab: (tab: AppTab) => void; onConnect: () => void; onDemo: () => void; busy: boolean;
}) {
  const [amount, setAmount] = useState('');
  const [destination, setDestination] = useState('');
  const [details, setDetails] = useState(false);
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(started);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const entered = /^(\d+)(?:\.(\d{0,6}))?$/.exec(amount.replace(/,/g, '').trim());
  const value = entered ? BigInt(entered[1]) * 1_000_000n + BigInt((entered[2] ?? '').padEnd(6, '0') || '0') : 0n;
  const route = sendRoute(value, 81_500_000n, destination.trim() === 'EfK2xChG7vR4tY9pK1sD6fH3jG8aZcE5uN2oP4wLq9mX', /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(destination.trim()));
  const section = (title: string) => <Copy style={{ fontFamily: f.semibold, fontSize: 15, paddingHorizontal: 4 }}>{title}</Copy>;
  if (tab === 'Home') return <View style={{ gap: 32 }}>
    <Panel style={{ borderRadius: 28, padding: 24, gap: 18 }}>
      <Copy style={common.muted}>Savings vault</Copy>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <Copy style={[common.amount, { fontSize: 44, fontFamily: f.medium }]}>12,480.50</Copy><Copy style={{ color: c.muted, fontSize: 18 }}>USDC</Copy>
      </View>
      <AllowanceMeter remaining="81.50" total="100.00" fraction={0.815} />
      <Copy style={[common.muted, { fontSize: 13 }]}>Larger amounts wait 24h and can be cancelled.</Copy>
      <View style={common.row}><View style={{ flex: 1 }}><Button title="Send" onPress={() => onTab('Send')} /></View><View style={{ flex: 1 }}><Button title="Deposit" tone="secondary" disabled={busy} onPress={onConnect} /></View></View>
      <FreezeButton onPress={onConnect} disabled={busy} />
      <Copy style={[common.muted, common.divider, { fontSize: 13 }]}>This is a preview. <Copy onPress={onConnect} accessibilityRole="link" style={{ fontFamily: f.medium }}>Connect a wallet</Copy> to open your own vault on devnet.</Copy>
    </Panel>
    <View style={{ gap: 12 }}>{section('Needs your attention')}
      <Panel style={{ padding: 20 }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.threat }} /><Copy style={[common.muted, { fontSize: 13, flex: 1 }]}>Looks suspicious. Argus is calling you.</Copy></View>
        <Copy style={[common.amount, { fontSize: 24 }]}>12,000.00 <Copy style={common.muted}>USDC</Copy></Copy>
        <Copy style={common.muted}>to <Copy style={[common.mono, { fontSize: 12 }]}>9WzD…AwfM</Copy></Copy>
        <View style={common.row}><View style={{ gap: 4 }}><Copy style={[common.muted, { fontSize: 12 }]}>Leaves in</Copy><Copy style={[common.num, { color: c.wait, fontSize: 20 }]}>{countdown(started + 85_280_000, now)}</Copy></View><Button title="Cancel" tone="threat" disabled={busy} onPress={onConnect} /></View>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: details }} onPress={() => setDetails(!details)} style={{ minHeight: 44, justifyContent: 'center' }}><Copy style={common.muted}>Why Argus flagged this {details ? '⌃' : '⌄'}</Copy></Pressable>
        {details && <Copy style={common.muted}>This sends 96% of the vault to an address created 14 minutes ago that imitates your trusted address Hk2v…Q8 but isn't it. It was requested at 03:12, outside your usual hours.</Copy>}
      </Panel>
    </View>
    <View style={{ gap: 12 }}>{section('Waiting to leave')}
      <Panel><Copy style={[common.amount, { fontSize: 24 }]}>200.00 <Copy style={common.muted}>USDC</Copy></Copy><Copy style={common.muted}>to <Copy style={[common.mono, { fontSize: 12 }]}>Bq4n…E3rT</Copy> · New recipient</Copy>
        <View style={common.row}><View style={{ gap: 4 }}><Copy style={[common.muted, { fontSize: 12 }]}>Leaves in</Copy><Copy style={[common.num, { color: c.wait, fontSize: 20 }]}>{countdown(started + 39_400_000, now)}</Copy></View><Button title="Cancel" tone="secondary" disabled={busy} onPress={onConnect} /></View>
        <ProgressTrack fraction={(47_000_000 + now - started) / 86_400_000} label="Preview withdrawal wait elapsed" />
      </Panel>
    </View>
    <View style={{ gap: 12 }}><View style={common.row}>{section('Recent activity')}<Pressable accessibilityRole="link" onPress={() => onTab('Activity')} style={{ minHeight: 44, justifyContent: 'center' }}><Copy style={common.muted}>View all →</Copy></Pressable></View><PreviewActivity /></View>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}><Copy style={[common.muted, { flex: 1, fontSize: 13 }]}>No wallet or sign-up needed. Test tokens only.</Copy><Pressable accessibilityRole="button" onPress={onDemo} disabled={busy} style={{ minHeight: 44, justifyContent: 'center' }}><Copy style={{ color: c.brand, fontFamily: f.medium }}>Try live demo →</Copy></Pressable></View>
  </View>;
  return <View style={common.stack}><Copy accessibilityRole="header" style={common.title}>{tab}</Copy>
    {tab === 'Send' && <Panel style={{ borderRadius: 28 }}>
      <Field label="Amount" placeholder="0" value={amount} onChangeText={value => setAmount(formatTypedAmount(value))} keyboardType="decimal-pad" style={{ fontSize: 40 }} />
      <Copy style={[common.muted, { fontSize: 13 }]}>Instant today: 81.50 USDC</Copy>
      <Field label="To" placeholder="Paste a Solana address" value={destination} onChangeText={setDestination} autoCapitalize="none" autoCorrect={false} />
      <RouteIndicator selected={route} waitLabel="24h" disabled />
      <Copy style={common.muted}>{value > 12_480_500_000n ? "That's more than the vault holds." : route === 'trusted' ? 'Goes now. This is one of your trusted addresses.' : route === 'instant' ? "Goes now. It fits within today's allowance." : route === 'delayed' ? 'Waits 24h, then goes. You can cancel it until then.' : "Argus tells you how it'll go before you sign anything."}</Copy>
      <Button title="Continue" busy={busy} disabled={!route || value > 12_480_500_000n} onPress={onConnect} />
    </Panel>}
    {tab === 'Activity' && <><Copy style={common.muted}>Everything Argus saw and did, newest first.</Copy><PreviewActivity /></>}
    {tab === 'Guardians' && <>
      <Copy style={common.muted}>Any one guardian can cancel, freeze, or move everything to your safe address. 2 of 3 are needed to change keys or rules.</Copy>
      {section('Proposals')}<Panel><Copy style={{ fontFamily: f.medium }}>No open proposals</Copy><Copy style={common.muted}>Changes to keys, limits or trusted addresses show up here for guardians to approve.</Copy></Panel>
      {section("Who's protecting this vault")}<Panel>{['You', 'Ada', 'Tunde', 'AI guardian'].map((name, i) => <View key={name} style={[common.row, i > 0 && common.divider]}><KeyAvatar label={name} ai={i === 3} /><View style={{ flex: 1, gap: 4 }}><Copy>{name}</Copy><Copy style={common.muted}>{i === 0 ? 'Backup key · Seeker' : i === 3 ? 'Can cancel or freeze. Cannot move funds.' : 'Family'}</Copy></View></View>)}</Panel>
    </>}
    {tab === 'Settings' && <>
      <Copy style={common.muted}>These rules live on-chain. Changing them takes your guardians, through a proposal.</Copy>
      {section('Spending')}<Panel><Copy>Instant allowance</Copy><Copy style={common.muted}>Spend this much per day without waiting.</Copy><Copy style={common.num}>100.00 USDC</Copy><View style={common.divider}><Copy>Delay for larger amounts</Copy></View><Copy style={common.muted}>Anyone protecting the vault can cancel during this time.</Copy><Copy style={common.num}>24h</Copy></Panel>
      {section('Safe address')}<Panel><Copy>Cold wallet (Ledger)</Copy><Copy style={common.muted}>If something goes wrong, any guardian can move everything here.</Copy></Panel>
      <Button title="Connect wallet" busy={busy} onPress={onConnect} />
    </>}
    <Copy style={[common.muted, { fontSize: 13 }]}>This is a preview. Connect a wallet to open your own vault on devnet.</Copy>
  </View>;
}

function PreviewActivity() {
  return <Panel><ActivityTimeline entries={[
    { id: 'risk', title: 'Argus rated it critical risk', detail: 'Savings vault' },
    { id: 'lookalike', title: 'It imitates one of your trusted addresses', detail: 'Savings vault' },
    { id: 'new', title: 'The destination was created 14 minutes ago', detail: 'Savings vault' },
    { id: 'withdrawal', title: 'Withdrawal of 12,000.00 USDC requested', detail: 'Savings vault' },
  ]} /></Panel>;
}
