import { useState, type ReactNode } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { Icon } from "../../components/Icon";
import { Button } from "../../components/ui";
import { AI_GUARDIAN, TEST_MINT } from "../../lib/config";
import { sentinelInfo } from "../../lib/sentinel";
import { Container, PageHeader } from "../Shell";
import { explain } from "./LiveVault";
import { ix, labels, nextVaultId } from "./program";

/**
 * First run: create a vault on devnet. The connected wallet becomes the owner.
 * Mirrors the program's own checks (1–5 guardians, threshold, no role
 * overlaps, delay between 1 minute and 30 days) so mistakes show up here.
 */

const DELAYS: { secs: number; label: string; note: string }[] = [
  { secs: 60, label: "1 minute", note: "For trying things out" },
  { secs: 3_600, label: "1 hour", note: "" },
  { secs: 86_400, label: "24 hours", note: "Recommended" },
  { secs: 259_200, label: "3 days", note: "" },
];

const isAddr = (s: string) => {
  try {
    new PublicKey(s.trim());
    return true;
  } catch {
    return false;
  }
};

type Person = { address: string; label: string };

export function CreateVault({ onCreated }: { onCreated: (vault: string) => void }) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [name, setName] = useState("Savings");
  const [guardians, setGuardians] = useState<Person[]>([{ address: "", label: "" }]);
  const [threshold, setThreshold] = useState(1);
  const [safe, setSafe] = useState<Person>({ address: "", label: "Safe address" });
  const [limit, setLimit] = useState("100");
  const [delay, setDelay] = useState(86_400);
  const [useAi, setUseAi] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backup, setBackup] = useState<string | null>(null);

  const me = publicKey?.toBase58() ?? "";
  const gs = guardians.map((g) => ({ ...g, address: g.address.trim() }));
  const need = Math.min(threshold, gs.length);

  const problem = (() => {
    if (gs.some((g) => !g.address)) return "Add an address for every guardian, or remove the empty one.";
    if (gs.some((g) => !isAddr(g.address))) return "One of the guardian addresses isn't a Solana address.";
    if (new Set(gs.map((g) => g.address)).size !== gs.length) return "The same guardian appears twice.";
    if (gs.some((g) => g.address === me)) return "Your connected wallet is the owner, so it can't also be a guardian. Use another wallet or a backup key.";
    if (useAi && gs.some((g) => g.address === AI_GUARDIAN)) return "The AI guardian can't also be a regular guardian.";
    if (!safe.address.trim()) return "Add a safe address: where everything goes in an emergency.";
    if (!isAddr(safe.address)) return "The safe address isn't a Solana address.";
    if (safe.address.trim() === me) return "The safe address can't be your connected wallet. If that key is stolen, the safe has to be somewhere else.";
    if (!/^\d+(\.\d{1,6})?$/.test(limit.trim())) return "Enter the daily allowance as a number.";
    return null;
  })();

  const makeBackupKey = () => {
    const kp = Keypair.generate();
    const file = {
      note: "Argus backup key (Solana devnet). Keep this file safe: whoever has it can act as this guardian. Import secretKeyBase58 into Phantom or Solflare.",
      publicKey: kp.publicKey.toBase58(),
      secretKeyBase58: bs58.encode(kp.secretKey),
      secretKey: Array.from(kp.secretKey),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `argus-backup-key-${file.publicKey.slice(0, 6)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    const addr = file.publicKey;
    setBackup(addr);
    setGuardians((xs) => {
      const empty = xs.findIndex((x) => !x.address.trim());
      const entry = { address: addr, label: "Backup key" };
      return empty >= 0 ? xs.map((x, i) => (i === empty ? entry : x)) : xs.length < 5 ? [...xs, entry] : xs;
    });
    if (!safe.address.trim()) setSafe({ address: addr, label: "Backup key" });
  };

  const create = async () => {
    if (!publicKey || problem) return;
    setError(null);
    try {
      setBusy("Preparing…");
      const info = await sentinelInfo().catch(() => null);
      const mint = new PublicKey(info?.test_mint ?? TEST_MINT);
      const ai = useAi ? new PublicKey(info?.ai_guardian ?? AI_GUARDIAN) : PublicKey.default;
      const vaultId = await nextVaultId(connection, publicKey);
      const [w, f = "0"] = limit.trim().split(".");
      const dailyLimit = BigInt(w) * 1_000_000n + BigInt((f + "000000").slice(0, 6));
      const { vault, ixs } = await ix.initialize(connection, {
        creator: publicKey,
        vaultId,
        mint,
        guardians: gs.map((g) => new PublicKey(g.address)),
        threshold: need,
        ai,
        safe: new PublicKey(safe.address.trim()),
        delay,
        dailyLimit,
      });
      const tx = new Transaction().add(...ixs);
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      tx.feePayer = publicKey;
      tx.recentBlockhash = blockhash;
      const sim = await connection.simulateTransaction(tx);
      if (sim.value.err) throw Object.assign(new Error(explain(sim.value.err, sim.value.logs)), { explained: true });
      setBusy("Approve in your wallet…");
      const sig = await sendTransaction(tx, connection);
      setBusy("Creating your vault on devnet…");
      const res = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      if (res.value.err) throw new Error(explain(res.value.err));
      const v = vault.toBase58();
      labels.set(v, v, name.trim() || "Your vault");
      gs.forEach((g, i) => labels.set(v, g.address, g.label.trim() || `Guardian ${i + 1}`));
      labels.set(v, safe.address.trim(), safe.label.trim() || "Safe address");
      onCreated(v);
    } catch (e) {
      console.error("[argus] create vault failed:", (e as Error).message, String((e as { error?: Error }).error?.message ?? ""), (e as { error?: { logs?: string[] } }).error?.logs?.join(" / ") ?? "");
      setError((e as { explained?: boolean }).explained ? (e as Error).message : explain(e));
      setBusy(null);
    }
  };

  const box = "rounded-xl border border-line bg-white px-3.5 py-2.5 text-[14.5px] outline-none placeholder:text-faint focus:border-brand";
  const field = `w-full ${box}`;

  return (
    <>
      <PageHeader title="Set up your vault" subtitle="Your connected wallet becomes the owner key. Guardians can cancel, freeze and approve changes. They can never take your money." />
      <Container>
        <div className="max-w-[640px] overflow-hidden rounded-[28px] border border-line bg-white shadow-[0_24px_60px_-40px_rgba(23,37,84,0.35)]">
          <Section n={1} title="Name it" hint="Only you see this name. It's saved in this browser.">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} className={field} placeholder="Savings" />
          </Section>

          <Section n={2} title="Guardians" hint="People or keys you trust: family, a second device, a backup key. Any one of them can cancel a withdrawal or freeze the vault.">
            <div className="space-y-2.5">
              {guardians.map((g, i) => (
                <div key={i} className="flex gap-2">
                  <input value={g.label} onChange={(e) => setGuardians((xs) => xs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder={`Name, e.g. ${["Ada", "Tunde", "Phone", "Backup", "Sister"][i]}`} className={`${box} w-[34%] shrink-0`} />
                  <input value={g.address} onChange={(e) => setGuardians((xs) => xs.map((x, j) => (j === i ? { ...x, address: e.target.value } : x)))} placeholder="Wallet address" spellCheck={false} className={`${box} min-w-0 flex-1 font-mono text-[13px]`} />
                  {guardians.length > 1 && (
                    <button type="button" onClick={() => setGuardians((xs) => xs.filter((_, j) => j !== i))} className="grid size-11 shrink-0 place-items-center rounded-xl text-muted hover:bg-panel hover:text-fg" aria-label="Remove guardian">
                      <Icon name="close" size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {guardians.length < 5 && (
                <button type="button" onClick={() => setGuardians((xs) => [...xs, { address: "", label: "" }])} className="press inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13.5px] text-muted ring-1 ring-line hover:text-fg">
                  <Icon name="plus" size={14} /> Add a guardian
                </button>
              )}
              <button type="button" onClick={makeBackupKey} className="press inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13.5px] text-muted ring-1 ring-line hover:text-fg">
                <Icon name="key" size={14} /> Create a backup key
              </button>
            </div>
            {backup && <p className="mt-3 rounded-xl bg-panel px-3.5 py-2.5 text-[13px] leading-relaxed text-muted">A backup key file was downloaded and added as a guardian. Keep it somewhere safe, like another device. Devnet only.</p>}
            {guardians.length > 1 && (
              <div className="mt-4 flex items-center gap-3 text-[14px]">
                <span className="text-muted">Approvals needed to change rules</span>
                <select value={need} onChange={(e) => setThreshold(Number(e.target.value))} className="rounded-lg border border-line bg-white px-2.5 py-1.5">
                  {guardians.map((_, i) => (
                    <option key={i} value={i + 1}>
                      {i + 1} of {guardians.length}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </Section>

          <Section n={3} title="Safe address" hint="If something goes wrong, any guardian can move everything here. Use a wallet the owner key doesn't control, like a hardware wallet.">
            <div className="flex gap-2">
              <input value={safe.label} onChange={(e) => setSafe({ ...safe, label: e.target.value })} placeholder="Name" className={`${box} w-[34%] shrink-0`} />
              <input value={safe.address} onChange={(e) => setSafe({ ...safe, address: e.target.value })} placeholder="Wallet address" spellCheck={false} className={`${box} min-w-0 flex-1 font-mono text-[13px]`} />
            </div>
          </Section>

          <Section n={4} title="Spending rules" hint="Up to the allowance goes out instantly each day. Anything bigger waits, and can be cancelled while it waits.">
            <label className="flex items-center gap-3 text-[14px]">
              <span className="w-[150px] text-muted">Daily allowance</span>
              <span className="flex flex-1 items-center rounded-xl border border-line pr-3 focus-within:border-brand">
                <input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="decimal" className="num w-full bg-transparent px-3.5 py-2.5 text-[14.5px] outline-none" />
                <span className="text-muted">dUSDC</span>
              </span>
            </label>
            <div className="mt-4 text-[14px] text-muted">Wait for larger amounts</div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {DELAYS.map((d) => (
                <button key={d.secs} type="button" onClick={() => setDelay(d.secs)} className={`rounded-xl px-3 py-2.5 text-left transition-colors ${delay === d.secs ? "bg-fg text-white" : "bg-panel hover:bg-raised"}`}>
                  <div className="text-[14px] font-medium">{d.label}</div>
                  <div className={`text-[11.5px] ${delay === d.secs ? "text-white/70" : "text-faint"}`}>{d.note || " "}</div>
                </button>
              ))}
            </div>
          </Section>

          <Section n={5} title="AI guardian" hint="Argus watches every withdrawal and calls you when one looks like theft. Its key can only cancel and freeze. It can never move funds or vote.">
            <button type="button" onClick={() => setUseAi(!useAi)} className="flex w-full items-center justify-between rounded-xl bg-panel px-4 py-3 text-left" aria-pressed={useAi}>
              <span className="text-[14.5px] font-medium">Let Argus watch this vault</span>
              <span className={`relative h-6 w-10 rounded-full transition-colors ${useAi ? "bg-brand" : "bg-line-strong"}`}>
                <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${useAi ? "left-[18px]" : "left-0.5"}`} />
              </span>
            </button>
          </Section>

          <div className="border-t border-line-soft px-6 py-5 sm:px-8">
            {(error || problem) && <p className={`mb-4 text-[13.5px] ${error ? "text-threat-soft" : "text-muted"}`}>{error ?? problem}</p>}
            <Button variant="primary" size="lg" disabled={!!problem || !!busy} onClick={create} className="w-full sm:w-auto">
              {busy ?? "Create vault"}
            </Button>
            <p className="mt-3 text-[12.5px] text-faint">One signature. It costs a little devnet SOL for rent and fees.</p>
          </div>
        </div>
      </Container>
    </>
  );
}

function Section({ n, title, hint, children }: { n: number; title: string; hint: string; children: ReactNode }) {
  return (
    <section className="border-b border-line-soft px-6 py-6 last:border-0 sm:px-8">
      <div className="flex items-baseline gap-3">
        <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-panel text-[12px] font-semibold text-muted">{n}</span>
        <div>
          <h2 className="text-[16px] font-semibold">{title}</h2>
          <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{hint}</p>
        </div>
      </div>
      <div className="mt-4 sm:pl-9">{children}</div>
    </section>
  );
}
