import * as SecureStore from 'expo-secure-store';
import { SentinelClient, httpTransport } from './client';
import { createMockSentinel } from './mock';

const baseUrl = process.env.EXPO_PUBLIC_SENTINEL_URL?.trim();
export const mockSentinel = baseUrl ? null : createMockSentinel();
export const sentinel = new SentinelClient(baseUrl ?? 'mock:v1', !baseUrl,
  mockSentinel ? mockSentinel.transport : httpTransport(baseUrl!), {
    get: key => SecureStore.getItemAsync(key),
    set: (key, value) => SecureStore.setItemAsync(key, value),
    remove: key => SecureStore.deleteItemAsync(key),
  });
