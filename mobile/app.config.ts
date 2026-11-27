import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? 'Argus',
  slug: config.slug ?? 'argus-mobile',
  android: {
    ...config.android,
    // EAS file variable or an ignored local file path; no service credentials in source.
    ...(process.env.GOOGLE_SERVICES_JSON ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON } : {}),
  },
});
