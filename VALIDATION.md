# Notch Lore 2.0.0 validation

## Documentation handoff · 25 November 2026

A local Linux checkout based on `7cd5d16` with the revised README, guide and walkthroughs passed all 75 tests and the package checks. The release build completed on Node.js 24.22.3, npm 11.19.1 and Python 3.12.14. All five resulting archives matched the generated checksum list. The local source candidate was `sha256:e1c8cdf6683c8444bf696cddc24fe2356f347fad823c0ca4164da5f2c85bc1ce`.

This run covered the CLI and packaged documentation. Live ChatGPT, native Codex and Dot sessions still need separate evidence.

## Earlier GitHub documentation update

The pinned npm command installed the published 2.0.0 skill in a disposable project. The source manifest and the three tracked ChatGPT ZIPs were regenerated from the revised GitHub source. The full local build reported a failure in `test/cli.test.mjs` during its unit-test step. The ignored tarball, source bundle and outer checksum list in this workspace belong to the earlier build. The optional offline smoke suite was skipped for this update.

## Earlier release candidate

Local checks for the earlier release candidate ran on Linux x86-64 with Python 3.12.3. The unit suite passed all 75 tests on Node.js 22.22.3 and 24.1.0. The package and generated-summary checks passed on both. The release build used Node.js 24.1.0 and npm 11.5.1.

| Check | Coverage |
| --- | --- |
| `npm test` | Project and user installation, updates, protected files, inspection, prompts, exports, scoring and packet handling |
| `npm run check` | npm payload allowlist and size, portable skill structure, license consistency, local links, starter lengths and generated summary |
| `npm run release` | npm tarball, three mode packs with per-file manifests, bundled source ZIP and SHA-256 lists |

The SHA-256 list in `dist/SHA256SUMS` covers the five generated archives. The separate offline installation and clean-rebuild smoke suite was skipped for this candidate.

Native Codex discovery, execution and session recovery, live ChatGPT and Dot workflows, user behavior, performance qualification, macOS, Windows and hosted GitHub Actions were outside this local run. Production qualification remains open.
