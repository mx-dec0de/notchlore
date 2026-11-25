import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { exportPrompts, resolveMode, promptText, referenceFiles, starterText } from '../lib/prompts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modes = [
  ['1', 'chatgpt', '01_chatgpt/CHATGPT_ONLY.md'],
  ['2', 'codex', '02_chatgpt_codex/CHATGPT_CODEX.md'],
  ['3', 'dot', '03_chatgpt_codex_dot/DOT.md'],
];

async function files(root, prefix = '', acc = []) {
  const entries = await fs.readdir(path.join(root, prefix), { withFileTypes: true });
  for (const entry of entries) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) await files(root, relative, acc);
    else acc.push(relative.split(path.sep).join('/'));
  }
  return acc.sort();
}

async function completeLocalLinks(root, names) {
  for (const name of names) {
    const content = await fs.readFile(path.join(root, name), 'utf8');
    for (const match of content.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      const link = match[1];
      if (/^(?:[a-z]+:|#)/i.test(link)) continue;
      const local = link.split('#')[0];
      if (!local) continue;
      const target = path.resolve(root, path.dirname(name), local);
      const relative = path.relative(root, target);
      assert.ok(!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`), `${name}: link leaves pack`);
      assert.ok((await fs.lstat(target)).isFile(), `${name}: missing ${link}`);
    }
  }
}

test('three prompt adapters use one installable canonical protocol', async () => {
  assert.deepEqual(await files(path.join(root, 'prompts')), ['BASE.md', ...modes.map(x => x[2])].sort());
  assert.deepEqual(await files(path.join(root, 'skills', 'notchlore', 'references')), [...referenceFiles].sort());
  const base = (await fs.readFile(path.join(root, 'prompts', 'BASE.md'), 'utf8')).trim();
  for (const [alias, name, modeFile] of modes) {
    assert.equal(resolveMode(alias), name);
    const prompt = await promptText(root, alias);
    assert.ok(prompt.includes(base));
    assert.ok(prompt.includes((await fs.readFile(path.join(root, 'prompts', modeFile), 'utf8')).trim()));
    assert.ok([...starterText(alias)].length <= 200);
  }
  await assert.rejects(promptText(root, '../../package'), /Choose mode/);
});

test('each exported mode is complete, preserves canonical bytes and does not install a skill', async t => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'notchlore-export-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  for (const [alias, name, modeFile] of modes) {
    const target = path.join(parent, `mode-${alias}`);
    const plan = await exportPrompts({ packageRoot: root, mode: alias, dir: target, dryRun: true });
    assert.equal(plan.dryRun, true);
    await assert.rejects(fs.lstat(target), { code: 'ENOENT' });
    const result = await exportPrompts({ packageRoot: root, mode: alias, dir: target });
    assert.equal(result.mode, name);
    const present = await files(target);
    assert.ok(present.length >= 14);
    assert.equal(plan.files, present.length);
    assert.equal(result.files, present.length);
    assert.ok(present.includes(`prompts/${modeFile}`));
    assert.ok(present.includes('START.md'));
    assert.ok(present.includes('GUIDE.md'));
    assert.ok(present.includes('skills/notchlore/LICENSE.txt'));
    assert.equal(present.filter(x => /CHATGPT_ONLY|CHATGPT_CODEX\.md|DOT\.md/.test(x)).length, 1);
    assert.ok(present.every(x => /\.(?:md|json|txt)$/.test(x)));
    await assert.rejects(fs.lstat(path.join(target, '.agents')), { code: 'ENOENT' });
    for (const file of present.filter(x => !['START.md', 'PACK_MANIFEST.json'].includes(x))) {
      assert.deepEqual(await fs.readFile(path.join(root, file)), await fs.readFile(path.join(target, file)), file);
    }
    const manifest = JSON.parse(await fs.readFile(path.join(target, 'PACK_MANIFEST.json'), 'utf8'));
    assert.equal(manifest.version, '2.0.0');
    assert.equal(manifest.mode, name);
    assert.deepEqual(Object.keys(manifest.files).sort(), present.filter(file => file !== 'PACK_MANIFEST.json').sort());
    for (const [file, hash] of Object.entries(manifest.files)) {
      assert.equal(createHash('sha256').update(await fs.readFile(path.join(target, file))).digest('hex'), hash);
    }
    await completeLocalLinks(target, present);
    await assert.rejects(exportPrompts({ packageRoot: root, mode: alias, dir: target }), /already exists/);
  }
});

test('export rejects bad modes, existing files, directories and linked targets without writes', async t => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'notchlore-export-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const occupied = path.join(parent, 'occupied');
  const directory = path.join(parent, 'directory');
  const linked = path.join(parent, 'linked');
  await fs.writeFile(occupied, 'protected');
  await fs.mkdir(directory);
  await fs.symlink(directory, linked, process.platform === 'win32' ? 'junction' : 'dir');
  for (const dir of [occupied, directory, linked]) {
    await assert.rejects(exportPrompts({ packageRoot: root, mode: 'dot', dir }), /already exists/);
  }
  assert.equal(await fs.readFile(occupied, 'utf8'), 'protected');
  assert.deepEqual(await fs.readdir(directory), []);
  await assert.rejects(exportPrompts({ packageRoot: root, mode: 'invalid', dir: path.join(parent, 'new') }), /Choose mode/);
  await assert.rejects(exportPrompts({ packageRoot: root, mode: '2', dir: path.join(parent, 'missing', 'new') }), { code: 'ENOENT' });
  assert.deepEqual((await fs.readdir(parent)).sort(), ['directory', 'linked', 'occupied']);
});

test('concurrent exporters cannot overwrite an existing or newly reserved destination', async t => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'notchlore-export-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const target = path.join(parent, 'one');
  const outcomes = await Promise.allSettled(modes.map(([mode]) => exportPrompts({ packageRoot: root, mode, dir: target })));
  const successes = outcomes.filter(x => x.status === 'fulfilled');
  assert.equal(successes.length, 1);
  for (const failed of outcomes.filter(x => x.status === 'rejected')) assert.match(failed.reason.message, /already exists/);
  const present = await files(target);
  assert.equal(present.length, successes[0].value.files);
  await completeLocalLinks(target, present);
});
