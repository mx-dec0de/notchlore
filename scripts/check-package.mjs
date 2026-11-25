import { lstat, readFile, readdir } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const expectedRoots = ['bin', 'lib', 'skills', 'prompts', 'schemas', 'examples', 'GUIDE.md', 'PUBLICATION.md'];
const promptNames = ['BASE.md', '01_chatgpt/CHATGPT_ONLY.md', '02_chatgpt_codex/CHATGPT_CODEX.md', '03_chatgpt_codex_dot/DOT.md'];
const referenceNames = ['CONVERSATION.md', 'METHOD.md', 'CONTEXT.md', 'SYSTEM.md', 'HANDOFF.md', 'CODEX.md', 'aperture-rules.json'];
const allowedExtensions = new Set(['.mjs', '.md', '.yaml', '.json', '.py', '.txt']);

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

async function filesBelow(path) {
  const stat = await lstat(path);
  requireValue(!stat.isSymbolicLink(), `Symlink in package: ${relative(root, path)}`);
  if (stat.isFile()) return [{ path, size: stat.size }];
  requireValue(stat.isDirectory(), `Unsupported file: ${relative(root, path)}`);
  const entries = await readdir(path);
  const files = [];
  for (const name of entries.sort()) {
    if (path === join(root, 'lib') && ['__pycache__', '.npmignore'].includes(name)) continue;
    files.push(...await filesBelow(join(path, name)));
  }
  return files;
}

try {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  requireValue(/^(?:@[a-z0-9._-]+\/)?notchlore$/.test(pkg.name), 'Use notchlore or an owned scope ending in /notchlore.');
  requireValue(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(pkg.version), 'Package version must be explicit.');
  requireValue(pkg.type === 'module' && pkg.engines?.node === '>=22', 'Expected ESM and Node >=22.');
  requireValue(pkg.bin?.notchlore === 'bin/notchlore.mjs', 'Missing notchlore executable.');
  requireValue(JSON.stringify(pkg.files) === JSON.stringify(expectedRoots), 'Keep the npm files allowlist explicit.');
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    requireValue(!pkg[key] || Object.keys(pkg[key]).length === 0, `Unexpected ${key}.`);
  }
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) {
    requireValue(!pkg.scripts?.[hook], `Unexpected lifecycle hook: ${hook}`);
  }
  const entry = await readFile(join(root, pkg.bin.notchlore), 'utf8');
  requireValue(entry.startsWith('#!/usr/bin/env node\n'), 'Executable needs a portable Node shebang and LF line endings.');

  const payload = [];
  for (const item of [...expectedRoots, 'package.json', 'README.md', 'LICENSE']) {
    payload.push(...await filesBelow(join(root, item)));
  }
  requireValue(payload.length <= 80, 'Package contains more than 80 payload files.');
  const bytes = payload.reduce((sum, file) => sum + file.size, 0);
  requireValue(bytes <= 500_000, `Package payload exceeds 500 KB: ${bytes} bytes.`);
  for (const file of payload) {
    const rel = relative(root, file.path);
    requireValue(!rel.split(sep).some(part => part.startsWith('.')), `Hidden package payload: ${rel}`);
    requireValue(rel === 'LICENSE' || allowedExtensions.has(extname(rel)), `Unexpected package format: ${rel}`);
  }

  const notice = await readFile(join(root, 'LICENSE'));
  requireValue(notice.equals(await readFile(join(root, 'skills', 'notchlore', 'LICENSE.txt'))),
    'Keep the distributed skill and prompt-pack notice identical to LICENSE.');
  const skillPath = join(root, 'skills', 'notchlore', 'SKILL.md');
  const skill = await readFile(skillPath, 'utf8');
  const frontmatter = skill.match(/^---\r?\n([\s\S]+?)\r?\n---\r?\n/);
  requireValue(frontmatter, 'SKILL.md must begin with YAML frontmatter.');
  requireValue(/^name:\s*notchlore\s*$/m.test(frontmatter[1]), 'Skill name must be notchlore.');
  requireValue(/^description:\s*\S.+/m.test(frontmatter[1]), 'Skill description is required.');
  requireValue(skill.split('\n').length <= 220, 'Keep SKILL.md under 220 lines; move details to references.');
  requireValue(Buffer.byteLength(skill) <= 18_000, 'Keep SKILL.md under 18 KB.');
  for (const file of payload.filter(item => item.path.endsWith('.md'))) {
    const markdown = await readFile(file.path, 'utf8');
    for (const match of markdown.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      const target = match[1];
      if (/^(?:[a-z]+:|#)/i.test(target)) continue;
      const local = target.split('#')[0];
      if (!local) continue;
      const path = resolve(dirname(file.path), local);
      const rel = relative(root, path);
      requireValue(!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`), `Reference leaves package: ${target}`);
      await lstat(path);
      if (file.path.startsWith(join(root, 'skills', 'notchlore') + sep)) {
        const skillRelative = relative(join(root, 'skills', 'notchlore'), path);
        requireValue(!isAbsolute(skillRelative) && skillRelative !== '..' && !skillRelative.startsWith(`..${sep}`),
          `Installed skill reference leaves its payload: ${target}`);
      }
    }
  }
  for (const name of promptNames) {
    const content = await readFile(join(root, 'prompts', name), 'utf8');
    requireValue(content.trim().length >= 100, `Prompt is empty or incomplete: ${name}`);
  }
  const guide = await readFile(join(root, 'GUIDE.md'), 'utf8');
  requireValue(guide.includes('Codex') && guide.includes('ChatGPT') && guide.includes('Dot'), 'Guide must explain all three arrangements.');
  const referenceDir = join(root, 'skills', 'notchlore', 'references');
  requireValue(JSON.stringify((await readdir(referenceDir)).sort()) === JSON.stringify([...referenceNames].sort()),
    'Keep six canonical prose references plus one machine scoring policy inside the installable skill.');
  for (const name of referenceNames) {
    requireValue((await readFile(join(referenceDir, name), 'utf8')).trim().length >= 100, `Empty reference: ${name}`);
  }
  requireValue(!(await readdir(join(root, 'prompts'))).includes('references'), 'Do not maintain a second copy of the protocol.');
  requireValue(!(await readdir(join(root, 'prompts'))).some(name => ['chatgpt.md', 'shape.md', 'task.md', 'review.md', 'resume.md'].includes(name)),
    'Do not duplicate old prompt entry points.');
  await readFile(join(root, 'skills', 'notchlore', 'agents', 'openai.yaml'), 'utf8');
  for (const file of payload.filter(item => item.path.endsWith('.md'))) {
    const markdown = await readFile(file.path, 'utf8');
    for (const match of markdown.matchAll(/```text\s*\n([\s\S]*?)\n```/g)) {
      const starter = match[1].trim();
      requireValue([...starter].length <= 200, `Copied starter exceeds 200 characters in ${relative(root, file.path)}.`);
    }
  }
  console.log(`Package structure passed: ${payload.length} files, ${bytes} bytes. Semantic quality requires review and execution evidence.`);
} catch (error) {
  console.error(`Package check failed: ${error.message}`);
  process.exitCode = 1;
}
