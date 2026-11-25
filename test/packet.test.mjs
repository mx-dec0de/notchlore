import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runPacket } from '../lib/packet.mjs';
const python = process.platform === 'win32' ? 'python' : 'python3';

const sha256 = data => createHash('sha256').update(data).digest('hex');
const packetHelper = fileURLToPath(new URL('../lib/packet.py', import.meta.url));

async function fixture(t, kind = 'task') {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'notchlore-packet-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'project');
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.mkdir(path.join(root, 'docs'));
  const source = 'export const count = 1;\n';
  await fs.writeFile(path.join(root, 'src/app.mjs'), source);
  await fs.writeFile(path.join(root, 'docs/project.md'), '# Existing project\n\n[Current source](../src/app.mjs)\n');
  await fs.writeFile(path.join(root, 'docs/task.md'), '# Accepted task\n\n[Project](project.md)\n\nChange the count and verify it.\n');
  const spec = {
    schemaVersion: 1, kind, id: 'TASK-001', project: 'Disposable test project',
    scope: 'Change the count in the existing module and return source plus evidence.',
    baseline: { revision: 'snapshot:fixture-v1', files: { 'src/app.mjs': sha256(source) }, empty: false, dirty: 'UNKNOWN' },
    selectedPaths: ['src', 'docs'], requiredReferences: ['docs/project.md', 'docs/task.md'],
    readingOrder: ['docs/project.md', 'docs/task.md'],
    start: { task: 'docs/task.md', prompt: 'Read START.md and the task. Validate the current checkout, implement the authorized change and return evidence.' },
    authority: { allowed: ['Inspect and change the disposable module.', 'Run local checks.'], forbidden: ['Deploy, publish or contact outside services.'], budget: { attempts: 3, minutes: 30 } },
    exclusions: [], privacy: { reviewed: true, reviewer: 'fixture author', notes: 'Synthetic code and documents; no real users, credentials or private data.' },
  };
  const specFile = path.join(parent, 'spec.json');
  const archive = path.join(parent, 'packet.zip');
  async function save() { await fs.writeFile(specFile, JSON.stringify(spec)); }
  async function create(out = archive) {
    await save();
    return runPacket(['create', '--root', root, '--spec', specFile, '--out', out, '--json']);
  }
  await save();
  return { parent, root, spec, specFile, archive, source, save, create };
}

function zipEntries(filename, entries) {
  execFileSync(python, ['-c', `
import sys,json,zipfile,stat,warnings
warnings.simplefilter('ignore', UserWarning)
with zipfile.ZipFile(sys.argv[1], 'w', compression=zipfile.ZIP_DEFLATED) as z:
 for item in json.load(sys.stdin):
  entry=zipfile.ZipInfo(item['name'])
  entry.create_system=3
  entry.external_attr=item.get('mode',(stat.S_IFREG|0o600))<<16
  entry.compress_type=zipfile.ZIP_DEFLATED
  z.writestr(entry, item.get('text','').encode())
`, filename], { encoding: 'utf8', input: JSON.stringify(entries) });
}

function mutateArchive(source, destination, instruction) {
  execFileSync(python, ['-c', `
import sys,json,zipfile,hashlib,stat
with zipfile.ZipFile(sys.argv[1]) as z: files={n:z.read(n) for n in z.namelist()}
change=json.loads(sys.argv[3])
if change.get('manifest'):
 data=json.loads(files['manifest.json']); data.update(change['manifest']); files['manifest.json']=json.dumps(data).encode()
if 'replace' in change:
 for name,body in change['replace'].items(): files[name]=body.encode()
if 'remove' in change:
 for name in change['remove']: files.pop(name,None)
with zipfile.ZipFile(sys.argv[2],'w',compression=zipfile.ZIP_DEFLATED) as z:
 for name,data in files.items():
  info=zipfile.ZipInfo(name); info.create_system=3; info.external_attr=(stat.S_IFREG|0o600)<<16
  z.writestr(info,data)
`, source, destination, JSON.stringify(instruction)], { encoding: 'utf8' });
}

