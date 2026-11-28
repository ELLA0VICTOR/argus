import { Connection } from '@solana/web3.js';
import { ArgusClient } from './client.ts';
import { HOSTED_SENTINEL_URL } from '../sentinel/live';
import { createRpcFetch } from './rpcFetch';

// This variable is public client configuration. Never put a server/guardian secret here.
const endpoint = process.env.EXPO_PUBLIC_SOLANA_RPC_URL?.trim() || `${process.env.EXPO_PUBLIC_SENTINEL_LIVE_URL?.trim() || HOSTED_SENTINEL_URL}/v1/rpc/devnet`;
if (!endpoint.startsWith('https://')) throw new Error('The Solana devnet RPC must use HTTPS.');
export const connection = new Connection(endpoint, { commitment: 'confirmed', disableRetryOnRateLimit: true,
  confirmTransactionInitialTimeout: 45_000,
  fetch: createRpcFetch(!process.env.EXPO_PUBLIC_SOLANA_RPC_URL?.trim()),
});
export const programClient = new ArgusClient(connection);
