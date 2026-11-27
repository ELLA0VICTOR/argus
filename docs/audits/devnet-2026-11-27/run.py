"""Probe actual public devnet bytes in LiteSVM; no keys, chain writes or workspace build outputs."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import sys

here = Path(__file__).resolve().parent
root = here.parents[2]
scratch = root / 'mobile/.program-check/audits/devnet-2026-11-27'
scratch.mkdir(parents=True, exist_ok=True)
deps = Path('/home/kolev/argus-target/debug/deps')
expected = '831417e4dcbfd59cf82753479bf22101fca1614a41953d6fb3e8992662da72f9'
actual = hashlib.sha256((scratch / 'argus.so').read_bytes()).hexdigest()
assert actual == expected, f'Bytecode mismatch: {actual}'
unit_only = '--unit-only' in sys.argv
log = [(here / 'results.txt').read_text()] if unit_only else [f'Devnet dump SHA256 matches HANDOFF: {actual}']
(scratch / 'tmp').mkdir(exist_ok=True)
(scratch / 'deploy').mkdir(exist_ok=True)
shutil.copyfile(scratch / 'argus.so', scratch / 'deploy/argus.so')
env = dict(os.environ, TMPDIR=str(scratch / 'tmp'), CARGO_TARGET_TMPDIR=str(scratch / 'tmp'), CARGO_MANIFEST_DIR=str(root / 'programs/argus'), CARGO_PKG_NAME='argus', CARGO_PKG_VERSION='0.1.0', CARGO_PKG_DESCRIPTION='Created with Anchor')
rustc = '/home/kolev/.cargo/bin/rustc'
externs = []
for name in ['anchor_lang', 'anchor_spl', 'litesvm', 'solana_keypair', 'solana_signer', 'solana_account', 'solana_transaction', 'solana_message']:
    library = max(deps.glob('lib' + name + '-*.rlib'), key=lambda p: p.stat().st_mtime)
    externs.extend(['--extern', name + '=' + str(library)])

def run(args):
    result = subprocess.run(list(map(str, args)), env=env, cwd=scratch, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    log.append('$ ' + ' '.join(map(str, args)) + '\n' + result.stdout)
    (here / 'results.txt').write_text('\n'.join(log))
    print(result.stdout[-3500:], flush=True)
    assert result.returncode == 0, 'See results.txt for failure'

manifest = []
for directory in ['programs/argus/src', 'programs/argus/tests']:
    for p in sorted((root / directory).rglob('*.rs')):
        manifest.append({'path': p.relative_to(root).as_posix(), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()})
(here / 'source-manifest.json').write_text(json.dumps(manifest, indent=2))
base = [rustc, '--edition=2021', '-A', 'warnings', '-L', 'dependency=' + str(deps), *externs]
if not unit_only:
    run([*base, '--crate-name=argus', '--crate-type=lib', root / 'programs/argus/src/lib.rs', '-o', scratch / 'libargus.rlib'])
    run([*base, '--test', '-C', 'strip=symbols', here / 'probe.rs', '--extern', 'argus=' + str(scratch / 'libargus.rlib'), '-o', scratch / 'probe-bin'])
    run([scratch / 'probe-bin', '--test-threads=1'])
run([*base, '--test', '-C', 'strip=symbols', '--crate-name=argus', root / 'programs/argus/src/lib.rs', '-o', scratch / 'unit-bin'])
run([scratch / 'unit-bin', '--test-threads=1', '--skip', '__anchor_private'])