test('packet round trip preserves local bytes, references, root binding and private staging modes', async t => {
  const f = await fixture(t);
  const made = await f.create();
  assert.equal(made.ok, true);
  assert.equal(made.files, 3);
  assert.equal(made.localLinksChecked, 2);
  assert.ok([...made.nextPrompt].length <= 200);
  assert.equal(made.sha256, sha256(await fs.readFile(f.archive)));
  const unbound = await runPacket(['check', f.archive]);
  assert.equal(unbound.structuralStatus, 'PASS');
  assert.equal(unbound.baseline.status, 'NOT CHECKED');
  assert.equal(unbound.executionReady, false);
  const bound = await runPacket(['check', f.archive, '--root', f.root]);
  assert.equal(bound.baseline.status, 'PASS');
  assert.equal(bound.baseline.checkedFiles, 1);
  assert.equal(bound.executionReady, true);
  const target = path.join(f.parent, 'stage');
  const unpacked = await runPacket(['unpack', f.archive, '--dir', target, '--root', f.root]);
  assert.equal(unpacked.operation, 'unpack');
  assert.equal(unpacked.target, target);
  assert.equal(await fs.readFile(path.join(target, 'payload/src/app.mjs'), 'utf8'), f.source);
  assert.equal(await fs.readFile(path.join(f.root, 'src/app.mjs'), 'utf8'), f.source);
  const start = await fs.readFile(path.join(target, 'START.md'), 'utf8');
  assert.match(start, /payload\/docs\/task\.md/);
  assert.match(start, /\.notchlore\/staging\/TASK-001/);
  assert.match(start, /does not overwrite, reconcile, install, or execute/);
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(target)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(f.archive)).mode & 0o777, 0o600);
    assert.equal((await fs.stat(path.join(target, 'payload/src/app.mjs'))).mode & 0o777, 0o600);
    assert.equal((await fs.stat(path.join(target, 'payload'))).mode & 0o777, 0o700);
    assert.equal((await fs.stat(path.join(target, 'payload/src'))).mode & 0o777, 0o700);
  }
});

test('all five packet kinds share the checked format and never execute imported scripts', async t => {
  const f = await fixture(t);
  const marker = path.join(f.parent, 'executed');
  await fs.writeFile(path.join(f.root, 'src/run.py'), `from pathlib import Path\nPath(${JSON.stringify(marker)}).write_text('bad')\n`);
  for (const kind of ['source', 'task', 'return', 'checkpoint', 'backup']) {
    f.spec.kind = kind;
    const archive = path.join(f.parent, `${kind}.zip`);
    await f.create(archive);
    const result = await runPacket(['unpack', archive, '--dir', path.join(f.parent, `stage-${kind}`)]);
    assert.equal(result.kind, kind);
    assert.equal(result.executionReady, false);
  }
  await assert.rejects(fs.stat(marker), { code: 'ENOENT' });
});

test('snapshot copies edited and untracked selected files while stale target baseline safely blocks execution', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, 'src/app.mjs'), 'export const count = 2;\n');
  await fs.writeFile(path.join(f.root, 'src/new.mjs'), 'export const added = true;\n');
  await f.create();
  await assert.rejects(runPacket(['check', f.archive, '--root', f.root]), /Stale baseline file/);
  const blocked = path.join(f.parent, 'blocked-stage');
  await assert.rejects(runPacket(['unpack', f.archive, '--dir', blocked, '--root', f.root]), /Stale baseline file/);
  await assert.rejects(fs.stat(blocked), { code: 'ENOENT' });
  const review = path.join(f.parent, 'review-stage');
  const result = await runPacket(['unpack', f.archive, '--dir', review]);
  assert.equal(result.executionReady, false);
  assert.equal(await fs.readFile(path.join(review, 'payload/src/app.mjs'), 'utf8'), 'export const count = 2;\n');
  assert.equal(await fs.readFile(path.join(review, 'payload/src/new.mjs'), 'utf8'), 'export const added = true;\n');
});

