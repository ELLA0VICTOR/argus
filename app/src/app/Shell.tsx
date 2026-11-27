import { useState, type ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Link, NavLink, useLocation } from "react-router";
import { Wordmark } from "../components/Logo";
import { Icon, type IconName } from "../components/Icon";
import { explorerAddr, explorerTx, shortAddr } from "../lib/format";
import { useConnectModal, useSolBalance } from "./wallet";
import { useOptionalVault } from "./store";

const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: "/app", label: "Home", icon: "home", end: true },
  { to: "/app/send", label: "Send", icon: "send" },
  { to: "/app/activity", label: "Activity", icon: "activity" },
  { to: "/app/guardians", label: "Guardians", icon: "users" },
  { to: "/app/rules", label: "Settings", icon: "settings" },
];

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas lg:grid lg:grid-cols-[248px_1fr]">
      <Sidebar />
      <div className="relative flex min-w-0 flex-col">
        <MobileTop />
        <main className="flex-1 pb-28 lg:pb-16">{children}</main>
      </div>
      <TabBar />
      <Toasts />
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-screen flex-col border-r border-line bg-white lg:flex">
      <div className="flex h-[72px] items-center px-6">
        <Link to="/" aria-label="Argus home">
          <Wordmark size={24} />
        </Link>
      </div>
      <nav className="mt-4 flex flex-col gap-0.5 px-3" aria-label="App">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) => `group relative flex h-10 items-center gap-3 rounded-xl px-3 text-[14px] transition-colors ${isActive ? "bg-panel font-medium text-fg" : "text-muted hover:bg-panel/60 hover:text-fg"}`}
          >
            <Icon name={n.icon} size={17} />
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto p-4">
        <SidebarWallet />
      </div>
    </aside>
  );
}

/** Top-right wallet control: "Connect wallet", or the connected wallet with its menu. */
/** Bottom of the sidebar: "Connect wallet", or the connected wallet with its menu (opens upward). */
function SidebarWallet() {
  const { publicKey, connecting } = useWallet();
  const { open } = useConnectModal();
  const [menu, setMenu] = useState(false);
  if (!publicKey)
    return (
      <button type="button" onClick={open} className="press btn-brand flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[14px] font-medium text-white">
        <Icon name="wallet" size={16} /> {connecting ? "Connecting…" : "Connect wallet"}
      </button>
    );
  return (
    <div className="relative">
      {menu && <AccountMenu onClose={() => setMenu(false)} className="right-0 bottom-full left-0 mb-2" />}
      <button type="button" onClick={() => setMenu(!menu)} aria-expanded={menu} className="flex w-full items-center gap-3 rounded-2xl border border-line bg-canvas px-3 py-3 text-left transition-colors hover:border-line-strong">
        <WalletAvatar size={36} />
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[12.5px] font-medium">{shortAddr(publicKey.toBase58())}</span>
          <SolLine />
        </span>
        <Icon name="chevron-down" size={15} className={`text-muted transition-transform ${menu ? "rotate-180" : ""}`} />
      </button>
    </div>
  );
}

function SolLine() {
  const sol = useSolBalance();
  return <span className="num block text-[11.5px] text-muted">{sol === null ? "…" : `${sol.toLocaleString("en-US", { maximumFractionDigits: 3 })} SOL`}</span>;
}

/** Phone header: compact connect button or address chip. */
function WalletButton({ compact = false }: { compact?: boolean }) {
  const { publicKey, connecting } = useWallet();
  const { open } = useConnectModal();
  const [menu, setMenu] = useState(false);
  if (!publicKey)
    return (
      <button type="button" onClick={open} className={`press btn-brand inline-flex items-center gap-2 rounded-full font-medium text-white ${compact ? "h-9 px-3.5 text-[13px]" : "h-10 px-4.5 text-[14px]"}`}>
        <Icon name="wallet" size={compact ? 14 : 16} /> {connecting ? "Connecting…" : compact ? "Connect" : "Connect wallet"}
      </button>
    );
  return (
    <div className="relative">
      <button type="button" onClick={() => setMenu(!menu)} aria-expanded={menu} className={`flex items-center gap-2.5 rounded-full border border-line bg-white py-1 pl-1 shadow-[0_1px_2px_rgba(16,24,40,0.05)] transition-colors hover:border-line-strong ${compact ? "h-9 pr-3" : "h-10 pr-3.5"}`}>
        <WalletAvatar size={compact ? 26 : 30} />
        {compact ? <span className="font-mono text-[12px]">{shortAddr(publicKey.toBase58())}</span> : <AccountLines />}
        {!compact && <Icon name="chevron-down" size={14} className={`text-muted transition-transform ${menu ? "rotate-180" : ""}`} />}
      </button>
      {menu && <AccountMenu onClose={() => setMenu(false)} className="top-full right-0 mt-2 w-[250px]" />}
    </div>
  );
}

function WalletAvatar({ size = 36 }: { size?: number }) {
  const { wallet } = useWallet();
  return wallet ? (
    <img src={wallet.adapter.icon} alt="" style={{ width: size, height: size }} className="shrink-0 rounded-full bg-white ring-1 ring-line" />
  ) : (
    <span style={{ width: size, height: size }} className="grid shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
      <Icon name="wallet" size={16} />
    </span>
  );
}

