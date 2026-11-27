/** Public, non-secret configuration. Nothing in here may ever be a key. */
export const PROGRAM_ID = "4LH7ikNGVVNaemB7eaLGUMbwSBHHqA2hKXTdrfhgD6nh";
export const CLUSTER = "devnet" as const;

/** Set once the EAS build is published. `null` renders an honest "building" state. */
export const APK_URL: string | null = null;
/** Set once the Solana dApp Store listing is live. */
export const DAPP_STORE_URL: string | null = null;
/** Public repo, once Victor makes it public. */
export const REPO_URL: string | null = "https://github.com/ELLA0VICTOR/argus";

export const TEST_COUNT = 148;
