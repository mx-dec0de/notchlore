import * as fs from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';

const RECEIPT = '.notchlore-install.json';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

async function statOrNull(file) {
  try { return await fs.lstat(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function directory(file) {
  const stat = await statOrNull(file);
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) {
    throw new Error(`Expected a real directory, not a link or file: ${file}`);
  }
  return stat;
}

async function tree(root, relative = '', result = { files: Object.create(null), directories: [], bytes: 0 }) {
  for (const entry of (await fs.readdir(path.join(root, relative))).sort()) {
    const name = relative ? `${relative}/${entry}` : entry;
    const file = path.join(root, ...name.split('/'));
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) throw new Error(`Refusing a symlink inside the skill: ${file}`);
    if (stat.isDirectory()) {
      result.directories.push(name);
      await tree(root, name, result);
    } else if (stat.isFile()) {
      if (Object.keys(result.files).length >= 1000 || result.bytes + stat.size > 8 * 1024 * 1024) {
        throw new Error('Skill exceeds the installer limit of 1000 files or 8 MiB.');
      }
      const bytes = await fs.readFile(file);
      result.files[name] = { bytes, hash: digest(bytes), mode: stat.mode & 0o777 };
      result.bytes += bytes.length;
    } else {
      throw new Error(`Unsupported file type inside the skill: ${file}`);
    }
  }
  return result;
}

function validReceipt(value) {
  return value?.format === 1 && value.package === 'notchlore' && typeof value.version === 'string'
    && value.files && typeof value.files === 'object' && !Array.isArray(value.files)
    && Object.hasOwn(value.files, 'SKILL.md') && Object.entries(value.files).every(([name, hash]) =>
      name !== RECEIPT && !name.includes('\\') && !path.posix.isAbsolute(name)
      && name.split('/').every(part => part && part !== '.' && part !== '..')
      && /^[a-f0-9]{64}$/.test(hash));
}

async function ownedTree(target) {
  const current = await tree(target);
  let receipt;
  try { receipt = JSON.parse(current.files[RECEIPT]?.bytes.toString('utf8')); }
  catch { throw new Error(`Existing skill has no valid Notch Lore receipt; left unchanged: ${target}`); }
  if (!validReceipt(receipt)) throw new Error(`Existing skill has an invalid Notch Lore receipt; left unchanged: ${target}`);
  const actual = Object.fromEntries(Object.entries(current.files).filter(([name]) => name !== RECEIPT).map(([name, file]) => [name, file.hash]));
  const expectedDirectories = new Set();
  for (const name of Object.keys(receipt.files)) {
    const parts = name.split('/');
    for (let n = 1; n < parts.length; n++) expectedDirectories.add(parts.slice(0, n).join('/'));
  }
  if (!same(actual, receipt.files) || current.directories.some(name => !expectedDirectories.has(name))) {
    throw new Error(`Installed skill has edited, missing, or extra content; left unchanged: ${target}`);
  }
  return receipt;
}

async function preflight(parents, target, hashes, update) {
  for (const parent of parents) await directory(parent);
  const present = await directory(target);
  if (!present) return { status: 'install' };
  const receipt = await ownedTree(target);
  if (same(receipt.files, hashes)) return { status: 'unchanged', installedVersion: receipt.version };
  if (!update) throw new Error('A different Notch Lore version is installed. Use --update after reviewing the new version.');
  return { status: 'update', installedVersion: receipt.version };
}

export async function installSkill({ packageRoot, dir, global = false, dryRun = false, update = false, home = homedir() }) {
  if (global && dir !== undefined) throw new Error('--global and --dir cannot be combined.');
  const base = await fs.realpath(global ? home : (dir ?? process.cwd()));
  if (!(await fs.stat(base)).isDirectory()) throw new Error(`Not a directory: ${base}`);
  const parents = [path.join(base, '.agents'), path.join(base, '.agents', 'skills')];
  const target = path.join(parents[1], 'notchlore');
  const packageInfo = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  if (!/^(?:@[a-z0-9._-]+\/)?notchlore$/.test(packageInfo.name) || typeof packageInfo.version !== 'string') throw new Error('The package metadata is invalid.');
  const source = path.join(packageRoot, 'skills', 'notchlore');
  if (!await directory(source)) throw new Error('The packaged Notch Lore skill is missing.');
  const payload = await tree(source);
  if (!payload.files['SKILL.md'] || payload.files[RECEIPT]) throw new Error('The packaged Notch Lore skill is invalid.');
  const hashes = Object.fromEntries(Object.entries(payload.files).map(([name, file]) => [name, file.hash]));
  const action = await preflight(parents, target, hashes, update);
  const result = { ...action, target, version: packageInfo.version, fileCount: Object.keys(hashes).length, dryRun };
  if (dryRun || action.status === 'unchanged') return result;

  const created = [];
  const lockPath = path.join(parents[1], '.notchlore-install.lock');
  const stage = path.join(parents[0], `.notchlore-stage-${randomUUID()}`);
  let lock;
  let backup, committed = false;
  try {
    for (const parent of parents) {
      if (!await directory(parent)) {
        try { await fs.mkdir(parent); created.push(parent); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
        await directory(parent);
      }
    }
    try { lock = await fs.open(lockPath, 'wx', 0o600); }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error(`Another install is active, or its lock remains after interruption: ${lockPath}`);
      throw error;
    }
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + '\n');
    const fresh = await preflight(parents, target, hashes, update);
    if (fresh.status === 'unchanged') return { ...result, ...fresh };
    await fs.mkdir(stage, { mode: 0o755 });
    for (const [name, file] of Object.entries(payload.files)) {
      const destination = path.join(stage, ...name.split('/'));
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, file.bytes, { flag: 'wx', mode: file.mode });
    }
    await fs.writeFile(path.join(stage, RECEIPT), JSON.stringify({ format: 1, package: 'notchlore', version: packageInfo.version, files: hashes }, null, 2) + '\n', { flag: 'wx', mode: 0o644 });
    await preflight(parents, target, hashes, update);
    if (fresh.status === 'update') {
      backup = path.join(parents[0], `.notchlore-backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
      await fs.rename(target, backup);
    }
    try { await fs.rename(stage, target); }
    catch (error) {
      if (backup) {
        try { await fs.rename(backup, target); backup = undefined; }
        catch { throw new Error(`Installation failed and automatic restore could not complete. Previous skill is preserved at ${backup}. ${error.message}`); }
      }
      throw error;
    }
    committed = true;
    return { ...result, status: fresh.status === 'update' ? 'updated' : 'installed', ...(backup ? { backup } : {}) };
  } finally {
    await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
    if (lock) {
      await lock.close();
      await fs.unlink(lockPath).catch(() => {});
    }
    if (!committed) for (const parent of created.reverse()) await fs.rmdir(parent).catch(() => {});
  }
}
