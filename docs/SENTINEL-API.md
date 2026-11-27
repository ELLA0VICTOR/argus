# Sentinel API (v1 contract)

**Status:** draft contract, not implemented yet. Base URL: _TBD (Render)_, recorded in `docs/HANDOFF.md` when deployed.
**Audience:** the mobile app (Codex) and the web app (Claude). Changes to this file are announced in `docs/HANDOFF.md`.

Sentinel is the AI guardian service. Clients use this API to sign in with a wallet, register where alerts go (phone and push), and read alerts and the watch log.

**What this API never does:** move funds, approve proposals or sign anything for a client. Cancel and freeze from the app are signed by the user's own wallet (MWA) and sent straight to the program. Sentinel's AI key signs `cancel_withdrawal` / `freeze` only on its own decision or after a "cancel" on the phone call. No endpoint lets a client trigger the AI key.

## Conventions

- JSON in and out. `Content-Type: application/json`.
- **Addresses:** base58 strings.
- **Amounts:** decimal strings in base units of the vault mint (`"2500000000"`), plus `decimals` where useful. Never JS numbers.
- **Times:** unix seconds (integers), matching the chain.
- **Auth:** `Authorization: Bearer <token>` on every endpoint except `/v1/health` and `/v1/auth/*`.
- **Errors:** non-2xx with this body:
  ```json
  { "error": { "code": "NOT_VAULT_MEMBER", "message": "Wallet is not the owner or a guardian of this vault" } }
  ```
- **Rate limits:** 60 req/min per token, 10 req/min per IP on `/v1/auth/*`. Exceeding gives `429 RATE_LIMITED`.

## Roles

On every request, Sentinel reads the on-chain `Vault` account (cached for 30 s) to decide the caller's role for that vault:

| Role | Who |
|---|---|
| `owner` | `vault.owner` |
| `guardian` | Any wallet in `vault.guardians` |
| none | Anyone else. Every vault endpoint returns `403 NOT_VAULT_MEMBER` |

The role is re-checked on every call, so an owner rotation or `SetGuardians` takes effect within 30 s without re-login.

## 1. Auth (sign in with the wallet)

### `POST /v1/auth/challenge`

```json
// request
{ "wallet": "7xKX…9fQ" }
// 200
{
  "nonce": "b3f1c2…",           // 32 random bytes, hex
  "message": "argus.app wants you to sign in with your Solana account:\n7xKX…9fQ\n\nSign in to Argus Sentinel. This does not move funds or approve any transaction.\n\nURI: https://argus.app\nVersion: 1\nChain ID: devnet\nNonce: b3f1c2…\nIssued At: 2026-11-26T10:00:00Z\nExpiration Time: 2026-11-26T10:05:00Z",
  "expires_at": 1795687500
}
```

The message is SIWS-formatted (Sign In With Solana), so MWA `signIn` or `signMessages` both work. The client signs the **exact UTF-8 bytes** of `message`. A nonce is single-use and lasts 5 minutes.

### `POST /v1/auth/verify`

```json
// request
{ "wallet": "7xKX…9fQ", "nonce": "b3f1c2…", "signature": "<base58 ed25519 signature>" }
// 200
{ "token": "<opaque>", "expires_at": 1795773600 }
```

The token lasts 24 h. Errors: `400 BAD_SIGNATURE`, `400 NONCE_EXPIRED`, `400 NONCE_USED`.

### `POST /v1/auth/logout`

Revokes the token. Returns `204`.

## 2. Vaults

### `GET /v1/vaults`

Lists the vaults where the signed-in wallet is the owner or a guardian (found from on-chain accounts).

```json
{ "vaults": [ { "vault": "Vt1…", "role": "owner", "watched": true } ] }
```

### `GET /v1/vaults/{vault}`

Sentinel's view of one vault: on-chain state as last seen, plus watch status. Clients may read the chain directly instead. This endpoint is a convenience, **the chain is the source of truth**.

