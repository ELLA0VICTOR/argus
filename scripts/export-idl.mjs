// Copies the Argus IDL out of WSL (target/ is a symlink Windows can't follow)
// into app/src/idl/, and adds the TrustedAddress account that Anchor leaves out.
// Anchor only lists accounts that some instruction takes as a typed Account<>,
// and TrustedAddress is deliberately unchecked (audit F-3).
//
// Usage (Windows, from repo root): node scripts/export-idl.mjs

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const SRC = String.raw`\\wsl.localhost\Ubuntu-24.04\home\kolev\argus-target`;
const OUT = "app/src/idl";

const disc = (name) => [...createHash("sha256").update(`account:${name}`).digest().subarray(0, 8)];

// The TS type file uses camelCase names ("vault", "trustedAddress").
const nm = (pascal, camel) => (camel ? pascal[0].toLowerCase() + pascal.slice(1) : pascal);

const trustedType = (camel) => ({
  name: nm("TrustedAddress", camel),
  docs: ["A trusted destination wallet. PDA: `[\"trusted\", vault, wallet]`.", "Created only by an executed `AddTrusted` proposal."],
  type: {
    kind: "struct",
    fields: [
      { name: "vault", type: "pubkey" },
      { name: "wallet", type: "pubkey" },
      { name: camel ? "activeAt" : "active_at", type: "i64" },
      { name: "bump", type: "u8" },
    ],
  },
});

function patch(idl, camel) {
  // Self-check: our discriminator derivation must match Anchor's for a known account.
  const vault = idl.accounts.find((a) => a.name === nm("Vault", camel));
  if (JSON.stringify(vault.discriminator) !== JSON.stringify(disc("Vault"))) {
    throw new Error("discriminator derivation mismatch, refusing to patch");
  }
  const tName = nm("TrustedAddress", camel);
  if (!idl.accounts.some((a) => a.name === tName)) {
    idl.accounts.push({ name: tName, discriminator: disc("TrustedAddress") });
    idl.accounts.sort((a, b) => a.name.localeCompare(b.name));
  }
  if (!idl.types.some((t) => t.name === tName)) {
    idl.types.push(trustedType(camel));
  }
  return idl;
}

mkdirSync(OUT, { recursive: true });

const json = patch(JSON.parse(readFileSync(`${SRC}\\idl\\argus.json`, "utf8")), false);
writeFileSync(`${OUT}/argus.json`, JSON.stringify(json, null, 2) + "\n");

const tsSrc = readFileSync(`${SRC}\\types\\argus.ts`, "utf8");
const start = tsSrc.indexOf("export type Argus = ");
const header = tsSrc.slice(0, start);
const body = tsSrc.slice(start + "export type Argus = ".length).trim().replace(/;$/, "");
const ts = patch(JSON.parse(body), true);
writeFileSync(`${OUT}/argus.ts`, `${header}export type Argus = ${JSON.stringify(ts, null, 2)};\n`);

console.log(`IDL exported: ${json.instructions.length} instructions, accounts [${json.accounts.map((a) => a.name).join(", ")}], ${json.errors.length} errors, address ${json.address}`);
