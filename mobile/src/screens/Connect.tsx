import { View } from 'react-native';
import { Button, Copy, Field, Label, Panel, common } from '../components/ui';
import type { VaultList } from '../sentinel/types';
import { DawnHero } from '../components/DawnHero';
import { userMessage } from '../domain/userMessage';

export function Connect({ wallet, busy, error, vault, vaults, demoAvailable, onVault, onConnect, onOpen, onDemo, onSignOut }: {
  wallet: string | undefined; busy: boolean; error: string | null; vault: string; vaults: VaultList['vaults']; demoAvailable: boolean;
  onVault: (value: string) => void; onConnect: () => void; onOpen: (value: string) => void;
  onDemo: () => void; onSignOut: () => void;
}) {
  return <View style={[common.stack, { flex: 1 }]}>
    <DawnHero />
    <Panel>
      <Label>SIGN IN WITH YOUR WALLET</Label>
      <Copy style={common.muted}>Sign a Sentinel sign-in message with the Solana wallet on your phone. This does not move funds or approve a transaction.</Copy>
      {wallet ? <>
        <Copy style={common.mono} selectable>{wallet}</Copy>
        {vaults.map(item => <View key={item.vault} style={{ gap: 8 }}>
          <Copy style={common.mono} selectable>{item.vault}</Copy><Copy style={common.muted}>Your role: {item.role}</Copy>
          <Button title="Open this vault" disabled={busy} onPress={() => onOpen(item.vault)} />
        </View>)}
        <Field label="Or enter a vault account address" value={vault} onChangeText={onVault} autoCapitalize="none"
          autoCorrect={false} placeholder="Paste your vault address" editable={!busy} />
        <Button title="Open entered vault" disabled={busy || !vault.trim()} onPress={() => onOpen(vault)} />
        <Button title="Sign out" tone="quiet" onPress={onSignOut} disabled={busy} />
      </> : <Button title="Connect wallet and sign in" busy={busy} busyTitle="Waiting for your wallet…" onPress={onConnect} />}
      {error && <Copy accessibilityRole="alert">{userMessage(error, 'Could not connect your wallet. Please try again.')}</Copy>}
    </Panel>
    <View style={{ flex: 1 }} />
    {demoAvailable && <><Copy style={[common.muted, { textAlign: 'center', fontSize: 13 }]}>Explore sample funds, contacts and alerts without a wallet.</Copy>
      <Button title="Explore the demo" disabled={busy} onPress={onDemo} /></>}
    <Copy style={[common.muted, { textAlign: 'center', fontSize: 12 }]}>Devnet only · No real funds</Copy>
  </View>;
}
