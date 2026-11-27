from pathlib import Path
import hashlib
import json
import re

here = Path(__file__).resolve().parent
root = here.parents[2]
manifest = json.loads((here / 'source-manifest.json').read_text())
changed = [r['path'] for r in manifest if hashlib.sha256((root / r['path']).read_bytes()).hexdigest() != r['sha256']]
lines = ['Reviewed Rust files changed after probes: ' + str(changed)]
assert not changed
metadata = json.loads((here / 'deployment.json').read_text())
assert hashlib.sha256((root / 'mobile/.program-check/audits/devnet-2026-11-27/argus.so').read_bytes()).hexdigest() == metadata['sha256']
lines.append('Public dump SHA256 matches observed deployment and HANDOFF.')
for extension in ['json', 'ts']:
    assert (root / f'mobile/src/idl/argus.{extension}').read_bytes() == (root / f'app/src/idl/argus.{extension}').read_bytes()
lines.append('Both mobile IDL files exactly match upstream.')
assert (root / 'mobile/assets/hero-dawn.webp').read_bytes() == (root / 'app/public/img/hero-dawn.webp').read_bytes()
lines.append('Painting matches Argus-owned source asset exactly.')
patterns = {
    'PEM private keys': rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
    'long secret tokens': rb'sk-(?:proj-|live_)[A-Za-z0-9_-]{20,}',
    'assigned service-role tokens': rb'''(?:service_role|SUPABASE_SERVICE_ROLE_KEY)\s*[=:]\s*["'][A-Za-z0-9._-]{30,}''',
    'literal 64-byte keypair arrays': rb'\[\s*(?:\d{1,3}\s*,\s*){63}\d{1,3}\s*\]',
}
files = [p for p in (root / 'mobile/dist').rglob('*') if p.is_file()]
lines.append(f'Fresh mobile export: {len(files)} artifact files scanned.')
for name, pattern in patterns.items():
    hits = sum(bool(re.search(pattern, p.read_bytes())) for p in files)
    lines.append(f'{name}: {hits} matching files')
(here / 'verification-results.txt').write_text('\n'.join(lines) + '\n')
print('\n'.join(lines))
