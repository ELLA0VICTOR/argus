import { useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PublicKey } from '@solana/web3.js';
import { Button, Copy, Field, Label, Panel, common } from './ui';
import { integer, type GovAction, type RecordAt, type Vault } from '../program/client';
import { parseAmount } from '../program/transactions';
import { colors as c, fonts as f } from '../theme';
import { formatTypedAmount } from '../domain/amountInput';

const actions = [
  ['unfreeze', 'Unfreeze the vault'], ['rotateOwner', 'Replace owner wallet'], ['addTrusted', 'Trust an address'],
  ['removeTrusted', 'Remove a trusted address'], ['tightenLimits', 'Tighten limits'], ['loosenLimits', 'Loosen limits'],
  ['setSafeAddress', 'Change safe address'], ['setGuardians', 'Replace guardians'], ['setAiGuardian', 'Change AI guardian'],
] as const;
type Kind = typeof actions[number][0];

export function ProposalComposer({ vault, decimals, disabled, onPropose }: {
  vault: RecordAt<Vault>; decimals: number; disabled: boolean; onPropose: (build: () => GovAction) => void;
}) {
  const [kind, setKind] = useState<Kind>('unfreeze');
  const [choosing, setChoosing] = useState(false);
  const [target, setTarget] = useState('');
  const [limit, setLimit] = useState('');
  const [delay, setDelay] = useState('');
  const [threshold, setThreshold] = useState('1');
  const limits = kind === 'tightenLimits' || kind === 'loosenLimits';
  const publicKey = (text: string) => { try { return new PublicKey(text.trim()); } catch { throw new Error('Enter a valid Solana wallet address.'); } };
  function build(): GovAction {
    if (kind === 'unfreeze') return { unfreeze: {} };
    if (kind === 'addTrusted') return { addTrusted: { wallet: publicKey(target) } };
    if (kind === 'removeTrusted') return { removeTrusted: { wallet: publicKey(target) } };
    if (kind === 'rotateOwner') return { rotateOwner: { newOwner: publicKey(target) } };
    if (kind === 'setSafeAddress') return { setSafeAddress: { wallet: publicKey(target) } };
    if (kind === 'setAiGuardian') return { setAiGuardian: { key: target.trim() ? publicKey(target) : PublicKey.default } };
    if (kind === 'setGuardians') {
      const guardians = target.split(',').map(publicKey); const need = Number(threshold);
      if (guardians.length < 1 || guardians.length > 5 || new Set(guardians.map(g => g.toBase58())).size !== guardians.length || !Number.isInteger(need) || need < 1 || need > guardians.length) throw new Error('Choose 1–5 distinct guardians and a valid approval threshold.');
      return { setGuardians: { guardians, threshold: need } };
    }
    if (!/^\d+$/.test(delay) || BigInt(delay) < 60n || BigInt(delay) > 2_592_000n) throw new Error('Choose a delay between 60 seconds and 30 days.');
    const dailyLimit = /^0+(?:\.0+)?$/.test(limit.replace(/,/g, '')) ? 0n : parseAmount(limit.replace(/,/g, ''), decimals);
    const delaySeconds = BigInt(delay);
    const currentLimit = BigInt(vault.data.dailyLimit.toString()); const currentDelay = BigInt(vault.data.delaySeconds.toString());
    if (kind === 'tightenLimits' && (dailyLimit > currentLimit || delaySeconds < currentDelay)) throw new Error('Tightening can only lower the allowance and lengthen the wait.');
    const args = { dailyLimit: integer(dailyLimit), delaySeconds: integer(delaySeconds, true) };
    return kind === 'tightenLimits' ? { tightenLimits: args } : { loosenLimits: args };
  }
  return <Panel><Label>New proposal</Label>
    <Pressable accessibilityRole="button" disabled={disabled} onPress={() => setChoosing(true)} style={{ minHeight: 48, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Copy style={{ fontFamily: f.medium }}>{actions.find(([id]) => id === kind)![1]}</Copy><Copy>⌄</Copy>
    </Pressable>
    {kind !== 'unfreeze' && !limits && <Field label={kind === 'setGuardians' ? 'Guardian wallet addresses, separated by commas' : kind === 'setAiGuardian' ? 'AI public address (leave empty to disable)' : 'Wallet address'} value={target} onChangeText={setTarget} autoCapitalize="none" autoCorrect={false} editable={!disabled} />}
    {kind === 'setGuardians' && <Field label="Approvals needed" value={threshold} onChangeText={setThreshold} keyboardType="number-pad" editable={!disabled} />}
    {limits && <><Field label="Daily allowance" value={limit} onChangeText={v => setLimit(formatTypedAmount(v))} keyboardType="decimal-pad" editable={!disabled} /><Field label="Withdrawal delay in seconds" value={delay} onChangeText={setDelay} keyboardType="number-pad" editable={!disabled} /></>}
    <Copy style={common.muted}>{kind === 'tightenLimits' || kind === 'unfreeze' || kind === 'removeTrusted' || kind === 'rotateOwner' ? 'Your guardian threshold must approve this change.' : 'Your guardian threshold must approve. A delay applies and guardians can veto.'}</Copy>
    <Button title="Review proposal" disabled={disabled} onPress={() => onPropose(build)} />
    <Modal visible={choosing} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setChoosing(false)}><SafeAreaView style={{ flex: 1, backgroundColor: c.ink }}><ScrollView contentContainerStyle={{ padding: 24, gap: 8 }}><Copy style={common.title}>Propose a change</Copy>{actions.map(([id, label]) => <Pressable key={id} accessibilityRole="button" onPress={() => { setKind(id); setChoosing(false); setTarget(''); }} style={{ minHeight: 48, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: c.lineSoft }}><Copy>{label}</Copy></Pressable>)}<Button title="Back" tone="quiet" onPress={() => setChoosing(false)} /></ScrollView></SafeAreaView></Modal>
  </Panel>;
}
