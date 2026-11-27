import { useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { Button, Copy, Field, Label, Panel, common } from '../components/ui';
import { sentinel } from '../sentinel/runtime';
import { useResource } from '../sentinel/useResource';
import { getExpoPushToken, showLocalAlertPreview } from '../services/notifications';
import { colors as c } from '../theme';

export function Settings({ vault, preview, onSignOut, onExit, onReset }: {
  vault: string; preview: boolean; onSignOut: () => Promise<void>; onExit: () => void; onReset: () => void;
}) {
  const [label, setLabel] = useState('My Android phone');
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resource = useResource(`settings:${sentinel.session?.wallet}:${vault}`, async () => {
    const [summary, contacts, device] = await Promise.all([sentinel.vault(vault), sentinel.contacts(vault), sentinel.localDevice(vault)]);
    return { summary, contacts, device };
  });
  async function perform(work: () => Promise<string>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setMessage(null); setError(null);
    try { setMessage(await work()); await resource.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not update alert contacts.'); }
    finally { locked.current = false; setBusy(false); }
  }
  const guardian = resource.data?.summary.role === 'guardian';
  const confirmRemoval = (title: string, work: () => Promise<string>) => Alert.alert(title,
    'This contact will stop receiving alerts. Other active contacts will continue to receive every alert.', [
      { text: 'Keep contact', style: 'cancel' }, { text: 'Remove contact', style: 'destructive', onPress: () => { void perform(work); } },
    ]);
  return <View style={common.stack}>
    <Label>SETTINGS</Label><Copy style={common.title}>Stay within reach.</Copy>
    <Copy style={common.muted}>Argus calls over the internet. No phone number or SIM is needed. Microphone access is requested when you accept a call.</Copy>
    <Copy style={common.muted}>{sentinel.mock ? 'Local mock: registrations stay on this device for this app session. Use the live devnet demo to try a voice call.'
      : 'Register this device for push alerts. Adding a device also notifies existing contacts.'}</Copy>
    {resource.error && <Copy accessibilityRole="alert">{resource.error}</Copy>}
    <Panel><Label>PUSH ALERTS</Label>
      <Field label="Device label" value={label} onChangeText={setLabel} maxLength={80} editable={!busy} />
      <Copy style={common.muted}>{sentinel.mock ? 'Register a sample push device to preview the contact flow.' : 'Register this Android phone for Sentinel notifications.'}</Copy>
      <Button title={sentinel.mock ? 'Register sample push device' : 'Register this phone for push alerts'} disabled={busy || !label.trim()} onPress={() => { void perform(async () => {
        const token = sentinel.mock ? 'ExponentPushToken[local-preview-only]' : await getExpoPushToken();
        await sentinel.addDevice(vault, token, label); return sentinel.mock ? 'Sample push device registered. Removal secret stored securely.' : 'Push alerts registered for this phone.';
      }); }} />
      {resource.data?.contacts.devices.map(device => <View key={device.id} style={{ gap: 8 }}>
        <Copy>{device.label}</Copy><Copy>{device.id} · {device.platform}</Copy>
        {(guardian || resource.data?.device?.id === device.id) && <Button title="Remove push device" disabled={busy}
          onPress={() => confirmRemoval('Remove this push device?', async () => {
            if (resource.data?.device?.id === device.id) await sentinel.removeOwnDevice(vault);
            else await sentinel.removeDevice(vault, device.id);
            return 'Push device removed.';
          })} />}
      </View>)}
      <Copy style={{ color: c.muted, fontSize: 12 }}>You can remove this phone using its stored device secret. A guardian can remove other devices.</Copy>
      {sentinel.mock && <Button title="Test a local alert notification" disabled={busy} onPress={() => { void perform(async () => {
        await showLocalAlertPreview('al_9', vault); return 'Local notification scheduled. Tap it to review the sample alert.';
      }); }} />}
    </Panel>
    {(message || error) && <Copy accessibilityRole="alert">{error ?? message}</Copy>}
    {busy && <Copy style={common.muted}>Updating alert contacts…</Copy>}
    <Button title="Refresh contacts" busy={resource.loading} disabled={busy} onPress={() => { void resource.refresh(); }} />
    {preview && <Button title="Reset demo" disabled={busy} onPress={onReset} />}
    <Button title="Sign out and remove this push device" disabled={busy} onPress={() => { void perform(async () => {
      await onSignOut(); return 'Signed out.';
    }); }} />
    {preview && <Button title="Back to connection" tone="quiet" disabled={busy} onPress={onExit} />}
  </View>;
}
