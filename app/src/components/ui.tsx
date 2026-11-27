import { useState, type ReactNode, type ButtonHTMLAttributes, type AnchorHTMLAttributes } from "react";
import { Link } from "react-router";
import { Icon, type IconName } from "./Icon";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "quiet";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "btn-brand text-white border border-transparent",
  secondary: "bg-white text-fg border border-line-strong hover:border-faint hover:bg-panel",
  ghost: "bg-transparent text-muted border border-transparent hover:text-fg",
  danger: "bg-threat text-white border border-threat hover:bg-threat-soft font-semibold",
  quiet: "bg-panel text-fg border border-line hover:bg-raised",
};
const sizes: Record<Size, string> = {
  sm: "min-h-9 px-3.5 text-[13px] gap-2 rounded-[10px]",
  md: "min-h-11 px-5 text-[14px] gap-2.5 rounded-xl",
  lg: "min-h-13 px-7 text-[15.5px] gap-3 rounded-[14px]",
};

function cls(variant: Variant, size: Size, extra = "") {
  return `press nudge inline-flex items-center justify-center font-medium select-none whitespace-nowrap disabled:opacity-40 disabled:pointer-events-none ${variants[variant]} ${sizes[size]} ${extra}`;
}

type Common = { variant?: Variant; size?: Size; icon?: IconName; arrow?: boolean; children: ReactNode; className?: string };

export function Button({ variant = "secondary", size = "md", icon, arrow, children, className = "", ...rest }: Common & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={cls(variant, size, className)} {...rest}>
      {icon && <Icon name={icon} size={size === "sm" ? 15 : 17} />}
      <span>{children}</span>
      {arrow && <Icon name="arrow-right" size={16} className="arrow" />}
    </button>
  );
}

export function ButtonLink({ to, variant = "secondary", size = "md", icon, arrow, children, className = "", external, ...rest }: Common & { to: string; external?: boolean } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const inner = (
    <>
      {icon && <Icon name={icon} size={size === "sm" ? 15 : 17} />}
      <span>{children}</span>
      {arrow && <Icon name={external ? "arrow-up-right" : "arrow-right"} size={16} className="arrow" />}
    </>
  );
  if (external || to.startsWith("http") || to.startsWith("#")) {
    return (
      <a href={to} className={cls(variant, size, className)} {...(to.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})} {...rest}>
        {inner}
      </a>
    );
  }
  return (
    <Link to={to} className={cls(variant, size, className)}>
      {inner}
    </Link>
  );
}

/** Section label: "01 — HOW IT WORKS". Syncopate, per DESIGN.md. */
export function Kicker({ index, children, className = "" }: { index?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center gap-3 text-[12px] font-medium tracking-[0.14em] text-faint uppercase ${className}`}>
      {index && <span className="text-faint">{index}</span>}
      {index && <span className="h-px w-6 bg-line-strong" />}
      <span>{children}</span>
    </div>
  );
}

type Tone = "threat" | "wait" | "safe" | "neutral";
const tones: Record<Tone, string> = {
  threat: "text-threat-soft border-threat/20 bg-threat-bg",
  wait: "text-wait border-wait/20 bg-wait-bg",
  safe: "text-safe-soft border-safe/20 bg-safe-bg",
  neutral: "text-muted border-line bg-white",
};

export function Badge({ tone = "neutral", children, solid, className = "" }: { tone?: Tone; children: ReactNode; solid?: boolean; className?: string }) {
  const s = solid && tone === "threat" ? "bg-threat text-white border-threat" : tones[tone];
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[12px] font-medium ${s} ${className}`}>{children}</span>;
}

export function Dot({ tone = "safe", pulse = false }: { tone?: "threat" | "wait" | "safe"; pulse?: boolean }) {
  const bg = { threat: "bg-threat", wait: "bg-wait", safe: "bg-safe" }[tone];
  return <span className={`inline-block size-2 rounded-full ${bg} ${pulse ? "animate-pulse-dot" : ""}`} />;
}

/** Monospace caption, used for small labels above numbers ("VAULT BALANCE"). */
export function Label({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`font-mono text-[11px] tracking-[0.14em] text-muted uppercase ${className}`}>{children}</div>;
}

export function Panel({ children, className = "", as: As = "section" }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" | "aside" }) {
  return <As className={`rounded-[20px] border border-line bg-white ${className}`}>{children}</As>;
}

/** A thin progress bar. `tone` carries the meaning. */
export function Meter({ value, tone = "neutral", className = "" }: { value: number; tone?: Tone; className?: string }) {
  const bar = { threat: "bg-threat", wait: "bg-wait", safe: "bg-safe", neutral: "bg-brand" }[tone];
  return (
    <div className={`h-[4px] w-full overflow-hidden rounded-full bg-line ${className}`} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full ${bar}`} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, transition: "width 800ms cubic-bezier(0.16,1,0.3,1)" }} />
    </div>
  );
}

/** Address with copy-to-clipboard and a short confirmation. */
export function Address({ value, head = 4, tail = 4, className = "" }: { value: string; head?: number; tail?: number; className?: string }) {
  const [copied, setCopied] = useState(false);
  const short = value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;
  return (
    <button
      type="button"
      title={value}
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        });
      }}
      className={`group inline-flex items-center gap-1.5 font-mono text-fg hover:text-brand ${className}`}
    >
      <span>{short}</span>
      <Icon name={copied ? "check" : "copy"} size={13} className={copied ? "text-safe" : "text-faint group-hover:text-muted"} />
      <span className="sr-only">{copied ? "Copied" : "Copy address"}</span>
    </button>
  );
}
