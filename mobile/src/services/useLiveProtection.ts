import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { WatchLog } from '../sentinel/types';
import type { LiveAlert } from '../sentinel/live';
import { liveSentinel } from '../sentinel/liveRuntime';

export function useLiveProtection(vault: string | undefined, active: boolean) {
  const [data, setData] = useState<{ vault: string; alerts: LiveAlert[]; log: WatchLog['entries']; error: string | null } | null>(null);
  const trigger = useRef<() => Promise<void>>(async () => {});
  const refresh = useCallback(() => trigger.current(), []);
  useEffect(() => {
    if (!vault || !active) { trigger.current = async () => {}; return; }
    let alive = true; let pending: Promise<void> | null = null;
    const poll = (): Promise<void> => {
      if (!alive || AppState.currentState !== 'active') return Promise.resolve();
      if (pending) return pending;
      pending = Promise.allSettled([liveSentinel.alerts(vault), liveSentinel.watchlog(vault)]).then(([alerts, log]) => {
        if (!alive) return;
        setData(old => ({ vault,
          alerts: alerts.status === 'fulfilled' ? alerts.value : old?.vault === vault ? old.alerts : [],
          log: log.status === 'fulfilled' ? log.value : old?.vault === vault ? old.log : [],
          error: alerts.status === 'rejected' ? 'Live alerts are temporarily unavailable. You can still cancel or freeze from your vault.' : null,
        }));
      }).finally(() => { pending = null; });
      return pending;
    };
    trigger.current = poll; void poll();
    const timer = setInterval(() => { void poll(); }, 6000);
    const sub = AppState.addEventListener('change', state => { if (state === 'active') void poll(); });
    return () => { alive = false; clearInterval(timer); sub.remove(); trigger.current = async () => {}; };
  }, [vault, active]);
  const selected = data && data.vault === vault ? data : null;
  return { alerts: selected?.alerts ?? [], log: selected?.log ?? [], error: selected?.error ?? null, refresh };
}
