import { Connection } from '@solana/web3.js';
import { ArgusClient } from './client.ts';

// This variable is public client configuration. Never put a server/guardian secret here.
const endpoint = process.env.EXPO_PUBLIC_SOLANA_RPC_URL?.trim() || 'https://api.devnet.solana.com';
if (!endpoint.startsWith('https://')) throw new Error('The Solana devnet RPC must use HTTPS.');
export const connection = new Connection(endpoint, { commitment: 'confirmed', disableRetryOnRateLimit: true,
  confirmTransactionInitialTimeout: 45_000 });
export const programClient = new ArgusClient(connection);
