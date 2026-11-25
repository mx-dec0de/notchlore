# Notch Lore 2.0.0 validation

Local checks for the first public release candidate ran on Linux x86-64 with Python 3.12.3. The unit suite passed all 75 tests on Node.js 22.22.3 and 24.1.0. The package and generated-summary checks passed on both. The release build used Node.js 24.1.0 and npm 11.5.1.

| Check | Coverage |
| --- | --- |
| `npm test` | Project and user installation, updates, protected files, inspection, prompts, exports, scoring and packet handling |
| `npm run check` | npm payload allowlist and size, portable skill structure, license consistency, local links, starter lengths and generated summary |
| `npm run release` | npm tarball, three mode packs with per-file manifests, bundled source ZIP and SHA-256 lists |

The SHA-256 list in `dist/SHA256SUMS` covers the five generated archives. The separate offline installation and clean-rebuild smoke suite was skipped for this candidate.

Native Codex discovery, execution and session recovery, live ChatGPT and Dot workflows, user behavior, performance qualification, macOS, Windows and hosted GitHub Actions were outside this local run. Production qualification remains open.
