# Refactor without changing behavior

The sample roadmap editor has two readers, Open and Import. Both convert a saved milestone into the internal format. Their handling of a missing title looks similar. Before merging them, establish whether the two entry points promise the same behavior. Similar-looking code can serve different contracts.

Bring the two call sites, a previous-version file, an example with an empty title and the existing tests. Ask for a short read-only pass before choosing the refactor.

```text
$notchlore Trace the title rule in Open and Import. Show the callers and existing behavior. Propose the smallest refactor that gives the shared rule one owner, with before-and-after checks.
```

**Record the baseline through the public entry points.** Open and import the same files. Capture the visible title, milestone order and any persisted changes. The table below is a proposed check list. Fill in observations from the real checkout before editing.

| Fixture | What to compare before and after |
| --- | --- |
| Previous-version file without a title | Displayed fallback and original file bytes after opening. |
| Current file with a title | Title and milestone IDs in their original order. |
| Malformed file | Observable error and whether the previously open roadmap survives. |

If both readers share only the missing-field rule, extract that rule and leave the different error handling in each caller. If the two readers disagree on intended behavior, record the discrepancy for a separate product decision. A refactor should preserve the agreed behavior at both entry points. An extra framework or a format migration would need its own justification.

**What to return.** A small diff showing the shared owner and both callers, the same fixture results from before and after, and any remaining intentional difference. The most useful review question is whether a user can open the same files, see the same results and recover from the same errors after the internal change.

[All use cases](README.md)
