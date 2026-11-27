import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, View } from 'react-native';
import { Button, Copy, common } from './ui';
import { transactionUrl, type TransactionState } from '../program/transactions';
import { userMessage } from '../domain/userMessage';
import { colors as c, fonts as f } from '../theme';

export function TransactionNotice({ state, onCheck }: { state: TransactionState; onCheck: () => void }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    setHidden(false);
    if (state.phase !== 'confirmed') return;
    const timer = setTimeout(() => setHidden(true), 6000);
    return () => clearTimeout(timer);
  }, [state.phase, state.signature]);
  if (state.phase === 'idle' || hidden) return null;
  const title = { preparing: 'Preparing your transaction', wallet: 'Review in your wallet', sending: 'Sending to devnet',
    confirming: 'Waiting for confirmation', confirmed: 'Transaction confirmed', failed: 'Transaction did not complete', unknown: 'Check transaction status' }[state.phase];
  return <View accessibilityLiveRegion="polite" style={{ backgroundColor: c.ink, borderWidth: 1, borderColor: c.line, borderRadius: 16, padding: 16, gap: 8 }}>
    <View style={common.row}><Copy accessibilityRole="alert" style={{ fontFamily: f.medium, flex: 1 }}>{title}</Copy>
      {!['confirmed', 'failed', 'unknown'].includes(state.phase) && <ActivityIndicator size="small" color={c.brand} />}</View>
    {state.message && <Copy style={[common.muted, { fontSize: 13 }]}>{userMessage(state.message, 'This action could not be completed. Please try again.')}</Copy>}
    {state.signature && <Pressable accessibilityRole="link" style={{ minHeight: 44, justifyContent: 'center' }} onPress={() => { void Linking.openURL(transactionUrl(state.signature!)); }}><Copy style={{ color: c.brand, fontSize: 13 }}>View transaction ↗</Copy></Pressable>}
    {state.phase === 'unknown' && <Button title="Check confirmation" onPress={onCheck} />}
  </View>;
}
