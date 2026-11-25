import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function summarize(markdown) {
  const sections = markdown.split(/(?=^## )/m);
  const names = ['Overview', 'Now, next and later', 'Release status'];
  const selected = names.map(name => {
    const section = sections.find(text => text.startsWith(`## ${name}\n`));
    if (!section) throw new Error(`Missing canonical project section: ${name}`);
    return section.trim();
  });
  return '# Notch Lore 2.0.0 — summary\n\nGenerated from PROJECT.md; edit its authoritative sections, then run npm run docs.\n\n' + selected.join('\n\n') + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = summarize(await readFile(path.join(root, 'PROJECT.md'), 'utf8'));
  if (process.argv.includes('--check')) {
    if (result !== await readFile(path.join(root, 'SUMMARY.md'), 'utf8')) throw new Error('SUMMARY.md is stale; run npm run docs.');
  } else await writeFile(path.join(root, 'SUMMARY.md'), result);
}
