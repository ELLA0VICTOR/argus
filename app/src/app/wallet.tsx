import "../lib/polyfills";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider, useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Icon } from "../components/Icon";
import { Logo } from "../components/Logo";
import { RPC_URL } from "../lib/config";

/**
 * Wallet connection for the app. Any Wallet Standard wallet (Phantom,
 * Solflare, Backpack, ...) is detected automatically. The connected wallet is
 * the vault's owner key, or a guardian's key.
 */

type ModalCtx = { open: () => void; close: () => void };
const ConnectModalCtx = createContext<ModalCtx | null>(null);

export function useConnectModal(): ModalCtx {
  const c = useContext(ConnectModalCtx);
  if (!c) throw new Error("useConnectModal outside WalletProviders");
  return c;
}

export function WalletProviders({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  const modal = useMemo<ModalCtx>(() => ({ open: () => setShown(true), close: () => setShown(false) }), []);
  return (
    <ConnectionProvider endpoint={RPC_URL} config={{ commitment: "confirmed" }}>
      {/* An empty list: Wallet Standard wallets register themselves. */}
      <WalletProvider wallets={[]} autoConnect>
        <ConnectModalCtx.Provider value={modal}>
          {children}
          {shown && <ConnectModal onClose={modal.close} />}
        </ConnectModalCtx.Provider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

/** Devnet SOL balance of the connected wallet, refreshed every 15 seconds. */
export function useSolBalance(): number | null {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [sol, setSol] = useState<number | null>(null);
  useEffect(() => {
    if (!publicKey) return setSol(null);
    let live = true;
    const read = () =>
      connection
        .getBalance(publicKey)
        .then((l) => live && setSol(l / LAMPORTS_PER_SOL))
        .catch(() => {});
    read();
    const id = setInterval(read, 15_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [connection, publicKey]);
  return sol;
}

const INSTALL: { name: string; url: string }[] = [
  { name: "Phantom", url: "https://phantom.com/download" },
  { name: "Solflare", url: "https://solflare.com/download" },
  { name: "Backpack", url: "https://backpack.app/download" },
];

function ConnectModal({ onClose }: { onClose: () => void }) {
  const { wallets, select, wallet, connect, connected, connecting } = useWallet();
  const [picked, setPicked] = useState<WalletName | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ready = wallets.filter((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable);
  const isMobile = typeof navigator !== "undefined" && /Android|iPhone|iPad/i.test(navigator.userAgent);
  const here = typeof location !== "undefined" ? location.href : "";

  // Close once connected.
  useEffect(() => {
    if (connected) onClose();
  }, [connected, onClose]);

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // After select(), connect to that wallet.
  useEffect(() => {
    if (!picked || wallet?.adapter.name !== picked || connected || connecting) return;
    connect().catch((e: Error) => {
      setPicked(null);
      setError(/reject|denied|cancel/i.test(e.message) ? "You cancelled the request in your wallet." : "Couldn't connect. Open your wallet and try again.");
    });
  }, [picked, wallet, connected, connecting, connect]);

  const choose = useCallback(
    (name: WalletName) => {
      setError(null);
      setPicked(name);
      select(name);
    },
    [select],
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-[#0b1020]/35 p-3 backdrop-blur-sm sm:items-center" onClick={onClose} role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="connect-title" onClick={(e) => e.stopPropagation()} className="enter w-full max-w-[420px] rounded-[28px] bg-white p-6 shadow-[0_40px_80px_-30px_rgba(15,23,42,0.5)] sm:p-7">
        <div className="flex items-start justify-between">
          <span className="grid size-11 place-items-center rounded-2xl bg-panel text-fg ring-1 ring-line">
            <Logo size={22} />
          </span>
          <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-full text-muted hover:bg-panel hover:text-fg" aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>
        <h2 id="connect-title" className="mt-5 font-serif text-[30px] leading-tight">
          Connect a wallet
        </h2>
        <p className="mt-2 text-[14.5px] leading-relaxed text-muted">The wallet you connect is your vault's owner key. Argus never sees your keys or seed phrase.</p>

        {ready.length > 0 ? (
          <ul className="mt-6 space-y-2">
            {ready.map((w) => {
              const busy = picked === w.adapter.name && (connecting || !error);
              return (
                <li key={w.adapter.name}>
                  <button
                    type="button"
                    onClick={() => choose(w.adapter.name)}
                    disabled={!!picked && !error}
                    className="press flex w-full items-center gap-3.5 rounded-2xl border border-line bg-white px-4 py-3.5 text-left transition-colors hover:border-line-strong hover:bg-canvas disabled:opacity-60"
                  >
                    <img src={w.adapter.icon} alt="" className="size-8 rounded-[9px]" />
                    <span className="flex-1 text-[15px] font-medium">{w.adapter.name}</span>
                    {busy ? (
                      <span className="text-[12.5px] text-muted">Approve in your wallet…</span>
                    ) : (
                      <span className="rounded-full bg-safe-bg px-2 py-0.5 text-[11.5px] font-medium text-safe-soft">Detected</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : isMobile ? (
          <div className="mt-6 space-y-2">
            <p className="text-[14px] text-muted">Open Argus inside your wallet app's browser:</p>
            <a className="press flex items-center justify-between rounded-2xl border border-line px-4 py-3.5 text-[15px] font-medium hover:bg-canvas" href={`https://phantom.app/ul/browse/${encodeURIComponent(here)}?ref=${encodeURIComponent(location.origin)}`}>
              Open in Phantom <Icon name="arrow-up-right" size={15} className="text-muted" />
            </a>
            <a className="press flex items-center justify-between rounded-2xl border border-line px-4 py-3.5 text-[15px] font-medium hover:bg-canvas" href={`https://solflare.com/ul/v1/browse/${encodeURIComponent(here)}?ref=${encodeURIComponent(location.origin)}`}>
              Open in Solflare <Icon name="arrow-up-right" size={15} className="text-muted" />
            </a>
          </div>
        ) : (
          <div className="mt-6 rounded-2xl bg-panel p-4">
            <div className="text-[14.5px] font-medium">No Solana wallet found in this browser</div>
            <p className="mt-1 text-[13.5px] text-muted">Install one, then come back to this page.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {INSTALL.map((w) => (
                <a key={w.name} href={w.url} target="_blank" rel="noreferrer" className="press inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-3.5 text-[13.5px] ring-1 ring-line hover:ring-line-strong">
                  {w.name} <Icon name="arrow-up-right" size={13} className="text-muted" />
                </a>
              ))}
            </div>
          </div>
        )}

        {error && <p className="mt-4 rounded-xl bg-threat-bg px-3.5 py-2.5 text-[13.5px] text-threat-soft">{error}</p>}

        <p className="mt-6 text-[12.5px] leading-relaxed text-faint">Argus runs on Solana devnet. Set your wallet's network to devnet to see test funds.</p>
      </div>
    </div>
  );
}
