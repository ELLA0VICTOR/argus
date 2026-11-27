import { useRef, type InputHTMLAttributes } from "react";

/**
 * "12500.5" → "12,500.5" while typing. Keeps one decimal point, at most
 * `decimals` places, no leading zeros, and grouping commas in the whole part.
 */
export function formatTyped(raw: string, decimals: number): string {
  let s = raw.replace(/[^\d.]/g, "");
  const dot = s.indexOf(".");
  if (dot >= 0) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, "");
  const [whole = "", frac] = s.split(".");
  const int = whole.replace(/^0+(?=\d)/, "");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac !== undefined ? `${grouped || "0"}.${frac.slice(0, decimals)}` : grouped;
}

/** A formatted amount ("12,480.5") without trailing zeros, for prefilling the field. */
export function amountForInput(formatted: string): string {
  return formatted.includes(".") ? formatted.replace(/\.?0+$/, "") : formatted;
}

/** "12,500.50" → bigint base units, or null if it isn't a valid amount. */
export function parseAmountInput(s: string, decimals: number): bigint | null {
  const t = s.replace(/,/g, "").trim();
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return null;
  const [w, f = ""] = t.split(".");
  if (f.length > decimals) return null;
  return BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
}

/** Amount field that adds thousands separators as you type and keeps the caret in place. */
export function AmountInput({ value, onValue, decimals, className = "", ...rest }: { value: string; onValue: (v: string) => void; decimals: number } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <input
      {...rest}
      ref={ref}
      inputMode="decimal"
      autoComplete="off"
      value={value}
      onChange={(e) => {
        const el = e.target;
        const caret = el.selectionStart ?? el.value.length;
        // Count the digits/point before the caret, then put the caret after the same count.
        const kept = el.value.slice(0, caret).replace(/[^\d.]/g, "").length;
        const next = formatTyped(el.value, decimals);
        onValue(next);
        requestAnimationFrame(() => {
          const input = ref.current;
          if (!input) return;
          let pos = 0;
          for (let i = 0, n = 0; i < next.length && n < kept; i++) {
            if (/[\d.]/.test(next[i])) n++;
            pos = i + 1;
          }
          input.setSelectionRange(pos, pos);
        });
      }}
      className={className}
    />
  );
}
