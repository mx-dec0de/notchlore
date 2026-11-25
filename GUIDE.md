# Notch Lore 2.0.0 — start here

Notch Lore turns a business goal into current project documents, a complete implementation task and checked results. The assistant handles the engineering details; you make the consequential product and business choices.

## 1. Choose one arrangement

| You want | Upload this file from `dist/` |
| --- | --- |
| Develop an idea and documentation in ChatGPT | `notchlore-chatgpt-2.0.0.zip` |
| Plan in ChatGPT and build with Codex | **`notchlore-chatgpt-codex-2.0.0.zip`** |
| Use an already connected Dot coordinator | `notchlore-chatgpt-codex-dot-2.0.0.zip` |

From the [GitHub dist directory](https://github.com/mx-dec0de/notchlore/tree/main/dist), open the filename for your mode and click **Download raw file**. Attach that one ZIP to a new ChatGPT planning chat. It contains `START.md`, the shared method and the selected adapter. If the chat cannot read the ZIP, extract it locally and attach `START.md`, `prompts/BASE.md`, the selected adapter in `prompts/` and the relevant files from `skills/notchlore/references/`.

Start with the message for your mode. Replace `[goal]` with what you want to achieve.

- **ChatGPT only** — “notchlore. Read START.md. Help me design [goal] and draw the main workflow.” Work through the decisions in the chat and download the current documents. You can skip the installation and packet steps.
- **ChatGPT + Codex** — “notchlore. Read START.md. Help me plan [goal] and agree on the acceptance checks.” Install the skill in the receiving project (section 2). Once you accept the plan, carry the task to Codex (section 4) and the results back to this chat (section 7).
- **Dot** — “notchlore. Read START.md. Help me plan [goal]. Verify Dot can access my project, run Codex and collect its return.” This requires an existing, authorized connection. Install the skill where Codex will work. If any part of the route is missing, ask for the full manual task packet and follow sections 4 and 7.

An idea is enough to begin. For an existing application, add current documents and a reviewed source snapshot. Bare `notchlore` with no context should produce one plain question about your goal.

## 2. Install in the actual project

Open a terminal in the project where Codex will work. Use **Node.js 22 or newer** with npm. ZIP packet commands also need **Python 3**. Install from the published npm package:

```sh
npx --yes --package=notchlore@2.0.0 notchlore install --dir /path/to/project
```

Replace `/path/to/project` with your existing project root, or use `.` when running from that directory. Quote paths with spaces. The installer creates `.agents/skills/notchlore/` under that root, with `SKILL.md`, references, agent metadata, a license and the `.notchlore-install.json` receipt. Open Codex in the same project and send:

```text
$notchlore Show what this project already does, what is uncertain, and the next useful action. Preserve the current application and documents.
```

Verify that Codex discovers the skill and reads the relevant references. To run another CLI command, reuse the same pinned runner, for example `npx --yes --package=notchlore@2.0.0 notchlore --help`.

### Local tarball alternative

Run `npm run release` in a clone of the GitHub repository to build the local tarball. From the root of that clone (or the `notchlore/` directory of an extracted full build), run:

```sh
npx --yes --package=./dist/notchlore-2.0.0.tgz notchlore install --dir /path/to/project
```

Replace the project path as above. This tarball contains the source used for the build, including its documentation and metadata. The registry command fetches the 2.0.0 package already published by `resultity`.

### Update an installed skill

To update an earlier installation to the published 2.0.0 skill, use the same project directory:

```sh
npx --yes --package=notchlore@2.0.0 notchlore install --dir /path/to/project --update
```

The installer verifies the receipt and file hashes before replacing the skill. It reports the backup path under `.agents/.notchlore-backup-…`. An identical installation returns `unchanged`. If the skill contains local edits or lacks a valid receipt, the installer stops so you can review it. If a lock remains after an interruption, check whether an installer is still running before recovering it.

Use `--dry-run` for a no-write preview. For a user-wide install, use `--global` in place of `--dir /path/to/project`.

## 3. Describe the outcome

```text
Add accounts and a visual constructor. Keep saved designs and public profiles in the longer-term plan. You choose the technical approach.
```

Expect a recommendation, meaningful alternatives, a named current document, tradeoffs and one next action. Routine technical choices belong to the engineer. Material cost, exposure and irreversible choices belong to you.

The assistant keeps current behavior, accepted target, proposals and actual proof distinct. It develops full and concise views from the same record, with useful diagrams and exact contracts. A changed constraint updates every affected goal and check while preserving unrelated decisions. Existing documentation paths retain ownership; with no convention the fallback is `docs/notchlore/project.md`, `iteration.md` and `report.md`. Each real task names its actual paths.

Prototype/MVP/Production is separate from workflow state, Try/Adjust/Polish, and Destination/Now/Next/Later. A score is not percentage complete.

## 4. Transfer an approved task

```text
Prepare this approved version for Codex. Include the complete documents, exact placement, acceptance checks and one short starter.
```

The assistant supplies **one task ZIP**, an exact staging location and one short prompt. Codex validates the packet and actual baseline, preserves local changes, reconciles accepted docs into their existing paths, implements, tests, corrects and returns evidence. It needs no planning-chat history.

Never unzip a task over live files. For a new empty workspace, stage beside it so the staging files do not contradict its baseline. For an existing project, use the fresh incoming directory named in START.md. Validation is not execution permission. If CLI/Python access is absent, a complete named-file handoff with manifest and references remains possible; report unexecuted checks honestly.

`packet unpack` requires its parent directory to exist and the final task directory to be absent. For the default existing-project placement, run `mkdir -p -- .notchlore/staging` from the intended project root, then unpack into the exact `.notchlore/staging/<task-id>` path named in START.md. Leave that final directory absent; the helper creates it exclusively. For an empty workspace, use its existing parent for the sibling staging directory.

## 5. Run the packet example

These commands run **from the release source directory**. Every input is supplied. They demonstrate a new empty receiver, not your application:

```sh
node bin/notchlore.mjs packet create --root examples/packet --spec examples/packet/spec.json --out demo-task.zip
mkdir demo-workspace
node bin/notchlore.mjs packet check demo-task.zip --root demo-workspace
node bin/notchlore.mjs packet unpack demo-task.zip --dir demo-stage --root demo-workspace
```

The ZIP has START.md and manifest.json at root; selected files are under `payload/`. All outputs must be new. In this example the staging parent is the release source directory, which already exists; leave `demo-stage` absent before unpacking. The manifest records selection, omissions, hashes, reading order, baseline, scope and authority. Without `--root`, checking validates the archive but cannot establish a receiving baseline. Unpacking only stages; it never merges, installs or executes.

Create and receive a packet with the same Notch Lore release. The generated START is part of the checked format. Keep the matching helper for an older packet, or regenerate it from reviewed source; do not edit the archive to bypass a format refusal.

For real work the assistant authors the selection specification. Relevant dirty/untracked bytes are copied, not silently replaced by HEAD. Explicit selections use files/directories, not globs. Missing required or conventional Markdown-linked local references fail visibly. Source dirty state is UNKNOWN unless independently established; a snapshot digest records the selected bytes.

Default exclusions protect credentials, private/customer data, live databases/logs and caches. They cannot be disabled; prepare redacted material instead. Content scans and `.gitignore` cannot certify privacy: inspect the actual selection and contents before transfer. Limits are 4,096 ZIP entries, 16 MiB per file, 64 MiB total and 200:1 expansion. Exceeding a limit fails, without truncating required records. Use a smaller coherent slice or an authorized repository/file route when needed. See [the schema](schemas/packet.schema.json) and [example specification](examples/packet/spec.json).

## 6. Read score and proof together

The assistant authors the assessment; you do not fill 48 technical cells. Try the supplied synthetic format fixtures:

```sh
node bin/notchlore.mjs score examples/aperture/assessment.json --root examples/aperture
node bin/notchlore.mjs score examples/aperture/runtime-not-run.json --root examples/aperture
```

The second deliberately exits 2 because runtime is NOT RUN. Neither fixture qualifies a real customer project.

Each of 12 dimensions has independent deductions: DEF 4, DIS 3, EXC 2, UNC 1, once per active type. All findings remain visible. Every applicable dimension must reach **5/7/9** for Prototype/MVP/Production and every mandatory gate needs valid PASS proof. One failed dimension or required unrun security check cannot be averaged away. UNKNOWN has no score; N/A needs a scoped reason. Documentation and runtime are assessed separately.

`score` checks declared IDs, coverage, references, local evidence hashes, candidate/environment/scope bindings and mandatory results. Exit 0 is structural readiness PASS; 1 is invalid structure/input; 2 is a structurally valid but blocked or unrun assessment. It cannot prove claims are true or every defect was found. Use `--candidate`, `--environment`, `--scope-revision` against independently known values and `--previous previous.json` for transitions. Authorized scope changes create a new revision and retain prior findings. Assessment JSON is capped at 4 MiB; evidence at 16 MiB/file and 64 MiB total.

## 7. Review and resume

Codex returns current docs, actual source/diff, candidate identity, gate evidence, findings and next action. Upload its named return ZIP and send:

```text
notchlore. Review this return against the accepted task and actual evidence. Reconcile the documents and finish any remaining authorized corrections.
```

After interruption, reconcile actual files, running ownership and unknown effects before replay. Use the recorded specific native Codex session ID when supported, or a fresh session with the durable checkpoint. Check the installed CLI's help. A checkpoint, a backup, a verified baseline and a running process are different things.

Dot follows the same contract through a real authorized route. Missing access yields a full manual handoff. This release supplies no unattended supervisor, recurring backup service or VPS connector. Your application needs its own operating and recovery evidence before production.

## What appears where

| Artifact | Location and owner |
| --- | --- |
| Reusable method | Release, selected ChatGPT pack, installed `.agents/skills/notchlore/` |
| Working design | Planning chat's actual downloadable project documents |
| Accepted current record | Existing repository document paths after reconciliation |
| Task | Transferred ZIP, then the fresh directory named in START.md |
| Implementation/evidence | Checked project worktree and its report/checkpoint |
| Return | Reviewed source/docs/evidence ZIP uploaded to the planning chat |
| Recovery | Durable checkpoint and appropriate independent source/data backup |

Read VALIDATION.md in the full repository for this release's precise qualification. Installation or structural readiness does not establish your application's readiness.

## 8. Practical use cases and conversation examples

The examples below show how to ask for an outcome. The assistant should adapt the work to your project and the authority you give it. These examples are not promises that all projects or integrations have been tested.

### Shape an idea

Upload the ChatGPT mode pack and describe who needs what:

```text
notchlore. Read START.md. I want a simple way for volunteers to organize a community workshop. Help me choose a useful first version.
```

Expect a proposed outcome, current assumptions and a next action. Ask for a concise overview and diagrams if they will help you decide.

### Understand an existing project

Upload a reviewed source snapshot and its current documents with the mode pack:

```text
notchlore. Read START.md. Study this project, explain what already works and recommend the next improvement. Distinguish what you observed from what you infer.
```

The assistant can only inspect the material it can actually access. Ask it to identify missing files and unverified behavior.

### Develop a feature and send it to Codex

After the planner understands the baseline, describe the desired change:

```text
Add saved roadmaps. Keep existing projects usable, update the relevant documentation and prepare the approved work for Codex.
```

Transfer the resulting task packet yourself unless a verified connection already supports transfer. Follow its exact staging instructions, then ask Codex to read its `START.md` and work within the accepted task. On return, provide the actual result and evidence to the planning conversation.

### Change an accepted requirement

```text
Change the plan: send one daily summary instead of individual reminders. Update affected workflows, decisions and acceptance checks while retaining unrelated work.
```

Review what is proposed and what is already implemented. A change to the target does not mean the application has already changed.

### Ask for useful diagrams

```text
Show the current user journey, the proposed workflow and the main components. Keep the diagrams consistent with the written contracts.
```

The method uses portable Markdown/Mermaid where helpful. Different tasks need different views; diagrams complement the underlying field definitions and decisions.

### Assess a result

```text
Assess documentation and implementation separately against the accepted scope. Show the 12 dimensions, findings, mandatory gates and supporting evidence. Mark unrun checks clearly.
```

An assistant writes the assessment; the local `score` command validates the declared structure and evidence bindings. Neither a generated score nor passing unit tests alone proves a project is ready for production. See section 6 and `examples/aperture/`.

### Continue after interruption

```text
Read the checkpoint and inspect the actual project state. Identify active work and uncertain effects before continuing the accepted task.
```

A written checkpoint is not proof that a process stopped, a backup succeeded or a workspace still matches an earlier snapshot. Use an actual supported session or a fresh session with reconciled records.

### Coordinate through Dot

Use the Dot pack when an actual authorized coordination route exists. Ask the coordinator to verify access to the target, execution and return channel before claiming it can dispatch work. Without that route, request the complete manual packet. The pack does not supply a service or a persistent unattended supervisor.

## 9. Where to find the material

| Need | Location in the extracted release |
| --- | --- |
| Entry and overview | `README.md`, `GUIDE.md` |
| Notch Lore's own workflow diagrams | `PROJECT.md` |
| Installable skill and detailed method | `skills/notchlore/SKILL.md` and `skills/notchlore/references/` |
| ChatGPT instructions | `prompts/` and the three mode ZIPs in `dist/` |
| Example task packet | `examples/packet/` |
| Example assessments | `examples/aperture/` |
| Local release checks and untested environments | `VALIDATION.md` |
| Publication and release procedure | `PUBLICATION.md` |

The three ChatGPT ZIPs are tracked in `dist/`. For the published skill, use the npm command in section 2. The same section covers installation from a locally built tarball.
