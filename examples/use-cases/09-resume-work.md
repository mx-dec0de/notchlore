# Resume interrupted work

A session stops halfway through producing an export. Its checkpoint says “export started.” A file exists in the output directory, and the last log line shows that a worker picked up the job. Starting again immediately might create a second export while the first worker is still writing.

Give the next Codex session the accepted task, last checkpoint, working directory and any job identifier the previous session recorded. Ask for an inventory before allowing a retry.

```text
$notchlore Resume the export task from its checkpoint. Check the current files, job state and output before retrying. Identify the first unfinished step you can establish.
```

Trace the same job ID through the worker state and the output. A completed job with an intact readable export can go straight to verification. A live writer should keep ownership while the reviewer checks its state. A partial file with no conclusive job record leaves an uncertain effect. Record what would resolve it, such as a durable completion entry or a known output digest. Choose the next action from what the project can actually establish.

**What to keep.** Update the checkpoint with the candidate, verified effects, unresolved effects, current owner and next command or check. If a supported Codex session ID was recorded, use it to recover the conversation; a fresh session can also work from the durable records. The acceptance check remains the same in either case: one complete export for the requested job.

[All use cases](README.md)
