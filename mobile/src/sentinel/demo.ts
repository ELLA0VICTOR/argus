import { BorshInstructionCoder } from '@anchor-lang/core';
import { Connection, Message, PublicKey, SystemProgram } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';
import { Buffer } from 'buffer';
import { ArgusClient, ARGUS_PROGRAM_ID } from '../program/client.ts';

export const SENTINEL_AI_GUARDIAN = 'DDZHZxxtYEwjttMJMoipr7tXuyPy6BmCCu4ECUi8Jppm';
export const DEMO_MINT = 'EXa24Mj3YsFxhhgohtBqYUSgy71AQrd9XtC64pZB9fhQ';
export type AttackKind = 'drain' | 'trusted' | 'allowance' | 'request';
export type DemoSession = { session: string; vault: string; vaultToken: string; owner: string; thief: string; thiefToken: string; mint: string; setupTx: string;
  rules: { dailyLimit: string; delayHours: number; funds: string } };
export type AttackResult = { ok: true; sig: string } | { ok: false; error: { code: number | null; name: string; msg: string } };
export type DemoEvent = { t: number } & (
  { type: 'log'; text: string; tone?: string } | { type: 'tx'; label: string; sig: string; by: string } |
  { type: 'attack'; kind: AttackKind; ok: boolean; sig?: string; error?: { code: number | null; name: string; msg: string } } |
  { type: 'risk'; score: number; level: string; reason: string; signals: { label: string; weight: number }[] } |
  { type: 'call'; who: string; text: string; status?: string } |
  { type: 'phone'; status: 'ready' } |
  { type: 'incoming'; amount: string; reason: string; timeoutSecs: number } |
  { type: 'decision'; decision: 'cancel' | 'allow' | 'timeout'; via: 'voice' | 'button' | 'timeout' } |
  { type: 'state'; vault: string; thief: string; frozen: boolean; pending: number }
);

export function demoUrl(value: string, development = false): string {
  const url = new URL(value);
  const privateHost = /^(localhost|127\.0\.0\.1|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})$/.test(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(development && privateHost && url.protocol === 'http:'))) {
    throw new Error('Use HTTPS for Sentinel. Local HTTP is supported only on private development hosts.');
  }
  return url.toString().replace(/\/$/, '');
}

export class SentinelDemoClient {
  readonly base: string;
  private seed: Uint8Array | null = null;
  private session: DemoSession | null = null;
  private readonly codec = new ArgusClient(new Connection('https://api.devnet.solana.com'));
  private fetcher: typeof fetch;
  constructor(base: string, fetcher: typeof fetch = fetch, development = false) { this.base = demoUrl(base, development); this.fetcher = fetcher; }