```json
{
  "vault": "Vt1…",
  "role": "owner",
  "watched": true,
  "frozen": false,
  "balance": "12500000000",
  "decimals": 6,
  "mint": "4zMM…",
  "pending_withdrawals": 1,
  "open_alerts": 1,
  "last_scan_at": 1795687400
}
```

`watched` is true when the vault's `ai_guardian` equals Sentinel's AI pubkey (`GET /v1/health` returns it). A vault that doesn't name Sentinel as its AI guardian still gets alerts, but Sentinel cannot cancel or freeze it.

## 3. Alert contacts (phone and push)

**Threat O6 (see THREAT-MODEL.md):** a thief holding the owner key must not be able to redirect alerts to themselves. Rules:

- **Anyone with a role can add** a contact. When at least one contact already exists, adding one sends a "new contact added" notice to every existing contact.
- **Only a guardian can remove** a phone contact. The owner cannot remove or replace one.
- **A push device can be removed** by a guardian, or by the device that registered it (using `device_secret`, below). This lets a user log out of a phone without needing a guardian.
- Alerts go to **every** active contact. An extra contact added by a thief can't silence the real owner.

### `GET /v1/vaults/{vault}/contacts`

```json
{
  "phones": [ { "id": "ph_1", "e164": "+23480******21", "label": "Victor", "added_by_role": "owner", "added_at": 1795687000, "verified": true } ],
  "devices": [ { "id": "dv_1", "platform": "android", "label": "Seeker", "added_by_role": "owner", "added_at": 1795687000 } ]
}
```

Phone numbers are masked in every response.

### `POST /v1/vaults/{vault}/phones`

```json
// request
{ "e164": "+2348012345621", "label": "Victor" }
// 201
{ "id": "ph_1", "verified": true, "verification": "none" }
```

The number is active immediately. **v1 has no SMS code check.** Decision (Victor, 2026-11-25): it costs Twilio credit and only guards against typos or registering a stranger's number, not against loss of funds. The `verified` / `verification` fields stay in the response so a production version can add `"sms_code_sent"` and a `POST …/phones/{id}/verify` step without breaking clients. The README lists this as a production item.

### `DELETE /v1/vaults/{vault}/phones/{id}`

Guardian only. Otherwise `403 GUARDIAN_REQUIRED`. Returns `204`.

### `POST /v1/vaults/{vault}/devices`

```json
// request
{ "expo_push_token": "ExponentPushToken[xxxx]", "platform": "android", "label": "Seeker" }
// 201
{ "id": "dv_1", "device_secret": "<opaque, store in SecureStore>" }
```

Registering the same `expo_push_token` again for the same vault updates it and returns the same `id` **without** `device_secret` (HTTP `200` instead of `201`). The secret is shown once only, on first registration, so clients keep the first one.

### `DELETE /v1/vaults/{vault}/devices/{id}`

Guardian token, **or** an `X-Device-Secret: <device_secret>` header. Returns `204`.

## 4. Alerts

An alert is created for every `WithdrawalRequested` that Sentinel scores, at any risk level, and for every freeze.

### Alert object

```json
{
  "id": "al_9",
  "vault": "Vt1…",
  "kind": "withdrawal",                 // "withdrawal" | "freeze"
  "token": { "mint": "4zMM…", "symbol": "USDC", "decimals": 6 },  // symbol may be null for unknown mints
  "withdrawal": {
    "pda": "Wd1…",
    "id": "3",
    "amount": "12000000000",
    "decimals": 6,
    "destination": "9wZ…",              // destination token account
    "destination_owner": "Hk2…",        // wallet that owns it
    "requested_at": 1795687200,
    "executes_at": 1795773600
  },
  "risk": "critical",                   // "low" | "medium" | "high" | "critical"
  "score": 92,                          // 0..100
  "reason": "This sends 96% of the vault to an address created 14 minutes ago that looks like your trusted address Hk2v…Q8 but isn't. It was requested at 03:12, outside your usual hours.",
  "signals": [
    { "id": "new_address",   "label": "Destination is 14 minutes old", "weight": 30 },
    { "id": "lookalike",     "label": "Looks like trusted Hk2v…Q8",   "weight": 35 },
    { "id": "share_of_vault","label": "96% of vault balance",          "weight": 20 },
    { "id": "odd_hour",      "label": "Requested at 03:12 local",      "weight": 7 },
    { "id": "scam_report",   "label": "No public scam reports found",  "weight": 0 }
  ],
  "status": "open",
  "actions": [
    { "at": 1795687210, "type": "push_sent" },
    { "at": 1795687215, "type": "call_started", "phone_id": "ph_1" }
  ],
  "call": {
    "status": "completed",              // "none" | "ringing" | "in_progress" | "completed" | "no_answer" | "failed"
    "outcome": "cancel_requested",      // "none" | "cancel_requested" | "user_approved" | "no_decision"
    "transcript": [ { "speaker": "agent", "text": "…" }, { "speaker": "user", "text": "Cancel it." } ]
  },
  "resolution": null,
  "created_at": 1795687205
}
```

