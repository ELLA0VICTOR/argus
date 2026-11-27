import bs58 from 'bs58';
import { validateChallenge, validatePhone } from './rules.ts';
import type { AlertPage, Challenge, Contacts, Credential, CredentialStore, DeviceCredential, DeviceRegistration,
  PhoneRegistration, SentinelAlert, Token, Transport, VaultList, VaultSummary, WatchLog } from './types.ts';

export class SentinelError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 0) { super(message); this.code = code; this.status = status; }
}

const SESSION_KEY = 'argus.sentinel.session';
export class SentinelClient {
  private credential: Credential | null = null;
  private listeners = new Set<() => void>();
  get session() { return this.credential; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish() { this.listeners.forEach(listener => listener()); }

  readonly scope: string;
  readonly mock: boolean;
  private transport: Transport;
  private store: CredentialStore;
  private now: () => number;
  constructor(scope: string, mock: boolean, transport: Transport, store: CredentialStore, now = () => Math.floor(Date.now() / 1000)) {
    this.scope = scope; this.mock = mock; this.transport = transport; this.store = store; this.now = now;
  }

  async restore() {
    const raw = await this.store.get(SESSION_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as Credential;
      if (saved.scope !== this.scope || typeof saved.token !== 'string' || !saved.token ||
        typeof saved.wallet !== 'string' || !Number.isInteger(saved.expires_at) || saved.expires_at <= this.now()) {
        await this.clearSession(); return;
      }
      this.credential = saved;
      // Verify persisted tokens with the service (mock sessions reset on app restart).
      await this.vaults();
      this.publish();
    } catch (error) {
      if (error instanceof SyntaxError) await this.clearSession();
      else if (error instanceof SentinelError && ['UNAUTHENTICATED', 'TOKEN_EXPIRED'].includes(error.code)) return;
      else { this.publish(); throw error; }
    }
  }

  private async saveSession(wallet: string, token: Token) {
    if (!token.token || !Number.isInteger(token.expires_at) || token.expires_at <= this.now()) throw new Error('Sentinel returned an invalid token.');
    const credential = { ...token, wallet, scope: this.scope };
    await this.store.set(SESSION_KEY, JSON.stringify(credential));
    this.credential = credential;
    this.publish();
  }

  async clearSession() {
    this.credential = null;
    this.publish();
    await this.store.remove(SESSION_KEY);
  }

  async signIn(wallet: string, sign: (challenge: Challenge) => Promise<string>) {
    const challenge = await this.request<Challenge>('/v1/auth/challenge', 'POST', { wallet }, false);
    validateChallenge(challenge, wallet, this.now());
    const signature = await sign(challenge);
    if (challenge.expires_at <= this.now()) throw new SentinelError('NONCE_EXPIRED', 'Sign-in expired. Please try again.');
    const token = await this.request<Token>('/v1/auth/verify', 'POST', { wallet, nonce: challenge.nonce, signature }, false);
    await this.saveSession(wallet, token);
  }

  // Only used by the in-process preview, never an HTTP endpoint or a persisted token.
  enterDemo(wallet: string, token: Token) {
    if (!this.mock) throw new Error('Demo authentication is unavailable with a live Sentinel.');
    this.credential = { ...token, wallet, scope: this.scope }; this.publish();
  }

  async logout(vault?: string) {
    if (this.credential) {
      const vaults = new Set(await this.deviceVaults());
      if (vault) vaults.add(vault);
      for (const registeredVault of vaults) {
        const device = await this.localDevice(registeredVault);
        if (device) await this.removeOwnDevice(registeredVault); // Keep the session if cleanup needs a retry.
      }
    }
    try { await this.request('/v1/auth/logout', 'POST'); }
    catch (error) {
      if (!(error instanceof SentinelError) || !['UNAUTHENTICATED', 'TOKEN_EXPIRED'].includes(error.code)) throw error;
    }
    await this.clearSession();
  }

  async request<T>(path: string, method = 'GET', body?: unknown, authenticated = true, deviceSecret?: string): Promise<T> {
    const credential = this.credential;
    if (authenticated && !deviceSecret && (!credential || credential.expires_at <= this.now())) {
      if (credential) await this.clearSession();
      throw new SentinelError('TOKEN_EXPIRED', 'Sign in with your wallet to continue.', 401);
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authenticated && credential && credential.expires_at > this.now()) headers.Authorization = `Bearer ${credential.token}`;
    if (deviceSecret) headers['X-Device-Secret'] = deviceSecret;
    let response;
    try { response = await this.transport(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
    catch { throw new SentinelError('NETWORK', 'Sentinel could not be reached. Check your connection and retry.'); }
    if (response.status < 200 || response.status >= 300) {
      const error = (response.data as { error?: { code?: string; message?: string } })?.error;
      const code = error?.code ?? 'INTERNAL';
      if (authenticated && !deviceSecret && credential === this.credential &&
        (response.status === 401 || code === 'TOKEN_EXPIRED' || code === 'UNAUTHENTICATED')) await this.clearSession();
      throw new SentinelError(code, error?.message ?? 'Sentinel could not complete the request.', response.status);
    }
    // A response from an old account must never populate a newly signed-in account's screen.
    if (authenticated && !deviceSecret && credential !== this.credential) throw new SentinelError('SESSION_CHANGED', 'The signed-in wallet changed. Please retry.');
    return response.data as T;
  }

  vaults() { return this.request<VaultList>('/v1/vaults'); }
  vault(vault: string) { return this.request<VaultSummary>(`/v1/vaults/${encodeURIComponent(vault)}`); }
  contacts(vault: string) { return this.request<Contacts>(`/v1/vaults/${encodeURIComponent(vault)}/contacts`); }
  alerts(vault: string, before?: number, status?: 'open') {
    const query = `limit=20${before === undefined ? '' : `&before=${before}`}${status ? `&status=${status}` : ''}`;
    return this.request<AlertPage>(`/v1/vaults/${encodeURIComponent(vault)}/alerts?${query}`);
  }
  alert(id: string) { return this.request<SentinelAlert>(`/v1/alerts/${encodeURIComponent(id)}`); }
  dismiss(id: string) { return this.request<SentinelAlert>(`/v1/alerts/${encodeURIComponent(id)}/dismiss`, 'POST'); }
  watchlog(vault: string) { return this.request<WatchLog>(`/v1/vaults/${encodeURIComponent(vault)}/watchlog?limit=50`); }
  addPhone(vault: string, e164: string, label: string) {
    return this.request<PhoneRegistration>(`/v1/vaults/${encodeURIComponent(vault)}/phones`, 'POST', { e164: validatePhone(e164), label: label.trim() });
  }
  removePhone(vault: string, id: string) { return this.request<void>(`/v1/vaults/${encodeURIComponent(vault)}/phones/${encodeURIComponent(id)}`, 'DELETE'); }

  private deviceKey(vault: string) {
    if (!this.credential) throw new SentinelError('UNAUTHENTICATED', 'Sign in to manage this device.');
    return `argus.device.${bs58.encode(new TextEncoder().encode(this.scope))}.${this.credential.wallet}.${vault}`;
  }
  private deviceIndexKey() { return this.deviceKey('index'); }
  private async deviceVaults(): Promise<string[]> {
    const raw = await this.store.get(this.deviceIndexKey());
    if (!raw) return [];
    const vaults: unknown = JSON.parse(raw);
    return Array.isArray(vaults) ? vaults.filter((v): v is string => typeof v === 'string') : [];
  }
  async localDevice(vault: string): Promise<DeviceCredential | null> {
    const raw = await this.store.get(this.deviceKey(vault));
    if (!raw) return null;
    const saved = JSON.parse(raw) as DeviceCredential;
    return saved.scope === this.scope && saved.wallet === this.credential?.wallet && saved.vault === vault &&
      typeof saved.id === 'string' && typeof saved.secret === 'string' ? saved : null;
  }
  async addDevice(vault: string, expo_push_token: string, label: string) {
    const credential = this.credential;
    const key = this.deviceKey(vault);
    const indexKey = this.deviceIndexKey();
    let existing = await this.localDevice(vault);
    // A rotated Expo token must not leave a contact whose removal secret is overwritten.
    if (existing && existing.expo_push_token !== expo_push_token) {
      await this.removeOwnDevice(vault); existing = null;
    }
    const result = await this.request<DeviceRegistration>(`/v1/vaults/${encodeURIComponent(vault)}/devices`, 'POST', {
      expo_push_token, platform: 'android', label: label.trim(),
    });
    const secret = result.device_secret ?? (existing?.id === result.id ? existing.secret : undefined);
    if (!secret) throw new Error('Push is registered, but this device has no removal secret. Ask a guardian to remove it, then register again.');
    await this.store.set(key, JSON.stringify({ scope: this.scope, wallet: credential!.wallet, vault, id: result.id, secret, expo_push_token } satisfies DeviceCredential));
    const vaults = await this.deviceVaults();
    if (!vaults.includes(vault)) await this.store.set(indexKey, JSON.stringify([...vaults, vault]));
    return result.id;
  }
  async removeOwnDevice(vault: string) {
    const key = this.deviceKey(vault);
    const indexKey = this.deviceIndexKey();
    const vaults = await this.deviceVaults();
    const device = await this.localDevice(vault);
    if (!device) throw new Error('No removal secret is stored for this device.');
    await this.request<void>(`/v1/vaults/${encodeURIComponent(vault)}/devices/${encodeURIComponent(device.id)}`, 'DELETE', undefined, true, device.secret);
    await this.store.remove(key);
    await this.store.set(indexKey, JSON.stringify(vaults.filter(v => v !== vault)));
  }
  removeDevice(vault: string, id: string) { return this.request<void>(`/v1/vaults/${encodeURIComponent(vault)}/devices/${encodeURIComponent(id)}`, 'DELETE'); }
}

export function httpTransport(baseUrl: string, fetcher: typeof fetch = fetch): Transport {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Sentinel must use an HTTPS base URL without credentials or query parameters.');
  const base = baseUrl.replace(/\/$/, '');
  return async (path, init) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const result = await fetcher(`${base}${path}`, { ...init, signal: controller.signal, redirect: 'error' });
      return { status: result.status, data: result.status === 204 ? undefined : await result.json() };
    } finally { clearTimeout(timeout); }
  };
}