test('default exclusions are visible; explicit exclusions preserve selected public material', async t => {
  const f = await fixture(t, 'source');
  await fs.mkdir(path.join(f.root, 'config'));
  await fs.mkdir(path.join(f.root, 'config/private'));
  await fs.writeFile(path.join(f.root, 'config/.env'), 'DATABASE_PASSWORD=do-not-export');
  await fs.writeFile(path.join(f.root, 'config/.env.example'), 'DATABASE_PASSWORD=<redacted>');
  await fs.writeFile(path.join(f.root, 'config/private/customer.txt'), 'Private customer material');
  await fs.writeFile(path.join(f.root, 'config/live.sqlite'), 'Live database bytes');
  await fs.writeFile(path.join(f.root, 'config/notes.txt'), 'Excluded by sender');
  f.spec.selectedPaths.push('config');
  f.spec.exclusions.push('config/notes.txt');
  const made = await f.create();
  assert.deepEqual(made.omitted.map(item => item.path).sort(), ['config/.env', 'config/live.sqlite', 'config/notes.txt', 'config/private']);
  const stage = path.join(f.parent, 'stage');
  await runPacket(['unpack', f.archive, '--dir', stage]);
  assert.deepEqual(await fs.readdir(path.join(stage, 'payload/config')), ['.env.example']);
  assert.match(made.privacy, /not a leak-free guarantee/);
  assert.equal(await fs.readFile(path.join(f.root, 'config/.env'), 'utf8'), 'DATABASE_PASSWORD=do-not-export');
});

test('explicit secret-path selections and detected credential values fail without revealing values or writing output', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, '.env'), 'SECRET=should-not-export');
  f.spec.selectedPaths.push('.env');
  await assert.rejects(f.create(), /Explicit selected path is excluded/);
  f.spec.selectedPaths.pop();
  const secret = 'ghp_' + 'A'.repeat(36);
  await fs.writeFile(path.join(f.root, 'src/leak.mjs'), `export const leaked = '${secret}';\n`);
  await assert.rejects(f.create(), error => {
    assert.match(error.message, /Possible GitHub token/);
    assert.equal(error.message.includes(secret), false);
    return true;
  });
  await assert.rejects(fs.stat(f.archive), { code: 'ENOENT' });
  await fs.writeFile(path.join(f.root, 'src/leak.mjs'), 'const api_key = "abCDefGhiJkL9876";\n');
  await assert.rejects(f.create(), /Possible hardcoded credential/);
});

test('review acknowledgement, complete baseline and short initiation prompt are mandatory', async t => {
  const f = await fixture(t);
  f.spec.privacy.reviewed = false;
  await assert.rejects(f.create(), /Privacy review acknowledgement/);
  f.spec.privacy.reviewed = true;
  f.spec.baseline.files = {};
  await assert.rejects(f.create(), /requires baseline file hashes/);
  f.spec.baseline.files = { 'src/app.mjs': sha256(f.source) };
  f.spec.start.prompt = 'x'.repeat(201);
  await assert.rejects(f.create(), /200 characters/);
  f.spec.start.prompt = 'x'.repeat(200);
  await f.create();
});

test('required references and conventional Markdown reference closure are validated before export', async t => {
  const f = await fixture(t);
  f.spec.requiredReferences.push('docs/missing.md');
  await assert.rejects(f.create(), /Required reference missing/);
  f.spec.requiredReferences.pop();
  await fs.writeFile(path.join(f.root, 'docs/task.md'), '# Task\n\n[Contract][contract]\n\n[contract]: missing.md\n');
  await assert.rejects(f.create(), /Local Markdown reference missing.*docs\/missing.md/);
  await fs.writeFile(path.join(f.root, 'docs/task.md'), '# Task\n\n[Outside](../../outside.md)\n');
  await assert.rejects(f.create(), /Unsafe path/);
  await fs.writeFile(path.join(f.root, 'docs/task.md'), '# Task\n\n[Source](../src/app.mjs)\n\n```md\n[Example only](missing.md)\n```\n');
  await f.create();
});

test('source and task support explicit empty baselines without treating an existing app as empty', async t => {
  const f = await fixture(t, 'source');
  f.spec.baseline = { revision: 'empty', files: {}, empty: true };
  f.spec.selectedPaths = [];
  f.spec.requiredReferences = [];
  f.spec.readingOrder = [];
  f.spec.start.task = null;
  await f.create();
  const empty = path.join(f.parent, 'empty');
  await fs.mkdir(empty);
  const checked = await runPacket(['check', f.archive, '--root', empty]);
  assert.equal(checked.files, 0);
  assert.equal(checked.baseline.status, 'PASS');
  await fs.mkdir(path.join(empty, '.agents'));
  await runPacket(['check', f.archive, '--root', empty]);
  await fs.writeFile(path.join(empty, 'existing.mjs'), 'do not overwrite');
  await assert.rejects(runPacket(['check', f.archive, '--root', empty]), /Expected an empty project root/);
  f.spec.kind = 'task';
  f.spec.selectedPaths = ['src', 'docs'];
  f.spec.readingOrder = ['docs/task.md'];
  f.spec.start.task = 'docs/task.md';
  const task = path.join(f.parent, 'new-project-task.zip');
  await f.create(task);
  await fs.unlink(path.join(empty, 'existing.mjs'));
  assert.equal((await runPacket(['check', task, '--root', empty])).executionReady, true);
});

