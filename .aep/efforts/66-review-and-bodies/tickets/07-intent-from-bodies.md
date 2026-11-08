---
status: resolved
blocked-by: [06]
---

# feat(review): read pull request and issue bodies as intent

## Outcome

With no spec.md, /review reads the pull request body and its linked issue body before asking, and never comment threads (requirement 7).

## Acceptance Criteria

- [x] Criterion 7: the review skill's step 2 lists the bodies after spec.md and before asking, and forbids comment threads; asserted.
      Verified: the section asserts the order spec.md, then the bodies, then "If none answers, ask"; with "never threads" removed it printed "FAIL the review skill reads the pull request and issue bodies".
- [x] Criterion 12: `node src/scripts/release.mjs 4.12.0` runs, `CHANGELOG.md` has a 4.12.0 entry, `.aep/` is reinstalled, and `node src/scripts/verify.mjs` passes.
      Verified: "released 4.12.0"; verify.mjs printed "2480 passed, 0 failed"; aep check clean, hot path 4198/4200.

## Relevant areas

src/skills/review.md, specs.md, src/scripts/verify.mjs

## Constraints

One release, 4.12.0, cut after the change and its assertion. specs.md moves in the same pass. No new reviewer, pass, or sub-agent.
