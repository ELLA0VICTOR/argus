import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, BackHandler, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PublicKey, type TransactionInstruction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, getAccount, getMint, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Button, Copy, Field, Label, Logo, Panel, Status, common } from '../components/ui';
import { DawnHero } from '../components/DawnHero';
import { TransactionNotice } from '../components/TransactionNotice';
import { ActivityTimeline, AllowanceMeter, KeyAvatar, RouteIndicator, WaitProgress } from '../components/VaultPatterns';
import { allowanceFraction, allowanceRemaining, delayLabel } from '../domain/vaultMetrics';
import { connectWallet, disconnectWallet, signWalletTransaction, type WalletSession } from '../services/wallet';
import { programClient as client, connection } from '../program/runtime';
import { readVault, readWalletVaults, type VaultView } from '../program/read';
import { integer, type GovAction, type RecordAt, type Proposal, type Withdrawal } from '../program/client';
import { checkTransaction, parseAmount, runTransaction, transactionBusy, type TransactionState } from '../program/transactions';
import { formatUnits } from '../sentinel/rules';
import { countdown } from '../domain/demo';
import { colors as c, fonts as f } from '../theme';
import * as SecureStore from 'expo-secure-store';
import { DEMO_MINT, SENTINEL_AI_GUARDIAN } from '../sentinel/demo';

type Tab = 'Home' | 'Send' | 'Activity' | 'Guardians' | 'Settings';
const tabs: Tab[] = ['Home', 'Send', 'Activity', 'Guardians', 'Settings'];
const key = (value: string) => {
  try { return new PublicKey(value.trim()); }
  catch { throw new Error('Enter a valid Solana wallet or account address.'); }
};
const numberId = (value: { toString(): string }) => BigInt(value.toString());

