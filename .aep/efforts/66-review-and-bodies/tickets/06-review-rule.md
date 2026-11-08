---
status: open
blocked-by: [05]
---

# feat(review): load an optional rules/review.md

## Outcome

/review loads rules/review.md where it exists, a template states its shape, and this repository has its own (requirement 6).

## Acceptance Criteria

- [ ] Criterion 6: templates/review.template.md exists, the review skill loads rules/review.md, and .aep/rules/review.md exists here with the three points; asserted for the template and the skill.
- [ ] Criterion 12: `node src/scripts/release.mjs 4.11.0` runs, `CHANGELOG.md` has a 4.11.0 entry, `.aep/` is reinstalled, and `node src/scripts/verify.mjs` passes.

## Relevant areas

src/templates/, src/skills/review.md, .aep/rules/review.md, src/scripts/manifest.mjs, specs.md, src/scripts/verify.mjs

## Constraints

One release, 4.11.0, cut after the change and its assertion. specs.md moves in the same pass. No new reviewer, pass, or sub-agent.
