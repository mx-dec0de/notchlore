#!/usr/bin/env python3
"""Exercise the actual release archives offline in disposable workspaces."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import unicodedata
import zipfile


ROOT = Path(__file__).resolve().parents[1]
MODE_NAMES = {"1": "chatgpt", "2": "chatgpt-codex", "3": "chatgpt-codex-dot"}
MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
MAX_ARCHIVE_ENTRIES = 16_000


class SmokeFailure(Exception):
    pass


def require(condition, message):
    if not condition:
        raise SmokeFailure(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def file_hash(file):
    return sha256(file.read_bytes())


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def safe_name(name, seen):
    require(isinstance(name, str) and name and len(name) <= 4096, "Invalid archive path")
    require(not any(char in name for char in ("\\", "\x00", ":")), "Unsafe archive path: " + name)
    parts = name.split("/")
    require(not name.startswith("/") and all(part not in {"", ".", "..", ".git", "node_modules", "__pycache__"} for part in parts),
            "Unsafe or generated archive member: " + name)
    require(not name.endswith(".pyc"), "Compiled Python cache in archive")
    for count in range(1, len(parts) + 1):
        prefix = "/".join(parts[:count])
        key = unicodedata.normalize("NFC", prefix).casefold()
        require(key not in seen or seen[key] == prefix, "Colliding archive paths: " + name)
        seen[key] = prefix
    return PurePosixPath(name)


def zip_contents(file):
    require(file.is_file() and not file.is_symlink(), "ZIP must be a regular local file")
    require(file.stat().st_size <= MAX_ARCHIVE_BYTES, "Release ZIP exceeds the smoke bound")
    result, seen = {}, {}
    with zipfile.ZipFile(file) as archive:
        infos = archive.infolist()
        require(len(infos) <= MAX_ARCHIVE_ENTRIES, "Release ZIP has too many entries")
        require(sum(info.file_size for info in infos) <= MAX_ARCHIVE_BYTES, "Expanded release ZIP exceeds the smoke bound")
        for info in infos:
            safe_name(info.filename, seen)
            require(info.filename not in result, "Duplicate ZIP member")
            kind = (info.external_attr >> 16) & 0o170000
            require(not info.is_dir() and kind in (0, stat.S_IFREG), "Non-regular ZIP member")
            require(not info.flag_bits & 1, "Encrypted ZIP member")
            result[info.filename] = (archive.read(info), (info.external_attr >> 16) & 0o777)
    return result


def tar_contents(file):
    require(file.is_file() and not file.is_symlink(), "Tarball must be a regular local file")
    require(file.stat().st_size <= MAX_ARCHIVE_BYTES, "Tarball exceeds the smoke bound")
    result, seen, total = {}, {}, 0
    with tarfile.open(file, "r:gz") as archive:
        for member in archive:
            require(len(result) < MAX_ARCHIVE_ENTRIES, "Tarball has too many entries")
            safe_name(member.name, seen)
            require(member.isfile() and member.name.startswith("package/"), "Unexpected npm member: " + member.name)
            relative = member.name.removeprefix("package/")
            require(relative not in result, "Duplicate tarball member")
            total += member.size
            require(total <= MAX_ARCHIVE_BYTES, "Expanded tarball exceeds the smoke bound")
            payload = archive.extractfile(member)
            require(payload is not None, "Tarball member cannot be read")
            result[relative] = (payload.read(), member.mode & 0o777)
    require("package.json" in result, "Tarball has no manifest")
    return result


def materialize(contents, target):
    require(not target.exists(), "Extraction target must be new")
    target.mkdir(mode=0o700)
    for name, (data, mode) in contents.items():
        file = target.joinpath(*PurePosixPath(name).parts)
        file.parent.mkdir(parents=True, exist_ok=True)
        with file.open("xb") as stream:
            stream.write(data)
        file.chmod(0o755 if mode & 0o111 else 0o644)


def snapshot(root, exclude=()):
    records = {}
    for file in sorted(root.rglob("*")):
        relative = file.relative_to(root).as_posix()
        if any(relative == item or relative.startswith(item + "/") for item in exclude):
            continue
        require(not file.is_symlink(), "Unexpected link in fixture: " + relative)
        mode = stat.S_IMODE(file.stat().st_mode)
        if file.is_dir():
            records[relative + "/"] = {"type": "directory", "mode": mode}
        elif file.is_file():
            records[relative] = {"sha256": file_hash(file), "mode": mode}
        else:
            raise SmokeFailure("Unexpected fixture file type")
    return records


class Campaign:
    def __init__(self, root, temp, report):
        self.root, self.temp, self.report = root, temp, report
        self.cache = temp / "npm-cache"
        self.clean = temp / "clean" / "notchlore"
        self.replacements = [(str(temp), "<temporary>"), (str(root), "<release>")]
        user_config = temp / "npm-user-config"
        global_config = temp / "npm-global-config"
        user_config.write_text("")
        global_config.write_text("")
        self.environment = {**os.environ, "npm_config_offline": "true", "npm_config_update_notifier": "false",
                            "npm_config_audit": "false", "npm_config_fund": "false", "npm_config_cache": str(self.cache),
                            "npm_config_userconfig": str(user_config), "npm_config_globalconfig": str(global_config)}

    def clean_text(self, text):
        for source, replacement in self.replacements:
            text = text.replace(source, replacement)
        return text

    def command(self, argv, *, cwd=None, expected=0, timeout=120):
        argv = [str(value) for value in argv]
        executable = shutil.which(argv[0])
        require(executable is not None, "Required tool is missing: " + argv[0])
        shown = [self.clean_text(value) for value in argv]
        print("smoke: " + " ".join(shown), file=sys.stderr, flush=True)
        started = time.perf_counter()
        try:
            result = subprocess.run([executable, *argv[1:]], cwd=cwd or self.clean,
                                    stdin=subprocess.DEVNULL, capture_output=True, text=True,
                                    errors="replace", timeout=timeout, check=False, env=self.environment)
        except subprocess.TimeoutExpired as error:
            self.report["commands"].append({"argv": shown, "cwd": self.clean_text(str(cwd or self.clean)),
                                            "result": "TIMEOUT", "limitSeconds": timeout})
            raise SmokeFailure("Command exceeded its time bound: " + " ".join(shown)) from error
        elapsed = time.perf_counter() - started
        accepted = {expected} if isinstance(expected, int) else set(expected)
        entry = {"argv": shown, "cwd": self.clean_text(str(cwd or self.clean)), "exitCode": result.returncode,
                 "expectedExitCodes": sorted(accepted), "seconds": round(elapsed, 4),
                 "stdoutSha256": sha256(result.stdout.encode()), "stderrSha256": sha256(result.stderr.encode()),
                 "stdoutTail": self.clean_text(result.stdout[-1800:]), "stderrTail": self.clean_text(result.stderr[-1200:])}
        self.report["commands"].append(entry)
        require(result.returncode in accepted, "Unexpected command result: " + " ".join(shown) + "\n" + entry["stderrTail"] + "\n" + entry["stdoutTail"])
        return result

    def npx(self, tarball, args, *, cwd=None, expected=0):
        return self.command(["npx", "--offline", "--yes", "--ignore-scripts", "--cache", self.cache,
                             "--package=" + str(tarball), "notchlore", *args], cwd=cwd, expected=expected)

    def json_npx(self, tarball, args, **options):
        result = self.npx(tarball, [*args, "--json"], **options)
        if result.stdout.strip():
            return json.loads(result.stdout)
        # The CLI prints expected refusal objects to stderr. npm may add diagnostics.
        for line in reversed(result.stderr.splitlines()):
            try:
                value = json.loads(line)
            except ValueError:
                continue
            if isinstance(value, dict) and isinstance(value.get("error"), str):
                return value
        raise SmokeFailure("Packed CLI did not return a JSON result")

    def passed(self, name, **evidence):
        self.report["checks"].append({"id": name, "result": "PASS", **evidence})

    def protected_project(self, name):
        project = self.temp / name
        project.mkdir()
        fixture_files = {
            "app.mjs": "export const requestStatus = 'open';\n",
            "README.md": "# Existing request application\n",
            "AGENTS.md": "Preserve current application code and the owner's local changes.\n",
            ".gitignore": ".agents/\n.env\n",
            ".env": "FIXTURE_VALUE=synthetic-not-a-credential\n",
            ".agents/skills/foreign/SKILL.md": "---\nname: foreign\ndescription: Existing unrelated fixture skill.\n---\nKeep this skill.\n",
        }
        for name, data in fixture_files.items():
            file = project / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(data)
        self.command(["git", "init", "--quiet"], cwd=project)
        self.command(["git", "add", "app.mjs", "README.md", "AGENTS.md", ".gitignore"], cwd=project)
        self.command(["git", "-c", "user.name=Release Smoke", "-c", "user.email=smoke@localhost", "commit", "--quiet", "-m", "Record disposable baseline"], cwd=project)
        with (project / "app.mjs").open("a") as stream:
            stream.write("// Owner's uncommitted change remains part of the actual source.\n")
        (project / "owner-notes.txt").write_text("Retain the future photos idea.\n")
        fixture_files["owner-notes.txt"] = ""
        protected = {name: file_hash(project / name) for name in fixture_files}
        head = self.command(["git", "rev-parse", "HEAD"], cwd=project).stdout.strip()
        return project, protected, head

    def protected_unchanged(self, project, protected, head):
        require({name: file_hash(project / name) for name in protected} == protected, "Application, owner notes, instructions or foreign skill changed")
        require(self.command(["git", "rev-parse", "HEAD"], cwd=project).stdout.strip() == head, "Fixture Git baseline changed")


def verify(root, temp, report, *, rebuild):
    package = json.loads((root / "package.json").read_text())
    version = package["version"]
    require(re.fullmatch(r"\d+\.\d+\.\d+(?:-[\w.-]+)?", version), "Invalid release version")
    filenames = [f"notchlore-{version}.tgz", *[f"notchlore-{name}-{version}.zip" for name in MODE_NAMES.values()], f"notchlore-{version}.zip"]
    artifacts = {name: root / "dist" / name for name in filenames}
    for name, file in artifacts.items():
        require(file.is_file() and not file.is_symlink(), "Build the release before smoke verification: " + name)
    report["package"] = {"name": package["name"], "version": version}
    report["artifacts"] = [{"filename": name, "bytes": file.stat().st_size, "sha256": file_hash(file)} for name, file in artifacts.items()]
    manifest = root / "SOURCE_MANIFEST.json"
    if manifest.is_file():
        report["candidate"] = json.loads(manifest.read_text()).get("candidate")
    campaign = Campaign(root, temp, report)

    contents = zip_contents(artifacts[f"notchlore-{version}.zip"])
    require(contents and all(name.startswith("notchlore/") for name in contents), "Repository ZIP must have one notchlore root")
    inner_sums = "".join(f"{file_hash(artifacts[name])}  {name}\n" for name in filenames[:-1]).encode()
    for name, (data, _) in contents.items():
        relative = name.removeprefix("notchlore/")
        if relative == "dist/SHA256SUMS":
            require(data == inner_sums, "Repository child-artifact checksum list differs")
            continue
        source = root / relative
        require(source.is_file() and not source.is_symlink() and source.read_bytes() == data, "Repository member differs from current source: " + relative)
    require("notchlore/dist/SHA256SUMS" in contents, "Repository archive is missing child-artifact checksums")
    materialize(contents, temp / "clean")
    campaign.passed("clean-source-extraction", files=len(contents), maintainedMembersMatchWorkspace=True, childArtifactChecksumsMatch=True)

    source_manifest = json.loads((campaign.clean / "SOURCE_MANIFEST.json").read_text())
    manifest_entries = source_manifest["files"]
    manifest_candidate = "sha256:" + sha256(json.dumps(manifest_entries, sort_keys=True, separators=(",", ":")).encode())
    require(source_manifest["candidate"] == manifest_candidate, "Source candidate digest does not match its manifest")
    for name, digest in manifest_entries.items():
        safe_name(name, {})
        source = campaign.clean / name
        require(source.is_file() and not source.is_symlink() and file_hash(source) == digest, "Source manifest entry differs: " + name)
    campaign.passed("source-candidate-identity", candidate=manifest_candidate, files=len(manifest_entries))

    report["environment"] = {"platform": platform.platform(), "python": platform.python_version(),
                              "node": campaign.command(["node", "--version"]).stdout.strip(),
                              "npm": campaign.command(["npm", "--version"]).stdout.strip(),
                              "npmOffline": True, "npmCache": "New temporary cache", "npmUserAndGlobalConfig": "Empty temporary files"}
    tests = campaign.command(["npm", "test"], timeout=180)
    counts = {label: int(match.group(1)) for label in ("tests", "pass", "fail", "skipped", "cancelled")
              if (match := re.search(r"(?:#|ℹ)\s*" + label + r"\s+(\d+)", tests.stdout))}
    require(counts.get("tests", 0) > 0 and counts.get("fail") == 0, "Cannot establish clean extracted test success")
    campaign.command(["npm", "run", "check"])
    campaign.passed("clean-source-suite", counts=counts)

    tarball = campaign.clean / "dist" / f"notchlore-{version}.tgz"
    payload = tar_contents(tarball)
    for name, (data, _) in payload.items():
        source = campaign.clean / name
        require(source.is_file() and not source.is_symlink() and source.read_bytes() == data, "Packed npm bytes differ: " + name)
    packed_package = json.loads(payload["package.json"][0])
    require(packed_package["name"] == package["name"] and packed_package["version"] == version, "Packed identity differs")
    require(not any(packed_package.get(kind) for kind in ("dependencies", "optionalDependencies", "peerDependencies", "devDependencies")), "Unexpected package dependencies")
    require(not any(packed_package.get("scripts", {}).get(hook) for hook in ("preinstall", "install", "postinstall", "prepare")), "Unexpected installation lifecycle hook")
    campaign.passed("npm-byte-identity", files=len(payload), bytes=sum(len(data) for data, _ in payload.values()), runtimeDependencies=0)
    require(campaign.npx(tarball, ["--version"]).stdout.strip() == version, "Packed CLI version differs")

    project, protected, head = campaign.protected_project("existing project with spaces")
    before = snapshot(project)
    dry = campaign.json_npx(tarball, ["install", "--dir", project, "--dry-run"])
    require(dry["status"] == "install" and snapshot(project) == before, "Packed dry run wrote or returned wrong action")
    installed = campaign.json_npx(tarball, ["install", "--dir", project])
    require(installed["status"] == "installed", "Packed install failed")
    after = snapshot(project)
    require(campaign.json_npx(tarball, ["install", "--dir", project])["status"] == "unchanged", "Packed repeat install is not unchanged")
    require(snapshot(project) == after, "Packed repeat install changed bytes or modes")
    target = project / ".agents" / "skills" / "notchlore"
    require(snapshot(target, exclude=(".notchlore-install.json",)) == snapshot(campaign.clean / "skills" / "notchlore"), "Installed skill differs from canonical payload")
    inspection = campaign.json_npx(tarball, ["inspect", project])
    require(inspection["git"]["dirty"] and inspection["classification"] == "code-and-docs", "Packed inventory lost actual workspace state")
    campaign.protected_unchanged(project, protected, head)
    campaign.passed("packed-install-and-idempotence", status=installed["status"], protectedFiles=len(protected), dirtySourcePreserved=True, installedBytesMatch=True)

    older = temp / "synthetic-older-package"
    materialize(payload, older)
    old_package = json.loads((older / "package.json").read_text())
    old_package["version"] = "1.9.0-smoke"
    (older / "package.json").write_text(json.dumps(old_package, indent=2) + "\n")
    with (older / "skills/notchlore/SKILL.md").open("a") as stream:
        stream.write("\nSynthetic older payload for the offline update-preservation check.\n")
    packed = json.loads(campaign.command(["npm", "pack", "--offline", "--json", "--ignore-scripts", "--pack-destination", temp], cwd=older).stdout)
    old_tarball = temp / packed[0]["filename"]
    updated_project, updated_protected, updated_head = campaign.protected_project("update project")
    require(campaign.json_npx(old_tarball, ["install", "--dir", updated_project])["status"] == "installed", "Synthetic old install failed")
    update_target = updated_project / ".agents/skills/notchlore"
    older_tree = snapshot(update_target)
    update_before = snapshot(updated_project)
    campaign.json_npx(tarball, ["install", "--dir", updated_project], expected=1)
    require(snapshot(updated_project) == update_before, "Unapproved update wrote files")
    update = campaign.json_npx(tarball, ["install", "--dir", updated_project, "--update"])
    require(update["status"] == "updated" and snapshot(Path(update["backup"])) == older_tree, "Owned update did not preserve original bytes")
    require(snapshot(update_target, exclude=(".notchlore-install.json",)) == snapshot(campaign.clean / "skills/notchlore"), "Updated payload differs from source")
    campaign.protected_unchanged(updated_project, updated_protected, updated_head)
    campaign.passed("packed-owned-update", fixture="Synthetic locally packed 1.9.0-smoke; never published", backupByteAndModeIdentity=True, toVersion=version)

    with (update_target / "SKILL.md").open("a") as stream:
        stream.write("\nOwner customization must remain.\n")
    edited = snapshot(updated_project)
    campaign.json_npx(tarball, ["install", "--dir", updated_project, "--update"], expected=1)
    require(snapshot(updated_project) == edited, "Edited skill was changed during refusal")
    campaign.passed("packed-edited-skill-refusal", workspaceUnchanged=True)

    for alias, name in MODE_NAMES.items():
        destination = temp / ("export-mode-" + alias)
        campaign.npx(tarball, ["export", "--mode", alias, "--dir", destination])
        expected = zip_contents(campaign.clean / "dist" / f"notchlore-{name}-{version}.zip")
        actual = {file.relative_to(destination).as_posix(): file.read_bytes() for file in destination.rglob("*") if file.is_file()}
        require(actual == {file: data for file, (data, _) in expected.items()}, "Packed mode export differs from release ZIP: " + alias)
        manifest = json.loads(actual["PACK_MANIFEST.json"])
        require(manifest["version"] == version and set(manifest["files"]) == set(actual) - {"PACK_MANIFEST.json"}, "Mode manifest coverage differs")
        require(all(sha256(actual[file]) == digest for file, digest in manifest["files"].items()), "Mode manifest digest differs")
        canonical = {file.relative_to(campaign.clean).as_posix(): file.read_bytes() for file in (campaign.clean / "skills/notchlore/references").iterdir() if file.is_file()}
        require(all(actual[file] == data for file, data in canonical.items()), "Mode canonical references differ")
        preserved = snapshot(destination)
        campaign.npx(tarball, ["export", "--mode", alias, "--dir", destination], expected=1)
        require(snapshot(destination) == preserved, "Existing export changed during refusal")
        campaign.passed("packed-mode-" + alias, mode=name, files=len(actual), canonicalReferences=len(canonical), archiveAndSourceBytesMatch=True)

    examples = campaign.clean / "examples/aperture"
    design = campaign.json_npx(tarball, ["score", examples / "assessment.json", "--root", examples])
    require(design["structuralStatus"] == "PASS" and design["readiness"] == "PASS", "Packed score design fixture did not pass")
    runtime = campaign.json_npx(tarball, ["score", examples / "runtime-not-run.json", "--root", examples], expected=2)
    require(runtime["structuralStatus"] == "PASS" and runtime["readiness"] == "NOT RUN", "Packed score runtime fixture did not retain NOT RUN")
    campaign.passed("packed-score-command", examples="Explicitly synthetic format fixtures", documentation="PASS", implementation="NOT RUN", implementationExitCode=2)

    example = campaign.clean / "examples/packet"
    packet = temp / "example-task.zip"
    receiver = temp / "empty receiver"
    receiver.mkdir()
    receiver_before = snapshot(receiver)
    created = campaign.json_npx(tarball, ["packet", "create", "--root", example, "--spec", example / "spec.json", "--out", packet])
    unchecked = campaign.json_npx(tarball, ["packet", "check", packet])
    require(unchecked["structuralStatus"] == "PASS" and unchecked["executionReady"] is False, "No-root packet check claimed execution readiness")
    checked = campaign.json_npx(tarball, ["packet", "check", packet, "--root", receiver])
    require(checked["executionReady"] is True, "Example packet did not match empty receiving baseline")
    staged = temp / "packet stage"
    campaign.json_npx(tarball, ["packet", "unpack", packet, "--dir", staged, "--root", receiver])
    require(snapshot(receiver) == receiver_before, "Staging changed the canonical receiver")
    for file in ("PROJECT.md", "TASK.md"):
        require((staged / "payload" / file).read_bytes() == (example / file).read_bytes(), "Staged payload differs from source")
    stage_before = snapshot(staged)
    campaign.json_npx(tarball, ["packet", "unpack", packet, "--dir", staged, "--root", receiver], expected=1)
    require(snapshot(staged) == stage_before, "Existing stage changed during refusal")
    campaign.passed("packed-packet-roundtrip", payloadFiles=created["files"], canonicalReceiverUnchanged=True, freshStageBytesMatch=True,
                    boundary="Structural and baseline check only; no task implementation or authority certification")

    if rebuild:
        expected_hashes = {name: file_hash(file) for name, file in artifacts.items()}
        campaign.command(["npm", "run", "release"], timeout=180)
        actual_hashes = {name: file_hash(campaign.clean / "dist" / name) for name in filenames}
        require(actual_hashes == expected_hashes, "Clean rebuild is not byte-reproducible: " + ", ".join(name for name in filenames if actual_hashes[name] != expected_hashes[name]))
        campaign.passed("clean-rebuild-reproducibility", artifacts=len(filenames), allSha256Match=True)
    else:
        report["checks"].append({"id": "clean-rebuild-reproducibility", "result": "NOT RUN", "reason": "Use --rebuild for the additional actual release rebuild."})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="Write report to this new file; default is stdout")
    parser.add_argument("--rebuild", action="store_true", help="Rebuild the clean extracted repository and compare all five artifact hashes")
    args = parser.parse_args()
    if args.output:
        require(not args.output.exists() and not args.output.is_symlink(), "Report destination must be new")
        require(args.output.parent.is_dir(), "Report parent directory must exist")
    report = {"schemaVersion": 1, "kind": "notchlore.release-smoke", "startedAt": utc_now(), "result": "FAIL", "checks": [], "commands": [],
              "limitations": "Local offline package/distribution evidence. Synthetic fixtures do not establish customer acceptance, live integration, native Codex execution, other physical platforms, publication or an unattended supervisor."}
    started = time.perf_counter()
    try:
        with tempfile.TemporaryDirectory(prefix="notchlore-smoke-") as temporary:
            verify(ROOT, Path(temporary), report, rebuild=args.rebuild)
        report["result"] = "PASS"
    except (SmokeFailure, OSError, ValueError, KeyError, tarfile.TarError, zipfile.BadZipFile) as error:
        report["failure"] = str(error)
    report["finishedAt"] = utc_now()
    report["seconds"] = round(time.perf_counter() - started, 4)
    result = json.dumps(report, indent=2, ensure_ascii=False) + "\n"
    if args.output:
        with args.output.open("x") as stream:
            stream.write(result)
        print(str(args.output))
    else:
        print(result, end="")
    return 0 if report["result"] == "PASS" else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SmokeFailure as error:
        raise SystemExit("Smoke verification refused: " + str(error)) from error
