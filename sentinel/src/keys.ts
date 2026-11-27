// Sentinel keypairs. Secret files live in sentinel/keys/ (gitignored, mode 600).
// The AI guardian key is cancel/freeze-only on-chain (INV-5). Never log a secret.
import { Keypair } from "@solana/web3.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEYS = join(ROOT, "keys");

export type KeyName = "funder" | "ai-guardian" | "demo-guardian" | "demo-safe";

export function loadKey(name: KeyName): Keypair {
  const p = join(KEYS, `${name}.json`);
  if (!existsSync(p)) throw new Error(`missing key ${name}: run npm run setup:keys`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
}

export function ensureKey(name: KeyName): { pubkey: string; created: boolean } {
  mkdirSync(KEYS, { recursive: true });
  const p = join(KEYS, `${name}.json`);
  if (existsSync(p)) return { pubkey: loadKey(name).publicKey.toBase58(), created: false };
  const kp = Keypair.generate();
  writeFileSync(p, JSON.stringify(Array.from(kp.secretKey)));
  try {
    chmodSync(p, 0o600);
  } catch {
    /* Windows: ignored */
  }
  return { pubkey: kp.publicKey.toBase58(), created: true };
}
