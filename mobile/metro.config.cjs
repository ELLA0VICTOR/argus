const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Anchor 1.2.2's browser entry still references fs inside NodeWallet.local().
  // Mobile uses a wallet-free provider and MWA; fail explicitly if that Node-only path is called.
  if (moduleName === 'fs' && context.originModulePath.replaceAll('\\', '/').includes('/@anchor-lang/core/')) {
    return { type: 'sourceFile', filePath: path.resolve(__dirname, 'src/program/node-files-unavailable.ts') };
  }
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
