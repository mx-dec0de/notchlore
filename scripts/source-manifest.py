#!/usr/bin/env python3
"""Record the deterministic code/method candidate without recursive report hashes."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIRECTORIES = ("bin", "lib", "skills", "prompts", "schemas", "examples", "test", "scripts", ".github")
FILES = ("package.json", "LICENSE", ".gitignore", ".gitattributes", "README.md", "GUIDE.md", "PUBLICATION.md", "PROJECT.md", "CHANGELOG.md", "RELEASE_SCOPE.md")


def main():
    paths = [ROOT / name for name in FILES]
    for directory in DIRECTORIES:
        paths.extend(p for p in (ROOT / directory).rglob("*") if p.is_file() and "__pycache__" not in p.parts)
    entries = {}
    for file in sorted(set(paths)):
        if file.is_symlink():
            raise SystemExit("Linked source is not permitted")
        entries[file.relative_to(ROOT).as_posix()] = hashlib.sha256(file.read_bytes()).hexdigest()
    canonical = json.dumps(entries, sort_keys=True, separators=(",", ":")).encode()
    result = {"schemaVersion": 1, "candidate": "sha256:" + hashlib.sha256(canonical).hexdigest(), "files": entries,
              "boundary": "Maintained executable, method, schemas, examples, tests, release tools and named product documents. VALIDATION, SUMMARY, generated distributions and this manifest are excluded to avoid recursive report hashes. Final archives have separate SHA-256 checksums."}
    (ROOT / "SOURCE_MANIFEST.json").write_text(json.dumps(result, indent=2) + "\n")
    print(result["candidate"])


if __name__ == "__main__":
    main()
