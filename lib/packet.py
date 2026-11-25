#!/usr/bin/env python3
"""Bounded, non-executing packet transport using Python's ZIP implementation."""

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import posixpath
import re
import shutil
import stat
import string
import subprocess
import sys
import unicodedata
from urllib.parse import unquote, urlsplit
from datetime import datetime, timezone
import zipfile
import zlib


FORMAT = "notchlore.packet"
MAX_ENTRIES = 4096
MAX_FILE_BYTES = 16 * 1024 * 1024
MAX_TOTAL_BYTES = 64 * 1024 * 1024
MAX_MANIFEST_BYTES = 4 * 1024 * 1024
MAX_RATIO = 200
KINDS = {"source", "task", "return", "checkpoint", "backup"}
DENIED_DIRS = {
    ".git", ".ssh", ".aws", ".kube", ".docker", "node_modules", ".venv",
    "venv", ".cache", "__pycache__", "coverage", ".next", ".nuxt", "dist",
    "build", "logs", "log", "private", "secrets", "credentials", "data",
    "uploads", "backup", "backups", ".notchlore",
}
DENIED_FILES = {".npmrc", ".pypirc", ".netrc", "cookies.txt", "credentials.json", "id_rsa", "id_ed25519"}
DENIED_SUFFIXES = {".pem", ".key", ".p12", ".pfx", ".db", ".db3", ".sqlite", ".sqlite3", ".dump", ".log", ".jsonl"}
ENV_EXAMPLES = {".env.example", ".env.sample", ".env.template"}
EMPTY_METADATA = {".git", ".agents", ".notchlore"}
DEVICE = re.compile(r"^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)", re.I)
DIGEST = re.compile(r"^[a-f0-9]{64}$")
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
TOKEN_PATTERNS = (
    ("private key", re.compile(rb"-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----")),
    ("GitHub token", re.compile(rb"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b")),
    ("provider secret key", re.compile(rb"\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b")),
    ("AWS access identifier", re.compile(rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")),
    ("Slack token", re.compile(rb"\bxox[baprs]-[A-Za-z0-9-]{15,}\b")),
    ("bearer credential", re.compile(rb"(?i)\bBearer\s+[A-Za-z0-9_\-.]{24,}")),
)
ASSIGNMENT = re.compile(
    rb'''(?im)(?:["']?)(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|client[_-]?secret)(?:["']?)\s*[:=]\s*["']([^"'\r\n]{8,})["']'''
)


class PacketError(Exception):
    pass


def fail(message):
    raise PacketError(message)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            fail("Duplicate JSON object key: " + key)
        result[key] = value
    return result


def parse_json(data, label):
    try:
        return json.loads(data.decode("utf-8"), object_pairs_hook=unique_object,
                          parse_constant=lambda value: fail("Non-finite JSON number: " + value))
    except (UnicodeDecodeError, ValueError) as error:
        fail("Invalid JSON in " + label + ": " + str(error))


def json_bytes(value):
    return (json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True) + "\n").encode("utf-8")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def text(value, label, limit=8000):
    if not isinstance(value, str) or not value.strip() or len(value) > limit or "\x00" in value:
        fail(label + " must be nonempty text within " + str(limit) + " characters.")
    return value


def obj(value, label, required, allowed=None):
    if not isinstance(value, dict):
        fail(label + " must be an object.")
    missing = set(required) - value.keys()
    unknown = value.keys() - set(allowed if allowed is not None else required)
    if missing or unknown:
        fail(label + " fields invalid; missing=" + ",".join(sorted(missing)) + "; unknown=" + ",".join(sorted(unknown)))


def safe_path(value):
    text(value, "Path", 1024)
    if "\\" in value or value.startswith("/") or ":" in value:
        fail("Unsafe path: " + value)
    parts = value.split("/")
    for part in parts:
        if (not part or part in {".", ".."} or part[-1:] in {".", " "}
                or len(part.encode("utf-8")) > 255 or DEVICE.match(part)
                or any(ord(char) < 32 or ord(char) == 127 or char in '<>"|?*' for char in part)):
            fail("Unsafe path: " + value)
    return value


def collision_key(value):
    return unicodedata.normalize("NFC", value).casefold()


def remember_spelling(value, seen):
    """Reject ambiguous directory spellings as well as colliding final filenames."""
    parts = value.split("/")
    for end in range(1, len(parts) + 1):
        prefix = "/".join(parts[:end])
        key = collision_key(prefix)
        if key in seen and seen[key] != prefix:
            fail("Case or Unicode path collision: " + prefix + " conflicts with " + seen[key])
        seen[key] = prefix


def validate_paths(paths, label):
    if not isinstance(paths, list) or len(paths) > MAX_ENTRIES:
        fail(label + " must be a bounded array of relative paths.")
    seen = set()
    spellings = {}
    for value in paths:
        safe_path(value)
        remember_spelling(value, spellings)
        key = collision_key(value)
        if key in seen:
            fail("Duplicate or colliding path in " + label + ": " + value)
        seen.add(key)


def validate_spec(spec):
    fields = {"schemaVersion", "kind", "id", "project", "scope", "baseline", "selectedPaths",
              "requiredReferences", "readingOrder", "start", "authority", "exclusions", "privacy"}
    obj(spec, "Packet specification", fields)
    if type(spec["schemaVersion"]) is not int or spec["schemaVersion"] != 1:
        fail("Unsupported packet schemaVersion; expected 1.")
    if spec["kind"] not in KINDS:
        fail("Unknown packet kind.")
    if not isinstance(spec["id"], str) or not IDENTIFIER.fullmatch(spec["id"]):
        fail("Packet id must have 1-64 ASCII letters, numbers, dots, underscores or hyphens.")
    safe_path(spec["id"])
    text(spec["project"], "Project", 200)
    text(spec["scope"], "Scope")
    baseline = spec["baseline"]
    obj(baseline, "Baseline", {"revision", "files"}, {"revision", "files", "empty", "dirty"})
    revision = text(baseline["revision"], "Baseline revision", 200)
    if not (re.fullmatch(r"git:[a-f0-9]{40}(?:[a-f0-9]{24})?", revision)
            or re.fullmatch(r"snapshot:[A-Za-z0-9._-]{1,128}", revision) or revision == "empty"):
        fail("Baseline revision must be git:<full SHA>, snapshot:<ID>, or empty.")
    if "empty" in baseline and type(baseline["empty"]) is not bool:
        fail("Baseline empty must be boolean.")
    if "dirty" in baseline and type(baseline["dirty"]) is not bool and baseline["dirty"] != "UNKNOWN":
        fail("Baseline dirty must be boolean or UNKNOWN.")
    if not isinstance(baseline["files"], dict):
        fail("Baseline files must map relative paths to SHA-256 digests.")
    validate_paths(list(baseline["files"]), "baseline.files")
    for value in baseline["files"].values():
        if not isinstance(value, str) or not DIGEST.fullmatch(value):
            fail("Invalid baseline SHA-256.")
    empty = baseline.get("empty", False)
    if empty != (revision == "empty") or (empty and baseline["files"]):
        fail("An empty baseline requires revision=empty, empty=true, and no baseline files.")
    if spec["kind"] == "task" and not empty and not baseline["files"]:
        fail("A task requires baseline file hashes, or an explicit empty baseline.")
    for key in ("selectedPaths", "requiredReferences", "readingOrder", "exclusions"):
        validate_paths(spec[key], key)
    start = spec["start"]
    obj(start, "Start", {"task", "prompt"})
    text(start["prompt"], "Start prompt", 200)
    if "\n" in start["prompt"] or "\r" in start["prompt"]:
        fail("The start prompt must be one line.")
    if start["task"] is not None:
        safe_path(start["task"])
        if start["task"] not in spec["readingOrder"]:
            fail("The start task must appear in readingOrder.")
    elif spec["kind"] == "task":
        fail("A task packet requires a start.task reference.")
    authority = spec["authority"]
    obj(authority, "Authority", {"allowed", "forbidden", "budget"})
    for name in ("allowed", "forbidden"):
        if not isinstance(authority[name], list) or not authority[name] or len(authority[name]) > 100:
            fail("Authority " + name + " must contain 1-100 explicit actions.")
        for value in authority[name]:
            text(value, "Authority action", 2000)
    obj(authority["budget"], "Authority budget", {"attempts", "minutes"})
    for name, maximum in (("attempts", 10000), ("minutes", 10080)):
        value = authority["budget"][name]
        if type(value) is not int or not 1 <= value <= maximum:
            fail("Authority budget " + name + " must be a positive bounded integer.")
    privacy = spec["privacy"]
    obj(privacy, "Privacy", {"reviewed", "reviewer", "notes"})
    if privacy["reviewed"] is not True:
        fail("Privacy review acknowledgement is required before export.")
    text(privacy["reviewer"], "Privacy reviewer", 200)
    text(privacy["notes"], "Privacy notes")
    return spec


def regular_bytes(root, relative, maximum=MAX_FILE_BYTES):
    """Read a regular file without following links; guard every path component on POSIX."""
    safe_path(relative)
    opened = []
    try:
        if os.open in os.supports_dir_fd and hasattr(os, "O_NOFOLLOW"):
            directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
            opened.append(directory)
            parts = relative.split("/")
            for part in parts[:-1]:
                directory = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
                opened.append(directory)
            declared = os.stat(parts[-1], dir_fd=directory, follow_symlinks=False)
            if not stat.S_ISREG(declared.st_mode) or declared.st_nlink != 1:
                fail("Nonregular file, symlink or hardlink refused: " + relative)
            fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0), dir_fd=directory)
        else:
            path = root
            for part in relative.split("/"):
                path = path / part
                if path.is_symlink():
                    fail("Symlink refused: " + relative)
            if os.path.commonpath((str(path.resolve()), str(root))) != str(root):
                fail("Path escaped source root: " + relative)
            declared = path.lstat()
            if not stat.S_ISREG(declared.st_mode) or declared.st_nlink != 1:
                fail("Nonregular file, symlink or hardlink refused: " + relative)
            fd = os.open(path, os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_NOFOLLOW", 0))
        opened.append(fd)
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
            fail("Nonregular file or hardlink refused: " + relative)
        if (before.st_dev, before.st_ino) != (declared.st_dev, declared.st_ino):
            fail("File identity changed before snapshot: " + relative)
        if before.st_size > maximum:
            fail("File size limit exceeded: " + relative)
        chunks = []
        remaining = maximum + 1
        while remaining:
            chunk = os.read(fd, min(remaining, 1024 * 1024))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        data = b"".join(chunks)
        after = os.fstat(fd)
        if len(data) > maximum:
            fail("File size limit exceeded: " + relative)
        if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            fail("File changed during snapshot; stop writers and retry: " + relative)
        return data
    except OSError as error:
        fail("Cannot safely read " + relative + ": " + str(error))
    finally:
        for fd in reversed(opened):
            os.close(fd)


def exclusion_reason(relative, exclusions):
    parts = relative.split("/")
    lower = [part.lower() for part in parts]
    if any(part in DENIED_DIRS for part in lower):
        return "default private-data, live-data, metadata or generated-directory exclusion"
    name = lower[-1]
    if name in DENIED_FILES or (name.startswith(".env") and name not in ENV_EXAMPLES):
        return "default credential/configuration exclusion"
    if Path(name).suffix in DENIED_SUFFIXES:
        return "default key, live-database or raw-log exclusion"
    if any(relative == item or relative.startswith(item + "/") for item in exclusions):
        return "explicit exclusion"
    return None


def scan_content(relative, data):
    for label, pattern in TOKEN_PATTERNS:
        if pattern.search(data):
            fail("Possible " + label + " in " + relative + "; redact or exclude it. Secret values are not printed.")
    for match in ASSIGNMENT.finditer(data):
        value = match.group(1).lower()
        safe_markers = (b"redacted", b"placeholder", b"example", b"dummy", b"sample", b"fixture", b"process.env", b"${", b"{{", b"<", b"your_")
        if not any(marker in value for marker in safe_markers):
            fail("Possible hardcoded credential in " + relative + "; redact or exclude it. Secret values are not printed.")


def collect(root, spec):
    files = {}
    omitted = []
    seen_paths = {}
    visited = 0
    total = 0

    def walk(relative, explicit=False):
        nonlocal visited, total
        safe_path(relative)
        visited += 1
        if visited > MAX_ENTRIES * 2:
            fail("Selection traversal limit exceeded; narrow the selected paths.")
        reason = exclusion_reason(relative, spec["exclusions"])
        if reason:
            if explicit:
                fail("Explicit selected path is excluded: " + relative + " (" + reason + ")")
            omitted.append({"path": relative, "reason": reason})
            return
        remember_spelling(relative, seen_paths)
        source = root / relative
        try:
            current = root
            for part in relative.split("/"):
                current = current / part
                if current.is_symlink():
                    fail("Symlink refused: " + relative)
            info = source.lstat()
        except OSError as error:
            fail("Cannot inspect selected path " + relative + ": " + str(error))
        if stat.S_ISDIR(info.st_mode):
            for item in sorted(source.iterdir(), key=lambda value: value.name):
                walk(relative + "/" + item.name)
        elif stat.S_ISREG(info.st_mode):
            if relative in files:
                return
            data = regular_bytes(root, relative)
            scan_content(relative, data)
            total += len(data)
            if total > MAX_TOTAL_BYTES or len(files) + 3 > MAX_ENTRIES:
                fail("Selection exceeds packet count or total-byte limit; split it into scoped packets.")
            files[relative] = data
        else:
            fail("Unsupported selected file type: " + relative)

    for relative in spec["selectedPaths"]:
        walk(relative, explicit=True)
    if not files and not spec["baseline"].get("empty", False):
        fail("An empty payload requires an explicit empty baseline; review the selected paths and omissions.")
    return files, sorted(omitted, key=lambda item: item["path"])


def markdown_destination(body, start):
    """Read a conventional Markdown destination with balanced or escaped parentheses."""
    position = start
    while position < len(body) and body[position].isspace():
        position += 1
    angled = position < len(body) and body[position] == "<"
    if angled:
        position += 1
    value = []
    depth = 0
    while position < len(body):
        char = body[position]
        if char == "\\" and position + 1 < len(body) and body[position + 1] in string.punctuation:
            value.append(body[position + 1])
            position += 2
            continue
        if angled:
            if char == ">":
                return "".join(value)
            if char in "\r\n":
                return None
        else:
            if char.isspace() or (char == ")" and depth == 0):
                return "".join(value) if depth == 0 else None
            if char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
        value.append(char)
        position += 1
    return "".join(value) if not angled and depth == 0 else None


def markdown_targets(data):
    try:
        body = data.decode("utf-8")
    except UnicodeDecodeError:
        return []
    body = re.sub(r"(?ms)^\s*(```|~~~).*?^\s*\1[^\n]*$", "", body)
    body = re.sub(r"`[^`\n]*`", "", body)
    links = []
    for pattern in (r"!?\[[^\]\n]*\]\(", r"(?m)^\s{0,3}\[[^\]\n]+\]:"):
        for match in re.finditer(pattern, body):
            target = markdown_destination(body, match.end())
            if target is not None:
                links.append(target)
    return links


def references_complete(spec, files):
    required = set(spec["requiredReferences"]) | set(spec["readingOrder"])
    if spec["start"]["task"]:
        required.add(spec["start"]["task"])
    for relative in sorted(required):
        if relative not in files:
            fail("Required reference missing from selected payload: " + relative)
    links_checked = 0
    for relative, data in files.items():
        if not relative.lower().endswith((".md", ".markdown")):
            continue
        for target in markdown_targets(data):
            parsed = urlsplit(target)
            if parsed.scheme in {"https", "http", "mailto", "urn", "data"} or target.startswith("#"):
                continue
            if parsed.scheme or parsed.netloc:
                fail("Unsupported local reference in " + relative + ": " + target)
            local = unquote(parsed.path)
            if not local:
                continue
            if local.startswith("/") or "\\" in local:
                fail("Unsafe Markdown reference in " + relative + ": " + target)
            normalized = posixpath.normpath(posixpath.join(posixpath.dirname(relative), local))
            safe_path(normalized)
            if normalized not in files:
                fail("Local Markdown reference missing from selected payload: " + relative + " -> " + normalized)
            links_checked += 1
    return links_checked


def git_head(root):
    if not shutil.which("git"):
        return None
    environment = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    environment.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull, GIT_OPTIONAL_LOCKS="0")
    try:
        result = subprocess.run(["git", "-c", "core.fsmonitor=false", "-C", str(root), "rev-parse", "--verify", "HEAD"],
                                env=environment, capture_output=True, timeout=10, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return None
    value = result.stdout.decode("ascii", errors="replace").strip()
    return value if result.returncode == 0 and re.fullmatch(r"[a-f0-9]{40}(?:[a-f0-9]{24})?", value) else None


def baseline_check(spec, root):
    if root is None:
        return {"status": "NOT CHECKED", "checkedFiles": 0, "root": None,
                "reason": "Supply --root for the intended checkout before executing a task."}
    root = root.resolve(strict=True)
    if not root.is_dir():
        fail("Baseline root must be a directory.")
    baseline = spec["baseline"]
    if baseline.get("empty", False):
        present = [item.name for item in root.iterdir() if item.name not in EMPTY_METADATA]
        if present:
            fail("Expected an empty project root; existing files must be reconciled first: " + ", ".join(sorted(present)[:20]))
    for relative, expected in baseline["files"].items():
        if digest(regular_bytes(root, relative)) != expected:
            fail("Stale baseline file: " + relative + ". Preserve current changes and reconcile before execution.")
    if baseline["revision"].startswith("git:"):
        if git_head(root) != baseline["revision"][4:]:
            fail("Git baseline revision does not match the intended checkout.")
    return {"status": "PASS", "checkedFiles": len(baseline["files"]), "root": str(root),
            "emptyMetadataExceptions": sorted(EMPTY_METADATA) if baseline.get("empty", False) else [],
            "reason": "Declared baseline bindings match; semantic correctness and authority are not certified."}


def start_document(spec):
    entry = "payload/" + spec["start"]["task"] if spec["start"]["task"] else "manifest.json"
    if spec["baseline"].get("empty", False):
        placement = ("Stage into a new `../notchlore-stage-" + spec["id"] + "` sibling directory outside the intended empty project. "
                     + "Use the existing parent of the intended project and leave that final staging directory absent. ")
    else:
        placement = ("Stage into a new `.notchlore/staging/" + spec["id"] + "` directory inside the intended project. "
                     + "From the intended project root, run `mkdir -p -- .notchlore/staging` to prepare the parent; leave "
                     + "`.notchlore/staging/" + spec["id"] + "` absent. ")
    reading = "\n".join(str(index + 1) + ". [" + relative + "](payload/" + relative + ")"
                        for index, relative in enumerate(spec["readingOrder"])) or "Read the manifest and inspect the selected snapshot."
    return ("# Notch Lore packet " + spec["id"] + "\n\n"
            + "Kind: " + spec["kind"] + ". Project: " + spec["project"] + ".\n\n"
            + "## Scope\n\n" + spec["scope"] + "\n\n"
            + "## Placement and use\n\n"
            + placement
            + "The staging parent must already exist; `packet unpack` creates only the final task directory. "
            + "This ZIP contains `START.md`, `manifest.json`, and selected project-relative files under `payload/`. "
            + "The entry is `" + entry + "`. Canonical destinations are the same paths with `payload/` removed. "
            + "Staging does not overwrite, reconcile, install, or execute project files.\n\n"
            + "Before execution, run `notchlore packet check` on the original archive with `--root` pointing to the actual project checkout. "
            + "A check without that root does not validate the task baseline. Compare staged documents and local changes, "
            + "then reconcile only within the recorded authority. Uploaded chat files do not appear on a VPS automatically.\n\n"
            + "## Reading order\n\n" + reading + "\n\n"
            + "## Initiation prompt\n\n```text\n" + spec["start"]["prompt"] + "\n```\n\n"
            + "## Boundaries\n\n"
            + "The manifest retains the baseline, selection, omissions, authority, budgets and privacy review. "
            + "Checksums establish byte identity, not truth, privacy or permission. Acknowledged review and scanning are not a leak-free guarantee. "
            + "No imported script is executed. Reconcile running ownership and unknown external effects before any replay. "
            + "A checkpoint is not a running process; a backup packet is only the selected files, not a live database snapshot or automatic schedule.\n").encode("utf-8")


def manifest_payload(spec, files, omitted, root):
    payload = {"payload/" + name: data for name, data in files.items()}
    payload["START.md"] = start_document(spec)
    hashes = [{"path": name, "sha256": digest(data), "size": len(data)} for name, data in sorted(payload.items())]
    selection_hash = digest(json_bytes([{key: item[key] for key in ("path", "sha256", "size")} for item in hashes if item["path"].startswith("payload/")]))
    manifest = {
        "format": FORMAT, "schemaVersion": 1,
        "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "spec": spec, "files": hashes, "omitted": omitted,
        "sourceSnapshot": {"sha256": selection_hash, "gitHead": git_head(root), "dirty": "UNKNOWN",
                           "selection": "Exact selected working-file bytes, including local edits and untracked files; clean Git status is not asserted."},
        "limitations": ["Declared references and conventional Markdown local links are checked; dynamic/code references need review.",
                        "Default exclusions and token scanning do not prove that private data or every secret was removed.",
                        "A fresh staged snapshot is not a synchronized checkout, database backup, or unattended process."]}
    return manifest, payload


def create(args):
    root = Path(args.root).resolve(strict=True)
    if not root.is_dir():
        fail("Source root must be a directory.")
    spec_path = Path(args.spec).resolve(strict=True)
    spec = validate_spec(parse_json(regular_bytes(spec_path.parent, spec_path.name, MAX_MANIFEST_BYTES), "specification"))
    files, omitted = collect(root, spec)
    links = references_complete(spec, files)
    manifest, payload = manifest_payload(spec, files, omitted, root)
    payload["manifest.json"] = json_bytes(manifest)
    if sum(map(len, payload.values())) > MAX_TOTAL_BYTES or len(payload) > MAX_ENTRIES:
        fail("Complete packet exceeds its entry or byte limit.")
    for name, data in payload.items():
        safe_path(name)
        maximum = MAX_MANIFEST_BYTES if name == "manifest.json" else MAX_FILE_BYTES
        if len(data) > maximum:
            fail("Generated packet entry exceeds size limit: " + name + ". Narrow the selection or references.")
        scan_content(name, data)
    with io.BytesIO() as stream:
        with zipfile.ZipFile(stream, "w") as archive:
            for name, data in sorted(payload.items()):
                entry = zipfile.ZipInfo(name)
                entry.create_system = 3
                entry.external_attr = (stat.S_IFREG | 0o600) << 16
                compressed_size = max(1, len(zlib.compress(data)) - 6)
                entry.compress_type = zipfile.ZIP_STORED if len(data) > (MAX_RATIO - 1) * compressed_size else zipfile.ZIP_DEFLATED
                archive.writestr(entry, data)
        raw = stream.getvalue()
    if len(raw) > MAX_TOTAL_BYTES:
        fail("ZIP metadata puts the archive over the total-byte limit; narrow the selection.")
    # Apply the receiver's ZIP checks before reserving an output destination.
    read_archive_bytes(raw)
    output = Path(args.out).absolute()
    parent = output.parent.resolve(strict=True)
    output = parent / output.name
    if output.suffix.lower() != ".zip":
        fail("Packet output must have a .zip suffix.")
    safe_path(output.name)
    try:
        fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    except FileExistsError:
        fail("Destination already exists; choose a new archive: " + str(output))
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
    except Exception as error:
        fail("Packet creation incomplete; inspect the reserved archive and choose a new path: " + str(error))
    return {"ok": True, "operation": "create", "archive": str(output), "id": spec["id"], "kind": spec["kind"],
            "files": len(files), "omitted": omitted, "bytes": output.stat().st_size,
            "sha256": digest(raw), "snapshotSha256": manifest["sourceSnapshot"]["sha256"],
            "localLinksChecked": links, "nextPrompt": spec["start"]["prompt"],
            "privacy": "Acknowledged review plus bounded scanning; not a leak-free guarantee."}


def read_archive(filename):
    path = Path(filename).absolute()
    raw = regular_bytes(path.parent.resolve(strict=True), path.name, MAX_TOTAL_BYTES)
    return path, raw, read_archive_bytes(raw)


def read_archive_bytes(raw):
    payload = {}
    keys = set()
    spellings = {}
    total = 0
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            entries = archive.infolist()
            if len(entries) > MAX_ENTRIES:
                fail("Archive entry limit exceeded.")
            for entry in entries:
                name = safe_path(entry.orig_filename)
                if name != entry.filename:
                    fail("Archive filename was truncated or changed during decoding.")
                key = collision_key(name)
                if key in keys:
                    fail("Duplicate or colliding archive path: " + name)
                keys.add(key)
                remember_spelling(name, spellings)
                mode = entry.external_attr >> 16
                if entry.is_dir() or entry.external_attr & 0x10 or (stat.S_IFMT(mode) not in (0, stat.S_IFREG)):
                    fail("Unsupported archive entry type or symlink: " + name)
                if entry.flag_bits & 1 or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                    fail("Encrypted or unsupported compressed entry: " + name)
                maximum = MAX_MANIFEST_BYTES if name == "manifest.json" else MAX_FILE_BYTES
                total += entry.file_size
                if entry.file_size > maximum or total > MAX_TOTAL_BYTES or entry.file_size > MAX_RATIO * max(1, entry.compress_size):
                    fail("Archive size or compression-ratio limit exceeded: " + name)
                if name not in {"START.md", "manifest.json"} and not name.startswith("payload/"):
                    fail("Unexpected archive entry outside packet layout: " + name)
                with archive.open(entry) as stream:
                    data = stream.read(maximum + 1)
                if len(data) != entry.file_size or len(data) > maximum:
                    fail("Archive entry length mismatch: " + name)
                payload[name] = data
    except (zipfile.BadZipFile, zipfile.LargeZipFile, RuntimeError, NotImplementedError) as error:
        fail("Invalid ZIP archive: " + str(error))
    for name in payload:
        parts = name.split("/")
        for end in range(1, len(parts)):
            if collision_key("/".join(parts[:end])) in keys:
                fail("Archive file/directory collision: " + name)
    return payload


def checked(filename, root=None):
    path, raw, payload = read_archive(filename)
    if "manifest.json" not in payload or "START.md" not in payload:
        fail("Packet must contain manifest.json and START.md.")
    manifest = parse_json(payload["manifest.json"], "manifest")
    obj(manifest, "Manifest", {"format", "schemaVersion", "createdAt", "spec", "files", "omitted", "sourceSnapshot", "limitations"})
    if manifest["format"] != FORMAT or type(manifest["schemaVersion"]) is not int or manifest["schemaVersion"] != 1:
        fail("Unsupported packet manifest.")
    spec = validate_spec(manifest["spec"])
    if not isinstance(manifest["createdAt"], str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", manifest["createdAt"]):
        fail("Manifest createdAt must be a UTC timestamp.")
    datetime.fromisoformat(manifest["createdAt"].replace("Z", "+00:00"))
    if not isinstance(manifest["limitations"], list) or not 1 <= len(manifest["limitations"]) <= 20:
        fail("Manifest limitations must be a bounded nonempty array.")
    for limitation in manifest["limitations"]:
        text(limitation, "Manifest limitation")
    if not isinstance(manifest["files"], list) or len(manifest["files"]) > MAX_ENTRIES:
        fail("Manifest files must be a bounded array.")
    expected = {}
    for record in manifest["files"]:
        obj(record, "Manifest file", {"path", "sha256", "size"})
        name = safe_path(record["path"])
        if name in expected or name == "manifest.json":
            fail("Duplicate or self-referential manifest path: " + name)
        if not isinstance(record["sha256"], str) or not DIGEST.fullmatch(record["sha256"]):
            fail("Invalid manifest SHA-256: " + name)
        if type(record["size"]) is not int or record["size"] < 0:
            fail("Invalid manifest size: " + name)
        expected[name] = record
    if set(expected) != set(payload) - {"manifest.json"}:
        fail("Manifest coverage does not match every archive entry.")
    for name, record in expected.items():
        if digest(payload[name]) != record["sha256"] or len(payload[name]) != record["size"]:
            fail("Manifest hash or size mismatch: " + name)
    if payload["START.md"] != start_document(spec):
        fail("START.md does not match the manifest contract.")
    files = {name[len("payload/"):]: data for name, data in payload.items() if name.startswith("payload/")}
    for relative, data in files.items():
        reason = exclusion_reason(relative, spec["exclusions"])
        if reason:
            fail("Payload contains an excluded path: " + relative)
        if not any(relative == selected or relative.startswith(selected + "/") for selected in spec["selectedPaths"]):
            fail("Payload path is outside the declared selection: " + relative)
        scan_content(relative, data)
    for name in ("manifest.json", "START.md"):
        scan_content(name, payload[name])
    snapshot = manifest["sourceSnapshot"]
    obj(snapshot, "Source snapshot", {"sha256", "gitHead", "dirty", "selection"})
    file_hashes = [expected[name] for name in sorted(expected) if name.startswith("payload/")]
    if snapshot["sha256"] != digest(json_bytes(file_hashes)):
        fail("Snapshot identity does not match payload files.")
    if snapshot["dirty"] != "UNKNOWN":
        fail("The transport does not certify Git clean/dirty status.")
    if snapshot["gitHead"] is not None and (not isinstance(snapshot["gitHead"], str) or not re.fullmatch(r"[a-f0-9]{40}(?:[a-f0-9]{24})?", snapshot["gitHead"])):
        fail("Invalid source Git revision.")
    text(snapshot["selection"], "Snapshot selection")
    if not isinstance(manifest["omitted"], list) or len(manifest["omitted"]) > MAX_ENTRIES * 2:
        fail("Invalid omission ledger.")
    for omission in manifest["omitted"]:
        obj(omission, "Omission", {"path", "reason"})
        safe_path(omission["path"])
        text(omission["reason"], "Omission reason")
    links = references_complete(spec, files)
    baseline = baseline_check(spec, Path(root) if root else None)
    result = {"ok": True, "operation": "check", "archive": str(path), "id": spec["id"], "kind": spec["kind"],
              "structuralStatus": "PASS", "baseline": baseline, "executionReady": spec["kind"] == "task" and baseline["status"] == "PASS",
              "files": len(files), "bytes": len(raw), "sha256": digest(raw), "snapshotSha256": snapshot["sha256"],
              "localLinksChecked": links, "omitted": manifest["omitted"], "nextPrompt": spec["start"]["prompt"],
              "limitations": manifest["limitations"] + ["Structural checks do not certify semantic completeness, gate truth or execution permission."]}
    return result, payload


def unpack(args):
    result, payload = checked(args.archive, args.root)
    target = Path(args.dir).absolute()
    try:
        parent = target.parent.resolve(strict=True)
    except FileNotFoundError:
        fail("Staging parent directory does not exist: " + str(target.parent)
             + ". Create this parent explicitly, then retry; leave the final task directory absent: " + str(target))
    target = parent / target.name
    safe_path(target.name)
    try:
        target.mkdir(mode=0o700)
    except FileExistsError:
        fail("Destination already exists; choose a fresh staging directory: " + str(target))
    try:
        for name, data in sorted(payload.items()):
            destination = target / name
            current = target
            for component in name.split("/")[:-1]:
                current = current / component
                try:
                    current.mkdir(mode=0o700)
                except FileExistsError:
                    if current.is_symlink() or not current.is_dir():
                        fail("Staging directory changed during extraction: " + str(current))
            fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
            with os.fdopen(fd, "wb") as stream:
                stream.write(data)
    except Exception as error:
        fail("Staging incomplete; original checkout is unchanged. Inspect " + str(target) + " and use a fresh directory: " + str(error))
    result.update(operation="unpack", target=str(target), start=str(target / "START.md"), payload=str(target / "payload"))
    return result


class Parser(argparse.ArgumentParser):
    def error(self, message):
        fail("Invalid packet command: " + message)


def main():
    parser = Parser(description="Create, validate and stage scoped Notch Lore ZIP packets without executing imported content.")
    commands = parser.add_subparsers(dest="command", required=True, parser_class=Parser)
    create_parser = commands.add_parser("create")
    create_parser.add_argument("--root", required=True)
    create_parser.add_argument("--spec", required=True)
    create_parser.add_argument("--out", required=True)
    check_parser = commands.add_parser("check")
    check_parser.add_argument("archive")
    check_parser.add_argument("--root")
    unpack_parser = commands.add_parser("unpack")
    unpack_parser.add_argument("archive")
    unpack_parser.add_argument("--dir", required=True)
    unpack_parser.add_argument("--root")
    for command in (create_parser, check_parser, unpack_parser):
        command.add_argument("--json", action="store_true")
    args = parser.parse_args()
    if args.command == "create":
        return create(args)
    if args.command == "unpack":
        return unpack(args)
    return checked(args.archive, args.root)[0]


if __name__ == "__main__":
    try:
        print(json.dumps(main(), ensure_ascii=False))
    except (PacketError, OSError, ValueError, TypeError, KeyError, OverflowError) as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        sys.exit(1)
