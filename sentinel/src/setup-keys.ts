// Generates Sentinel's keypairs if missing. Prints public keys only.
import { ensureKey, type KeyName } from "./keys.ts";

const names: KeyName[] = ["funder", "ai-guardian", "demo-guardian", "demo-safe"];
for (const n of names) {
  const { pubkey, created } = ensureKey(n);
  console.log(`${n.padEnd(14)} ${pubkey}${created ? "  (new)" : ""}`);
}
