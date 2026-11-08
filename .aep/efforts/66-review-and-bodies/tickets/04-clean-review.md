---
status: open
blocked-by: [03]
---

# feat(review): a clean review says Nothing to fix

## Outcome

The review report leads with the count per tag, and a review with no findings says exactly Nothing to fix (requirement 4).

## Acceptance Criteria

- [ ] Criterion 4: the review skill's report step requires the count per tag first and the words Nothing to fix; asserted.
- [ ] Criterion 12: `node src/scripts/release.mjs 4.9.0` runs, `CHANGELOG.md` has a 4.9.0 entry, `.aep/` is reinstalled, and `node src/scripts/verify.mjs` passes.

## Relevant areas

src/skills/review.md, specs.md, src/scripts/verify.mjs

## Constraints

One release, 4.9.0, cut after the change and its assertion. specs.md moves in the same pass. No new reviewer, pass, or sub-agent.
