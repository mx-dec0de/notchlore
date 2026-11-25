import * as fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';

const run = promisify(execFile);
const SKIP = new Set(['.git', '.svn', 'node_modules', '.venv', 'venv', 'dist', 'build', 'target', 'coverage', '.cache', '.next']);
const CODE = /\.(?:[cm]?[jt]sx?|py|rs|go|java|kt|swift|c|cc|cpp|h|hpp|cs|rb|php|sh|bash|ps1|bat|cmd|sql|html|css|vue|svelte)$/i;
const MANIFEST = /^(?:package\.json|pyproject\.toml|Cargo\.toml|go\.mod|Makefile|CMakeLists\.txt|Dockerfile|requirements\.txt)$/;
const DOC = /\.(?:md|mdx|rst|adoc|txt)$/i;

async function regular(file) {
  try { const stat = await fs.lstat(file); return stat.isFile() && !stat.isSymbolicLink(); }
  catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) return false; throw error; }
}

async function gitInfo(root) {
  const options = { encoding: 'utf8', timeout: 5000, maxBuffer: 512 * 1024, windowsHide: true,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } };
  const args = ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'submodule.recurse=false', '-C', root];
  try {
    const { stdout } = await run('git', [...args, 'rev-parse', '--show-toplevel'], options);
    const gitRoot = stdout.trim();
    let configuredFilters = '';
    try {
      ({ stdout: configuredFilters } = await run('git', [...args, 'config', '--null', '--name-only', '--get-regexp', '^filter\\..*\\.(clean|process|required)$'], options));
    } catch (error) { if (error.code !== 1) throw error; }
    const filterOverrides = [];
    for (const key of new Set(configuredFilters.split('\0').filter(Boolean))) {
      if (!/^filter\..+\.(?:clean|process|required)$/i.test(key)) throw new Error('Unexpected filter configuration key.');
      filterOverrides.push('-c', `${key}=${/\.required$/i.test(key) ? 'false' : ''}`);
    }
    const { stdout: changes } = await run('git', [...args, ...filterOverrides, 'status', '--porcelain=v1', '-z', '--untracked-files=normal', '--ignore-submodules=all'], options);
    const fields = changes.split('\0').filter(Boolean), entries = [];
    for (let i = 0; i < fields.length; i++) {
      const value = fields[i];
      const entry = { status: value.slice(0, 2), path: value.slice(3) };
      if (/[RC]/.test(entry.status)) entry.from = fields[++i];
      entries.push(entry);
    }
    return { available: true, root: gitRoot, dirty: entries.length > 0, changedEntries: entries.length, changes: entries.slice(0, 20) };
  } catch (error) {
    return { available: false, reason: error.code === 'ENOENT' ? 'git-unavailable' : error.code === 128 ? 'not-a-git-repository' : 'git-inspection-failed' };
  }
}

async function skillPaths(parent, inventory, limit = 30) {
  try {
    const container = await fs.lstat(path.dirname(parent));
    if (!container.isDirectory() || container.isSymbolicLink()) return [];
    const stat = await fs.lstat(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return [];
    const found = [], handle = await fs.opendir(parent);
    let scanned = 0;
    for await (const entry of handle) {
      if (++scanned > 4000 || found.length >= limit) { inventory.truncated = true; break; }
      const dir = path.join(parent, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink() && await regular(path.join(dir, 'SKILL.md'))) found.push(path.join(dir, 'SKILL.md'));
    }
    return found.sort();
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) return [];
    if (['EACCES', 'EPERM'].includes(error.code)) { inventory.warnings.push(`Could not inspect skills at ${parent}`); return []; }
    throw error;
  }
}

export async function inspectWorkspace(input = process.cwd()) {
  const root = await fs.realpath(input);
  if (!(await fs.stat(root)).isDirectory()) throw new Error(`Not a directory: ${root}`);
  const inventory = { scannedEntries: 0, codeFiles: 0, documentationFiles: 0, otherFiles: 0, symlinksSkipped: 0,
    truncated: false, code: [], documentation: [], localInstructions: [], warnings: [] };
  const maxEntries = 4000, maxDepth = 6;
  async function walk(dir, depth = 0) {
    const handle = await fs.opendir(dir);
    for await (const entry of handle) {
      if (inventory.scannedEntries >= maxEntries) { inventory.truncated = true; break; }
      inventory.scannedEntries++;
      const full = path.join(dir, entry.name), relative = path.relative(root, full);
      if (entry.isSymbolicLink()) { inventory.symlinksSkipped++; continue; }
      if (entry.isDirectory()) {
        if (SKIP.has(entry.name) || /^\.notchlore-(?:stage|backup)-/.test(entry.name)) continue;
        if (depth >= maxDepth) { inventory.truncated = true; continue; }
        try { await walk(full, depth + 1); }
        catch (error) { if (['EACCES', 'EPERM', 'ENOENT'].includes(error.code)) inventory.warnings.push(`Could not inspect ${relative}`); else throw error; }
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name === 'AGENTS.md' || entry.name === 'AGENTS.override.md') inventory.localInstructions.push(relative);
      else if (entry.name === 'SKILL.md' || relative.split(path.sep).includes('.agents')) continue;
      else if (CODE.test(entry.name) || MANIFEST.test(entry.name)) {
        inventory.codeFiles++;
        if (inventory.code.length < 20) inventory.code.push(relative);
      } else if (DOC.test(entry.name)) {
        inventory.documentationFiles++;
        if (inventory.documentation.length < 30) inventory.documentation.push(relative);
      } else inventory.otherFiles++;
    }
  }
  await walk(root);
  const git = await gitInfo(root), instructions = [], skills = [];
  let cursor = root;
  while (true) {
    for (const name of ['AGENTS.override.md', 'AGENTS.md']) {
      const file = path.join(cursor, name);
      if (await regular(file)) instructions.push(file);
    }
    skills.push(...await skillPaths(path.join(cursor, '.agents', 'skills'), inventory));
    if (cursor === git.root || path.dirname(cursor) === cursor) break;
    cursor = path.dirname(cursor);
  }
  const globalSkills = await skillPaths(path.join(homedir(), '.agents', 'skills'), inventory);
  const classification = inventory.codeFiles ? (inventory.documentationFiles ? 'code-and-docs' : 'code-only')
    : inventory.documentationFiles ? 'docs-only' : inventory.otherFiles ? 'other-files' : 'empty';
  return { root, classification, documentationSufficiency: 'not-assessed',
    note: 'This is a bounded file inventory. Read the applicable instructions and assess documentation against the actual task.',
    ...inventory, applicableInstructions: [...new Set(instructions)], skills: [...new Set(skills)], globalSkills, git };
}
