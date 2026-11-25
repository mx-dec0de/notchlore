# Notch Lore 2.0.0 release scope

The distribution contains a local CLI, an installable Codex skill and three ChatGPT mode packs. The CLI requires Node.js 22 or later. Packet commands and release tooling also require Python 3.

| Workflow | What the local checks cover |
| --- | --- |
| Install and update | Project and user targets, dry runs, repeat installation, receipt verification, backups, refusal of edited files and protection of other skills |
| Inspect | Bounded, read-only discovery of project files, instructions, skills and Git state |
| Prompt and export | One adapter per mode, shared references, complete local links, license notice and content hashes |
| Score | Assessment structure, evidence binding, deductions, thresholds and mandatory gate outcomes |
| Packet | Selected files, baseline checks, bounded archive handling and fresh staging |
| Distribute | Package allowlist, source manifest, local tarball execution, mode exports, checksums and clean rebuild |

Production qualification also requires behavioral trials with users or agents, native Codex discovery and execution, session recovery and platform-specific checks. A live Dot route requires separate access and verification. Mode 3 supports manual transfer when that route is unavailable. See [VALIDATION.md](VALIDATION.md) for the checks run on this candidate.
