---
status: resolved
---

# feat(review): tag findings Important, Nit, or Pre-existing

## Outcome

Every review finding carries one of three tags, only Important blocks, and a Pre-existing finding is recorded rather than fixed in the effort (requirement 1).

## Acceptance Criteria

- [x] Criterion 1: the review skill and both reviewer agents define the three tags and say only Important blocks; a verify.mjs assertion fails when a tag is removed.
      Verified: `verify.mjs --section "review and bodies"` printed "4 passed"; with `| **Nit** |` removed from the tag table it printed "FAIL the review skill defines the three tags", then passed again once restored.
- [x] Criterion 12: `node src/scripts/release.mjs 4.6.0` runs, `CHANGELOG.md` has a 4.6.0 entry, `.aep/` is reinstalled, and `node src/scripts/verify.mjs` passes.
      Verified: `release.mjs 4.6.0` printed "released 4.6.0, 5 artifacts changed"; `verify.mjs` printed "2457 passed, 0 failed"; `aep check` reports 0 over budget, hot path 4188/4200.

## Relevant areas

src/skills/review.md, src/agents/reviewer-*.md, src/policies/execution.md, specs.md, src/scripts/verify.mjs

## Constraints

One release, 4.6.0, cut after the change and its assertion. specs.md moves in the same pass. No new reviewer, pass, or sub-agent.

## Notes

The tag rules live in a new note, `skills/review/findings.md`, and the review skill points at it. The standard-lane hot path had about 45 words of headroom, and the note loads only when a review runs.
