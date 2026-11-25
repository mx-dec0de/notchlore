# Review what an agent delivered

A coding agent returns an invoice change and a green test report. The accepted rule says a line total is unit price multiplied by quantity, in integer cents. The report shows only an empty invoice. That case returns zero even if the implementation ignores quantity.

Give the planning chat the accepted task, returned diff, candidate identity and test output. Read the changed calculation. If the diff sums unit prices alone, identify the smallest input that distinguishes the two formulas.

```text
notchlore. Review the returned invoice change against the quantity rule. Trace each reported check to its input and expected result. Give me the smallest case that could expose a wrong total.
```

| Input | Required total | Total if quantity is ignored |
| --- | ---: | ---: |
| Empty invoice | 0 cents | 0 cents |
| One line, 350 cents, quantity 1 | 350 cents | 350 cents |
| One line, 350 cents, quantity 3 | 1,050 cents | 350 cents |

The third input can settle the question. Have Codex run it against the returned build and retain the command, expected result and actual output. A chat review with only the diff can identify the missing test. It must leave the execution result open until someone runs it.

**What to keep.** A finding tied to the quantity rule, the discriminating test, the fix if needed, and the result on the corrected build. Keep the empty-invoice check because it covers a different boundary. The table is an illustrative calculation. The actual project’s result belongs in its return packet.

[All use cases](README.md)
