#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installSkill } from '../lib/install.mjs';
import { inspectWorkspace } from '../lib/inspect.mjs';
import { exportPrompts, promptText } from '../lib/prompts.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HELP = `Notch Lore — project knowledge, precise fit, checked delivery.

Usage:
  notchlore install [--dir PATH | --global] [--dry-run] [--update] [--json]
  notchlore inspect [PATH] [--json]
  notchlore prompt base|1|2|3|chatgpt|codex|dot|guide
  notchlore export --mode 1|2|3 --dir NEW_DIRECTORY [--dry-run]
  notchlore score FILE [--root PATH] [--candidate ID] [--environment ID]
                  [--scope-revision ID] [--previous FILE] [--json]
  notchlore packet create --root PATH --spec FILE --out NEW.zip [--json]
  notchlore packet check FILE.zip [--root PATH] [--json]
  notchlore packet unpack FILE.zip --dir NEW_DIRECTORY [--root PATH] [--json]
  notchlore --version

install  Safely add the Codex skill to .agents/skills/notchlore.
inspect  Read-only workspace inventory; does not certify project completeness.
prompt   Print the shared ChatGPT prompt and selected mode (or just base/guide).
export   Write a ready-to-upload ChatGPT pack with one mode and shared references.
         Refuses to overwrite an existing directory.
score    Derive a structural scorecard from findings and verified evidence files.
         A structural PASS does not certify semantic correctness.
packet   Create/check/stage bounded ZIP transfers using Python 3 standard library.
         Review exclusions and contents; scanning is not a privacy guarantee.

Modes: 1 ChatGPT only; 2 ChatGPT + Codex; 3 ChatGPT + Codex + Dot.
No command launches Codex, creates a supervisor, or grants remote access.
Read GUIDE.md for the complete setup and end-to-end workflow.
`;

function parse(command, args) {
  const allowed = command === 'install'
    ? new Set(['--global', '--dir', '--dry-run', '--update', '--json'])
    : command === 'export'
      ? new Set(['--mode', '--dir', '--dry-run'])
      : command === 'score'
        ? new Set(['--root', '--candidate', '--environment', '--scope-revision', '--previous', '--json'])
      : new Set(['--json']);
  const result = { positional: [] };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('-')) {
      if (!allowed.has(arg) || seen.has(arg)) throw new Error(`Unknown or repeated option: ${arg}`);
      seen.add(arg);
      if (['--dir', '--mode', '--root', '--candidate', '--environment', '--scope-revision', '--previous'].includes(arg)) {
        if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error(`${arg} requires a value.`);
        result[arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = args[++i];
      } else {
        result[arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = true;
      }
    } else result.positional.push(arg);
  }
  if ((command === 'install' || command === 'export') && result.positional.length > 0) throw new Error('Unexpected positional arguments.');
  if (result.positional.length > 1) throw new Error('Too many positional arguments.');
  return result;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || (['--help', '-h', 'help'].includes(command) && !args.length)) return process.stdout.write(HELP);
  if (command === '--version' && !args.length) {
    const pkg = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
    return process.stdout.write(`${pkg.version}\n`);
  }
  if (['install', 'inspect', 'prompt', 'export', 'score', 'packet'].includes(command)
      && args.length === 1 && ['--help', '-h'].includes(args[0])) return process.stdout.write(HELP);
  if (command === 'prompt') {
    if (args.length !== 1) throw new Error('Choose prompt base, 1, 2, 3, or guide.');
    return process.stdout.write(await promptText(packageRoot, args[0]));
  }
  if (command === 'install') {
    const options = parse(command, args);
    const result = await installSkill({ packageRoot, ...options });
    if (options.json) return process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.stdout.write(`${result.dryRun ? 'Dry run: ' : ''}${result.status}: ${result.target}\n`);
    if (result.backup) process.stdout.write(`Previous skill: ${result.backup}\n`);
    if (!result.dryRun) process.stdout.write('Use $notchlore in Codex, from the project directory.\n');
    return;
  }
  if (command === 'inspect') {
    const options = parse(command, args), result = await inspectWorkspace(options.positional[0]);
    if (options.json) return process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.stdout.write(`Workspace: ${result.root}\nState: ${result.classification}\nCode: ${result.codeFiles}; docs: ${result.documentationFiles}; skipped symlinks: ${result.symlinksSkipped}\n`);
    for (const file of result.applicableInstructions) process.stdout.write(`Instructions: ${JSON.stringify(file)}\n`);
    for (const file of [...new Set([...result.skills, ...result.globalSkills])]) process.stdout.write(`Skill: ${JSON.stringify(file)}\n`);
    process.stdout.write(`Git: ${result.git.available ? (result.git.dirty ? `${result.git.changedEntries} changed entries` : 'clean') : result.git.reason}\n`);
    if (result.truncated) process.stdout.write('Inventory is truncated; inspect the relevant paths directly.\n');
    for (const warning of result.warnings) process.stdout.write(`Warning: ${warning}\n`);
    process.stdout.write(result.note + '\n');
    return;
  }
  if (command === 'export') {
    const options = parse(command, args);
    const result = await exportPrompts({ packageRoot, ...options });
    process.stdout.write(`${result.dryRun ? 'Dry run: would export' : 'Exported'} ${result.files} prompt files for mode ${result.mode} at ${result.target}\n`);
    return;
  }
  if (command === 'score') {
    const options = parse(command, args);
    if (options.positional.length !== 1) throw new Error('score requires an assessment JSON file.');
    const { readAssessment, renderScorecard } = await import('../lib/aperture.mjs');
    const file = path.resolve(options.positional[0]);
    const expectedBinding = {};
    for (const key of ['candidate', 'environment', 'scopeRevision']) {
      if (options[key] !== undefined) expectedBinding[key] = options[key];
    }
    const previousAssessment = options.previous ? JSON.parse(await fs.readFile(options.previous, 'utf8')) : undefined;
    const result = await readAssessment(file, { root: path.resolve(options.root ?? path.dirname(file)), expectedBinding, previousAssessment });
    process.stdout.write(options.json ? JSON.stringify(result, null, 2) + '\n' : renderScorecard(result));
    if (result.structuralStatus !== 'PASS') process.exitCode = 1;
    else if (result.readiness !== 'PASS') process.exitCode = 2;
    return;
  }
  if (command === 'packet') {
    const { runPacket } = await import('../lib/packet.mjs');
    const result = await runPacket(args);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }
  throw new Error(`Unknown command: ${command}. Run notchlore --help.`);
}

try { await main(); }
catch (error) {
  if (process.argv.includes('--json')) process.stderr.write(JSON.stringify({ error: error.message }) + '\n');
  else process.stderr.write(`notchlore: ${error.message}\n`);
  process.exitCode = 1;
}
