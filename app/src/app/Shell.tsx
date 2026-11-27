import { type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { Logo, Wordmark } from "../components/Logo";
import { Icon, type IconName } from "../components/Icon";
import { explorerTx, shortAddr } from "../lib/format";
import { useVault } from "./store";

const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: "/app", label: "Home", icon: "home", end: true },
  { to: "/app/send", label: "Send", icon: "send" },
  { to: "/app/activity", label: "Activity", icon: "activity" },
  { to: "/app/guardians", label: "Guardians", icon: "users" },
  { to: "/app/rules", label: "Settings", icon: "settings" },
];

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-ink lg:grid lg:grid-cols-[232px_1fr]">
      <Sidebar />
      <div className="flex min-w-0 flex-col">
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
    <aside className="sticky top-0 hidden h-screen flex-col border-r border-line lg:flex">
      <div className="flex h-16 items-center px-6">
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
            className={({ isActive }) => `flex h-10 items-center gap-3 rounded-xl px-3 text-[14px] transition-colors ${isActive ? "bg-panel font-medium text-fg" : "text-muted hover:text-fg"}`}
          >
            <Icon name={n.icon} size={17} />
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto p-4">
        <Account />
      </div>
    </aside>
  );
}

/** Connected wallet. Becomes the Solana wallet-connect button. */
function Account() {
  const { me, role } = useVault();
  return (
    <div className="flex items-center justify-between rounded-xl border border-line px-3 py-2.5">
      <div>
        <div className="text-[13px]">{role === "owner" ? "Owner" : "Guardian"}</div>
        <div className="num text-[12px] text-muted">{shortAddr(me)}</div>
      </div>
      <span className="text-[11px] text-faint">Devnet</span>
    </div>
  );
}

function MobileTop() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-ink/95 px-4 backdrop-blur-sm lg:hidden">
      <Link to="/" className="text-fg" aria-label="Argus home">
        <Logo size={24} />
      </Link>
    </header>
  );
}

function TabBar() {
  const { pathname } = useLocation();
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-ink/95 backdrop-blur-sm lg:hidden" aria-label="App">
      {NAV.map((n) => {
        const active = n.end ? pathname === n.to : pathname.startsWith(n.to);
        return (
          <NavLink key={n.to} to={n.to} end={n.end} className={`flex flex-1 flex-col items-center gap-1 pt-2.5 pb-1 text-[10.5px] transition-colors ${active ? "text-fg" : "text-faint"}`}>
            <Icon name={n.icon} size={20} />
            {n.label}
          </NavLink>
        );
      })}
    </nav>
  );
}

function Toasts() {
  const { txs, dismissTx } = useVault();
  if (txs.length === 0) return null;
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
    <div className="mx-auto flex max-w-[880px] flex-col gap-4 px-5 pt-8 pb-2 sm:flex-row sm:items-end sm:justify-between sm:px-8 lg:pt-14">
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] sm:text-[30px]">{title}</h1>
        {subtitle && <div className="mt-2 max-w-[36rem] text-[15px] leading-relaxed text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  );
}

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto max-w-[880px] px-5 py-8 sm:px-8 ${className}`}>{children}</div>;
}
