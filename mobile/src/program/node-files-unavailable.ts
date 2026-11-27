export function readFileSync(): never {
  throw new Error('Local keypair files are unavailable on Android. Sign transactions through MWA.');
}
