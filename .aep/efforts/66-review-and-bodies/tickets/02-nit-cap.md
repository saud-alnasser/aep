---
status: resolved
blocked-by: [01]
---

# feat(review): cap nits at 3, and a nit starts no round

## Outcome

A reviewer reports at most 3 nits per axis; a nit never blocks and never starts a round (requirement 2).

## Acceptance Criteria

- [x] Criterion 2: both reviewer agents state the cap and that a nit starts no round; asserted.
      Verified: the section passed; with "with at most 3 Nits" removed from reviewer-standards it printed "FAIL the findings note and both reviewer agents cap Nits at 3".
- [x] Criterion 12: `node src/scripts/release.mjs 4.7.0` runs, `CHANGELOG.md` has a 4.7.0 entry, `.aep/` is reinstalled, and `node src/scripts/verify.mjs` passes.
      Verified: "released 4.7.0, 3 artifacts changed"; verify.mjs printed "2459 passed, 0 failed"; aep check clean, hot path 4188/4200.

## Relevant areas

src/agents/reviewer-*.md, src/skills/review.md, specs.md, src/scripts/verify.mjs

## Constraints

One release, 4.7.0, cut after the change and its assertion. specs.md moves in the same pass. No new reviewer, pass, or sub-agent.
