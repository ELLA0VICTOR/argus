import { Connection } from '@solana/web3.js';
import { ArgusClient } from './client.ts';

// This variable is public client configuration. Never put a server/guardian secret here.
const endpoint = process.env.EXPO_PUBLIC_SOLANA_RPC_URL?.trim() || 'https://api.devnet.solana.com';
if (!endpoint.startsWith('https://')) throw new Error('The Solana devnet RPC must use HTTPS.');
export const connection = new Connection(endpoint, { commitment: 'confirmed', disableRetryOnRateLimit: true,
  confirmTransactionInitialTimeout: 45_000, fetch: async (input, init) => {
    const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), 15_000);
    try { return await fetch(input, { ...init, signal: abort.signal }); }
    finally { clearTimeout(timer); }
  } });
export const programClient = new ArgusClient(connection);
