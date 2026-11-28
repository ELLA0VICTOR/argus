import { HOSTED_SENTINEL_URL, LiveSentinel } from './live';

// Public endpoint only. The draft SIWS/contact API remains a separate, unimplemented service.
export const liveSentinel = new LiveSentinel(process.env.EXPO_PUBLIC_SENTINEL_LIVE_URL?.trim() || HOSTED_SENTINEL_URL);
