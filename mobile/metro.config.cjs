const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // bigint-buffer's Node native addon has GHSA-3gc7-fjrx-p6mg and no upstream fix.
  // Android uses the package's pure-JS browser implementation, never the Node addon.
  if (platform === 'android' && moduleName === 'bigint-buffer') {
    return { type: 'sourceFile', filePath: path.resolve(__dirname, 'node_modules/bigint-buffer/dist/browser.js') };
  }
  // Anchor 1.2.2's browser entry still references fs inside NodeWallet.local().
  // Mobile uses a wallet-free provider and MWA; fail explicitly if that Node-only path is called.
  if (moduleName === 'fs' && context.originModulePath.replaceAll('\\', '/').includes('/@anchor-lang/core/')) {
    return { type: 'sourceFile', filePath: path.resolve(__dirname, 'src/program/node-files-unavailable.ts') };
  }
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
