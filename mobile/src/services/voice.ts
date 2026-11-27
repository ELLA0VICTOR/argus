import { PermissionsAndroid, Platform } from 'react-native';
import type { CallLine, GuardianCallRequest, VoiceAttempt } from '../domain/guardianCall';

export type NativeVoiceProps = { attempt: VoiceAttempt; request: GuardianCallRequest; callbacks: {
  cancel(): Promise<string>; allow(): Promise<string>; connected(): void; disconnected(): void;
  mode(speaking: boolean): void; line(line: CallLine): void; error(message: string): void;
} };

export async function requestCallMicrophone() {
  if (Platform.OS !== 'android') return;
  const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
    title: 'Talk to Argus', message: 'Allow the microphone for this internet call with your vault guardian.',
    buttonPositive: 'Allow microphone', buttonNegative: 'Use buttons',
  });
  if (granted !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('Microphone access is off. You can still cancel or confirm using the buttons.');
}
