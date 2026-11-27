/** 1.5px line icons on a 24px grid, square caps, matching the hairline system. */
export type IconName =
  | "arrow-right" | "arrow-up-right" | "arrow-down" | "shield" | "eye" | "clock" | "phone"
  | "lock" | "users" | "send" | "download" | "android" | "globe" | "check" | "x" | "snow"
  | "plus" | "menu" | "close" | "copy" | "home" | "activity" | "settings" | "key" | "bolt"
  | "store" | "play" | "chevron-down" | "chevron-right" | "vault" | "alert" | "wallet" | "log";

const P: Record<IconName, string> = {
  "arrow-right": "M4 12h15M13 6l6 6-6 6",
  "arrow-up-right": "M7 17 17 7M8 7h9v9",
  "arrow-down": "M12 4v15M6 13l6 6 6-6",
  shield: "M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-14v5l3 2",
  phone: "M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2Z",
  lock: "M6 10h12v11H6zM8.5 10V7a3.5 3.5 0 0 1 7 0v3",
  users: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 10v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6",
  send: "M3 11 21 3l-8 18-2-8-8-2Z",
  download: "M12 3v12M6 10l6 6 6-6M4 21h16",
  android: "M7 9h10v8H7zM9 17v3M15 17v3M5 10v5M19 10v5M9 6 7.5 4M15 6l1.5-2M9 9a3 3 0 0 1 6 0",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.5 2.5 3.5 6 3.5 9S14.5 18.5 12 21c-2.5-2.5-3.5-6-3.5-9S9.5 5.5 12 3Z",
  check: "m4.5 12.5 5 5L20 7",
  x: "M6 6l12 12M18 6 6 18",
  snow: "M12 2v20M3.3 7l17.4 10M20.7 7 3.3 17M9 4l3 2 3-2M9 20l3-2 3 2",
  plus: "M12 5v14M5 12h14",
  menu: "M3 7h18M3 12h18M3 17h18",
  close: "M6 6l12 12M18 6 6 18",
  copy: "M8 8h12v12H8zM4 16V4h12",
  home: "M3 11 12 4l9 7v9H3z",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  settings: "M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6",
  key: "M15 8a4 4 0 1 1-7.5 2L3 14.5V18h3.5v-2h2v-2l1.5-1.5A4 4 0 0 1 15 8Z",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7l1-8Z",
  store: "M4 9h16l-1-5H5L4 9Zm0 0v11h16V9M9 20v-6h6v6",
  play: "M8 5.5v13l10.5-6.5L8 5.5Z",
  "chevron-down": "m6 9 6 6 6-6",
  "chevron-right": "m9 6 6 6-6 6",
  vault: "M3 4h18v16H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM12 9V7M17 12h2",
  alert: "M12 3 2 20h20L12 3Zm0 6v5m0 3v.01",
  wallet: "M3 6h16v14H3zM3 6l13-3v3M15 13h2",
  log: "M4 5h2M4 12h2M4 19h2M9 5h11M9 12h11M9 19h11",
};

export function Icon({ name, size = 18, className = "", strokeWidth = 1.5 }: { name: IconName; size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      <path d={P[name]} />
    </svg>
  );
}
