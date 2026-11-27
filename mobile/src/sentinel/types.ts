// JSON contract: docs/SENTINEL-API.md. Amounts stay base-unit strings; times are unix seconds.
export type Role = 'owner' | 'guardian';
export type Risk = 'low' | 'medium' | 'high' | 'critical';
export type SignalId = 'new_address' | 'lookalike' | 'share_of_vault' | 'odd_hour' | 'scam_report' | 'first_destination';
export type AlertStatus = 'open' | 'cancelled' | 'executed' | 'dismissed' | 'voided';
export type AlertToken = { mint: string; symbol: string | null; decimals: number };
export type SentinelAlert = {
  id: string; vault: string; kind: 'withdrawal' | 'freeze';
  token: AlertToken;
  withdrawal: null | {
    pda: string; id: string; amount: string; decimals: number;
    destination: string; destination_owner: string; requested_at: number; executes_at: number;
  };
  risk: Risk; score: number; reason: string;
  signals: { id: SignalId; label: string; weight: number }[];
  status: AlertStatus;
  actions: { at: number; type: string; phone_id?: string }[];
  call: {
    status: 'none' | 'ringing' | 'in_progress' | 'completed' | 'no_answer' | 'failed';
    outcome: 'none' | 'cancel_requested' | 'user_approved' | 'no_decision';
    transcript: { speaker: 'agent' | 'user'; text: string }[];
  };
  resolution: null | { by_role: Role | 'ai'; tx: string };
  created_at: number;
};
export type AlertPage = { alerts: SentinelAlert[]; next_before: number | null };
export type VaultSummary = {
  vault: string; role: Role; watched: boolean; frozen: boolean; balance: string;
  decimals: number; mint: string; pending_withdrawals: number; open_alerts: number; last_scan_at: number;
};
export type VaultList = { vaults: { vault: string; role: Role; watched: boolean }[] };
export type Contacts = {
  phones: { id: string; e164: string; label: string; added_by_role: Role; added_at: number; verified: boolean }[];
  devices: { id: string; platform: 'android'; label: string; added_by_role: Role; added_at: number }[];
};
export type WatchLog = { entries: { at: number; type: string; text: string; alert_id?: string; risk?: Risk; tx?: string }[]; next_before: number | null };
export type Challenge = { nonce: string; message: string; expires_at: number };
export type Token = { token: string; expires_at: number };
export type Credential = Token & { wallet: string; scope: string };
export type DeviceCredential = { vault: string; id: string; secret: string; scope: string; wallet: string; expo_push_token: string };
export type PhoneRegistration = { id: string; verified: boolean; verification: 'none' | 'sms_code_sent' };
export type DeviceRegistration = { id: string; device_secret?: string };

export type Transport = (path: string, init: {
  method: string; headers: Record<string, string>; body?: string;
}) => Promise<{ status: number; data?: unknown }>;
export interface CredentialStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
