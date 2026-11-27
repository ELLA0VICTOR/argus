import { AppState } from 'react-native';
import { DemoEventCursor, type DemoEvent } from '../sentinel/demo';

export function listenForDemoEvents(base: string, session: string, emit: (event: DemoEvent) => void, status: (message: string) => void) {
  let closed = false; let request: XMLHttpRequest | undefined; let retry: ReturnType<typeof setTimeout> | undefined;
  const cursor = new DemoEventCursor(emit);
  function stopRequest() { if (retry) clearTimeout(retry); const previous = request; request = undefined; previous?.abort(); }
  function connect() {
    if (closed || AppState.currentState === 'background') return;
    const xhr = new XMLHttpRequest(); request = xhr; let offset = 0;
    const decoder = cursor.decoder();
    const reconnect = (message = 'Reconnecting to the live log…') => {
      if (closed || request !== xhr) return;
      request = undefined; status(message); xhr.abort();
      retry = setTimeout(connect, cursor.retryMs);
    };
    const consume = () => {
      if (closed || request !== xhr) return;
      if (xhr.status && xhr.status !== 200) { status('Sentinel event stream is unavailable. Reconnecting…'); return; }
      try { const text = xhr.responseText || ''; decoder.feed(text.slice(offset)); offset = text.length; }
      catch { reconnect('Sentinel returned an invalid event stream. Reconnecting…'); }
    };
    xhr.open('GET', cursor.url(base, session));
    xhr.setRequestHeader('Accept', 'text/event-stream');
    xhr.timeout = 65_000;
    xhr.onprogress = consume;
    xhr.onreadystatechange = () => { if (xhr.readyState >= 3) { if (xhr.status === 200) status('Connected to Sentinel'); consume(); } };
    xhr.onerror = () => reconnect(); xhr.onloadend = () => reconnect(); xhr.ontimeout = () => reconnect();
    xhr.send();
  }
  connect();
  const subscription = AppState.addEventListener('change', state => { stopRequest(); if (state === 'active') connect(); });
  return () => { closed = true; stopRequest(); subscription.remove(); };
}
