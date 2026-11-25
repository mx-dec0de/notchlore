# Using Notch Lore

## Start a planning chat

Choose one pack from the [GitHub downloads](https://github.com/mx-dec0de/notchlore/tree/main/dist). Open the ZIP’s file page and choose **Download raw file**. Attach the whole ZIP to a new ChatGPT conversation. If the chat cannot open it, extract it and attach `START.md`, `prompts/BASE.md`, the selected mode file and the relevant skill references. Add the project material you want the chat to use.

| Pack | Who moves the work? |
| --- | --- |
| `notchlore-chatgpt-2.0.0.zip` | You plan and review in chat. Download any project documents you want to keep. |
| `notchlore-chatgpt-codex-2.0.0.zip` | You carry a task ZIP to the IDE and bring back a return ZIP. |
| `notchlore-chatgpt-codex-dot-2.0.0.zip` | An existing, authorized Dot connection may move the work. Verify it can reach the intended project, dispatch to Codex and retrieve the result. Use the manual handoff if a link is missing. |

```text
notchlore. Read START.md. I want [outcome] for [user]. Use the project material I supplied and propose a first change we can check.
```

## Install the skill in the IDE

In the terminal for the application project, run the following with Node.js 22 or newer and npm. Install Python 3 on the machine handling ZIP packets.

```sh
npx --yes --package=notchlore@2.0.0 notchlore install --dir .
```

The installer writes `.agents/skills/notchlore/` and records the installed files in a receipt. Open Codex in this project and invoke `$notchlore`. For an installation preview add `--dry-run`. To update an earlier installation add `--update`. The installer checks ownership and local edits and reports the backup location when replacing an installation.

### Local tarball alternative

The npm command installs the published 2.0.0 skill. To use a tarball built from a particular Git checkout, run these commands in the Notch Lore source directory, substituting the path to your application project.

```sh
npm run release
npx --yes --package=./dist/notchlore-2.0.0.tgz notchlore install --dir /path/to/project
```

## Transfer an approved task

Ask the planning chat for the task ZIP, the intended project root, the fresh staging path and the short Codex starter. Put the ZIP on the project machine and give Codex its location. The task’s `START.md` tells the receiver which documents to read.

`packet check` with `--root` checks the receiver against the declared baseline. `packet unpack` stages selected files in a new directory. Its parent must exist. For an empty project, stage beside the application directory so the staging files do not break the empty baseline. For an existing project, create the named staging parent first. Use the same packet-helper version at both ends.

Review the files you select for transfer, including relevant uncommitted work. The helper checks declared paths, hashes and conventional Markdown links. Its filters can miss private content. The format allows up to 4,096 entries, 16 MiB per file, 64 MiB overall and a 200:1 expansion ratio. The [packet walkthrough](examples/use-cases/06-hand-off-a-task.md) includes a runnable example.

## Review the return

Upload the return ZIP to the planning chat alongside the accepted task if the chat no longer has it. A useful return contains the changed source or diff, the exact candidate tested, the commands and results, and any remaining findings. Compare each required check with the evidence for that build. [Review an agent’s delivery](examples/use-cases/07-review-a-return.md).

## CLI reference

The examples below use a clone of the Notch Lore repository. From a different project, replace `node bin/notchlore.mjs` with `npx --yes --package=notchlore@2.0.0 notchlore`.

| Command | Result |
| --- | --- |
| `install --dir .` | Install the Codex skill in the current project. |
| `inspect /path/to/project --json` | List workspace signals, project instructions, detected skills and Git state. |
| `prompt codex` | Print the entry prompt for the manual handoff mode. |
| `export --mode 2 --dir NEW_DIRECTORY` | Write the manual-mode pack files to a fresh directory. |
| `packet create/check/unpack` | Prepare, validate or stage a handoff. See the packet walkthrough for arguments. |
| `score FILE --root PATH` | Check an assessment against its evidence and print the result. |

Run `node bin/notchlore.mjs --help` for exact syntax. For a first score, see the [assessment guide](examples/assessment-guide.md). For examples of planning, implementation and recovery, see the [use cases](examples/use-cases/README.md).
