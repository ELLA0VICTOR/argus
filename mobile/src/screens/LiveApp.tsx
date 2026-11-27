import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { Alert, AppState, BackHandler, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PublicKey, type TransactionInstruction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, getMint, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Button, Copy, Field, Label, Panel, common } from '../components/ui';
import { AppHeader, AppTabBar, type AppTab } from '../components/AppChrome';
import { VaultPreview } from './VaultPreview';
import { FreezeButton } from '../components/FreezeButton';
import { TransactionNotice } from '../components/TransactionNotice';
import { ActivityTimeline, AllowanceMeter, KeyAvatar, RouteIndicator, WaitProgress } from '../components/VaultPatterns';
import { allowanceFraction, allowanceRemaining, delayLabel, sendRoute } from '../domain/vaultMetrics';
import { connectWallet, disconnectWallet, signWalletTransaction, type WalletSession } from '../services/wallet';
import { programClient as client, connection } from '../program/runtime';
import { readVault, readWalletVaults, type VaultView } from '../program/read';
import { integer, type GovAction, type RecordAt, type Proposal, type Withdrawal } from '../program/client';
import { checkTransaction, parseAmount, restorePendingTransaction, runTransaction, saveTransaction, transactionBusy, type TransactionState } from '../program/transactions';
import { formatUnits } from '../sentinel/rules';
import { countdown } from '../domain/demo';
import { colors as c, fonts as f } from '../theme';
import { userMessage } from '../domain/userMessage';
import { formatTypedAmount } from '../domain/amountInput';
import * as SecureStore from 'expo-secure-store';
import { DEMO_MINT, SENTINEL_AI_GUARDIAN } from '../sentinel/demo';

const key = (value: string) => {
  try { return new PublicKey(value.trim()); }
  catch { throw new Error('Enter a valid Solana wallet or account address.'); }
};
const numberId = (value: { toString(): string }) => BigInt(value.toString());

