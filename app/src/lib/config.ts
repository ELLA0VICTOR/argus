/** Public, non-secret configuration. Nothing in here may ever be a key. */
export const PROGRAM_ID = "4LH7ikNGVVNaemB7eaLGUMbwSBHHqA2hKXTdrfhgD6nh";
export const CLUSTER = "devnet" as const;

/**
 * Solana RPC for the web app. By default it goes through Sentinel's relay
 * (/v1/rpc/devnet), which forwards to a private RPC so its key never reaches the
 * browser. Subscriptions (websockets) use public devnet.
 */
const SENTINEL_BASE: string = (import.meta.env.VITE_SENTINEL_URL as string | undefined) ?? "http://localhost:8787";
// "devnet" must appear in the URL: wallet adapters choose the network from it (otherwise: mainnet).
export const RPC_URL: string = (import.meta.env.VITE_RPC_URL as string | undefined) ?? `${SENTINEL_BASE}/v1/rpc/devnet`;
export const WS_URL: string = (import.meta.env.VITE_WS_URL as string | undefined) ?? "wss://api.devnet.solana.com";

/** Standalone Android devnet preview: embedded bundle, no Metro server required. */
export const APK_URL: string | null = "https://expo.dev/artifacts/eas/H-EnfZuI-_t3FbopjKywARvkT7H0KrEO8Zyo-SxYMGM.apk";
/** Set once the Solana dApp Store listing is live. */
export const DAPP_STORE_URL: string | null = null;
/** Public repo, once Victor makes it public. */
export const REPO_URL: string | null = "https://github.com/ELLA0VICTOR/argus";

export const TEST_COUNT = 148;

/** Fallbacks if Sentinel can't be reached: the demo's test token (dUSDC) and the AI guardian. */
export const TEST_MINT = "EXa24Mj3YsFxhhgohtBqYUSgy71AQrd9XtC64pZB9fhQ";
export const AI_GUARDIAN = "DDZHZxxtYEwjttMJMoipr7tXuyPy6BmCCu4ECUi8Jppm";

/** The Argus voice agent (ElevenLabs). A public agent id, not a secret. */
export const ELEVENLABS_AGENT_ID: string = (import.meta.env.VITE_ELEVENLABS_AGENT_ID as string | undefined) ?? "agent_3001m8ebdd1ee1yrp9ga4kcn2436";
