# Notch Lore distribution

The npm account `resultity` published `notchlore@2.0.0`. The pinned install command in the guide uses that registry artifact. The revised documentation, repository links and rebuilt ChatGPT packs are part of the GitHub source. A local build still carries version 2.0.0 and produces a separate tarball. [Published package](https://www.npmjs.com/package/notchlore/v/2.0.0) · [GitHub repository](https://github.com/mx-dec0de/notchlore)

## Build from the GitHub source

Run the local build from the repository root with Node.js 22 or newer, npm, Python 3 and Git:

```sh
npm run release
```

The build runs the unit tests and package checks, refreshes `SOURCE_MANIFEST.json`, and writes five archives to `dist/`. Each ChatGPT pack embeds the guide, this document, package metadata and the selected mode instructions. Rebuild after changing any of those inputs.

| Build output in `dist/` | Distribution |
| --- | --- |
| `notchlore-chatgpt-2.0.0.zip`, `notchlore-chatgpt-codex-2.0.0.zip`, `notchlore-chatgpt-codex-dot-2.0.0.zip` | Track all three in Git so readers can download them from the README. |
| `notchlore-2.0.0.tgz` | Local installer built from this checkout. See the local tarball alternative in GUIDE.md. |
| `notchlore-2.0.0.zip` | Local source bundle containing the tarball, three packs and their checksums. |
| `SHA256SUMS` | Local SHA-256 list for the five archives. |

For an offline installation test and a byte-for-byte rebuild in a disposable workspace, run `python3 scripts/smoke-release.py --rebuild`. To verify the archive checksums, run `sha256sum -c SHA256SUMS` from `dist/` (on macOS, `shasum -a 256 -c SHA256SUMS`).

## Review the GitHub update

Review the source diff, refreshed manifest and three tracked ZIPs together. Keep local agent state, editor settings, reports, the tarball, the source bundle and the outer checksum list out of the commit. Preserve the MIT copyright and permission notices in all distributed copies.

After the maintainer pushes the reviewed commit, each README download link opens a tracked ZIP on GitHub. Readers can use **Download raw file** there. The npm install command continues to resolve to the original published tarball. Publishing changed package contents to npm would require a new version.

## Use a pinned GitHub revision

Use the full published commit ID for `prompts/BASE.md`, the chosen adapter in `prompts/`, `package.json`, `GUIDE.md`, `skills/notchlore/SKILL.md` and its references. Ask the assistant to confirm the version, mode and files it could read. If the repository is inaccessible, attach the matching complete mode ZIP. Supply project documents separately.
