import { useMemo } from "react";
import qrcode from "qrcode-generator";

/** A QR code as crisp SVG. Plain square modules, so every phone camera reads it. */
export function QrCode({ value, size = 168, className = "" }: { value: string; size?: number; className?: string }) {
  const { n, path } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c},${r}h1v1h-1z`;
    return { n, path: d };
  }, [value]);
  return (
    <svg viewBox={`-2 -2 ${n + 4} ${n + 4}`} width={size} height={size} className={className} role="img" aria-label="QR code">
      <rect x="-2" y="-2" width={n + 4} height={n + 4} rx="2" fill="#fff" />
      <path d={path} fill="#16191f" shapeRendering="crispEdges" />
    </svg>
  );
}
