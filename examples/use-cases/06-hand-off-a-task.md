# Guide Codex through a task

The bundled text-counter assignment is small enough to inspect. Its project document defines how to count words, lines and characters. Its task document gives the executor the allowed work and required checks. Its packet specification declares that the receiving application directory must be empty.

**Try the handoff.** From a Notch Lore source checkout on Linux or macOS, run the following. The scratch directory keeps the receiver, the staged instructions and the ZIP apart.

```sh
demo=$(mktemp -d)
mkdir "$demo/receiver"
node bin/notchlore.mjs packet create --root examples/packet --spec examples/packet/spec.json --out "$demo/task.zip"
node bin/notchlore.mjs packet check "$demo/task.zip" --root "$demo/receiver"
node bin/notchlore.mjs packet unpack "$demo/task.zip" --dir "$demo/staged" --root "$demo/receiver"
```

Open `staged/START.md` inside that scratch directory. Follow its reading order into `payload/PROJECT.md` and `payload/TASK.md`. The first describes the product and the second tells Codex what to do. At this point the helper has staged instructions. The Python application has yet to be written.

**Try the same ZIP against a changed target.** In the same terminal run these commands.

```sh
touch "$demo/receiver/existing-app.txt"
node bin/notchlore.mjs packet check "$demo/task.zip" --root "$demo/receiver"
```

The second check exits 1 and names `existing-app.txt`. That file is enough to invalidate the promise that the project is empty. Preserve it and reconcile the task with the actual project.

**In your own project**, the planning chat prepares the ZIP and supplies its starter. Give Codex the ZIP location and starter in the intended checkout. A useful handoff lets a fresh session find the agreed behavior, reproduce the baseline check and identify the required return files without reading the original conversation.

**What to tell Codex.** Use the starter supplied with the task. For example, if the file is called `counter-task.zip` and you supplied its location, a short instruction is enough.

```text
$notchlore Read START.md in counter-task.zip. Verify the target, stage the packet, implement TASK.md, run each required check and return the changed files and results.
```

Let the agent complete ordinary implementation and test corrections within the agreed scope. If the baseline check fails, ask which path changed and reconcile the task with the current project. When the session ends, take the return ZIP to the planning chat and [review the delivery](07-review-a-return.md).

[All use cases](README.md)
