# Document an existing project

You inherit a roadmap editor. Its README says “export and restore,” but nobody can tell you whether a restored project keeps its milestone order. Your first deliverable is documentation of what the current version does. Leave changes to application behavior for a separate decision.

**Start in the checkout.** Find the root, project instructions and local changes. From the project machine, use the inventory below. Then read the actual entry points. In a chat-only session, attach a reviewed snapshot, the existing docs and a small exported file. Record which revision the snapshot describes.

```sh
npx --yes --package=notchlore@2.0.0 notchlore inspect . --json
```

```text
$notchlore Document this editor as it exists. Trace export and restore through code and a sample. Update the project docs. Preserve the code and record what needs a runtime check.
```

**Build the document around one journey.** Start at the Export action and follow the writer, file format, reader and restored view. For each step, name the owning file or symbol. Choose an exported roadmap with two milestones whose display order differs from their alphabetical order. A single-item fixture cannot expose sorting during import.

| Question | Evidence to put beside the answer |
| --- | --- |
| What gets written? | Writer path and the relevant fields in a sample export. |
| What can be restored? | Reader path, accepted versions and handling of missing fields. |
| Does order survive? | Input order, observed restored order and the revision actually exercised. |

**Leave one useful record.** Update the existing project overview with the user journey, responsible components, file contract and unresolved questions. Link to existing format or API docs where they already own the detail. If the supplied snapshot contains only the writer, record the reader as unavailable and leave recovery unverified. A proposed improvement can go in a separate next-work section.

Hand that document to someone new and ask them to find the code that controls milestone order and the evidence that restoration works. If the only answer is “the README says so,” add the missing source reference or make the uncertainty explicit.

[All use cases](README.md)
