#!/usr/bin/env python3
"""Build the npm tarball and complete ChatGPT packs from one source tree."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
FIXED_DATE = (2020, 1, 1, 0, 0, 0)
SOURCE_DIRS = ("bin", "lib", "skills", "prompts", "scripts", "test", ".github", "schemas", "examples")
SOURCE_FILES = ("package.json", "LICENSE", ".gitignore", ".gitattributes", "README.md", "GUIDE.md", "VALIDATION.md", "PUBLICATION.md", "PROJECT.md", "SUMMARY.md", "RELEASE_SCOPE.md", "CHANGELOG.md", "SOURCE_MANIFEST.json")
MODE_NAMES = {
    "1": "chatgpt",
    "2": "chatgpt-codex",
    "3": "chatgpt-codex-dot",
}


def command(executable: str, args: list[str], *, capture: bool = False) -> str:
    resolved = shutil.which(executable)
    if not resolved:
        raise RuntimeError(f"Required release tool is missing: {executable}")
    result = subprocess.run(
        [resolved, *args], cwd=ROOT, check=True, text=True,
        stdout=subprocess.PIPE if capture else None,
        shell=os.name == "nt" and resolved.lower().endswith((".cmd", ".bat")),
    )
    return result.stdout or ""


def regular_files(directory: Path) -> list[Path]:
    result = []
    for entry in sorted(directory.rglob("*")):
        if any(part in {"__pycache__", "node_modules", ".git"} for part in entry.relative_to(directory).parts):
            continue
        if entry.is_symlink():
            raise RuntimeError(f"Release input is a symlink: {entry.relative_to(ROOT)}")
        if entry.is_file():
            result.append(entry)
        elif not entry.is_dir():
            raise RuntimeError(f"Unsupported release input: {entry}")
    return result


def write_zip(destination: Path, entries: list[tuple[str, Path]]) -> None:
    names = set()
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, source in sorted(entries):
            if source.is_symlink() or not source.is_file():
                raise RuntimeError(f"Release input must be a regular file: {source}")
            parts = name.split("/")
            if name in names or name.startswith("/") or ".." in parts or "\\" in name:
                raise RuntimeError(f"Unsafe or repeated archive path: {name}")
            names.add(name)
            info = zipfile.ZipInfo(name, FIXED_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            mode = 0o755 if name.endswith("/bin/notchlore.mjs") else 0o644
            info.external_attr = (0o100000 | mode) << 16
            archive.writestr(info, source.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    with zipfile.ZipFile(destination) as archive:
        bad = archive.testzip()
        if bad:
            raise RuntimeError(f"Corrupt archive member: {bad}")


def main() -> None:
    package = json.loads((ROOT / "package.json").read_text())
    version = package["version"]
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[\w.-]+)?", version):
        raise RuntimeError("Invalid package version")
    command("npm", ["test"])
    command("npm", ["run", "check"])
    command("python3", ["scripts/source-manifest.py"])
    DIST.mkdir(exist_ok=True)
    if DIST.is_symlink():
        raise RuntimeError("dist must be a real directory")

    with tempfile.TemporaryDirectory(prefix="notchlore-release-") as tmp:
        stage = Path(tmp)
        packed = json.loads(command("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", str(stage)], capture=True))
        if len(packed) != 1:
            raise RuntimeError("Expected one npm package")
        tarball = stage / f"notchlore-{version}.tgz"
        produced = stage / packed[0]["filename"]
        if produced != tarball:
            produced.rename(tarball)
        with tarfile.open(tarball, "r:gz") as archive:
            names = set()
            for item in archive.getmembers():
                if not item.isfile() or not item.name.startswith("package/") or ".." in item.name.split("/") or item.name in names:
                    raise RuntimeError(f"Unexpected npm member: {item.name}")
                names.add(item.name)
                relative = item.name.removeprefix("package/")
                if "__pycache__" in relative.split("/") or relative.endswith(".pyc"):
                    raise RuntimeError("Generated Python cache leaked into npm payload")
                source = ROOT / relative
                if source.is_symlink() or not source.is_file() or archive.extractfile(item).read() != source.read_bytes():
                    raise RuntimeError(f"npm member differs from maintained source: {relative}")
            packed_package = json.load(archive.extractfile("package/package.json"))
            if packed_package["version"] != version:
                raise RuntimeError("npm package version mismatch")

        generated = [tarball]
        for alias, name in MODE_NAMES.items():
            export = stage / name
            command("node", ["bin/notchlore.mjs", "export", "--mode", alias, "--dir", str(export)])
            files = regular_files(export)
            if not files or any(file.suffix not in {".md", ".json", ".txt"} for file in files):
                raise RuntimeError("A ChatGPT pack must contain only portable Markdown/JSON/text records")
            archive = stage / f"notchlore-{name}-{version}.zip"
            write_zip(archive, [(file.relative_to(export).as_posix(), file) for file in files])
            generated.append(archive)

        sources = [ROOT / name for name in SOURCE_FILES]
        for directory in SOURCE_DIRS:
            sources.extend(regular_files(ROOT / directory))
        entries = [("notchlore/" + file.relative_to(ROOT).as_posix(), file) for file in sources]
        entries.extend((f"notchlore/dist/{file.name}", file) for file in generated)
        inner_sums = stage / "SHA256SUMS"
        inner_sums.write_text("".join(f"{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.name}\n" for file in generated))
        entries.append(("notchlore/dist/SHA256SUMS", inner_sums))
        release = stage / f"notchlore-{version}.zip"
        write_zip(release, entries)
        generated.append(release)

        # Build every artifact successfully before replacing generated outputs.
        for file in generated:
            destination = DIST / file.name
            if destination.is_symlink():
                raise RuntimeError(f"Refusing linked release output: {destination}")
            shutil.copyfile(file, destination)
        for file in generated:
            destination = DIST / file.name
            print(f"{destination.name}: {destination.stat().st_size} bytes; sha256 {hashlib.sha256(destination.read_bytes()).hexdigest()}")
        sums = "".join(f"{hashlib.sha256((DIST / file.name).read_bytes()).hexdigest()}  {file.name}\n" for file in generated)
        (DIST / "SHA256SUMS").write_text(sums)


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, subprocess.CalledProcessError, ValueError) as error:
        raise SystemExit(f"Release failed: {error}") from error
