import { HOSTED_SENTINEL_DEMO_URL, SentinelDemoClient } from './demo';

const configured = process.env.EXPO_PUBLIC_SENTINEL_DEMO_URL?.trim();
// Public demo endpoint only. The full authenticated alert API is configured separately.
export const sentinelDemoUrl = configured || HOSTED_SENTINEL_DEMO_URL;
export function makeDemoClient() {
  if (!sentinelDemoUrl) throw new Error('Set EXPO_PUBLIC_SENTINEL_DEMO_URL to your phone-reachable Sentinel demo endpoint.');
  return new SentinelDemoClient(sentinelDemoUrl, fetch, __DEV__);
}
