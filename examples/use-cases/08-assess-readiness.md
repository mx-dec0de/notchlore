# Decide whether a version is ready

A team wants to call an importer MVP-ready. The design explains how old files will open. The implementation author has reviewed the reader but has yet to run it against a supported older file. The first decision is which claim the available material can support.

Give the reviewer the accepted scope and MVP stage, identified source or build, environment, required checks, and evidence files. Ask for separate documentation and implementation assessments. Each applicable dimension gets its own findings. A required compatibility run belongs in the implementation gates.

```text
notchlore. Assess this importer for MVP. Give me separate design and implementation results, the evidence for compatibility, and the exact check holding up either decision.
```

For an example of the output format, run the two fixtures in the [assessment guide](../assessment-guide.md). The design fixture prints eleven 10s and one 9. The runtime fixture prints `UNKNOWN` for all twelve dimensions, shows its mandatory gate as `NOT RUN` and exits 2. Both records are synthetic. They show how to read the output without assuming a customer release has passed.

**Make the next action specific.** In the importer scenario, name the old-format fixture, the candidate to open it with and the required result. Once that run exists, attach its evidence and reassess the affected criteria. A score reaching the MVP floor of 7 settles only the numeric part. Every applicable mandatory gate still needs a passing result for this candidate.

[All use cases](README.md)