  private async call(path: string, body?: unknown): Promise<any> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await this.fetcher(`${this.base}${path}`, { method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal, redirect: 'error' });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data?.error?.message === 'string' ? data.error.message : 'Sentinel could not complete this demo request.');
      return data;
    } catch (error) {
      if (error instanceof TypeError || (error instanceof Error && error.name === 'AbortError')) throw new Error('Could not reach the local Sentinel. Check the demo URL, USB forwarding or HTTPS tunnel, then retry.');
      throw error;
    } finally { clearTimeout(timer); }
  }

  async health() {
    const data = await this.call('/v1/health');
    if (data.ok !== true || data.cluster !== 'devnet' || data.program_id !== ARGUS_PROGRAM_ID.toBase58() || data.ai_guardian !== SENTINEL_AI_GUARDIAN) throw new Error('Sentinel does not match the announced devnet program and AI guardian.');
    return { aiGuardian: data.ai_guardian as string, version: data.version as string };
  }

  async start(): Promise<DemoSession> {
    this.dispose(); await this.health();
    const data = await this.call('/v1/demo/session', {});
    if (!data || typeof data.stolenKey !== 'string' || !data.rules || typeof data.rules.dailyLimit !== 'string' || typeof data.rules.funds !== 'string' || !Number.isFinite(data.rules.delayHours)) throw new Error('Sentinel returned an incomplete demo session.');
    const secret = bs58.decode(data.stolenKey);
    delete data.stolenKey; // Never expose this disposable demo key in UI state, storage or logs.
    try {
      if (secret.length !== 64 || bs58.encode(ed25519.getPublicKey(secret.subarray(0, 32))) !== data.owner || data.mint !== DEMO_MINT) throw new Error('Sentinel returned an invalid disposable demo wallet.');
      const owner = new PublicKey(data.owner); const vault = this.codec.vaultAddress(owner, 0n)[0];
      if (data.vault !== vault.toBase58() || data.session !== data.vault || data.vaultToken !== getAssociatedTokenAddressSync(new PublicKey(data.mint), vault, true).toBase58() || data.thiefToken !== getAssociatedTokenAddressSync(new PublicKey(data.mint), new PublicKey(data.thief)).toBase58()) throw new Error('Sentinel returned inconsistent demo accounts.');
      this.seed = secret.slice(0, 32); this.session = data as DemoSession; return this.session;
    } finally { secret.fill(0); }
  }

  async attack(kind: AttackKind): Promise<AttackResult> {
    if (!this.session || !this.seed) throw new Error('Start a live demo first.');
    const session = this.session;
    const prepared = await this.call(`/v1/demo/${session.session}/attack`, { kind });
    if (prepared.kind !== kind || !/^[a-zA-Z0-9_-]{1,128}$/.test(prepared.nonce)) throw new Error('Sentinel returned an invalid demo move.');
    const bytes = Buffer.from(prepared.message, 'base64');
    const message = Message.from(bytes);
    if (message.header.numRequiredSignatures !== 1 || message.accountKeys[0].toBase58() !== session.owner || message.instructions.length !== 1) throw new Error('The demo requested an unexpected transaction.');
    const instruction = message.instructions[0];
    if (!message.accountKeys[instruction.programIdIndex].equals(ARGUS_PROGRAM_ID)) throw new Error('The demo can sign only Argus test-token moves.');
    const decoded = new BorshInstructionCoder(this.codec.program.idl).decode(Buffer.from(bs58.decode(instruction.data)))!;
    const method = kind === 'request' ? 'requestWithdrawal' : kind === 'trusted' ? 'withdrawTrusted' : 'withdrawInstant';
    if (!decoded || decoded.name !== method) throw new Error('The demo move differs from the selected action.');
    const amount = BigInt((decoded.data as { amount: { toString(): string } }).amount.toString());
    if (amount <= 0n || amount > 12_000_000_000n || (kind === 'allowance' && amount !== 100_000_000n)) throw new Error('The demo requested an unexpected token amount.');
    const schema = this.codec.program.idl.instructions.find(i => i.name === method)!;
    const expected: Record<string, string> = { vault: session.vault, owner: session.owner, mint: session.mint, tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
      vaultToken: session.vaultToken, destination: session.thiefToken, systemProgram: SystemProgram.programId.toBase58(),
      trusted: this.codec.trustedAddress(new PublicKey(session.vault), new PublicKey(session.thief))[0].toBase58() };
    if (instruction.accounts.length !== schema.accounts.length) throw new Error('The demo account list is invalid.');
    schema.accounts.forEach((meta, i) => {
      const index = instruction.accounts[i]; const address = message.accountKeys[index].toBase58();
      if (meta.name !== 'withdrawal' && expected[meta.name] !== address) throw new Error('The demo tried to substitute an account.');
      const signer = 'signer' in meta && meta.signer === true;
      const writable = ('writable' in meta && meta.writable === true) || address === session.owner;
      if (message.isAccountSigner(index) !== signer || message.isAccountWritable(index) !== writable) throw new Error('The demo account permissions are invalid.');
    });
    if (session !== this.session || !this.seed) throw new Error('This demo session has ended. Start a new one.');
    const signature = bs58.encode(ed25519.sign(bytes, this.seed));
    return this.call(`/v1/demo/${session.session}/attack/${prepared.nonce}`, { signature });
  }

  dispose() { this.seed?.fill(0); this.seed = null; this.session = null; }

  async decide(decision: 'cancel' | 'allow', via: 'voice' | 'button' = 'button'): Promise<void> {
    if (!this.session) throw new Error('Start a live demo first.');
    await this.call(`/v1/demo/${this.session.session}/decision`, { decision, via });
  }

  async relayCall(line: { status: 'connected' | 'ended' } | { who: 'argus' | 'owner'; text: string }): Promise<void> {
    if (!this.session) throw new Error('Start a live demo first.');
    const body = 'text' in line ? { who: line.who, text: line.text.slice(0, 400) } : { status: line.status };
    await this.call(`/v1/demo/${this.session.session}/call`, body);
  }
}

/** Incremental SSE framing, including split chunks and CRLF, without depending on browser EventSource. */
export class DemoEventDecoder {
  private buffer = '';
  private emit: (event: DemoEvent) => void;
  constructor(emit: (event: DemoEvent) => void) { this.emit = emit; }
  feed(chunk: string) {
    this.buffer += chunk;
    if (this.buffer.length > 200_000) throw new Error('Sentinel sent an oversized event.');
    const frames = this.buffer.split(/\r?\n\r?\n/); this.buffer = frames.pop()!;
    for (const frame of frames) {
      const body = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (!body) continue;
      try {
        const event = JSON.parse(body) as DemoEvent;
        if (!isDemoEvent(event)) continue;
        this.emit(event);
      } catch { /* Ignore malformed frames, without interpreting them as a resolved action. */ }
    }
  }
}

function isDemoEvent(event: DemoEvent): boolean {
  if (!event || !Number.isFinite(event.t)) return false;
  const text = (value: unknown) => typeof value === 'string' && value.length <= 6000;
  const signature = (value: unknown) => typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(value);
  switch (event.type) {
    case 'log': return text(event.text);
    case 'tx': return text(event.label) && text(event.by) && signature(event.sig);
    case 'call': return text(event.text) && ['argus', 'owner'].includes(event.who) && (event.status === undefined || text(event.status));
    case 'phone': return event.status === 'ready';
    case 'incoming': return text(event.amount) && text(event.reason) && Number.isInteger(event.timeoutSecs) && event.timeoutSecs > 0 && event.timeoutSecs <= 300;
    case 'decision': return ['cancel', 'allow', 'timeout'].includes(event.decision) && ['voice', 'button', 'timeout'].includes(event.via);
    case 'attack': return ['drain', 'trusted', 'allowance', 'request'].includes(event.kind) && typeof event.ok === 'boolean' &&
      (event.ok ? signature(event.sig) : !!event.error && text(event.error.msg));
    case 'risk': return Number.isInteger(event.score) && event.score >= 0 && event.score <= 100 && ['low', 'medium', 'high', 'critical'].includes(event.level) && text(event.reason) &&
      Array.isArray(event.signals) && event.signals.length <= 30 && event.signals.every(s => text(s.label) && Number.isFinite(s.weight));
    case 'state': return /^\d{1,30}(?:\.\d{1,10})?$/.test(event.vault) && /^\d{1,30}(?:\.\d{1,10})?$/.test(event.thief) && typeof event.frozen === 'boolean' && Number.isInteger(event.pending) && event.pending >= 0;
    default: return false;
  }
}
