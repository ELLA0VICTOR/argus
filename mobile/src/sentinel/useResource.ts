import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

export function useResource<T>(key: string, loader: () => Promise<T>, poll = true) {
  const latest = useRef(loader); latest.current = loader;
  const mounted = useRef(false);
  const generation = useRef(0);
  const running = useRef<Promise<void> | null>(null);
  const dataKey = useRef(key);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    if (!mounted.current) return;
    const current = generation.current;
    if (running.current) {
      await running.current;
      if (generation.current === current) await refresh();
      return;
    }
    setLoading(true);
    const work = (async () => {
      try {
        const value = await Promise.resolve().then(() => latest.current());
        if (generation.current === current) { setData(value); setError(null); }
      } catch (e) {
        if (generation.current === current) setError(e instanceof Error ? e.message : 'Could not load Sentinel data.');
      } finally {
        if (generation.current === current) { setLoading(false); running.current = null; }
      }
    })();
    running.current = work;
    await work;
  }, []);
  useEffect(() => {
    mounted.current = true;
    generation.current++; running.current = null; dataKey.current = key; setData(null); setError(null);
    void refresh();
    const timer = poll ? setInterval(() => { if (AppState.currentState === 'active') void refresh(); }, 15_000) : undefined;
    const foreground = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
    return () => { mounted.current = false; generation.current++; if (timer) clearInterval(timer); foreground.remove(); };
  }, [key, poll, refresh]);
  return { data: dataKey.current === key ? data : null, error: dataKey.current === key ? error : null, loading, refresh };
}