test('repeat, occupied, linked and concurrent output destinations are never overwritten', async t => {
  const f = await fixture(t);
  await f.create();
  const original = await fs.readFile(f.archive);
  await assert.rejects(f.create(), /already exists/);
  assert.deepEqual(await fs.readFile(f.archive), original);
  const occupied = path.join(f.parent, 'occupied');
  await fs.mkdir(occupied);
  await fs.writeFile(path.join(occupied, 'keep'), 'original');
  await assert.rejects(runPacket(['unpack', f.archive, '--dir', occupied]), /already exists/);
  assert.equal(await fs.readFile(path.join(occupied, 'keep'), 'utf8'), 'original');
  const link = path.join(f.parent, 'link');
  await fs.symlink(occupied, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(runPacket(['unpack', f.archive, '--dir', link]), /already exists/);
  const raced = path.join(f.parent, 'race');
  const outcomes = await Promise.allSettled([1, 2].map(() => runPacket(['unpack', f.archive, '--dir', raced])));
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  assert.match(outcomes.find(item => item.status === 'rejected').reason.message, /already exists/);
});

test('nested staging requires an explicitly prepared parent and leaves no writes on refusal', async t => {
  const f = await fixture(t);
  await f.create();
  const originalArchive = await fs.readFile(f.archive);
  const originalEntries = await fs.readdir(f.root);
  const parent = path.join(f.root, '.notchlore', 'staging');
  const target = path.join(parent, f.spec.id);
  await assert.rejects(runPacket(['unpack', f.archive, '--dir', target, '--root', f.root]), error => {
    assert.match(error.message, /Staging parent directory does not exist/);
    assert.ok(error.message.includes(parent));
    assert.match(error.message, /Create this parent explicitly/);
    assert.match(error.message, /leave the final task directory absent/);
    return true;
  });
  await assert.rejects(fs.stat(path.join(f.root, '.notchlore')), { code: 'ENOENT' });
  assert.deepEqual(await fs.readdir(f.root), originalEntries);
  assert.deepEqual(await fs.readFile(f.archive), originalArchive);
  assert.equal(await fs.readFile(path.join(f.root, 'src/app.mjs'), 'utf8'), f.source);

  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  await assert.rejects(fs.stat(target), { code: 'ENOENT' });
  const unpacked = await runPacket(['unpack', f.archive, '--dir', target, '--root', f.root]);
  assert.equal(unpacked.target, target);
  assert.equal(await fs.readFile(path.join(target, 'payload/src/app.mjs'), 'utf8'), f.source);
  const start = await fs.readFile(path.join(target, 'START.md'), 'utf8');
  assert.match(start, /mkdir -p -- \.notchlore\/staging/);
  assert.match(start, /leave `\.notchlore\/staging\/TASK-001` absent/);
  assert.match(start, /staging parent must already exist/);
});

test('source symlinks, directory-link traversal, hardlinks and case collisions are refused', async t => {
  const f = await fixture(t);
  const outside = path.join(f.parent, 'outside.txt');
  await fs.writeFile(outside, 'outside data');
  const link = path.join(f.root, 'src/link.txt');
  await fs.symlink(outside, link);
  await assert.rejects(f.create(), /Symlink refused/);
  await fs.unlink(link);
  await fs.link(outside, link);
  await assert.rejects(f.create(), /hardlink refused/);
  await fs.unlink(link);
  await fs.symlink(f.parent, path.join(f.root, 'other'), process.platform === 'win32' ? 'junction' : 'dir');
  f.spec.selectedPaths.push('other/outside.txt');
  await assert.rejects(f.create(), /Symlink refused/);
  f.spec.selectedPaths.pop();
  await fs.writeFile(path.join(f.root, 'src/APP.mjs'), 'case collision');
  if (process.platform !== 'win32') await assert.rejects(f.create(), /Case or Unicode path collision/);
});

test('unsafe ZIP paths, namespace violations, duplicate members, symlinks and special files fail before extraction', async t => {
  const f = await fixture(t);
  const cases = [
    ['../escape', undefined, /Unsafe path/], ['/absolute', undefined, /Unsafe path/],
    ['C:/escape', undefined, /Unsafe path/], ['payload/..\\escape', undefined, /Unsafe path/],
    ['payload/CON.txt', undefined, /Unsafe path/], ['payload/name.', undefined, /Unsafe path/],
    ['payload//empty', undefined, /Unsafe path/], ['elsewhere/file', undefined, /outside packet layout/],
    ['payload/link', 0o120777, /symlink/], ['payload/fifo', 0o010600, /Unsupported archive entry/],
  ];
  let index = 0;
  for (const [name, mode, expected] of cases) {
    const archive = path.join(f.parent, `unsafe-${index}.zip`);
    const target = path.join(f.parent, `unsafe-stage-${index++}`);
    zipEntries(archive, [{ name, mode, text: 'untrusted' }]);
    await assert.rejects(runPacket(['unpack', archive, '--dir', target]), expected);
    await assert.rejects(fs.stat(target), { code: 'ENOENT' });
  }
  for (const names of [['payload/a', 'payload/a'], ['payload/a', 'payload/A'], ['payload/a', 'payload/a/b']]) {
    const archive = path.join(f.parent, `collision-${index++}.zip`);
    zipEntries(archive, names.map(name => ({ name })));
    await assert.rejects(runPacket(['check', archive]), /colliding|collision/);
  }
});

test('tampering, unlisted files, missing manifest coverage and misleading entry instructions are rejected', async t => {
  const f = await fixture(t);
  await f.create();
  for (const [name, instruction, expected] of [
    ['changed', { replace: { 'payload/src/app.mjs': 'export const count = 99;' } }, /hash or size mismatch/],
    ['extra', { replace: { 'payload/extra.mjs': 'unlisted' } }, /coverage does not match/],
    ['missing', { remove: ['payload/src/app.mjs'] }, /coverage does not match/],
    ['no-start', { remove: ['START.md'] }, /must contain/],
    ['schema', { manifest: { schemaVersion: 999 } }, /Unsupported packet/],
    ['duplicate-record', { manifest: { files: [] } }, /coverage does not match/],
  ]) {
    const archive = path.join(f.parent, `${name}.zip`);
    mutateArchive(f.archive, archive, instruction);
    await assert.rejects(runPacket(['check', archive]), expected);
  }
});

test('duplicate JSON keys, unknown fields and invalid baseline digests fail safely', async t => {
  const f = await fixture(t);
  await fs.writeFile(f.specFile, '{"kind":"source","kind":"task"}');
  await assert.rejects(runPacket(['create', '--root', f.root, '--spec', f.specFile, '--out', f.archive]), /Duplicate JSON object key/);
  f.spec.unrecognized = true;
  await assert.rejects(f.create(), /unknown=unrecognized/);
  delete f.spec.unrecognized;
  f.spec.baseline.files['src/app.mjs'] = 'not-a-hash';
  await assert.rejects(f.create(), /Invalid baseline SHA/);
});

test('ZIP entry, per-file and compression-ratio bounds reject oversized work rather than truncate it', async t => {
  const f = await fixture(t);
  const countArchive = path.join(f.parent, 'too-many.zip');
  execFileSync(python, ['-c', 'import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1],"w")\nfor i in range(4097):z.writestr("payload/"+str(i),b"")\nz.close()', countArchive]);
  await assert.rejects(runPacket(['check', countArchive]), /entry limit/);
  const ratioArchive = path.join(f.parent, 'ratio.zip');
  zipEntries(ratioArchive, [{ name: 'payload/bomb.txt', text: 'a'.repeat(300000) }]);
  await assert.rejects(runPacket(['check', ratioArchive]), /compression-ratio limit/);
  await fs.writeFile(path.join(f.root, 'src/oversized.txt'), Buffer.alloc(16 * 1024 * 1024 + 1));
  await assert.rejects(f.create(), /File size limit/);
});

test('Git baseline binds full revision without executing repository hooks or filters', async t => {
  const f = await fixture(t);
  execFileSync('git', ['init', '-q', f.root]);
  execFileSync('git', ['-C', f.root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'add', 'src/app.mjs']);
  execFileSync('git', ['-C', f.root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture baseline']);
  const revision = execFileSync('git', ['-C', f.root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const marker = path.join(f.parent, 'hook-executed');
  await fs.writeFile(path.join(f.root, '.git/hooks/post-checkout'), `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o700 });
  execFileSync('git', ['-C', f.root, 'config', 'core.fsmonitor', `touch '${marker}'`]);
  f.spec.baseline.revision = `git:${revision}`;
  await f.create();
  assert.equal((await runPacket(['check', f.archive, '--root', f.root])).baseline.status, 'PASS');
  await assert.rejects(fs.stat(marker), { code: 'ENOENT' });
  f.spec.baseline.revision = `git:${'0'.repeat(40)}`;
  const wrong = path.join(f.parent, 'wrong-git.zip');
  await f.create(wrong);
  await assert.rejects(runPacket(['check', wrong, '--root', f.root]), /Git baseline revision does not match/);
});

test('packet wrapper rejects malformed argv and invalid command without running a shell', async () => {
  await assert.rejects(runPacket('create'), /array of strings/);
  await assert.rejects(runPacket(['missing-command']), /Invalid packet command/);
});

test('generated metadata size is checked before reserving output, even when the compact input specification fits', async t => {
  const f = await fixture(t);
  const directory = ['a'.repeat(220), 'b'.repeat(220), 'c'.repeat(220), 'd'.repeat(220)].join('/');
  await fs.mkdir(path.join(f.root, directory), { recursive: true });
  const files = [];
  for (let index = 0; index < 1000; index++) {
    const relative = `${directory}/file-${String(index).padStart(4, '0')}.txt`;
    files.push(relative);
    await fs.writeFile(path.join(f.root, relative), 'x\n');
  }
  f.spec.selectedPaths = files;
  f.spec.requiredReferences = files;
  f.spec.readingOrder = files;
  f.spec.start.task = files[0];
  f.spec.baseline.files = Object.fromEntries(files.map(name => [name, sha256('x\n')]));
  assert.ok(Buffer.byteLength(JSON.stringify(f.spec)) < 4 * 1024 * 1024);
  await assert.rejects(f.create(), /Generated packet entry exceeds size limit: manifest.json/);
  await assert.rejects(fs.stat(f.archive), { code: 'ENOENT' });
});

test('archive prefix length is validated before output; the longest valid encoded packet path round-trips', async t => {
  const f = await fixture(t);
  const directory = ['a'.repeat(252), 'b'.repeat(252), 'c'.repeat(252), 'd'.repeat(252)].join('/');
  await fs.mkdir(path.join(f.root, directory), { recursive: true });
  const tooLong = `${directory}/file.txt`;
  assert.equal(tooLong.length, 1020);
  await fs.writeFile(path.join(f.root, tooLong), 'x\n');
  f.spec.selectedPaths = [tooLong];
  f.spec.requiredReferences = [tooLong];
  f.spec.readingOrder = [tooLong];
  f.spec.start.task = tooLong;
  f.spec.baseline.files = { [tooLong]: sha256('x\n') };
  await assert.rejects(f.create(), /1024 characters/);
  await assert.rejects(fs.stat(f.archive), { code: 'ENOENT' });
  const boundary = `${directory}/file`;
  assert.equal(`payload/${boundary}`.length, 1024);
  await fs.writeFile(path.join(f.root, boundary), 'x\n');
  f.spec.selectedPaths = [boundary];
  f.spec.requiredReferences = [boundary];
  f.spec.readingOrder = [boundary];
  f.spec.start.task = boundary;
  f.spec.baseline.files = { [boundary]: sha256('x\n') };
  await f.create();
  assert.equal((await runPacket(['check', f.archive, '--root', f.root])).executionReady, true);
});

test('FIFO archive, specification and baseline inputs are refused promptly without waiting for a writer', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t);
  await f.create();
  const fifo = path.join(f.parent, 'pipe.zip');
  execFileSync(python, ['-c', 'import os,sys; os.mkfifo(sys.argv[1])', fifo]);
  function refusesPromptly(args) {
    assert.throws(() => execFileSync(python, [packetHelper, ...args], { timeout: 2000, encoding: 'utf8' }), error => {
      assert.notEqual(error.code, 'ETIMEDOUT', 'The helper blocked on a FIFO.');
      assert.equal(error.status, 1);
      assert.match(JSON.parse(error.stdout).error, /Nonregular file/);
      return true;
    });
  }
  refusesPromptly(['check', fifo]);
  const output = path.join(f.parent, 'never-created.zip');
  refusesPromptly(['create', '--root', f.root, '--spec', fifo, '--out', output]);
  await assert.rejects(fs.stat(output), { code: 'ENOENT' });
  await fs.unlink(path.join(f.root, 'src/app.mjs'));
  execFileSync(python, ['-c', 'import os,sys; os.mkfifo(sys.argv[1])', path.join(f.root, 'src/app.mjs')]);
  refusesPromptly(['check', f.archive, '--root', f.root]);
});

test('case and Unicode collisions in directory ancestors are refused on creation and receipt', async t => {
  const f = await fixture(t, 'source');
  f.spec.start.task = null;
  f.spec.requiredReferences = [];
  f.spec.readingOrder = [];
  let index = 0;
  for (const names of [['Upper/a.txt', 'upper/b.txt'], ['caf\u00e9/a.txt', 'cafe\u0301/b.txt']]) {
    for (const name of names) {
      await fs.mkdir(path.dirname(path.join(f.root, name)), { recursive: true });
      await fs.writeFile(path.join(f.root, name), 'x\n');
    }
    f.spec.selectedPaths = names;
    await assert.rejects(f.create(), /Case or Unicode path collision/);
    await assert.rejects(fs.stat(f.archive), { code: 'ENOENT' });
    const archive = path.join(f.parent, `ambiguous-directory-${index++}.zip`);
    zipEntries(archive, names.map(name => ({ name: `payload/${name}`, text: 'x\n' })));
    const target = path.join(f.parent, `ambiguous-stage-${index}`);
    await assert.rejects(runPacket(['unpack', archive, '--dir', target]), /Case or Unicode path collision/);
    await assert.rejects(fs.stat(target), { code: 'ENOENT' });
  }
});

test('Markdown destination checks support balanced parentheses, escapes, angle form and reference definitions', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, 'docs/api(v2).md'), '# Exact versioned contract\n');
  await fs.writeFile(path.join(f.root, 'docs/api(v2(extra)).md'), '# Nested contract name\n');
  await fs.writeFile(path.join(f.root, 'docs/api v2.md'), '# Space in contract name\n');
  await fs.writeFile(path.join(f.root, 'docs/task.md'), [
    '# Task', '',
    '[Contract](api(v2).md)',
    '[Nested](api(v2(extra)).md)',
    '[Escaped](api\\(v2\\).md)',
    '[Angle](<api(v2).md>)',
    '[Space](<api v2.md> "Contract title")',
    '[Reference][contract]', '',
    '[contract]: api(v2).md "Contract title"', '',
  ].join('\n'));
  await f.create();
  assert.equal((await runPacket(['check', f.archive])).localLinksChecked, 7);
  await fs.unlink(path.join(f.root, 'docs/api(v2).md'));
  await assert.rejects(f.create(path.join(f.parent, 'missing-link.zip')), /Local Markdown reference missing.*api\(v2\).md/);
});

test('large Unicode omission reports preserve exact paths across stdout chunk boundaries', async t => {
  const f = await fixture(t, 'source');
  await fs.mkdir(path.join(f.root, 'selected'));
  await fs.writeFile(path.join(f.root, 'selected/ok.txt'), 'Public selected content\n');
  const expected = [];
  for (let index = 0; index < 2000; index++) {
    const directory = `selected/${'é'.repeat(100)}${index}`;
    await fs.mkdir(path.join(f.root, directory));
    await fs.writeFile(path.join(f.root, directory, '.env'), 'EXCLUDED=synthetic');
    expected.push(`${directory}/.env`);
  }
  f.spec.selectedPaths = ['selected'];
  f.spec.requiredReferences = [];
  f.spec.readingOrder = [];
  f.spec.start.task = null;
  const created = await f.create();
  assert.deepEqual(created.omitted.map(item => item.path).sort(), expected.sort());
  assert.equal(JSON.stringify(created).includes('\uFFFD'), false);
  const checked = await runPacket(['check', f.archive]);
  assert.deepEqual(checked.omitted.map(item => item.path).sort(), expected.sort());
});
