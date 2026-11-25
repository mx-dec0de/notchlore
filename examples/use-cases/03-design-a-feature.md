# Design a new feature

A customer asks to “save roadmaps.” That could mean downloading a named file, keeping projects in the browser, or storing them in an account. Those choices affect the interface, where data lives and what happens when it disappears. Before preparing a coding task, give ChatGPT the current save/load flow, an older project file, and the user’s situation.

```text
notchlore. Users want to reopen a named roadmap tomorrow on the same laptop. Compare two ways to do that in this editor. Recommend one, sketch the interaction and draft the acceptance checks.
```

Suppose the editor already imports and exports files, and the user needs a copy they can move between browsers. Extending that file flow reuses the existing reader and writer. Browser-only storage makes reopening easier on one browser profile but leaves the portable copy unresolved. Write down why the file route fits this version. Accounts can remain a later decision.

**Make the design specific enough to build.** Where does the title appear? What does the user see when opening a file created before titles existed? Does opening that file modify it? In this example the editor shows “Untitled” for an old file, preserves its bytes until Save and keeps the milestone order. An existing format specification is the right place to record the optional field and default.

| User action | Acceptance example |
| --- | --- |
| Open an older roadmap | Display “Untitled,” preserve milestone IDs and order, and leave the original file intact. |
| Title and save a copy | Reopen the copy in a fresh session and see the title and the same milestones. |

**What leaves the design chat.** A short feature specification with the target user, chosen interaction, saved-field rule, compatibility examples and excluded work. Review it using a real older file. Once accepted, ask for the task ZIP. The IDE receives the approved design and fixtures together. The later return supplies the actual outcomes for those two checks.

[All use cases](README.md)
