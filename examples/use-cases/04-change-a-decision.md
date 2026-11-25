# Change an accepted requirement

An organizer previously approved one email per registration. After trying a busy event, she wants a single daily digest. The existing code, queue and earlier acceptance check all encode the old decision. Editing the feature description alone would leave three conflicting instructions for the next coding session.

Give the planner the accepted decision, its old check and the current delivery flow. Settle the details that change what recipients experience. In this example the organizer chooses a 17:00 digest in the event’s time zone, skips empty days and wants each registration included once.

```text
notchlore. Replace per-registration emails with a daily digest. Trace the affected decisions, pending messages and checks. Show the proposed cutover before preparing the task.
```

Use a concrete cutover. A registration arrives at 16:59, deployment happens at 17:00 and an old individual email is still queued. Ask who owns that queued item and how the next run knows whether it was sent. If the available system cannot settle an uncertain send, preserve it as an operator decision. Quietly retrying can send two emails.

**What to keep.** A revised decision with a date or revision, the agreed handling of pending work and a replacement check covering the boundary. Retain the old decision as history so a reviewer can explain why its check changed. The coding task can then point to the revised requirement, while the return records when the implementation actually changed.

[All use cases](README.md)
