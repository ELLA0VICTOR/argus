import "../lib/polyfills";
import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router";
import { Shell } from "./Shell";
import { VaultProvider } from "./store";
import { WalletProviders } from "./wallet";
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

export default function AppRoot() {
  return (
    <WalletProviders>
    <VaultProvider>
      <TitleSync />
      <Shell>
        <Routes>
          <Route index element={<Overview />} />
          <Route path="activity" element={<Activity />} />
          <Route path="send" element={<Send />} />
          <Route path="guardians" element={<Guardians />} />
          <Route path="rules" element={<Rules />} />
          <Route path="*" element={<Overview />} />
        </Routes>
      </Shell>
    </VaultProvider>
    </WalletProviders>
  );
}
