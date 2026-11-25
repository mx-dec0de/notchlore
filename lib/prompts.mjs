import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const modeFiles = Object.freeze({
  chatgpt: '01_chatgpt/CHATGPT_ONLY.md',
  codex: '02_chatgpt_codex/CHATGPT_CODEX.md',
  dot: '03_chatgpt_codex_dot/DOT.md',
});

export const referenceFiles = Object.freeze([
  'CONVERSATION.md', 'METHOD.md', 'CONTEXT.md', 'SYSTEM.md', 'HANDOFF.md', 'CODEX.md', 'aperture-rules.json',
]);
const referenceRoot = 'skills/notchlore/references';
export const aliases = Object.freeze({ '1': 'chatgpt', '2': 'codex', '3': 'dot' });

export function resolveMode(name) {
  const mode = aliases[name] ?? name;
  if (!Object.hasOwn(modeFiles, mode)) {
    throw new Error('Choose mode 1 (chatgpt), 2 (codex), or 3 (dot).');
  }
  return mode;
}

export async function promptText(packageRoot, selection) {
  if (selection === 'base') return fs.readFile(path.join(packageRoot, 'prompts', 'BASE.md'), 'utf8');
  if (selection === 'guide') return fs.readFile(path.join(packageRoot, 'GUIDE.md'), 'utf8');
  const referencePrompts = { shape: 'SYSTEM.md', task: 'HANDOFF.md', review: 'METHOD.md', resume: 'CONTEXT.md' };
  if (Object.hasOwn(referencePrompts, selection)) {
    return fs.readFile(path.join(packageRoot, referenceRoot, referencePrompts[selection]), 'utf8');
  }
  const mode = resolveMode(selection);
  const [base, specific] = await Promise.all([
    fs.readFile(path.join(packageRoot, 'prompts', 'BASE.md'), 'utf8'),
    fs.readFile(path.join(packageRoot, 'prompts', modeFiles[mode]), 'utf8'),
  ]);
  return `# Notch Lore — ${mode} mode\n\nUse this entry with the six accompanying documents in skills/notchlore/references/. Export a complete upload pack with notchlore export; this printed entry alone omits the shared protocol.\n\n${base.trim()}\n\n---\n\n${specific.trim()}\n`;
}

export function starterText(mode) {
  const names = { chatgpt: 'ChatGPT', codex: 'ChatGPT + Codex', dot: 'ChatGPT + Codex + Dot' };
  return `notchlore. Use the attached pack in ${names[resolveMode(mode)]} mode. My business goal is: [goal]. Propose the solution, develop the documents, and guide the next useful step.`;
}

async function sourceFiles(packageRoot, mode) {
  const relative = [
    'package.json', 'GUIDE.md', 'PUBLICATION.md', 'prompts/BASE.md', 'skills/notchlore/SKILL.md', 'skills/notchlore/LICENSE.txt',
    ...referenceFiles.map(file => `${referenceRoot}/${file}`),
    `prompts/${modeFiles[mode]}`,
  ];
  for (const directory of ['schemas', 'examples']) {
    async function collect(prefix) {
      for (const entry of (await fs.readdir(path.join(packageRoot, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isSymbolicLink()) throw new Error(`Linked prompt source: ${prefix}/${entry.name}`);
        if (entry.isDirectory()) await collect(`${prefix}/${entry.name}`);
        else if (entry.isFile()) relative.push(`${prefix}/${entry.name}`);
        else throw new Error(`Unsupported prompt source: ${prefix}/${entry.name}`);
      }
    }
    await collect(directory);
  }
  const files = [];
  for (const name of relative) {
    const source = path.join(packageRoot, name);
    const stat = await fs.lstat(source);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Invalid prompt source: ${name}`);
    files.push({ name, content: await fs.readFile(source) });
  }
  const prompt = starterText(mode);
  if ([...prompt].length > 200) throw new Error('Starter prompt exceeds 200 characters.');
  files.push({ name: 'START.md', content: `# Start Notch Lore\n\nMode: ${mode}\n\n1. Attach this whole ZIP to a new ChatGPT chat. If ZIP reading is unavailable, extract it and attach its Markdown files.\n2. Send this, replacing [goal] with what you want to achieve:\n\n\`\`\`text\n${prompt}\n\`\`\`\n\nYou can also send \"notchlore\" or describe your goal naturally. Include existing project documents or a sanitized source dump when available; an idea alone is enough to begin.\n\nThe assistant develops a proposal and current documents, asks only consequential business or product questions, and proceeds in the selected mode. This archive supplies the approach, not your application code.\n\nRead [GUIDE.md](GUIDE.md) for file transfer and continuation. The skill file is included as a reference; uploading this pack does not install it in Codex or connect Dot to a VPS.\n` });
  const pkg = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  const start = files.find(file => file.name === 'START.md');
  start.content = start.content.replace(`Mode: ${mode}\n`, `Version: ${pkg.version}\nMode: ${mode}\nIntegrity: PACK_MANIFEST.json records every supplied file. Verify before importing project-specific instructions.\n`);
  const hashes = Object.fromEntries(files.map(file => [file.name, createHash('sha256').update(file.content).digest('hex')]).sort(([a], [b]) => a.localeCompare(b)));
  const manifest = { schemaVersion: 1, package: pkg.name, version: pkg.version, mode,
    sourceIdentity: 'sha256:' + createHash('sha256').update(JSON.stringify(hashes)).digest('hex'), files: hashes,
    limitation: 'Hashes establish the supplied bytes, not semantic truth or project-specific authority.' };
  files.push({ name: 'PACK_MANIFEST.json', content: JSON.stringify(manifest, null, 2) + '\n' });
  return files;
}

export async function exportPrompts({ packageRoot, dir, mode, dryRun = false }) {
  const resolvedMode = resolveMode(mode);
  if (!dir) throw new Error('Specify --dir for a new prompt-pack destination.');
  const target = path.resolve(dir);
  const files = await sourceFiles(packageRoot, resolvedMode);
  try {
    await fs.lstat(target);
    throw new Error(`Destination already exists; choose a new directory: ${target}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const parent = await fs.realpath(path.dirname(target));
  const safeTarget = path.join(parent, path.basename(target));
  const result = { mode: resolvedMode, target: safeTarget, files: files.length, dryRun };
  if (dryRun) return result;

  // Exclusive creation reserves the destination even when exporters race.
  try {
    await fs.mkdir(safeTarget, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Destination already exists; choose a new directory: ${safeTarget}`);
    throw error;
  }
  try {
    for (const { name, content } of files) {
      const to = path.join(safeTarget, name);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.writeFile(to, content, { flag: 'wx' });
    }
  } catch (error) {
    // Keep a partial export for inspection; never delete somebody else's new file.
    throw new Error(`Export incomplete at ${safeTarget}: ${error.message}. Choose a new directory after checking this one.`);
  }
  return result;
}