function AccountLines() {
  const { publicKey } = useWallet();
  const sol = useSolBalance();
  return (
    <span className="flex items-baseline gap-2">
      <span className="font-mono text-[12.5px] font-medium">{publicKey ? shortAddr(publicKey.toBase58()) : ""}</span>
      <span className="num text-[12px] text-muted">{sol === null ? "…" : `${sol.toLocaleString("en-US", { maximumFractionDigits: 3 })} SOL`}</span>
    </span>
  );
}

function AccountMenu({ onClose, className = "" }: { onClose: () => void; className?: string }) {
  const { publicKey, disconnect } = useWallet();
  const sol = useSolBalance();
  const [copied, setCopied] = useState(false);
  if (!publicKey) return null;
  const addr = publicKey.toBase58();
  const item = "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] hover:bg-panel";
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />
      <div className={`enter absolute z-50 rounded-2xl border border-line bg-white p-1.5 shadow-[0_24px_60px_-24px_rgba(23,37,84,0.4)] ${className}`} role="menu">
        <button
          type="button"
          role="menuitem"
          className={item}
          onClick={() =>
            navigator.clipboard?.writeText(addr).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1300);
            })
          }
        >
          <Icon name={copied ? "check" : "copy"} size={15} className={copied ? "text-safe" : "text-muted"} /> {copied ? "Copied" : "Copy address"}
        </button>
        <a role="menuitem" className={item} href={explorerAddr(addr)} target="_blank" rel="noreferrer">
          <Icon name="arrow-up-right" size={15} className="text-muted" /> View on Solana Explorer
        </a>
        {sol !== null && sol < 0.05 && (
          <a role="menuitem" className={item} href="https://faucet.solana.com" target="_blank" rel="noreferrer">
            <Icon name="plus" size={15} className="text-muted" /> Get devnet SOL for fees
          </a>
        )}
        <div className="my-1 h-px bg-line-soft" />
        <button
          type="button"
          role="menuitem"
          className={item}
          onClick={() => {
            onClose();
            void disconnect();
          }}
        >
          <Icon name="close" size={15} className="text-muted" /> Disconnect
        </button>
      </div>
    </>
  );
}

function MobileTop() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-white/90 px-4 backdrop-blur-md lg:hidden">
      <Link to="/" className="text-fg" aria-label="Argus home">
        <Wordmark size={22} />
      </Link>
      <WalletButton compact />
    </header>
  );
}

function TabBar() {
  const { pathname } = useLocation();
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-white/90 backdrop-blur-md lg:hidden" aria-label="App">
      {NAV.map((n) => {
        const active = n.end ? pathname === n.to : pathname.startsWith(n.to);
        return (
          <NavLink key={n.to} to={n.to} end={n.end} className={`flex flex-1 flex-col items-center gap-1 pt-2.5 pb-1 text-[10.5px] transition-colors ${active ? "font-medium text-brand" : "text-faint"}`}>
            <Icon name={n.icon} size={20} />
            {n.label}
          </NavLink>
        );
      })}
    </nav>
  );
}

function Toasts() {
  const v = useOptionalVault();
  if (!v || v.txs.length === 0) return null;
  const { txs, dismissTx } = v;
  return (
    <div className="fixed inset-x-3 bottom-24 z-50 flex flex-col gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[340px]" aria-live="polite">
      {txs.map((t) => (
        <div key={t.id} className="enter flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 shadow-[0_16px_40px_-16px_rgba(23,37,84,0.3)]">
          {t.state === "pending" ? (
            <span className="size-3.5 shrink-0 animate-spin border-[1.5px] border-line-strong border-t-fg" style={{ borderRadius: "50%" }} />
          ) : (
            <Icon name={t.state === "confirmed" ? "check" : "alert"} size={16} className={t.state === "confirmed" ? "text-safe" : "text-threat"} />
          )}
          <div className="min-w-0 flex-1 text-[13.5px]">
            {t.label}
            <span className="text-muted">{t.state === "pending" ? " · confirming" : t.state === "confirmed" ? " · done" : ` · ${t.error}`}</span>
          </div>
          {t.sig && (
            <a href={explorerTx(t.sig)} target="_blank" rel="noreferrer" className="text-muted hover:text-fg" aria-label="View transaction">
              <Icon name="arrow-up-right" size={15} />
            </a>
          )}
          <button type="button" onClick={() => dismissTx(t.id)} className="text-faint hover:text-fg" aria-label="Dismiss">
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Page title block. No border, generous space. */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[880px] flex-col gap-4 px-5 pt-8 pb-2 sm:flex-row sm:items-end sm:justify-between sm:px-8 lg:pt-16">
      <div className="min-w-0">
        <h1 className="font-serif text-[36px] leading-[1.05] tracking-[-0.01em] sm:text-[44px]">{title}</h1>
        {subtitle && <div className="mt-3 max-w-[36rem] text-[15px] leading-relaxed text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  );
}

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto max-w-[880px] px-5 py-8 sm:px-8 ${className}`}>{children}</div>;
}
