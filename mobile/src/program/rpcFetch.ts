const PUBLIC_DEVNET_RPC = 'https://api.devnet.solana.com';
const readMethods = new Set(['getAccountInfo', 'getMultipleAccounts', 'getProgramAccounts', 'getBalance', 'getTokenAccountBalance',
  'getLatestBlockhash', 'isBlockhashValid', 'getBlockHeight', 'getSlot', 'getEpochInfo', 'getMinimumBalanceForRentExemption',
  'getFeeForMessage', 'getSignatureStatuses', 'getSignaturesForAddress', 'getTransaction', 'simulateTransaction', 'getHealth', 'getVersion', 'getGenesisHash']);

/** Keep protective actions available when the relay is down. A submitted transaction is never retried. */
export function createRpcFetch(allowPublicFallback: boolean, fetcher: typeof fetch = fetch): typeof fetch {
  let direct = false;
  return async (input, init) => {
    const request = async (target: Parameters<typeof fetch>[0]) => {
      const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), 15_000);
      try { return await fetcher(target, { ...init, signal: abort.signal }); }
      finally { clearTimeout(timer); }
    };
    if (direct) return request(PUBLIC_DEVNET_RPC);
    let safeRead = false; let submitted = false;
    try {
      const data = JSON.parse(typeof init?.body === 'string' ? init.body : 'null');
      const calls = Array.isArray(data) ? data : [data];
      safeRead = calls.length > 0 && calls.every(c => readMethods.has(c?.method));
      submitted = calls.some(c => c?.method === 'sendTransaction');
    } catch { /* Unrecognized requests cannot be retried. */ }
    try {
      const response = await request(input);
      if (allowPublicFallback && (response.status >= 500 || response.status === 429)) {
        if (safeRead || submitted) direct = true;
        if (safeRead) return request(PUBLIC_DEVNET_RPC);
      }
      return response;
    } catch (error) {
      if (allowPublicFallback && (safeRead || submitted)) direct = true;
      if (allowPublicFallback && safeRead) return request(PUBLIC_DEVNET_RPC);
      throw error;
    }
  };
}
