---
status: resolved
blocked-by: [02]
---

# feat(review): every finding cites a line the reviewer opened

## Outcome

Every finding cites path:line, opened before it is reported; an uncited finding is dropped and counted (requirement 3).

## Acceptance Criteria

- [x] Criterion 3: both reviewer agents require path:line, opened before reporting, and a dropped count in the return; asserted.
      Verified: the section passed; with "you open that line" changed to "you read that line" it printed "FAIL the findings note and both reviewer agents require an opened path:line".
- [x] Criterion 12: `node src/scripts/release.mjs 4.8.0` runs, `CHANGELOG.md` has a 4.8.0 entry, `.aep/` is reinstalled, and `node src/scripts/verify.mjs` passes.
      Verified: "released 4.8.0, 3 artifacts changed"; verify.mjs printed "2461 passed, 0 failed"; aep check clean.

## Relevant areas

src/agents/reviewer-*.md, specs.md, src/scripts/verify.mjs

## Constraints

One release, 4.8.0, cut after the change and its assertion. specs.md moves in the same pass. No new reviewer, pass, or sub-agent.
