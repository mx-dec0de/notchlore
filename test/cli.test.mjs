import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { installSkill } from '../lib/install.mjs';
import { inspectWorkspace } from '../lib/inspect.mjs';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'notchlore.mjs');

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'notchlore test '));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const packageRoot = path.join(base, 'package'), project = path.join(base, 'project with spaces');
  await fs.mkdir(path.join(packageRoot, 'skills', 'notchlore', 'references'), { recursive: true });
  await fs.mkdir(project);
  await fs.writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name: 'notchlore', version: '1.0.0' }));
  await fs.writeFile(path.join(packageRoot, 'skills', 'notchlore', 'SKILL.md'), '---\nname: notchlore\ndescription: Test fixture\n---\nInspect before changing.\n');
  await fs.writeFile(path.join(packageRoot, 'skills', 'notchlore', 'references', 'flow.md'), 'Preserve callers.\n');
  return { base, packageRoot, project, target: path.join(project, '.agents', 'skills', 'notchlore') };
}

async function snapshot(dir, relative = '', result = {}) {
  for (const entry of (await fs.readdir(path.join(dir, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    const full = path.join(dir, ...name.split('/'));
    if (entry.isSymbolicLink()) result[name] = `link:${await fs.readlink(full)}`;
    else if (entry.isDirectory()) { result[`${name}/`] = 'directory'; await snapshot(dir, name, result); }
    else result[name] = createHash('sha256').update(await fs.readFile(full)).digest('hex');
  }
  return result;
}

const install = f => installSkill({ packageRoot: f.packageRoot, dir: f.project });
const invoke = (args = [], cwd = root) => run(process.execPath, [cli, ...args], { cwd, timeout: 15000, maxBuffer: 1024 * 1024 });

test('installs into an empty folder and repeats without modifying anything', async t => {
  const f = await fixture(t);
  const result = await install(f);
  assert.equal(result.status, 'installed');
  assert.equal(result.fileCount, 2);
  const first = await snapshot(f.project);
  assert.equal((await install(f)).status, 'unchanged');
  assert.deepEqual(await snapshot(f.project), first);
  assert.equal(await fs.readFile(path.join(f.target, 'references', 'flow.md'), 'utf8'), 'Preserve callers.\n');
});

test('preserves code, partial documentation, instructions, and other skills byte for byte', async t => {
  const f = await fixture(t);
  const other = path.join(f.project, '.agents', 'skills', 'existing');
  await fs.mkdir(other, { recursive: true });
  const protectedFiles = { 'app.js': 'export const value = 7;\n', 'README.md': '# Incomplete project\n', 'AGENTS.md': 'Keep my rules.\n', '.agents/skills/existing/SKILL.md': 'Existing skill.\n' };
  for (const [name, content] of Object.entries(protectedFiles)) await fs.writeFile(path.join(f.project, name), content);
  await install(f);
  for (const [name, content] of Object.entries(protectedFiles)) assert.equal(await fs.readFile(path.join(f.project, name), 'utf8'), content);
});

test('dry run on a new project writes no directories or files', async t => {
  const f = await fixture(t), before = await snapshot(f.project);
  const result = await installSkill({ packageRoot: f.packageRoot, dir: f.project, dryRun: true });
  assert.equal(result.status, 'install');
  assert.equal(result.dryRun, true);
  assert.deepEqual(await snapshot(f.project), before);
});

test('refuses unrecognized or modified installations even with --update', async t => {
  const f = await fixture(t);
  await fs.mkdir(f.target, { recursive: true });
  await fs.writeFile(path.join(f.target, 'SKILL.md'), 'My existing skill');
  const unknown = await snapshot(f.project);
  await assert.rejects(install(f), /receipt/);
  assert.deepEqual(await snapshot(f.project), unknown);
  await fs.rm(f.target, { recursive: true });
  await install(f);
  await fs.appendFile(path.join(f.target, 'SKILL.md'), 'User adjustment.\n');
  const modified = await snapshot(f.project);
  await assert.rejects(installSkill({ packageRoot: f.packageRoot, dir: f.project, update: true }), /edited, missing, or extra/);
  assert.deepEqual(await snapshot(f.project), modified);
});

test('updates unmodified owned content explicitly and preserves the old skill', async t => {
  const f = await fixture(t);
  await install(f);
  const oldSkill = await snapshot(f.target);
  await fs.writeFile(path.join(f.packageRoot, 'skills', 'notchlore', 'references', 'flow.md'), 'New version.\n');
  await fs.writeFile(path.join(f.packageRoot, 'package.json'), JSON.stringify({ name: 'notchlore', version: '1.1.0' }));
  await assert.rejects(install(f), /--update/);
  const before = await snapshot(f.project);
  const plan = await installSkill({ packageRoot: f.packageRoot, dir: f.project, dryRun: true, update: true });
  assert.equal(plan.status, 'update');
  assert.deepEqual(await snapshot(f.project), before);
  const result = await installSkill({ packageRoot: f.packageRoot, dir: f.project, update: true });
  assert.equal(result.status, 'updated');
  assert.equal(result.version, '1.1.0');
  assert.equal(path.dirname(result.backup), path.join(f.project, '.agents'));
  assert.deepEqual(await snapshot(result.backup), oldSkill);
  assert.equal(await fs.readFile(path.join(f.target, 'references', 'flow.md'), 'utf8'), 'New version.\n');
  assert.equal((await install(f)).status, 'unchanged');
  const inspection = await inspectWorkspace(f.project);
  const localAgents = path.join(await fs.realpath(f.project), '.agents') + path.sep;
  assert.deepEqual(inspection.skills.filter(file => file.startsWith(localAgents)),
    [path.join(await fs.realpath(f.target), 'SKILL.md')]);
});

test('refuses extra files and empty directories rather than discarding them', async t => {
  const f = await fixture(t);
  await install(f);
  for (const name of ['my-notes.md', '__proto__']) {
    await fs.writeFile(path.join(f.target, name), 'Keep this.');
    const before = await snapshot(f.project);
    await assert.rejects(installSkill({ packageRoot: f.packageRoot, dir: f.project, update: true }), /extra/);
    assert.deepEqual(await snapshot(f.project), before);
    await fs.unlink(path.join(f.target, name));
  }
  await fs.mkdir(path.join(f.target, 'my-empty-folder'));
  await assert.rejects(installSkill({ packageRoot: f.packageRoot, dir: f.project, update: true }), /extra/);
  assert.equal((await fs.stat(path.join(f.target, 'my-empty-folder'))).isDirectory(), true);
});

test('refuses missing owned content and malformed receipts', async t => {
  const f = await fixture(t);
  await install(f);
  await fs.unlink(path.join(f.target, 'references', 'flow.md'));
  await assert.rejects(install(f), /missing/);
  await fs.writeFile(path.join(f.target, '.notchlore-install.json'), '{broken');
  await assert.rejects(install(f), /receipt/);
});

test('refuses destination parent and target directory links', async t => {
  const f = await fixture(t), foreign = path.join(f.base, 'foreign');
  await fs.mkdir(foreign);
  await fs.writeFile(path.join(foreign, 'keep'), 'untouched');
  await fs.symlink(foreign, path.join(f.project, '.agents'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(install(f), /real directory/);
  assert.deepEqual(await fs.readdir(foreign), ['keep']);
  await fs.unlink(path.join(f.project, '.agents'));
  await fs.mkdir(path.dirname(f.target), { recursive: true });
  await fs.symlink(foreign, f.target, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(install(f), /real directory/);
  assert.deepEqual(await fs.readdir(foreign), ['keep']);
});

test('refuses links inside the bundled skill before any project mutation', async t => {
  const f = await fixture(t), foreign = path.join(f.base, 'external');
  await fs.mkdir(foreign);
  await fs.symlink(foreign, path.join(f.packageRoot, 'skills', 'notchlore', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(install(f), /symlink/);
  assert.deepEqual(await fs.readdir(f.project), []);
});

test('concurrent installers leave one complete skill and no active staging paths', async t => {
  const f = await fixture(t);
  const outcomes = await Promise.allSettled([install(f), install(f), install(f)]);
  assert.ok(outcomes.some(value => value.status === 'fulfilled'));
  for (const result of outcomes) if (result.status === 'rejected') assert.match(result.reason.message, /install is active/);
  assert.equal((await install(f)).status, 'unchanged');
  assert.deepEqual(await fs.readdir(path.dirname(f.target)), ['notchlore']);
});

test('does not remove another installation lock', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.dirname(f.target), { recursive: true });
  const lock = path.join(path.dirname(f.target), '.notchlore-install.lock');
  await fs.writeFile(lock, 'retained lock');
  await assert.rejects(install(f), /lock remains/);
  assert.equal(await fs.readFile(lock, 'utf8'), 'retained lock');
  assert.deepEqual(await fs.readdir(path.dirname(f.target)), ['.notchlore-install.lock']);
});

test('global installation selects only the supplied home and rejects mixed destinations', async t => {
  const f = await fixture(t), home = path.join(f.base, 'home');
  await fs.mkdir(home);
  const result = await installSkill({ packageRoot: f.packageRoot, global: true, home });
  assert.equal(result.target, path.join(await fs.realpath(home), '.agents', 'skills', 'notchlore'));
  assert.deepEqual(await fs.readdir(f.project), []);
  await assert.rejects(installSkill({ packageRoot: f.packageRoot, global: true, home, dir: f.project }), /cannot be combined/);
});

test('accepts a scoped Notch Lore package and rejects unrelated package names', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.packageRoot, 'package.json'), JSON.stringify({ name: '@example-owner/notchlore', version: '1.0.0' }));
  assert.equal((await install(f)).status, 'installed');
  const receipt = JSON.parse(await fs.readFile(path.join(f.target, '.notchlore-install.json'), 'utf8'));
  assert.equal(receipt.package, 'notchlore');
  const before = await snapshot(f.project);
  await fs.writeFile(path.join(f.packageRoot, 'package.json'), JSON.stringify({ name: '@example-owner/unrelated', version: '1.0.0' }));
  await assert.rejects(install(f), /package metadata is invalid/);
  assert.deepEqual(await snapshot(f.project), before);
});

test('inspection distinguishes empty, code only, partial docs and skills without changing files', async t => {
  const f = await fixture(t);
  assert.equal((await inspectWorkspace(f.project)).classification, 'empty');
  await fs.writeFile(path.join(f.project, 'index.js'), 'export const answer = 42;');
  assert.equal((await inspectWorkspace(f.project)).classification, 'code-only');
  await fs.writeFile(path.join(f.project, 'README.md'), '# Partial docs');
  await fs.writeFile(path.join(f.project, 'AGENTS.md'), 'Existing instruction');
  await install(f);
  const before = await snapshot(f.project), result = await inspectWorkspace(f.project);
  assert.equal(result.classification, 'code-and-docs');
  assert.equal(result.documentationSufficiency, 'not-assessed');
  assert.ok(result.applicableInstructions.includes(path.join(await fs.realpath(f.project), 'AGENTS.md')));
  assert.ok(result.skills.includes(path.join(await fs.realpath(f.target), 'SKILL.md')));
  assert.deepEqual(await snapshot(f.project), before);
});

test('inspection skips linked folders and dependency trees and reports truncation', async t => {
  const f = await fixture(t), outside = path.join(f.base, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'secret.js'), 'must not inspect');
  await fs.symlink(outside, path.join(f.project, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await fs.mkdir(path.join(f.project, 'node_modules'));
  await fs.writeFile(path.join(f.project, 'node_modules', 'ignored.js'), 'not source');
  const deep = path.join(f.project, ...Array.from({ length: 8 }, (_, i) => `d${i}`));
  await fs.mkdir(deep, { recursive: true });
  await fs.writeFile(path.join(deep, 'too-deep.js'), 'outside depth budget');
  const result = await inspectWorkspace(f.project);
  assert.equal(result.codeFiles, 0);
  assert.equal(result.symlinksSkipped, 1);
  assert.equal(result.truncated, true);
});

test('inspection does not execute repository-configured clean filters', async t => {
  const f = await fixture(t);
  const git = args => run('git', ['-C', f.project, ...args], { timeout: 5000 });
  await git(['init', '--quiet']);
  const tracked = path.join(f.project, 'tracked.txt');
  await fs.writeFile(tracked, 'one\n');
  await git(['add', 'tracked.txt']);
  await fs.writeFile(path.join(f.project, '.gitattributes'), 'tracked.txt filter=probe\n');
  await git(['config', 'filter.probe.clean', `node -e "require('fs').writeFileSync('FILTER_RAN','yes');process.stdin.pipe(process.stdout)"`]);
  await git(['config', 'filter.probe.required', 'true']);
  await fs.writeFile(tracked, 'two\n');
  await fs.utimes(tracked, new Date(), new Date(Date.now() + 2000));
  const marker = path.join(f.project, 'FILTER_RAN');
  await git(['status', '--porcelain=v1']);
  assert.equal(await fs.readFile(marker, 'utf8'), 'yes');
  await fs.unlink(marker);
  const before = await snapshot(f.project);
  const result = await inspectWorkspace(f.project);
  assert.equal(result.git.available, true);
  assert.equal(result.git.dirty, true);
  await assert.rejects(fs.stat(marker), { code: 'ENOENT' });
  assert.deepEqual(await snapshot(f.project), before);
});

test('inspection does not follow a linked .agents directory', async t => {
  const f = await fixture(t), outside = path.join(f.base, 'outside');
  await fs.mkdir(path.join(outside, 'skills', 'foreign'), { recursive: true });
  await fs.writeFile(path.join(outside, 'skills', 'foreign', 'SKILL.md'), 'Foreign skill');
  await fs.symlink(outside, path.join(f.project, '.agents'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = await inspectWorkspace(f.project);
  assert.equal(result.symlinksSkipped, 1);
  assert.equal(result.skills.some(file => file.includes('foreign')), false);
});

test('CLI help and inspect are read only, and prompt traversal is rejected', async t => {
  const f = await fixture(t), before = await snapshot(f.project);
  assert.match((await invoke([], f.project)).stdout, /Usage:/);
  const inspection = JSON.parse((await invoke(['inspect', f.project, '--json'])).stdout);
  assert.equal(inspection.classification, 'empty');
  assert.deepEqual(await snapshot(f.project), before);
  await assert.rejects(invoke(['prompt', '../../package']), error => error.code !== 0 && /Choose mode/.test(error.stderr));
});

test('CLI rejects invalid options and destinations without writes', async t => {
  const f = await fixture(t), before = await snapshot(f.project);
  for (const args of [['install', '--force'], ['install', '--dir'], ['install', '--dir', f.project, '--global'], ['inspect', '--update'], ['install', '--json', '--json']]) {
    await assert.rejects(invoke(args, f.project), error => error.code !== 0);
  }
  await assert.rejects(invoke(['install', '--dir', path.join(f.base, 'missing')]), error => error.code !== 0);
  assert.deepEqual(await snapshot(f.project), before);
});

test('CLI can install its packaged payload and print every bundled prompt', async t => {
  const f = await fixture(t);
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const result = JSON.parse((await invoke(['install', '--dir', f.project, '--json'])).stdout);
  assert.equal(result.status, 'installed');
  assert.equal(result.version, pkg.version);
  assert.equal((await invoke(['--version'])).stdout.trim(), pkg.version);
  const base = await fs.readFile(path.join(root, 'prompts', 'BASE.md'), 'utf8');
  assert.equal((await invoke(['prompt', 'base'])).stdout, base);
  for (const [name, filename] of Object.entries({
    '1': '01_chatgpt/CHATGPT_ONLY.md',
    '2': '02_chatgpt_codex/CHATGPT_CODEX.md',
    '3': '03_chatgpt_codex_dot/DOT.md',
  })) {
    const output = (await invoke(['prompt', name])).stdout;
    const mode = await fs.readFile(path.join(root, 'prompts', filename), 'utf8');
    assert.ok(output.includes(base.trim()));
    assert.ok(output.includes(mode.trim()));
    assert.equal(output.split(base.trim()).length - 1, 1);
  }
  assert.equal((await invoke(['prompt', 'guide'])).stdout, await fs.readFile(path.join(root, 'GUIDE.md'), 'utf8'));
  for (const [name, file] of Object.entries({shape:'SYSTEM.md',task:'HANDOFF.md',review:'METHOD.md',resume:'CONTEXT.md'})) {
    assert.equal((await invoke(['prompt', name])).stdout, await fs.readFile(path.join(root, 'skills', 'notchlore', 'references', file), 'utf8'));
  }
});
