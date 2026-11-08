---
status: open
blocked-by: [04]
---

# feat(review): later rounds read only what changed

## Outcome

Each round records the commit it reviewed; round 2 and later diff from it and carry the open findings, never re-raising one already fixed or accepted (requirement 5).

## Acceptance Criteria

- [ ] Criterion 5: aep record writes the reviewed commit into ## Rounds, shown by a test; the review skill tells round 2 to diff from it; asserted.
- [ ] Criterion 12: `node src/scripts/release.mjs 4.10.0` runs, `CHANGELOG.md` has a 4.10.0 entry, `.aep/` is reinstalled, and `node src/scripts/verify.mjs` passes.

## Relevant areas

src/scripts/aep.mjs (record), tests/aep.test.mjs, src/skills/review.md, src/policies/execution.md, specs.md, src/scripts/verify.mjs

## Constraints

One release, 4.10.0, cut after the change and its assertion. specs.md moves in the same pass. No new reviewer, pass, or sub-agent.
