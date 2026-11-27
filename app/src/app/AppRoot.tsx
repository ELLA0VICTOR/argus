import "../lib/polyfills";
import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { Route, Routes, useLocation } from "react-router";
import { Shell } from "./Shell";
import { VaultProvider } from "./store";
import { WalletProviders } from "./wallet";
import { LiveVaultProvider, VaultLoading } from "./live/LiveVault";
import { CreateVault } from "./live/CreateVault";
import { findVaults, type Found } from "./live/program";
import Overview from "./pages/Overview";
import Activity from "./pages/Activity";
import Send from "./pages/Send";
import Guardians from "./pages/Guardians";
import Rules from "./pages/Rules";

const TITLES: Record<string, string> = {
  "/app": "Overview",
  "/app/activity": "Activity",
  "/app/send": "Send",
  "/app/guardians": "Guardians",
  "/app/rules": "Rules",
};

function TitleSync() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = `${TITLES[pathname] ?? "Vault"} · Argus`;
  }, [pathname]);
  return null;
}

/** Picks the vault source: the preview (no wallet), or your vault live from devnet. */
function AppBody() {
  const { connection } = useConnection();
  const { publicKey, wallet, connecting } = useWallet();
  const key = publicKey?.toBase58() ?? null;
  const [found, setFound] = useState<{ key: string; list: Found[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keyed on the address string: the adapter may hand out a new PublicKey object each render.
  const lookUp = useCallback(() => {
    if (!key) return;
    setError(null);
    findVaults(connection, new PublicKey(key))
      .then((list) => setFound({ key, list }))
      .catch(() => setError("Couldn't reach devnet to look for your vault. Retrying…"));
  }, [connection, key]);

  useEffect(() => {
    setFound(null);
    lookUp();
  }, [lookUp]);
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(lookUp, 4000);
    return () => clearTimeout(t);
  }, [error, lookUp]);

  const routes = (
    <Routes>
      <Route index element={<Overview />} />
      <Route path="activity" element={<Activity />} />
      <Route path="send" element={<Send />} />
      <Route path="guardians" element={<Guardians />} />
      <Route path="rules" element={<Rules />} />
      <Route path="*" element={<Overview />} />
    </Routes>
  );

  // Reconnecting a remembered wallet: wait rather than flash the preview.
  if (!key && wallet && connecting) return <Shell><VaultLoading message="Connecting your wallet…" /></Shell>;
  if (!key)
    return (
      <VaultProvider>
        <Shell>{routes}</Shell>
      </VaultProvider>
    );
  if (!found || found.key !== key) return <Shell><VaultLoading message={error ?? "Looking for your vault on devnet…"} /></Shell>;
  if (found.list.length === 0) return <Shell><CreateVault onCreated={(v) => setFound({ key, list: [{ address: v, role: "owner" }] })} /></Shell>;
  const vault = found.list[0];
  return (
    <LiveVaultProvider key={vault.address} address={vault.address} onGone={lookUp} frame={(n) => <Shell>{n}</Shell>}>
      <Shell>{routes}</Shell>
    </LiveVaultProvider>
  );
}

export default function AppRoot() {
  return (
    <WalletProviders>
      <TitleSync />
      <AppBody />
    </WalletProviders>
  );
}