`signals[].id` is a stable enum, `new_address | lookalike | share_of_vault | odd_hour | scam_report | first_destination`. The app can use it for icons. Labels are display text.

`status` is one of:

| status | Meaning |
|---|---|
| `open` | Pending on-chain, nobody has acted |
| `cancelled` | The withdrawal was cancelled. `resolution.by_role` is `owner`, `guardian` or `ai`, and `resolution.tx` is the signature |
| `executed` | It went through |
| `dismissed` | A member said "it was me". Display only, the on-chain withdrawal still executes at `executes_at` |
| `voided` | Owner rotation made it stale (INV-6) |

Statuses come from on-chain events. A client calling cancel through MWA doesn't need to tell Sentinel. The alert updates within one scan interval (≤ 15 s).

### `GET /v1/vaults/{vault}/alerts?status=open&limit=20&before=<created_at>`

```json
{ "alerts": [ /* Alert */ ], "next_before": 1795600000 }
```

### `GET /v1/alerts/{id}`

One alert. Returns `403` unless the caller has a role in the alert's vault.

### `POST /v1/alerts/{id}/dismiss`

This is "It was me, let it through". It marks the alert `dismissed`, stops further calls for it, and logs who did it. It **does not** touch the chain. Returns `200` with the Alert.

## 5. Watch log

### `GET /v1/vaults/{vault}/watchlog?limit=50&before=<at>`

A time-ordered feed of everything Sentinel saw and did, for the dashboard's "watch log" panel.

```json
{
  "entries": [
    { "at": 1795687215, "type": "call_started",  "text": "Calling Victor (+234…21)", "alert_id": "al_9" },
    { "at": 1795687205, "type": "scored",        "text": "Withdrawal #3 scored CRITICAL (92)", "alert_id": "al_9", "risk": "critical" },
    { "at": 1795687200, "type": "chain_event",   "text": "WithdrawalRequested #3: 12,000 USDC", "tx": "5Kp…" },
    { "at": 1795680000, "type": "heartbeat",     "text": "Watching. No pending withdrawals." }
  ],
  "next_before": 1795600000
}
```

`type` is one of `chain_event | scored | push_sent | call_started | call_ended | ai_cancel | ai_freeze | dismissed | contact_added | contact_removed | heartbeat`.

## 6. Push payload (Expo)

Sentinel sends Expo push messages in this shape. `data` is the contract, and the title and body are display text:

```json
{
  "to": "ExponentPushToken[xxxx]",
  "title": "Argus: withdrawal flagged CRITICAL",
  "body": "12,000 USDC to a 14-minute-old address. Executes in 23h 58m. Tap to cancel.",
  "priority": "high",
  "channelId": "argus-alerts",
  "data": {
    "type": "withdrawal_alert",       // "withdrawal_alert" | "vault_frozen" | "contact_added" | "alert_resolved"
    "alert_id": "al_9",
    "vault": "Vt1…",
    "withdrawal_pda": "Wd1…",
    "risk": "critical",
    "url": "argus://alert/al_9"
  }
}
```

The app should create the Android channel `argus-alerts` with max importance.

