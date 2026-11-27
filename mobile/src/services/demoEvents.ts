import { AppState } from 'react-native';
import { DemoEventDecoder, type DemoEvent } from '../sentinel/demo';

export function listenForDemoEvents(base: string, session: string, emit: (event: DemoEvent) => void, status: (message: string) => void) {
  let closed = false; let request: XMLHttpRequest | undefined; let retry: ReturnType<typeof setTimeout> | undefined;
  const seen = new Set<string>();
  let latestTime = 0;
  function stopRequest() { if (retry) clearTimeout(retry); const previous = request; request = undefined; previous?.abort(); }
  function connect() {
    if (closed || AppState.currentState === 'background') return;
    const xhr = new XMLHttpRequest(); request = xhr; let offset = 0;
    const decoder = new DemoEventDecoder(event => {
      if (event.t < latestTime) return;
      if (event.t > latestTime) { latestTime = event.t; seen.clear(); }
      const id = JSON.stringify(event);
      if (seen.has(id)) return;
      seen.add(id); emit(event);
    });
    const consume = () => {
      if (closed || request !== xhr) return;
      if (xhr.status && xhr.status !== 200) { status('Sentinel event stream is unavailable. Reconnecting…'); return; }
      try { const text = xhr.responseText || ''; decoder.feed(text.slice(offset)); offset = text.length; }
      catch { status('Sentinel returned an invalid event stream.'); stopRequest(); }
    };
    const reconnect = () => {
      if (closed || request !== xhr) return;
      request = undefined; status('Connection interrupted. Reconnecting to the live log…');
      retry = setTimeout(connect, 4000);
    };
    xhr.open('GET', `${base}/v1/demo/${encodeURIComponent(session)}/events`);
    xhr.setRequestHeader('Accept', 'text/event-stream');
    xhr.onprogress = consume;
    xhr.onreadystatechange = () => { if (xhr.readyState >= 3) { if (xhr.status === 200) status('Connected to Sentinel'); consume(); } };
    xhr.onerror = reconnect; xhr.onloadend = reconnect;
    xhr.send();
  }
  connect();
  const subscription = AppState.addEventListener('change', state => { stopRequest(); if (state === 'active') connect(); });
  return () => { closed = true; stopRequest(); seen.clear(); subscription.remove(); };
}