export function LiveApp({ onDemo, onLiveDemo, onSentinel, onBusy, demoAvailable }: { onDemo: () => void; onLiveDemo: () => void; onSentinel: () => void; onBusy: (busy: boolean) => void; demoAvailable: boolean }) {
  const [wallet, setWallet] = useState<WalletSession | null>(null);
  const [address, setAddress] = useState('');
  const [vaultChoices, setVaultChoices] = useState<string[]>([]);
  const [view, setView] = useState<VaultView | null>(null);
  const [tab, setTab] = useState<Tab>('Home');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tx, setTx] = useState<TransactionState>({ phase: 'idle' });
  const [now, setNow] = useState(Date.now());
  const [creating, setCreating] = useState(false);
  const [amount, setAmount] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [destination, setDestination] = useState('');
  const [sendMode, setSendMode] = useState<'instant' | 'delayed' | 'trusted'>('delayed');
  const [mint, setMint] = useState(DEMO_MINT);
  const [guardians, setGuardians] = useState('');
  const [threshold, setThreshold] = useState('1');
  const [ai, setAi] = useState(SENTINEL_AI_GUARDIAN);
  const [safe, setSafe] = useState('');
  const [delay, setDelay] = useState('86400');
  const [limit, setLimit] = useState('100');
  const [proposalWallet, setProposalWallet] = useState('');
  const [action, setAction] = useState<'unfreeze' | 'addTrusted' | 'removeTrusted' | 'rotateOwner'>('unfreeze');
  const lock = useRef(false);
  const current = useRef('');
  const busy = loading || transactionBusy(tx);
  useEffect(() => { onBusy(transactionBusy(tx)); }, [tx.phase, onBusy]);
  useEffect(() => { void SecureStore.getItemAsync('argus:pending-devnet-transaction').then(value => {
    if (!value) return; const pending = JSON.parse(value) as TransactionState;
    if (pending.signature && ['sending', 'confirming', 'unknown'].includes(pending.phase)) setTx({ ...pending, phase: 'unknown' });
  }).catch(() => setError('Could not restore transaction status. Check recent wallet activity before sending again.')); }, []);

  const refresh = useCallback(async (selected = current.current) => {
    if (!selected) return;
    setLoading(true);
    try {
      const result = await readVault(client, key(selected));
      if (current.current === selected) { setView(result); setError(null); }
    } catch { if (current.current === selected) setError('Could not refresh this devnet vault. Check the address and your connection, then retry.'); }
    finally { if (current.current === selected) setLoading(false); }
  }, []);

  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { const sub = AppState.addEventListener('change', state => { if (state === 'active' && !lock.current) void refresh(); }); return () => sub.remove(); }, [refresh]);
  useEffect(() => { const sub = BackHandler.addEventListener('hardwareBackPress', () => {
    if (busy) return true;
    if (creating) { setCreating(false); return true; }
    if (view && tab !== 'Home') { setTab('Home'); return true; }
    if (view) { current.current = ''; setView(null); return true; }
    return false;
  }); return () => sub.remove(); }, [view, tab, busy, creating]);

  async function connect() {
    if (lock.current) return;
    lock.current = true; setLoading(true); setError(null);
    try {
      const session = await connectWallet(); setWallet(session);
      try { setVaultChoices((await readWalletVaults(client, key(session.address))).map(v => v.address.toBase58())); }
      catch { setError('Wallet connected. Vault discovery could not reach devnet; paste a vault address below or retry later.'); }
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not connect your Android wallet.'); }
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
        pending => SecureStore.setItemAsync('argus:pending-devnet-transaction', JSON.stringify(pending)));
      await SecureStore.setItemAsync('argus:pending-devnet-transaction', JSON.stringify(result))
        .catch(() => setError('Transaction status could not be saved. Keep its Explorer link; the on-chain result above still applies.'));
      if (result.phase === 'confirmed') await refresh();
    } catch (e) { setTx({ phase: 'failed', message: e instanceof Error ? e.message : 'Could not prepare this action. Refresh and retry.' }); }
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
  const units = (value: string) => `${formatUnits(value, view?.decimals ?? 0)} tokens`;
  const remaining = v ? allowanceRemaining(numberId(v.data.dailyLimit), numberId(v.data.spentInWindow), numberId(v.data.windowStart), BigInt(Math.floor(now / 1000))) : 0n;
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
    setTx(state); await SecureStore.setItemAsync('argus:pending-devnet-transaction', JSON.stringify(state)); if (state.phase === 'confirmed') await refresh();
  }).catch(() => setError('Could not check confirmation. Keep this signature and try checking again.')); }} />;

  let content;
  if (!v || !view) content = <View style={common.stack}>
    <DawnHero />
    {!wallet ? <><Copy style={common.muted}>A self-custodial vault on Solana. Large withdrawals wait; your guardians can stop them.</Copy>
      <Button title="Connect your wallet" busy={loading} busyTitle="Opening your wallet…" onPress={() => { void connect(); }} />
      <Button title="Try the live theft demo" tone="secondary" disabled={busy} onPress={onLiveDemo} />
      {demoAvailable && <Button title="Explore the offline sample" tone="quiet" disabled={busy} onPress={onDemo} />}
      <Button title="Open alerts and contact settings" tone="quiet" disabled={busy} onPress={onSentinel} /></>
      : <Panel><Label>Your connected wallet</Label><Copy selectable style={common.mono}>{wallet.address}</Copy>
        {!creating ? <>{vaultChoices.map(selected => <View key={selected} style={{ gap: 8 }}><Copy selectable style={common.mono}>{selected}</Copy><Button title="Open this vault" tone="secondary" disabled={busy} onPress={() => { current.current = selected; setAddress(selected); void refresh(selected); }} /></View>)}
          <Field label="Vault address" value={address} onChangeText={setAddress} autoCapitalize="none" autoCorrect={false} placeholder="Paste a vault account address" />
          <Button title="Open vault" busy={loading} disabled={!address.trim()} onPress={() => { void open(); }} />
          <Button title="Create a new vault" tone="quiet" disabled={busy} onPress={() => setCreating(true)} /></>
          : <><Copy style={{ fontFamily: f.semibold, fontSize: 20 }}>Create your devnet vault</Copy>
            <Field label="Classic SPL token mint" value={mint} onChangeText={setMint} autoCapitalize="none" autoCorrect={false} />
            <Field label="Guardian wallets (separate with commas)" value={guardians} onChangeText={setGuardians} autoCapitalize="none" autoCorrect={false} />
            <Field label="Approvals needed" value={threshold} onChangeText={setThreshold} keyboardType="number-pad" />
            <Field label="Safe wallet (separate from your owner wallet)" value={safe} onChangeText={setSafe} autoCapitalize="none" autoCorrect={false} />
            <Field label="AI guardian (optional)" value={ai} onChangeText={setAi} autoCapitalize="none" autoCorrect={false} />
            <Copy style={common.muted}>The announced Sentinel public key is prefilled. Clear it to disable the AI guardian. Its signing key stays on the server.</Copy>
            <Field label="Withdrawal delay in seconds (60–2,592,000)" value={delay} onChangeText={setDelay} keyboardType="number-pad" />
            <Field label="Daily token allowance" value={limit} onChangeText={setLimit} keyboardType="decimal-pad" />
            <Copy style={common.muted}>Keep owner, guardian and safe keys separate. The wallet pays devnet rent and fees. The program is upgradeable by the hackathon dev wallet; use test tokens only.</Copy>
            <Button title="Review vault creation" disabled={busy} onPress={() => confirm('Create this vault?', 'Check every address. Guardians control changes to your vault’s rules.', async signer => {
              const token = await getMint(connection, key(mint), 'confirmed', TOKEN_PROGRAM_ID);
              const set = guardians.split(',').map(g => key(g)); const t = Number(threshold);
              if (!/^\d+$/.test(delay)) throw new Error('Enter the withdrawal delay in whole seconds.');
              const d = BigInt(delay);
              if (set.length < 1 || set.length > 5 || new Set(set.map(g => g.toBase58())).size !== set.length || set.some(g => g.equals(signer)) || !Number.isInteger(t) || t < 1 || t > set.length) throw new Error('Use 1–5 distinct guardian wallets separate from your owner, with a valid approval threshold.');
              if (d < 60n || d > 2592000n) throw new Error('Choose a delay between 60 seconds and 30 days.');
              const id = BigInt(Date.now()); const selected = client.vaultAddress(signer, id)[0].toBase58();
              const ix = await client.initializeVault(signer, key(mint), { vaultId: id, guardians: set, threshold: t,
                aiGuardian: ai.trim() ? key(ai) : PublicKey.default, safeAddress: key(safe), delaySeconds: d, dailyLimit: limit.trim() === '0' ? 0n : parseAmount(limit, token.decimals) });
              current.current = selected; setAddress(selected); return [ix];
            })} />
            <Button title="Back to your vaults" tone="quiet" disabled={busy} onPress={() => setCreating(false)} /></>}
      </Panel>}
    {txNotice}
    <Copy style={[common.muted, { textAlign: 'center', fontSize: 12 }]}>Live on Solana devnet · Test tokens only</Copy>
  </View>;
  else content = <View style={common.stack}>
    <View style={{ gap: 8 }}><Label>{tab === 'Home' ? 'Your vault' : tab}</Label><Copy style={common.title}>{tab === 'Home' ? 'A little more peace of mind.' : tab === 'Send' ? 'Move money on your terms.' : tab === 'Activity' ? 'Time is on your side.' : tab === 'Guardians' ? 'Separate keys. Shared protection.' : 'Make yourself at home.'}</Copy></View>
    {txNotice}
    {tab === 'Home' && <>
      <Panel style={{ borderRadius: 28 }}><View style={common.row}><Label>Vault balance</Label><Status text={v.data.frozen ? 'Frozen' : 'Protected'} tone={v.data.frozen ? 'brand' : 'safe'} /></View>
        <Copy style={[common.amount, { fontSize: 38 }]}>{units(view.balance)}</Copy>
        <Copy style={common.muted}>Devnet · Test tokens</Copy><Copy selectable style={common.mono}>{v.data.mint.toBase58()}</Copy>
        <AllowanceMeter remaining={units(remaining.toString())} total={units(v.data.dailyLimit.toString())} fraction={allowanceFraction(remaining, numberId(v.data.dailyLimit))} />
        <Copy style={common.muted}>Large transfers wait {v.data.delaySeconds.toString()} seconds. Your guardians can cancel during the wait.</Copy>
        <Button title="Send tokens" disabled={!owner || v.data.frozen || busy} onPress={() => setTab('Send')} />
        <Field label="Amount to deposit" value={depositAmount} onChangeText={setDepositAmount} keyboardType="decimal-pad" placeholder="0.00" editable={!busy} />
        <Button title="Deposit tokens" tone="secondary" disabled={busy || !wallet || !depositAmount.trim()} onPress={() => confirm('Deposit into this vault?', `${depositAmount} tokens will move from your wallet to this vault.`, async signer => {
          const latest = await fresh(); const from = getAssociatedTokenAddressSync(latest.data.mint, signer);
          return [await client.deposit(latest, signer, from, parseAmount(depositAmount, view.decimals))];
        })} />
        <Button title={v.data.frozen ? 'Vault is paused' : 'Freeze vault'} tone="quiet" disabled={!protective || v.data.frozen || busy} onPress={freeze} />
      </Panel>
      <Panel><Label>Waiting to leave</Label>{view.withdrawals.length === 0 ? <Copy style={common.muted}>No pending requests.</Copy> : view.withdrawals.slice(0, 3).map((w, i) => <View key={w.address.toBase58()} style={[i > 0 && common.divider, { gap: 12 }]}>
        <Copy style={common.num}>{units(w.data.amount.toString())}</Copy><Copy style={common.muted}>Request {w.data.id.toString()}</Copy>
        <WaitProgress requestedAt={Number(w.data.requestedAt.toString()) * 1000} executesAt={Number(w.data.executesAt.toString()) * 1000} now={now} />
      </View>)}<Button title="Review pending withdrawals" tone="quiet" onPress={() => setTab('Activity')} /></Panel>
      <VaultActivity history={view.history} limit={4} />
      <Panel><Label>Your protection</Label><View style={[common.row, { justifyContent: 'flex-start' }]}><KeyAvatar label="Guardian keys" /><Copy style={{ flex: 1 }}>{v.data.threshold} of {v.data.guardianCount} guardians approve rule changes.</Copy></View><View style={[common.row, { justifyContent: 'flex-start' }]}><KeyAvatar label="AI guardian" ai /><Copy style={[common.muted, { flex: 1 }]}>{v.data.aiGuardian.equals(PublicKey.default) ? 'No AI guardian is configured.' : 'The AI guardian can cancel or freeze. It cannot withdraw.'}</Copy></View></Panel>
    </>}
    {tab === 'Send' && <>
      <Copy style={common.muted}>Enter the recipient’s wallet address. Argus will use its associated token account for this mint.</Copy>
      <Panel><Field label="Recipient wallet" value={destination} onChangeText={setDestination} autoCapitalize="none" autoCorrect={false} />
        <Field label="Token amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
        <Label>Choose your transfer route</Label>
        <RouteIndicator selected={sendMode} waitLabel={delayLabel(numberId(v.data.delaySeconds))} onSelect={setSendMode} disabled={busy} />
        <Copy style={common.muted}>{sendMode === 'delayed' ? 'Your request starts a countdown. It must be executed separately after the delay.' : sendMode === 'trusted' ? 'The recipient must already be an active trusted wallet.' : 'This transfer uses your remaining daily allowance.'}</Copy>
        <Button title={sendMode === 'delayed' ? 'Review withdrawal request' : 'Review transfer'} disabled={!owner || busy || v.data.frozen || !destination.trim() || !amount.trim()} onPress={() => confirm('Review this transfer?', `${amount} tokens to ${destination}. ${sendMode === 'delayed' ? 'The program will hold the request until its delay ends.' : 'This transfer moves tokens immediately.'}`, async signer => {
          const latest = await fresh(); const receiver = key(destination); const value = parseAmount(amount, view.decimals);
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
      </Panel>
    </>}
    {tab === 'Activity' && <>
      {view.withdrawals.length === 0 && <Panel><Copy>No pending withdrawals. Your vault is quiet.</Copy></Panel>}
      {view.withdrawals.map(w => <Panel key={w.address.toBase58()}>
        <Copy style={common.amount}>{units(w.data.amount.toString())}</Copy><Copy selectable style={common.mono}>{w.data.destination.toBase58()}</Copy>
        <WaitProgress requestedAt={Number(w.data.requestedAt.toString()) * 1000} executesAt={Number(w.data.executesAt.toString()) * 1000} now={now} />
        {w.data.ownerEpoch !== v.data.ownerEpoch && <Copy style={common.muted}>The owner changed. This request can only be cancelled.</Copy>}
        <Button title="Cancel withdrawal" tone="secondary" disabled={!protective || busy} onPress={() => cancel(w)} />
        <Button title="Execute withdrawal" tone="secondary" disabled={busy || v.data.frozen || w.data.ownerEpoch !== v.data.ownerEpoch || BigInt(Math.floor(now / 1000)) < numberId(w.data.executesAt)} onPress={() => confirm('Execute this withdrawal?', 'This sends the exact stored amount to the exact stored token account.', async signer => {
          const latest = await fresh(); const request = await client.fetchWithdrawal(w.address, latest.address);
          return [await client.executeWithdrawal(latest, signer, request)];
        })} />
      </Panel>)}
      <Button title="Freeze vault" tone="quiet" disabled={!protective || v.data.frozen || busy} onPress={freeze} />
      <VaultActivity history={view.history} />
    </>}
    {tab === 'Guardians' && <>
      <Panel><Label>Guardian threshold</Label><Copy style={common.num}>{v.data.threshold} of {v.data.guardianCount} approvals</Copy>{v.data.guardians.slice(0, v.data.guardianCount).map((g, i) => <View key={g.toBase58()} style={common.row}><KeyAvatar label={`Guardian ${i + 1}`} /><View style={{ flex: 1, gap: 4 }}><Copy>Guardian {i + 1}</Copy><Copy selectable style={[common.mono, { fontSize: 12 }]}>{g.toBase58()}</Copy></View></View>)}</Panel>
      {view.trusted.length > 0 && <Panel><Label>Trusted wallets</Label>{view.trusted.map(record => <View key={record.address.toBase58()} style={{ gap: 8 }}><Copy selectable style={common.mono}>{record.data.wallet.toBase58()}</Copy>
        {numberId(record.data.activeAt) > BigInt(Math.floor(now / 1000)) ? <Copy style={common.countdown}>{countdown(Number(record.data.activeAt.toString()) * 1000, now)}</Copy>
          : <Button title="Send to this trusted wallet" tone="quiet" disabled={!owner || busy || v.data.frozen} onPress={() => { setDestination(record.data.wallet.toBase58()); setSendMode('trusted'); setTab('Send'); }} />}
      </View>)}</Panel>}
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
      <Panel><Label>Vault account</Label><Copy selectable style={common.mono}>{v.address.toBase58()}</Copy><Label>Owner wallet</Label><Copy selectable style={common.mono}>{v.data.owner.toBase58()}</Copy>
        <Label>Safe wallet</Label><Copy selectable style={common.mono}>{v.data.safeAddress.toBase58()}</Copy>
        <Copy style={common.muted}>The program is upgradeable by the hackathon dev wallet. Devnet only; use test tokens.</Copy>
        <Button title="View deployed program" tone="quiet" onPress={() => { void Linking.openURL('https://explorer.solana.com/address/4LH7ikNGVVNaemB7eaLGUMbwSBHHqA2hKXTdrfhgD6nh?cluster=devnet'); }} />
      </Panel>
      <Panel><Label>Sentinel alerts</Label><Copy style={common.muted}>Phone and push setup use a separate signed Sentinel session. Until its service is connected, those screens show sample data. They never sign your vault transactions.</Copy><Button title="Open alerts and contact settings" tone="secondary" disabled={busy} onPress={onSentinel} /></Panel>
      {guardianIndex >= 0 && <Button title="Sweep all tokens to the safe wallet" tone="secondary" disabled={busy} onPress={() => confirm('Sweep and freeze this vault?', 'Every token goes to the preset safe wallet. This also pauses outgoing transfers.', async signer => [await client.emergencySweep(await fresh(), signer, true)])} />}
      <Button title="Choose another vault" tone="quiet" disabled={busy} onPress={() => { current.current = ''; setView(null); setTx({ phase: 'idle' }); }} />
    </>}
    <Button title="Refresh from devnet" tone="quiet" busy={loading} disabled={transactionBusy(tx)} onPress={() => { void refresh(); }} />
  </View>;

  return <SafeAreaView style={s.root}><View style={s.header}><Logo /><Status text="Solana devnet" /></View>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
      {error && <Panel><Copy accessibilityRole="alert">{error}</Copy><Button title="Dismiss message" tone="quiet" onPress={() => setError(null)} /></Panel>}
      {content}
      {wallet && !view && <Button title="Disconnect wallet" tone="quiet" disabled={busy} onPress={() => { void disconnectWallet(wallet).then(() => { setWallet(null); setTx({ phase: 'idle' }); }).catch(() => setError('Could not revoke wallet access. Try again.')); }} />}
    </ScrollView></KeyboardAvoidingView>
    {view && <View style={s.nav}>{tabs.map(t => <Pressable key={t} accessibilityRole="tab" accessibilityState={{ selected: t === tab }} disabled={busy} style={[s.tab, t === tab && s.active]} onPress={() => setTab(t)}><Copy style={{ color: t === tab ? c.brand : c.muted, fontFamily: f.medium, fontSize: 12 }}>{t}</Copy></Pressable>)}</View>}
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
  root: { flex: 1, backgroundColor: c.canvas }, header: { backgroundColor: c.ink, paddingHorizontal: 22, paddingVertical: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  content: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 28, gap: 20, flexGrow: 1 },
  nav: { backgroundColor: c.ink, flexDirection: 'row', padding: 8, borderTopWidth: 1, borderTopColor: c.lineSoft },
  tab: { flex: 1, minHeight: 48, borderRadius: 12, justifyContent: 'center', alignItems: 'center' }, active: { backgroundColor: c.brandSoft },
});

function VaultActivity({ history, limit = 10 }: { history: VaultView['history']; limit?: number }) {
  return <Panel><Label>Recent activity</Label>
    {history === null ? <Copy style={common.muted}>Transaction history is unavailable. Refresh to try again.</Copy>
      : history.length === 0 ? <Copy style={common.muted}>No recent vault transactions returned by devnet.</Copy>
        : <ActivityTimeline entries={history.slice(0, limit).map(item => ({ id: item.signature,
          title: item.err ? 'Transaction failed' : item.confirmationStatus === 'finalized' ? 'Transaction finalized' : 'Transaction confirmed',
          detail: item.blockTime == null ? `Slot ${item.slot}` : new Date(item.blockTime * 1000).toLocaleString(), done: !item.err,
          onPress: () => { void Linking.openURL(`https://explorer.solana.com/tx/${item.signature}?cluster=devnet`); },
        }))} />}
    <Copy style={[common.muted, { fontSize: 12 }]}>Recent transactions involving this vault, as reported by devnet.</Copy>
  </Panel>;
}
