# Publish Notch Lore 2.0.0

The package, executable and skill use the name `notchlore`. The release uses the MIT license. Keep the copyright and permission notice with distributed copies. The local installer works directly from the release tarball.

## Build and verify

From the repository root, with Node.js 22 or later, npm, Python 3 and Git available:

```sh
npm run release
python3 scripts/smoke-release.py --rebuild
(cd dist && sha256sum -c SHA256SUMS)
npm pack --dry-run
```

The build runs the tests and package checks, builds the npm tarball, exports the three ChatGPT ZIPs and bundles them with the source in `dist/notchlore-2.0.0.zip`. The outer checksum list covers all five archives. The source ZIP carries a second list for its four bundled artifacts. Use `shasum -a 256 -c SHA256SUMS` in `dist/` on macOS.

Only the three ChatGPT mode ZIPs are tracked under `dist/`. The README links point directly to those files. A clone can regenerate the local npm installer with `npm run release`. The full release ZIP already contains it.

## First GitHub release

Review the staged files and the local results in the repository's VALIDATION.md. Once the release is approved, create the first commit. Create an empty public repository in the intended GitHub account and use its actual URL for the remote.

```sh
git diff --cached --stat
git commit -m "Release Notch Lore 2.0.0"
git remote add origin <github-repository-url>
git push -u origin main
```

After reviewing the GitHub Actions results for that commit, tag it and upload the exact verified files:

```sh
git tag -a v2.0.0 -m "Notch Lore 2.0.0"
git push origin v2.0.0
gh release create v2.0.0 --verify-tag --title "Notch Lore 2.0.0" --generate-notes dist/notchlore-2.0.0.zip dist/notchlore-2.0.0.tgz dist/notchlore-chatgpt*.zip dist/SHA256SUMS
```

Replace the remote placeholder before running the command. Users who need the offline installer should download the uploaded Notch Lore source ZIP or tarball.

## Optional npm publication

Registry publication is a separate release decision. Confirm the package name and intended account. If you change metadata, including repository links or package scope, rebuild and recheck the resulting archives before publishing them.

```sh
npm whoami
npm view notchlore version
npm publish ./dist/notchlore-2.0.0.tgz --dry-run --ignore-scripts
```

When authorized, publish the exact checked tarball with `npm publish ./dist/notchlore-2.0.0.tgz --access public`. Verify the published version and integrity before sharing registry install instructions.

## Use a pinned GitHub revision

Use the full published commit ID for `prompts/BASE.md`, the chosen adapter in `prompts/`, `package.json`, `GUIDE.md`, `skills/notchlore/SKILL.md` and its references. Ask the assistant to confirm the version, mode and files it could read. If the repository is inaccessible, attach the matching complete mode ZIP. Supply project documents separately.