export function LiveApp({ active = true, onLiveDemo, onBusy }: { active?: boolean; onLiveDemo: () => void; onBusy: (busy: boolean) => void }) {
  const [wallet, setWallet] = useState<WalletSession | null>(null);
  const [address, setAddress] = useState('');
  const [vaultChoices, setVaultChoices] = useState<string[]>([]);
  const [view, setView] = useState<VaultView | null>(null);
  const [tab, setTab] = useState<AppTab>('Home');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tx, setTx] = useState<TransactionState>({ phase: 'idle' });
  const [now, setNow] = useState(Date.now());
  const [creating, setCreating] = useState(false);
  const [amount, setAmount] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [destination, setDestination] = useState('');
  const [depositing, setDepositing] = useState(false);
  const [mint, setMint] = useState(DEMO_MINT);
  const [guardians, setGuardians] = useState('');
  const [threshold, setThreshold] = useState('1');
  const [ai, setAi] = useState(SENTINEL_AI_GUARDIAN);
  const [safe, setSafe] = useState('');
  const [delay, setDelay] = useState('86400');
  const [limit, setLimit] = useState('100');
  const [vaultName, setVaultName] = useState('Savings');
  const [displayName, setDisplayName] = useState('Your');
  const [advanced, setAdvanced] = useState(false);
  const [proposalWallet, setProposalWallet] = useState('');
  const [action, setAction] = useState<'unfreeze' | 'addTrusted' | 'removeTrusted' | 'rotateOwner'>('unfreeze');
  const lock = useRef(false);
  const current = useRef('');
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [tab, !!view, creating]);
  const busy = loading || transactionBusy(tx);
  useEffect(() => { if (active) onBusy(transactionBusy(tx)); }, [active, tx.phase, onBusy]);
  useEffect(() => { void restorePendingTransaction(SecureStore).then(pending => {
    if (pending) setTx(pending);
  }).catch(() => setError('Could not restore transaction status. Check recent wallet activity before sending again.')); }, []);

  const refresh = useCallback(async (selected = current.current) => {
    if (!selected) return;
    setLoading(true);
    try {
      const result = await readVault(client, key(selected));
      const name = await SecureStore.getItemAsync(`argus.vault.${selected}.name`).catch(() => null);
      if (current.current === selected) { setDisplayName(name || 'Your'); setView(result); setError(null); }
    } catch { if (current.current === selected) setError('Could not refresh this devnet vault. Check the address and your connection, then retry.'); }
    finally { if (current.current === selected) setLoading(false); }
  }, []);

  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { const sub = AppState.addEventListener('change', state => { if (active && state === 'active' && !lock.current) void refresh(); }); return () => sub.remove(); }, [active, refresh]);
  useEffect(() => { if (!active) return; const sub = BackHandler.addEventListener('hardwareBackPress', () => {
    if (busy) return true;
    if (creating) { setCreating(false); return true; }
    if (view && tab !== 'Home') { setTab('Home'); return true; }
    if (view) { current.current = ''; setView(null); return true; }
    return false;
  }); return () => sub.remove(); }, [active, view, tab, busy, creating]);

  async function connect() {
    if (lock.current) return;
    lock.current = true; setLoading(true); setError(null);
    try {
      const session = await connectWallet(); setWallet(session);
      try {
        const choices = (await readWalletVaults(client, key(session.address))).map(v => v.address.toBase58());
        setVaultChoices(choices);
        if (choices.length) { current.current = choices[0]; setAddress(choices[0]); await refresh(choices[0]); }
        else setCreating(true);
      }
      catch { setError("Couldn't reach devnet to look for your vault. Try again."); }
    }
    catch (e) { console.info('Wallet connection failed', e); setError('Could not connect your wallet. Open your Solana wallet and try again.'); }
    finally { lock.current = false; setLoading(false); }
  }
  async function open() {
    if (busy) return;
    try { const selected = key(address).toBase58(); current.current = selected; setView(null); await refresh(selected); setTab('Home'); }
    catch { setError('Enter a valid vault account address.'); }
  }

  async function perform(build: (signer: PublicKey) => Promise<TransactionInstruction[]>) {
    if (lock.current || transactionBusy(tx) || !wallet) return;
    lock.current = true; setError(null); setTx({ phase: 'preparing' });
    try {
      const instructions = await build(key(wallet.address));
      const result = await runTransaction(connection, key(wallet.address), instructions,
        transaction => signWalletTransaction(wallet, transaction), setTx,
        pending => saveTransaction(SecureStore, pending));
      await saveTransaction(SecureStore, result)
        .catch(() => setError('Transaction status could not be saved. Keep its Explorer link; the on-chain result above still applies.'));
      if (result.phase === 'confirmed') await refresh();
    } catch (e) { console.info('Could not prepare transaction', e); setTx({ phase: 'failed', message: userMessage(e, 'Could not prepare this action. Refresh and retry.') }); }
    finally { lock.current = false; }
  }
  function confirm(title: string, body: string, build: (signer: PublicKey) => Promise<TransactionInstruction[]>) {
    Alert.alert(title, body, [{ text: 'Go back', style: 'cancel' }, { text: 'Review in wallet', onPress: () => { void perform(build); } }]);
  }
  const fresh = async () => client.fetchVault(key(current.current));
  const v = view?.vault;
  const guardianIndex = wallet && v ? v.data.guardians.slice(0, v.data.guardianCount).findIndex(g => g.toBase58() === wallet.address) : -1;
  const owner = !!wallet && v?.data.owner.toBase58() === wallet.address;
  const protective = owner || guardianIndex >= 0 || (!!wallet && v?.data.aiGuardian.toBase58() === wallet.address);
  const symbol = v?.data.mint.toBase58() === DEMO_MINT ? 'dUSDC' : 'tokens';
  const units = (value: string) => `${formatUnits(value, view?.decimals ?? 0)} ${symbol}`;
  const remaining = v ? allowanceRemaining(numberId(v.data.dailyLimit), numberId(v.data.spentInWindow), numberId(v.data.windowStart), BigInt(Math.floor(now / 1000))) : 0n;
  let parsedAmount = 0n;
  try { parsedAmount = parseAmount(amount.replace(/,/g, ''), view?.decimals ?? 6); } catch { /* A partially typed amount has no route yet. */ }
  let validDestination = false;
  try { const recipient = key(destination); validDestination = !recipient.equals(PublicKey.default) && !recipient.equals(v?.address ?? PublicKey.default); } catch { /* Keep the route unset for an incomplete address. */ }
  const trustedRecipient = view?.trusted.some(t => t.data.wallet.toBase58() === destination.trim() && numberId(t.data.activeAt) <= BigInt(Math.floor(now / 1000)));
  const sendMode = sendRoute(parsedAmount, remaining, !!trustedRecipient, validDestination);
  const sendError = amount && !parsedAmount ? `Enter a number with up to ${view?.decimals ?? 6} decimals.`
    : view && parsedAmount > BigInt(view.balance) ? "That's more than the vault holds."
    : destination.trim() === v?.address.toBase58() ? "You can't send the vault to itself."
    : destination && !validDestination ? "That doesn't look like a Solana address." : null;
  function freeze() {
    if (!v) return;
    confirm('Pause outgoing transfers?', 'Any owner or guardian can freeze. Unfreezing needs guardian approval.', async signer => {
      const latest = await fresh(); return [await client.freeze(latest.address, signer)];
    });
  }
  function cancel(w: RecordAt<Withdrawal>) {
    confirm('Cancel this withdrawal?', 'Its funds will stay in the vault. The original request payer receives the rent refund.', async signer => {
      const latest = await client.fetchWithdrawal(w.address, key(current.current));
      return [await client.cancelWithdrawal(signer, latest)];
    });
  }
  function proposalAction(p: RecordAt<Proposal>, type: 'approve' | 'veto' | 'execute' | 'close') {
    confirm(type === 'approve' ? 'Approve this change?' : type === 'veto' ? 'Veto this change?' : type === 'close' ? 'Close this dead proposal?' : 'Apply this approved change?',
      'Review the proposal details before signing. The program checks your role, approvals and delay.', async signer => {
        const latest = await client.fetchProposal(p.address, key(current.current));
        return [await (type === 'approve' ? client.approve(signer, latest) : type === 'veto' ? client.veto(signer, latest)
          : type === 'close' ? client.closeProposal(signer, latest) : client.executeProposal(signer, latest))];
      });
  }
  const txNotice = <TransactionNotice state={tx} onCheck={() => { void checkTransaction(connection, tx).then(async state => {
    setTx(state); await saveTransaction(SecureStore, state); if (state.phase === 'confirmed') await refresh();
  }).catch(() => setError('Could not check confirmation. Keep this signature and try checking again.')); }} />;

  let content;
  if (!v || !view) content = <View style={common.stack}>
    {!wallet ? <VaultPreview tab={tab} onTab={setTab} onConnect={() => { void connect(); }} onDemo={onLiveDemo} busy={busy} />
      : <Panel><Copy style={common.title}>{creating ? 'Set up your vault' : 'Your vaults'}</Copy>
        {!creating ? <>{vaultChoices.map(selected => <View key={selected} style={{ gap: 8 }}><Copy selectable style={common.mono}>{selected}</Copy><Button title="Open this vault" tone="secondary" disabled={busy} onPress={() => { current.current = selected; setAddress(selected); void refresh(selected); }} /></View>)}
          <Field label="Vault address" value={address} onChangeText={setAddress} autoCapitalize="none" autoCorrect={false} placeholder="Paste a vault account address" />
          <Button title="Open vault" busy={loading} disabled={!address.trim()} onPress={() => { void open(); }} />
          <Button title="Create a new vault" tone="quiet" disabled={busy} onPress={() => setCreating(true)} /></>
          : <>
            <Copy style={common.muted}>Your connected wallet becomes the owner key. Guardians can cancel, freeze and approve changes. They can never take your money.</Copy>
            <Field label="Name it" value={vaultName} onChangeText={setVaultName} placeholder="Savings" maxLength={32} />
            <Copy style={[common.muted, { fontSize: 13 }]}>Only you see this name. It's saved on this device.</Copy>
            <Label>Guardians</Label><Copy style={common.muted}>People or keys you trust: family, a second device, a backup key. Any one of them can cancel a withdrawal or freeze the vault.</Copy>
            <Field label="Wallet addresses, separated by commas" value={guardians} onChangeText={setGuardians} autoCapitalize="none" autoCorrect={false} multiline />
            <Field label="Approvals needed" value={threshold} onChangeText={setThreshold} keyboardType="number-pad" />
            <Label>Safe address</Label><Copy style={common.muted}>If something goes wrong, any guardian can move everything here. Use a wallet the owner key doesn't control, like a hardware wallet.</Copy>
            <Field label="Wallet address" value={safe} onChangeText={setSafe} autoCapitalize="none" autoCorrect={false} />
            <Label>Spending rules</Label><Copy style={common.muted}>Up to the allowance goes out instantly each day. Anything bigger waits, and can be cancelled while it waits.</Copy>
            <Field label="Daily allowance" value={limit} onChangeText={setLimit} keyboardType="decimal-pad" />
            <Copy style={common.muted}>Wait for larger amounts</Copy>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{[{ label: '1 min', value: '60' }, { label: '1h', value: '3600' }, { label: '24h', value: '86400' }, { label: '3d', value: '259200' }].map(option => <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: delay === option.value }} disabled={busy} onPress={() => setDelay(option.value)} style={{ minWidth: '45%', flexGrow: 1, minHeight: 44, padding: 12, borderRadius: 12, backgroundColor: delay === option.value ? c.fg : c.panel }}><Copy style={{ color: delay === option.value ? c.ink : c.fg }}>{option.label}</Copy></Pressable>)}</View>
            <Label>AI guardian</Label><Copy style={common.muted}>Argus watches every withdrawal and calls you when one looks like theft. Its key can only cancel and freeze. It can never move funds or vote.</Copy>
            <View style={common.row}><Copy style={{ flex: 1 }}>Let Argus watch this vault</Copy><Switch accessibilityLabel="Let Argus watch this vault" value={!!ai.trim()} disabled={busy} trackColor={{ true: c.brand, false: c.lineStrong }} onValueChange={enabled => setAi(enabled ? SENTINEL_AI_GUARDIAN : '')} /></View>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: advanced }} onPress={() => setAdvanced(!advanced)} style={{ minHeight: 44, justifyContent: 'center' }}><Copy style={common.muted}>Advanced {advanced ? '⌃' : '⌄'}</Copy></Pressable>
            {advanced && <><Field label="Token mint" value={mint} onChangeText={setMint} autoCapitalize="none" autoCorrect={false} /><Field label="AI guardian public address" value={ai} onChangeText={setAi} autoCapitalize="none" autoCorrect={false} /></>}
            <Button title="Create vault" disabled={busy} onPress={() => confirm('Create this vault?', 'Check every address. Guardians control changes to your vault’s rules.', async signer => {
              const token = await getMint(connection, key(mint), 'confirmed', TOKEN_PROGRAM_ID);
              const set = guardians.split(',').map(g => key(g)); const t = Number(threshold);
              if (!/^\d+$/.test(delay)) throw new Error('Enter the withdrawal delay in whole seconds.');
              const d = BigInt(delay);
              if (set.length < 1 || set.length > 5 || new Set(set.map(g => g.toBase58())).size !== set.length || set.some(g => g.equals(signer)) || !Number.isInteger(t) || t < 1 || t > set.length) throw new Error('Use 1–5 distinct guardian wallets separate from your owner, with a valid approval threshold.');
              if (d < 60n || d > 2592000n) throw new Error('Choose a delay between 60 seconds and 30 days.');
              const id = BigInt(Date.now()); const selected = client.vaultAddress(signer, id)[0].toBase58();
              const ix = await client.initializeVault(signer, key(mint), { vaultId: id, guardians: set, threshold: t,
                aiGuardian: ai.trim() ? key(ai) : PublicKey.default, safeAddress: key(safe), delaySeconds: d, dailyLimit: limit.trim() === '0' ? 0n : parseAmount(limit, token.decimals) });
              await SecureStore.setItemAsync(`argus.vault.${selected}.name`, vaultName.trim() || 'Your');
              current.current = selected; setAddress(selected); return [ix];
            })} />
            <Copy style={[common.muted, { fontSize: 12 }]}>One signature. It costs a little devnet SOL for rent and fees.</Copy>
            <Button title="Back to your vaults" tone="quiet" disabled={busy} onPress={() => setCreating(false)} /></>}
      </Panel>}
    {txNotice}
  </View>;
  else content = <View style={common.stack}>
    {tab !== 'Home' && <View style={{ gap: 12 }}><Copy accessibilityRole="header" style={common.title}>{tab}</Copy>
      {tab === 'Activity' && <Copy style={common.muted}>Everything Argus saw and did, newest first.</Copy>}
      {tab === 'Guardians' && <Copy style={common.muted}>Any one guardian can cancel, freeze, or move everything to your safe address. {v.data.threshold} of {v.data.guardianCount} are needed to change keys or rules.</Copy>}
      {tab === 'Settings' && <Copy style={common.muted}>These rules live on-chain. Changing them takes your guardians, through a proposal.</Copy>}
    </View>}
    {txNotice}
    {tab === 'Home' && <>
      <Panel style={{ borderRadius: 28, padding: 24, gap: 18 }}><Copy style={common.muted}>{displayName} vault</Copy>
        <Copy style={[common.amount, { fontSize: 40 }]}>{formatUnits(view.balance, view.decimals)} <Copy style={{ color: c.muted, fontSize: 18 }}>{symbol}</Copy></Copy>
        {v.data.frozen ? <Copy style={common.muted}>Nothing can leave until {v.data.threshold} guardians unfreeze it.</Copy> : <>
        <AllowanceMeter remaining={formatUnits(remaining.toString(), view.decimals)} total={formatUnits(v.data.dailyLimit.toString(), view.decimals)} fraction={allowanceFraction(remaining, numberId(v.data.dailyLimit))} />
        <Copy style={[common.muted, { fontSize: 13 }]}>Larger amounts wait {delayLabel(numberId(v.data.delaySeconds))} and can be cancelled.</Copy></>}
        {owner && <View style={common.row}><View style={{ flex: 1 }}><Button title="Send" disabled={v.data.frozen || busy} onPress={() => setTab('Send')} /></View><View style={{ flex: 1 }}><Button title="Deposit" tone="secondary" disabled={busy} onPress={() => setDepositing(!depositing)} /></View></View>}
        {depositing && <View style={{ gap: 16 }}><Copy style={common.muted}>Move test {symbol} from your wallet into the vault.</Copy>
        <Field label="Amount to deposit" value={depositAmount} onChangeText={setDepositAmount} keyboardType="decimal-pad" placeholder="0.00" editable={!busy} />
        <Button title="Deposit" tone="secondary" disabled={busy || !wallet || !depositAmount.trim()} onPress={() => confirm('Deposit into this vault?', `${depositAmount} ${symbol} will move from your wallet to this vault.`, async signer => {
          const latest = await fresh(); const from = getAssociatedTokenAddressSync(latest.data.mint, signer);
          return [await client.deposit(latest, signer, from, parseAmount(depositAmount, view.decimals))];
        })} /></View>}
        <FreezeButton disabled={!protective || busy} frozen={v.data.frozen} onPress={freeze} />
      </Panel>
      <View style={{ gap: 12 }}><Copy style={s.section}>Waiting to leave</Copy><Panel>{view.withdrawals.length === 0 ? <Copy style={common.muted}>No pending withdrawals.</Copy> : view.withdrawals.slice(0, 3).map((w, i) => <View key={w.address.toBase58()} style={[i > 0 && common.divider, { gap: 12 }]}>
        <Copy style={common.num}>{units(w.data.amount.toString())}</Copy><Copy style={common.muted}>Request {w.data.id.toString()}</Copy>
        <Copy style={[common.mono, { color: c.muted, fontSize: 12 }]}>to {w.data.destination.toBase58().slice(0, 4)}…{w.data.destination.toBase58().slice(-4)}</Copy>
        <WaitProgress requestedAt={Number(w.data.requestedAt.toString()) * 1000} executesAt={Number(w.data.executesAt.toString()) * 1000} now={now} />
        <View style={{ alignSelf: 'flex-start' }}><Button title="Cancel" tone="secondary" disabled={!protective || busy} onPress={() => cancel(w)} /></View>
      </View>)}{view.withdrawals.length > 0 && <Button title="View all" tone="quiet" onPress={() => setTab('Activity')} />}</Panel></View>
      <VaultActivity history={view.history} limit={4} />
      <Pressable accessibilityRole="button" onPress={onLiveDemo} disabled={busy} style={{ alignSelf: 'flex-end', minHeight: 44, justifyContent: 'center' }}><Copy style={{ color: c.brand, fontFamily: f.medium }}>Try live demo →</Copy></Pressable>
    </>}
    {tab === 'Send' && <>
      {!owner || v.data.frozen ? <Copy style={common.muted}>{v.data.frozen ? `The vault is frozen, so nothing can leave. Unfreezing takes ${v.data.threshold} guardians.` : "Only the owner key can send. Guardians can't move funds anywhere except a sweep to your safe address, which keeps a single compromised guardian harmless."}</Copy> : <Panel style={{ borderRadius: 28 }}>
        <Field label="Amount" value={amount} onChangeText={value => setAmount(formatTypedAmount(value))} keyboardType="decimal-pad" placeholder="0" style={{ fontSize: 40 }} />
        <Copy style={[common.muted, { fontSize: 13 }]}>Instant today: {units(remaining.toString())}</Copy>
        <Field label="To" value={destination} onChangeText={setDestination} placeholder="Paste a Solana address" autoCapitalize="none" autoCorrect={false} />
        <RouteIndicator selected={sendError ? null : sendMode} waitLabel={delayLabel(numberId(v.data.delaySeconds))} disabled />
        <Copy style={common.muted}>{sendError ?? (!sendMode ? "Argus tells you how it'll go before you sign anything." : sendMode === 'delayed' ? `Waits ${delayLabel(numberId(v.data.delaySeconds))}, then goes. You can cancel it until then.` : sendMode === 'trusted' ? 'Goes now. This is one of your trusted addresses.' : "Goes now. It fits within today's allowance.")}</Copy>
        <Button title="Continue" disabled={!owner || busy || v.data.frozen || !sendMode || !!sendError} onPress={() => confirm('Review this transfer?', `${amount} ${symbol} to ${destination}. ${sendMode === 'delayed' ? 'The program will hold the request until its delay ends.' : 'This transfer moves tokens immediately.'}`, async signer => {
          const latest = await fresh(); const receiver = key(destination); const value = parseAmount(amount.replace(/,/g, ''), view.decimals);
          if (receiver.equals(latest.address) || receiver.equals(PublicKey.default)) throw new Error('Choose a valid recipient wallet other than the vault.');
          const ata = getAssociatedTokenAddressSync(latest.data.mint, receiver, true);
          const create = createAssociatedTokenAccountIdempotentInstruction(signer, ata, receiver, latest.data.mint);
          const ix = sendMode === 'delayed' ? await client.requestWithdrawal(latest, signer, ata, value)
            : sendMode === 'instant' ? await client.withdrawInstant(latest, signer, ata, value)
            : await client.program.methods.withdrawTrusted(integer(value)).accountsStrict({ vault: latest.address, owner: signer,
              mint: latest.data.mint, tokenProgram: TOKEN_PROGRAM_ID, vaultToken: client.vaultToken(latest), destination: ata,
              trusted: client.trustedAddress(latest.address, receiver)[0] }).instruction();
          return [create, ix];
        })} />
      </Panel>}
    </>}
    {tab === 'Activity' && <>
      {view.withdrawals.length === 0 && <Panel><Copy>No pending withdrawals. Your vault is quiet.</Copy></Panel>}
      {view.withdrawals.map(w => <Panel key={w.address.toBase58()}>
        <Copy style={common.amount}>{units(w.data.amount.toString())}</Copy><Copy selectable style={common.mono}>{w.data.destination.toBase58()}</Copy>
        <WaitProgress requestedAt={Number(w.data.requestedAt.toString()) * 1000} executesAt={Number(w.data.executesAt.toString()) * 1000} now={now} />
        {w.data.ownerEpoch !== v.data.ownerEpoch && <Copy style={common.muted}>The owner changed. This request can only be cancelled.</Copy>}
        <Button title="Cancel" tone="secondary" disabled={!protective || busy} onPress={() => cancel(w)} />
        <Button title="Release" tone="secondary" disabled={busy || v.data.frozen || w.data.ownerEpoch !== v.data.ownerEpoch || BigInt(Math.floor(now / 1000)) < numberId(w.data.executesAt)} onPress={() => confirm('Release this withdrawal?', 'This sends the exact stored amount to the exact stored token account.', async signer => {
          const latest = await fresh(); const request = await client.fetchWithdrawal(w.address, latest.address);
          return [await client.executeWithdrawal(latest, signer, request)];
        })} />
      </Panel>)}
      <FreezeButton disabled={!protective || busy} frozen={v.data.frozen} onPress={freeze} />
      <VaultActivity history={view.history} />
    </>}
    {tab === 'Guardians' && <>
      <Copy style={s.section}>Who's protecting this vault</Copy><Panel>{v.data.guardians.slice(0, v.data.guardianCount).map((g, i) => <View key={g.toBase58()} style={common.row}><KeyAvatar label={`Guardian ${i + 1}`} /><View style={{ flex: 1, gap: 4 }}><Copy>Guardian {i + 1}</Copy><Copy selectable style={[common.mono, { fontSize: 12 }]}>{g.toBase58()}</Copy></View></View>)}
        {!v.data.aiGuardian.equals(PublicKey.default) && <View style={[common.row, common.divider]}><KeyAvatar label="AI guardian" ai /><View style={{ flex: 1, gap: 4 }}><Copy>AI guardian</Copy><Copy style={common.muted}>Can cancel or freeze. Cannot move funds.</Copy></View></View>}
      </Panel>
      {view.trusted.length > 0 && <Panel><Label>Trusted wallets</Label>{view.trusted.map(record => <View key={record.address.toBase58()} style={{ gap: 8 }}><Copy selectable style={common.mono}>{record.data.wallet.toBase58()}</Copy>
        {numberId(record.data.activeAt) > BigInt(Math.floor(now / 1000)) ? <Copy style={common.countdown}>{countdown(Number(record.data.activeAt.toString()) * 1000, now)}</Copy>
          : <Button title="Send" tone="quiet" disabled={!owner || busy || v.data.frozen} onPress={() => { setDestination(record.data.wallet.toBase58()); setTab('Send'); }} />}
      </View>)}</Panel>}
      <Copy style={s.section}>Proposals</Copy>
      {view.proposals.length === 0 && <Panel><Copy>No open proposals</Copy><Copy style={common.muted}>Changes to keys, limits or trusted addresses show up here for guardians to approve.</Copy></Panel>}
      {view.proposals.map(p => {
        const a = p.data.action; const stale = p.data.guardianEpoch !== v.data.guardianEpoch;
        const ttl = BigInt(client.program.idl.constants?.find(c => c.name === 'proposalTtl')?.value ?? '604800');
        const dead = stale || (numberId(p.data.eta) === 0n && BigInt(Math.floor(now / 1000)) > numberId(p.data.createdAt) + ttl);
        const vetoable = 'addTrusted' in a || 'loosenLimits' in a || 'setSafeAddress' in a || 'setGuardians' in a || ('setAiGuardian' in a && !a.setAiGuardian.key.equals(PublicKey.default));
        const canVeto = vetoable && (!('setGuardians' in a) || a.setGuardians.guardians.some((g: PublicKey) => g.toBase58() === wallet?.address));
        return <Panel key={p.address.toBase58()}><Copy style={{ fontFamily: f.semibold, fontSize: 18 }}>{proposalTitle(a)}</Copy>
          <Copy selectable style={common.mono}>{p.address.toBase58()}</Copy>
          <Copy selectable style={common.muted}>{proposalDescription(a, view.decimals)}</Copy>
          <Copy>{p.data.approvals.toString(2).replaceAll('0', '').length} of {v.data.threshold} approvals</Copy>
          {numberId(p.data.eta) > 0n && <Copy style={common.countdown}>{countdown(Number(p.data.eta.toString()) * 1000, now)}</Copy>}
          {dead ? <Button title="Close dead proposal and refund rent" tone="secondary" disabled={busy} onPress={() => proposalAction(p, 'close')} /> : <>
            <Button title="Approve proposal" disabled={busy || guardianIndex < 0 || !!(p.data.approvals & (1 << guardianIndex))} onPress={() => proposalAction(p, 'approve')} />
            {canVeto && <Button title="Veto proposal" tone="quiet" disabled={busy || guardianIndex < 0} onPress={() => proposalAction(p, 'veto')} />}
            <Button title="Apply approved change" tone="secondary" disabled={busy || numberId(p.data.eta) === 0n || numberId(p.data.eta) > BigInt(Math.floor(now / 1000))} onPress={() => proposalAction(p, 'execute')} />
          </>}
        </Panel>;
      })}
      {guardianIndex >= 0 && <Panel><Label>Propose a change</Label>
        {(['unfreeze', 'addTrusted', 'removeTrusted', 'rotateOwner'] as const).map(value => <Button key={value} title={{ unfreeze: 'Unfreeze vault', addTrusted: 'Add a trusted wallet', removeTrusted: 'Remove a trusted wallet', rotateOwner: 'Replace owner wallet' }[value]} tone={value === action ? 'secondary' : 'quiet'} disabled={busy} onPress={() => setAction(value)} />)}
        {action !== 'unfreeze' && <Field label="Wallet address for this change" value={proposalWallet} onChangeText={setProposalWallet} autoCapitalize="none" autoCorrect={false} />}
        <Button title="Review proposal" disabled={busy} onPress={() => confirm('Propose this change?', action === 'unfreeze' ? 'Unfreezing requires your guardian threshold.' : `Check the target wallet: ${proposalWallet}. Other guardians must approve.`, async signer => {
          const latest = await fresh(); const change: GovAction = action === 'unfreeze' ? { unfreeze: {} } : action === 'addTrusted' ? { addTrusted: { wallet: key(proposalWallet) } } : action === 'removeTrusted' ? { removeTrusted: { wallet: key(proposalWallet) } } : { rotateOwner: { newOwner: key(proposalWallet) } };
          return [await client.propose(latest, signer, change)];
        })} />
      </Panel>}
    </>}
    {tab === 'Settings' && <>
      <Copy style={s.section}>Spending</Copy><Panel>
        <Copy>Instant allowance</Copy><Copy style={common.muted}>Spend this much per day without waiting.</Copy><Copy style={common.num}>{units(v.data.dailyLimit.toString())}</Copy>
        <View style={common.divider}><Copy>Delay for larger amounts</Copy></View><Copy style={common.muted}>Anyone protecting the vault can cancel during this time.</Copy><Copy style={common.num}>{delayLabel(numberId(v.data.delaySeconds))}</Copy>
      </Panel>
      <Panel><Label>Vault account</Label><Copy selectable style={common.mono}>{v.address.toBase58()}</Copy><Label>Owner wallet</Label><Copy selectable style={common.mono}>{v.data.owner.toBase58()}</Copy>
        <Label>Safe wallet</Label><Copy selectable style={common.mono}>{v.data.safeAddress.toBase58()}</Copy>
        <Copy style={common.muted}>The program is upgradeable by the hackathon dev wallet. Devnet only; use test tokens.</Copy>
        <Button title="View deployed program" tone="quiet" onPress={() => { void Linking.openURL('https://explorer.solana.com/address/4LH7ikNGVVNaemB7eaLGUMbwSBHHqA2hKXTdrfhgD6nh?cluster=devnet'); }} />
      </Panel>
      {guardianIndex >= 0 && <Button title="Sweep all tokens to the safe wallet" tone="secondary" disabled={busy} onPress={() => confirm('Sweep and freeze this vault?', 'Every token goes to the preset safe wallet. This also pauses outgoing transfers.', async signer => [await client.emergencySweep(await fresh(), signer, true)])} />}
      <Button title="Choose another vault" tone="quiet" disabled={busy} onPress={() => { current.current = ''; setView(null); setTx({ phase: 'idle' }); }} />
    </>}
    <Button title="Refresh" tone="quiet" busy={loading} disabled={transactionBusy(tx)} onPress={() => { void refresh(); }} />
  </View>;

  function account() {
    Alert.alert('Your wallet', wallet?.address, [
      { text: 'Close', style: 'cancel' },
      { text: 'Disconnect', onPress: () => {
        if (busy || !wallet) return;
        void disconnectWallet(wallet).then(() => { current.current = ''; setWallet(null); setView(null); setCreating(false); setVaultChoices([]); setTab('Home'); setError(null); })
          .catch(() => setError('Could not disconnect your wallet. Try again.'));
      } },
    ]);
  }
  return <SafeAreaView style={s.root}><AppHeader wallet={wallet?.address} busy={busy} onConnect={() => { void connect(); }} onAccount={account} />
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
      {error && <Copy accessibilityRole="alert" style={[common.muted, { fontSize: 13 }]}>{error}</Copy>}
      {content}
    </ScrollView></KeyboardAvoidingView>
    <AppTabBar selected={tab} onSelect={setTab} disabled={transactionBusy(tx)} />
  </SafeAreaView>;
}