## 7. Health

### `GET /v1/health` (no auth)

```json
{ "ok": true, "cluster": "devnet", "program_id": "…", "ai_guardian": "<AI pubkey>", "last_scan_at": 1795687400, "version": "0.1.0" }
```

The create-vault wizard reads `ai_guardian` from here to fill the vault's AI guardian field.

## Internal endpoints (not for clients)

These exist but are authenticated by provider secrets and are not part of the client contract: `POST /internal/helius/webhook`, `POST /internal/elevenlabs/tool/cancel_withdrawal`, `POST /internal/elevenlabs/call-status`. The ElevenLabs tool endpoint checks that the call belongs to an open alert before it signs `cancel_withdrawal`. Web-demo endpoints ("Steal my wallet") will be documented here when built.

## Hackathon build: what's implemented, and how it differs (2026-11-27)

Approved by Victor on 2026-11-27. They cover what the live build does today. The full contract above still describes the production design.

**Watching real vaults**

- **What's watched:** every vault whose `ai_guardian` is Sentinel's AI key.
- **How Sentinel learns of activity:**
  - `POST /internal/helius/webhook` (Helius raw webhook, `Authorization` header = `HELIUS_WEBHOOK_SECRET`);
  - a scan of the vault whenever a client reads its alerts (at most every 8 s per vault);
  - a long-lived server also scans every 10 s.
- **Scoring:** each new pending withdrawal is scored into an Alert with the shape above. The signals used are `new_address`, `share_of_vault`, `first_destination`, `lookalike` and `odd_hour`.
- **The AI key acts on its own decision only:** a **critical** alert still open 45 seconds after it was raised gets `cancel_withdrawal` and then `freeze`, signed by the AI key.
  - The 45 s window replaces the phone call's no-answer timeout. It fits inside one serverless invocation.
  - High-risk alerts are raised but never auto-cancelled.
  - Statuses follow the chain: `open` → `cancelled` (by owner, guardian or ai) / `executed`.

**Reads without a session token (deviation)**

- `GET /v1/vaults/{vault}/alerts?status=open|all` and `GET /v1/vaults/{vault}/watchlog` need no Bearer token. Every field is derived from public on-chain data.
- SIWS sessions (§1) and contacts (§3) aren't built yet.

**Dismiss with a signed message (deviation)**

- `POST /v1/alerts/{id}/dismiss { wallet, signature, ts }`:
  - `signature` is the wallet's ed25519 signature of the exact text `Argus: it was me. Dismiss alert {id} at {ts}`;
  - `ts` (unix seconds) must be within 5 minutes;
  - the wallet must be the vault's owner or a guardian.
- **Critical alerts can only be dismissed by a guardian.** A stolen owner key is exactly the threat, so the owner key alone can't stand Argus down.
- Dismissing never touches the chain. It stops the AI's automatic cancel for that alert.

**Cancelling from the app**

- The owner or a guardian cancels with **their own wallet's** signature (`cancel_withdrawal` sent straight to the program).
- The in-app "Argus is calling" voice agent's *cancel* tool does exactly that. No client request makes the AI key sign anything.

**Other live routes**

- `POST /v1/faucet { wallet }`: 1,000 test dUSDC, plus 0.1 SOL if the wallet holds under 0.05 SOL. Once per wallet per 12 h, and 5 per address per day.
- `POST /v1/rpc/devnet`: a JSON-RPC relay to the private devnet RPC. It enforces a method allowlist, scans only for the Argus program, and caps batches at 25.
- The web demo's routes are under `/v1/demo/*` (see `docs/HANDOFF.md`).

## Error codes

`UNAUTHENTICATED`, `TOKEN_EXPIRED`, `BAD_SIGNATURE`, `NONCE_EXPIRED`, `NONCE_USED`, `NOT_VAULT_MEMBER`, `GUARDIAN_REQUIRED`, `VAULT_NOT_FOUND`, `ALERT_NOT_FOUND`, `INVALID_PHONE`, `RATE_LIMITED`, `INTERNAL`.
