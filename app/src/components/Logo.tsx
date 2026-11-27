/**
 * The Argus mark: a triangle "A" with an almond eye. Redrawn for the light
 * direction with rounded strokes and a single colour, so it sits cleanly in white
 * on the sky and in ink on white. `alert` turns the pupil red and dilates it.
 * That's the only time the mark carries colour.
 */
export function Logo({
  size = 28,
  alert = false,
  watching = false,
  className = "",
}: {
  size?: number;
  alert?: boolean;
  watching?: boolean;
  className?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true" className={className}>
      <path d="M20 4.5 L35.5 34.5 H4.5 Z" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M11 24.5 Q20 16.5 29 24.5 Q20 32.5 11 24.5 Z" stroke="currentColor" strokeWidth="2.1" strokeLinejoin="round" />
      <g className={watching ? "argus-look" : ""}>
        <circle
          cx="20"
          cy="24.5"
          r="3"
          fill={alert ? "#dc2626" : "currentColor"}
          style={{
            transformOrigin: "20px 24.5px",
            transform: alert ? "scale(1.35)" : "scale(1)",
            transition: "transform 600ms cubic-bezier(0.16, 1, 0.3, 1), fill 300ms",
          }}
        />
      </g>
      <style>{`
        @keyframes argus-look {
          0%, 30%, 100% { transform: translateX(0); }
          40%, 55% { transform: translateX(-2.4px); }
          65%, 80% { transform: translateX(2.4px); }
        }
        .argus-look { animation: argus-look 9s cubic-bezier(0.2,0.7,0.2,1) infinite; }
        @media (prefers-reduced-motion: reduce) { .argus-look { animation: none; } }
      `}</style>
    </svg>
  );
}

/** Logo + name. Inherits colour (white on the sky, ink on white). */
export function Wordmark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Logo size={size} watching />
      <span className="font-sans font-semibold tracking-[-0.02em]" style={{ fontSize: size * 0.86 }}>
        Argus
      </span>
    </span>
  );
}
