# Text counter — complete example target

Synthetic task-format example, revision 1. Current application: none. Target maturity: Prototype. Route: develop. Radius: Try. Nothing below claims implemented or measured behavior.

## Outcome and boundary

Help a local user count the words and lines in a UTF-8 text file. Success is a correct JSON result or a clear nonzero error. Now: one Python CLI and focused tests. Next: decide whether users need another input format. Later: optional desktop integration. No network, account, database, hosted API, paid dependency or public release is authorized. Demand and savings are hypotheses, not established business results.

## Exact interface and ownership

Create `counter.py`, `test_counter.py` and current project docs in the receiving empty workspace. One pure counting function owns the semantics; the CLI owns file I/O and errors. Python standard library only. CLI input: one path. Read UTF-8 strictly; refuse input larger than 1 MiB. Success stdout is one JSON object with integer fields `words`, `lines`, `characters`; exit 0. Failure goes to stderr and exits nonzero without a success object.

Words are `len(text.split())`, including Unicode whitespace. Lines are `len(text.splitlines())`; empty text has 0 lines and a single trailing newline does not create another line. Characters are the number of Unicode code points in the decoded text. No normalization or punctuation stripping. Missing file, invalid UTF-8, oversized file and wrong argument count are errors. Tests define each boundary explicitly.

## Operation, access and growth

Local single-user execution under existing filesystem permissions. No secret collection or private-data export. Instant clock: read, validate, count, print. Queued and accumulated work are N/A because no obligation survives process exit. Time O(n), memory O(n), explicitly bounded by input size. Measure a representative near-limit file and retain environment/command/result; no invented universal latency SLA.

Use the actual installed Python 3; declare the tested version. No process supervisor, install hooks or system changes. Before replacing any future existing source, retain a recovery copy; this task starts empty and must stop if application files already exist. A source snapshot is not a tested machine backup.

## Acceptance and continuity

Mandatory before marking this slice accepted: empty input, ASCII and Unicode whitespace, trailing newline, multi-line input, missing/invalid/oversized file, actual CLI success/error, no network/dependency install, no overwrite of pre-existing application files. Every result names the actual candidate and environment. Runtime begins NOT RUN; the document supplies target behavior only.

Maintain current source, concise project summary, findings and result report. If two attempts make no progress, change approach or checkpoint the exact blocker. Return source, docs, actual test output, candidate digest, unresolved findings and next action. Review all applicable dimensions; unknowns get no invented score. Filesystem ownership, input contract and local operating path have one owner each.
