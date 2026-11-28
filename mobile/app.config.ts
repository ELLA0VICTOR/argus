import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? 'Argus',
  slug: config.slug ?? 'argus-mobile',
  android: {
    ...config.android,
    blockedPermissions: [...new Set([
      ...(config.android?.blockedPermissions ?? []),
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      ...(['preview', 'production'].includes(process.env.EAS_BUILD_PROFILE ?? '') ? ['android.permission.SYSTEM_ALERT_WINDOW'] : []),
    ])],
    // EAS file variable or an ignored local file path; no service credentials in source.
    ...(process.env.GOOGLE_SERVICES_JSON ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON } : {}),
  },
});