function proposalTitle(a: GovAction): string {
  if ('unfreeze' in a) return 'Unfreeze the vault'; if ('rotateOwner' in a) return 'Replace owner wallet';
  if ('addTrusted' in a) return 'Add trusted wallet'; if ('removeTrusted' in a) return 'Remove trusted wallet';
  if ('tightenLimits' in a) return 'Tighten spending rules'; if ('loosenLimits' in a) return 'Change spending rules';
  if ('setSafeAddress' in a) return 'Change safe wallet'; if ('setGuardians' in a) return 'Change guardians'; return 'Change AI guardian';
}
function proposalDescription(a: GovAction, decimals: number): string {
  if ('unfreeze' in a) return 'Allow outgoing transfers again.';
  if ('rotateOwner' in a) return `New owner: ${a.rotateOwner.newOwner.toBase58()}. Existing requests become invalid.`;
  if ('addTrusted' in a) return `Trust ${a.addTrusted.wallet.toBase58()} after the proposal delay.`;
  if ('removeTrusted' in a) return `Remove trust for ${a.removeTrusted.wallet.toBase58()}.`;
  if ('setSafeAddress' in a) return `New safe wallet: ${a.setSafeAddress.wallet.toBase58()}.`;
  if ('setAiGuardian' in a) return a.setAiGuardian.key.equals(PublicKey.default) ? 'Disable the AI guardian.' : `New AI guardian: ${a.setAiGuardian.key.toBase58()}.`;
  if ('setGuardians' in a) return `${a.setGuardians.threshold} approvals needed from: ${a.setGuardians.guardians.map((g: PublicKey) => g.toBase58()).join(', ')}.`;
  const limits = 'tightenLimits' in a ? a.tightenLimits : a.loosenLimits;
  return `Daily allowance: ${formatUnits(limits.dailyLimit.toString(), decimals)} tokens. Delay: ${limits.delaySeconds.toString()} seconds.`;
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.canvas },
  content: { paddingHorizontal: 20, paddingTop: 32, paddingBottom: 32, gap: 24, flexGrow: 1 },
  section: { fontFamily: f.semibold, fontSize: 15, paddingHorizontal: 4 },
});

function VaultActivity({ history, limit = 10 }: { history: VaultView['history']; limit?: number }) {
  return <View style={{ gap: 12 }}><Copy style={{ fontFamily: f.semibold, fontSize: 15, paddingHorizontal: 4 }}>Recent activity</Copy><Panel>
    {history === null ? <Copy style={common.muted}>Transaction history is unavailable. Refresh to try again.</Copy>
      : history.length === 0 ? <View style={{ gap: 8 }}><Copy>Nothing here yet</Copy><Copy style={common.muted}>Events appear as soon as Argus sees them on-chain.</Copy></View>
        : <ActivityTimeline entries={history.slice(0, limit).map(item => ({ id: item.signature,
          title: item.err ? 'Transaction failed' : item.confirmationStatus === 'finalized' ? 'Transaction finalized' : 'Transaction confirmed',
          detail: item.blockTime == null ? `Slot ${item.slot}` : new Date(item.blockTime * 1000).toLocaleString(), done: !item.err,
          onPress: () => { void Linking.openURL(`https://explorer.solana.com/tx/${item.signature}?cluster=devnet`); },
        }))} />}
  </Panel></View>;
}
