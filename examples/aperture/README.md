# Aperture format example

These are synthetic format fixtures. They teach the record shape and exercise the real checker; they do not qualify a customer project or the Notch Lore release. Every reference is local and hash-bound.

From the repository root:

```bash
node bin/notchlore.mjs score examples/aperture/assessment.json --root examples/aperture
node bin/notchlore.mjs score examples/aperture/runtime-not-run.json --root examples/aperture
```

The documentation fixture structurally passes with a visible bounded uncertainty in D12 (9/10); its MVP threshold is 7. The implementation fixture is structurally valid but **NOT RUN**, with UNKNOWN dimensions and no invented scores. The command returns a nonzero exit status for unpassed readiness, including the second fixture; this is expected.

The supplied evidence explicitly identifies itself as synthetic. A structural PASS checks declarations, references, byte hashes and bindings, not whether a review was competent or a test actually ran. Replace these declarations with actual project goals, scoped criteria, source/review/result evidence and candidate/environment identities before using the format for a real readiness decision. The assistant maintains this record; the owner does not complete a technical questionnaire.

Assessment schema: `schemas/aperture.schema.json` in the repository. The canonical machine policy lives in `skills/notchlore/references/aperture-rules.json`; plane-specific rubrics live in `skills/notchlore/references/METHOD.md`.
