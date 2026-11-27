import { Linking, View } from 'react-native';
import { Button, Copy, Panel, common } from './ui';
import { transactionUrl, type TransactionState } from '../program/transactions';

export function TransactionNotice({ state, onCheck }: { state: TransactionState; onCheck: () => void }) {
  if (state.phase === 'idle') return null;
  const title = { preparing: 'Preparing your transaction', wallet: 'Review in your wallet', sending: 'Sending to devnet',
    confirming: 'Waiting for confirmation', confirmed: 'Transaction confirmed', failed: 'Transaction did not complete', unknown: 'Check transaction status' }[state.phase];
  return <Panel><Copy accessibilityRole="alert" style={{ fontSize: 17 }}>{title}</Copy>
    {state.message && <Copy style={common.muted}>{state.message}</Copy>}
    {state.signature && <View style={{ gap: 8 }}><Copy selectable style={[common.mono, { fontSize: 11 }]}>{state.signature}</Copy>
      <Button title="View on Solana Explorer" tone="quiet" onPress={() => { void Linking.openURL(transactionUrl(state.signature!)); }} /></View>}
    {state.phase === 'unknown' && <Button title="Check confirmation" onPress={onCheck} />}
  </Panel>;
}
