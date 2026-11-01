"""Export tracked baseline plus this repair; no untracked historical tests."""
from pathlib import Path
import hashlib, io, json, subprocess, tempfile, zipfile

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
BASE = 'cba836746128b9f92cf81ccff887922b5320b25a'
def git(*args): return subprocess.check_output(['git', '-C', str(ROOT), *args])
def digest(b): return hashlib.sha256(b).hexdigest()
paths = git('diff', '--name-only', '-z', BASE, '--', 'src', 'tests', 'docs', 'CHANGELOG.md', 'DEV_PROGRESS.md').decode().strip('\0').split('\0')
assert all(p.startswith(('src/', 'tests/', 'docs/')) or p in ('CHANGELOG.md', 'DEV_PROGRESS.md') for p in paths)
names = git('ls-tree', '--name-only', BASE).decode().splitlines()
names = [n for n in names if n not in ('review', '_reference')]
scratch = Path(tempfile.mkdtemp(prefix='recolor-r1-', dir=r'D:\software\yx-work\runs'))
with zipfile.ZipFile(io.BytesIO(git('archive', '--format=zip', BASE, '--', *names))) as archive:
    archive.extractall(scratch)
for name in paths:
    (scratch / name).write_bytes((ROOT / name).read_bytes())
files = []
for item in json.loads((ROOT / 'review/recolor-early-print-20261101/SOURCE.json').read_text(encoding='utf-8-sig'))['files']:
    name = item['path']; raw = (ROOT / name).read_bytes()
    assert raw.replace(b'\r\n', b'\n') == (scratch / name).read_bytes().replace(b'\r\n', b'\n')
    previous = git('show', BASE + ':' + name)
    clean = previous if previous == raw else raw.replace(b'\r\n', b'\n')
    files.append({'path': name, 'sha256': digest(clean), 'lfNormalizedSha256': digest(raw.replace(b'\r\n', b'\n')), 'worktreeSha256': digest(raw)})
binding = {'version': '0.6.30-R1', 'base': BASE, 'files': files, 'hashMeaning': 'sha256 uses Git bytes, retaining unchanged mixed line endings; worktreeSha256 uses actual source bytes'}
(OUT / 'SOURCE.json').write_text(json.dumps(binding, ensure_ascii=False, indent=2), encoding='utf-8')
record = {'base': BASE, 'root': str(scratch), 'overlayPaths': paths, 'excluded': ['all historical review directories', '_reference'], 'sourceBindings': len(files)}
(OUT / 'source-restore.json').write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
print(str(scratch))
