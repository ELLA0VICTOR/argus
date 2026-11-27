"""Pin reviewed sources and scan only built client artifacts, never credential files."""
from pathlib import Path
import hashlib
import json
import re

here = Path(__file__).resolve().parent
root = here.parents[2]
initial = json.loads((here.parent / 'codex-r1-manifest.json').read_text(encoding='utf-8-sig'))
changed = [r['path'] for r in initial if hashlib.sha256((root / r['path']).read_bytes()).hexdigest() != r['sha256']]
records = [{'path': r['path'], 'sha256': hashlib.sha256((root / r['path']).read_bytes()).hexdigest()} for r in initial]
for path in ['programs/argus/tests/fuzz.rs', 'app/src/idl/argus.ts']:
    if not any(r['path'] == path for r in records):
        records.append({'path': path, 'sha256': hashlib.sha256((root / path).read_bytes()).hexdigest()})
(here.parent / 'codex-r1-manifest-final.json').write_text(json.dumps(records, indent=2) + '\n')
patterns = {
    'PEM private key': rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
    'long secret token': rb'sk-(?:proj-|live_)[A-Za-z0-9_-]{20,}',
    'assigned service role': rb'''(?:service_role|SUPABASE_SERVICE_ROLE_KEY)\s*[=:]\s*["'][A-Za-z0-9._-]{30,}''',
    'literal 64-byte keypair array': rb'\[\s*(?:\d{1,3}\s*,\s*){63}\d{1,3}\s*\]',
}
lines = ['Source files changed from initial manifest: ' + str(changed)]
for directory in ['mobile/dist', 'mobile/.program-check', 'app/dist']:
    files = [p for p in (root / directory).rglob('*') if p.is_file()]
    lines.append(f'{directory}: {len(files)} artifacts')
    for name, pattern in patterns.items():
        count = sum(bool(re.search(pattern, p.read_bytes())) for p in files)
        lines.append(f'  {name}: {count} matching files')
(here / 'verification-results.txt').write_text('\n'.join(lines) + '\n')
print('\n'.join(lines))
