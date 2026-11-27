import Constants from 'expo-constants';
import { SentinelDemoClient } from './demo';

const configured = process.env.EXPO_PUBLIC_SENTINEL_DEMO_URL?.trim();
const metroHost = Constants.expoConfig?.hostUri?.split(':')[0];
// Development only: the backend normally runs alongside Metro. USB forwarding needs port 8787 too.
const local = __DEV__ && metroHost ? `http://${metroHost}:8787` : undefined;
export const sentinelDemoUrl = configured || local;
export function makeDemoClient() {
  if (!sentinelDemoUrl) throw new Error('Set EXPO_PUBLIC_SENTINEL_DEMO_URL to your phone-reachable Sentinel demo endpoint.');
  return new SentinelDemoClient(sentinelDemoUrl, fetch, __DEV__);
}
