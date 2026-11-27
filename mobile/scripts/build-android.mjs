import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const profile = process.argv[2] ?? 'development';
const flags = process.argv.slice(3);
if (!['development', 'preview', 'production'].includes(profile) || flags.some(arg => !['--inspect', '--no-wait', '--non-interactive'].includes(arg))) {
  throw new Error('Use: node scripts/build-android.mjs development|preview|production [--inspect | --no-wait --non-interactive]');
}
const inspect = process.argv.includes('--inspect');
const mobileRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const args = inspect
  ? ['build:inspect', '--platform', 'android', '--profile', profile, '--stage', 'archive', '--output', '.program-check/eas-mobile-archive']
  : ['build', '--platform', 'android', '--profile', profile, ...flags];
// This app has no source dependencies outside mobile/. Scope uploads here so EAS
// reads this folder's ignore rules and excludes monorepo keys and scratch builds.
// Windows invokes npx.cmd through cmd; every argument here is fixed or validated above.
const command = process.platform === 'win32' ? 'cmd.exe' : 'npx';
const commandArgs = process.platform === 'win32'
  ? ['/d', '/s', '/c', ['npx', '--yes', 'eas-cli@latest', ...args].join(' ')]
  : ['--yes', 'eas-cli@latest', ...args];
const child = spawn(command, commandArgs, {
  cwd: mobileRoot, stdio: 'inherit',
  env: { ...process.env, EAS_NO_VCS: '1', EAS_PROJECT_ROOT: mobileRoot },
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
