"""Read cached build artifacts; write results/probe executable only in this directory."""
from pathlib import Path
import hashlib
import os
import subprocess
import sys

here = Path(__file__).resolve().parent
deps = Path('/home/kolev/argus-target/debug/deps')
output = here / ('restored-results.txt' if '--restored' in sys.argv else 'results.txt')
log = []
failed = False
def run(args, **kwargs):
    global failed
    result = subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, **kwargs)
    log.append('$ ' + ' '.join(map(str, args)) + '\n' + result.stdout)
    output.write_text('\n'.join(log))
    print(result.stdout[-1800:], flush=True)
    failed = failed or result.returncode != 0
    return result.returncode == 0

sbf = deps.parent.parent / 'deploy/argus.so'
log.append('Cached SBF SHA256: ' + hashlib.sha256(sbf.read_bytes()).hexdigest())
for stem in ([] if '--probe-only' in sys.argv else ['argus', 'initialize_vault', 'deposit', 'withdraw_instant', 'withdraw_trusted', 'withdrawals', 'protective', 'governance', 'rollback', 'fuzz']):
    if stem == 'fuzz' and '--skip-fuzz' in sys.argv: continue
    files = [p for p in deps.glob(stem + '-*') if p.is_file() and '.' not in p.name and os.access(p, os.X_OK)]
    if not files:
        log.append(stem + ': no cached executable available')
        continue
    binary = max(files, key=lambda p: p.stat().st_mtime)
    log.append('Binary SHA256: ' + hashlib.sha256(binary.read_bytes()).hexdigest())
    run([str(binary), '--test-threads=1', '--skip', '__anchor_private'])

if '--suites-only' in sys.argv:
    output.write_text('\n'.join(log))
    sys.exit(1 if failed else 0)

rustc = '/home/kolev/.cargo/bin/rustc'
externs = []
for name in ['argus', 'anchor_lang', 'anchor_spl', 'litesvm', 'solana_keypair', 'solana_signer', 'solana_account', 'solana_transaction', 'solana_message']:
    candidates = list(deps.glob('lib' + name + '-*.rlib'))
    if name == 'argus': candidates = [deps / 'libargus.rlib']
    if name == 'argus': continue
    externs.extend(['--extern', name + '=' + str(max(candidates, key=lambda p: p.stat().st_mtime))])
env = dict(os.environ, CARGO_TARGET_TMPDIR='/home/kolev/argus-target/tmp', CARGO_MANIFEST_DIR=str((here / '../../../programs/argus').resolve()), CARGO_PKG_NAME='argus')
library = here / 'libargus.rlib'
compiled = run([rustc, '--edition=2021', '--crate-name=argus', '--crate-type=lib', str(here / '../../../programs/argus/src/lib.rs'), '-L', 'dependency=' + str(deps), '-o', str(library), *externs], env=env)
args = [rustc, '--edition=2021', '--test', '-C', 'strip=symbols', str(here / 'probe.rs'), '-L', 'dependency=' + str(deps), '-o', str(here / 'probe-bin'), '--extern', 'argus=' + str(library), *externs]
if compiled and run(args, env=env):
    run([str(here / 'probe-bin'), '--test-threads=1'])
output.write_text('\n'.join(log))
sys.exit(1 if failed else 0)
