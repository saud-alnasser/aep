---
status: resolved
blocked-by: [04]
---

# feat(review): later rounds read only what changed

## Outcome

Each round records the commit it reviewed; round 2 and later diff from it and carry the open findings, never re-raising one already fixed or accepted (requirement 5).

## Acceptance Criteria

- [x] Criterion 5: aep record writes the reviewed commit into ## Rounds, shown by a test; the review skill tells round 2 to diff from it; asserted.
      Verified: node --test tests/aep.test.mjs printed "pass 44, fail 0", including "a review round records the commit it judged, and a round with no Important finding is clear" and "a review round names a commit that exists". The section fails by name with --at dropped from implement.md, and with the record line renamed in aep.mjs.
- [x] Criterion 12: `node src/scripts/release.mjs 4.10.0` runs, `CHANGELOG.md` has a 4.10.0 entry, `.aep/` is reinstalled, and `node src/scripts/verify.mjs` passes.
      Verified: "released 4.10.0"; verify.mjs printed "2467 passed, 0 failed"; aep check clean, hot path 4186/4200.

## Relevant areas

src/scripts/aep.mjs (record), tests/aep.test.mjs, src/skills/review.md, src/policies/execution.md, specs.md, src/scripts/verify.mjs

## Constraints

One release, 4.10.0, cut after the change and its assertion. specs.md moves in the same pass. No new reviewer, pass, or sub-agent.
