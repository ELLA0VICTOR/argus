// End-to-end smoke test of the demo against a running Sentinel (real devnet).
// Plays the thief: signs each attack with the "stolen" key, like the browser does.
// Usage: node src/smoke.ts [baseUrl]
import nacl from "tweetnacl";
import bs58 from "bs58";

const BASE = process.argv[2] ?? "http://localhost:8787";
const post = async (path: string, body: unknown = {}) => {
  const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${JSON.stringify(j)}`);
  return j;
};

const s = await post("/v1/demo/session");
console.log("session", s.session, "setup tx", s.setupTx);
const secret = bs58.decode(s.stolenKey);

// Stream events in the background.
const events: { type: string; [k: string]: unknown }[] = [];
const ctrl = new AbortController();
(async () => {
  const r = await fetch(`${BASE}/v1/demo/${s.session}/events`, { signal: ctrl.signal });
  const reader = r.body!.getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += new TextDecoder().decode(value);
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const e = JSON.parse(line.slice(6));
      events.push(e);
      const d = e.type === "log" ? e.text : e.type === "tx" ? `${e.label} ${e.sig.slice(0, 12)}…` : e.type === "risk" ? `${e.level} ${e.score}` : e.type === "call" ? `${e.who}: ${e.text}` : e.type === "attack" ? `${e.kind} ok=${e.ok} ${e.error?.name ?? ""}` : e.type === "state" ? `vault ${e.vault} thief ${e.thief} frozen ${e.frozen} pending ${e.pending}` : "";
      console.log(`  [event ${e.type}] ${d}`);
    }
  }
})().catch(() => {});

async function attack(kind: string) {
  const p = await post(`/v1/demo/${s.session}/attack`, { kind });
  const sig = nacl.sign.detached(Buffer.from(p.message, "base64"), secret);
  const r = await post(`/v1/demo/${s.session}/attack/${p.nonce}`, { signature: bs58.encode(sig) });
  console.log(`attack ${kind}:`, r.ok ? `LANDED ${r.sig}` : `REFUSED ${r.error?.name} (${r.error?.code}): ${r.error?.msg}`);
  return r;
}

const expect = (cond: boolean, what: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${what}`);
  if (!cond) process.exitCode = 1;
};

const drain = await attack("drain");
expect(!drain.ok && drain.error?.name === "OverDailyLimit", "instant drain refused with OverDailyLimit");
const trusted = await attack("trusted");
expect(!trusted.ok && trusted.error?.name === "NotTrusted", "trusted send refused with NotTrusted");
const allowance = await attack("allowance");
expect(allowance.ok, "daily allowance (100) goes through");
const req = await attack("request");
expect(req.ok, "withdrawal request of everything lands");

// Wait for Argus to react (score, call, cancel, freeze).
const deadline = Date.now() + 60_000;
while (Date.now() < deadline && !events.some((e) => e.type === "tx" && String(e.label).startsWith("Vault frozen"))) {
  await new Promise((r) => setTimeout(r, 1000));
}
const risk = events.find((e) => e.type === "risk") as { score?: number } | undefined;
expect(!!risk && (risk.score ?? 0) >= 70, `risk scored critical (${risk?.score})`);
expect(events.some((e) => e.type === "tx" && String(e.label).startsWith("Withdrawal cancelled")), "AI guardian cancelled on-chain");
expect(events.some((e) => e.type === "tx" && String(e.label).startsWith("Vault frozen")), "AI guardian froze the vault");
const after = await attack("allowance");
expect(!after.ok && after.error?.name === "Frozen", "after the freeze, even the allowance is refused (Frozen)");
const last = [...events].reverse().find((e) => e.type === "state") as { vault?: string; thief?: string } | undefined;
console.log("final balances: vault", last?.vault, "thief", last?.thief);
ctrl.abort();
process.exit(process.exitCode ?? 0);
