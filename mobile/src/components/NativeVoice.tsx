import { Component, useEffect, useRef } from 'react';
import { ConversationProvider, useConversation } from '@elevenlabs/react-native';
import { AudioSession } from '@livekit/react-native';
import { ARGUS_VOICE_AGENT, voiceVariables, type VoiceConnection } from '../domain/guardianCall';
import type { NativeVoiceProps } from '../services/voice';

// This entire module is loaded after Accept and microphone permission, never while ringing.
export default class NativeVoice extends Component<NativeVoiceProps, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.callbacks.error('Voice is unavailable in this build. Use the decision buttons.'); }
  render() { return this.state.failed ? null : <ConversationProvider><VoiceBridge {...this.props} /></ConversationProvider>; }
}

function VoiceBridge({ attempt, request, callbacks }: NativeVoiceProps) {
  const latest = useRef(callbacks); latest.current = callbacks;
  const resolve = useRef<((connection: VoiceConnection) => void) | null>(null);
  const reject = useRef<((error: Error) => void) | null>(null);
  const conversation = useConversation({
    clientTools: {
      cancel_withdrawal: () => attempt.active ? latest.current.cancel() : Promise.reject(new Error('This call ended.')),
      allow_withdrawal: () => attempt.active ? latest.current.allow() : Promise.reject(new Error('This call ended.')),
    },
    onConversationCreated: connection => {
      resolve.current?.({ setMicMuted: muted => connection.setMicMuted(muted), endSession: async () => {
        try { await connection.endSession(); } finally { await AudioSession.stopAudioSession(); }
      } });
    },
    onConnect: () => { if (attempt.active) latest.current.connected(); },
    onDisconnect: () => {
      reject.current?.(new Error('Voice disconnected.'));
      if (attempt.active) latest.current.disconnected();
    },
    onModeChange: ({ mode }) => { if (attempt.active) latest.current.mode(mode === 'speaking'); },
    onMessage: ({ message, source }) => { if (attempt.active) latest.current.line({ who: source === 'ai' ? 'argus' : 'owner', text: message.slice(0, 400) }); },
    onError: () => {
      reject.current?.(new Error('Voice connection failed.'));
      void AudioSession.stopAudioSession().catch(() => {});
      if (attempt.active) latest.current.error('The voice connection failed. Use the decision buttons below.');
    },
  });
  const controls = useRef(conversation); controls.current = conversation;
  useEffect(() => {
    if (!attempt.active) return;
    void attempt.start(() => new Promise<VoiceConnection>((yes, no) => {
      resolve.current = yes; reject.current = no;
      controls.current.startSession({ agentId: ARGUS_VOICE_AGENT, connectionType: 'webrtc', textOnly: false, dynamicVariables: voiceVariables(request) });
    })).catch(() => {
      void AudioSession.stopAudioSession().catch(() => {});
      if (attempt.active) latest.current.error('Could not connect voice. Use the decision buttons below.');
    });
    return () => {
      controls.current.endSession();
      void attempt.close().catch(() => {});
      void AudioSession.stopAudioSession().catch(() => {});
    };
  }, [attempt]);
  return null;
}
