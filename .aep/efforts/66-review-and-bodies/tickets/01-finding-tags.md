---
status: open
---

# feat(review): tag findings Important, Nit, or Pre-existing

## Outcome

Every review finding carries one of three tags, only Important blocks, and a Pre-existing finding is recorded rather than fixed in the effort (requirement 1).

## Acceptance Criteria

- [ ] Criterion 1: the review skill and both reviewer agents define the three tags and say only Important blocks; a verify.mjs assertion fails when a tag is removed.
- [ ] Criterion 12: `node src/scripts/release.mjs 4.6.0` runs, `CHANGELOG.md` has a 4.6.0 entry, `.aep/` is reinstalled, and `node src/scripts/verify.mjs` passes.

## Relevant areas

src/skills/review.md, src/agents/reviewer-*.md, src/policies/execution.md, specs.md, src/scripts/verify.mjs

## Constraints

One release, 4.6.0, cut after the change and its assertion. specs.md moves in the same pass. No new reviewer, pass, or sub-agent.
