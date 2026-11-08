---
status: open
blocked-by: [07]
---

# feat(tracker): issue and pull request templates, human part on top

## Outcome

Two templates are the one home of each body shape, with a human part on top and a folded AEP block at the bottom; the contradictions in the policy, rule seed, and GitHub reference are removed (requirements 8 and 12).

## Acceptance Criteria

- [ ] Criterion 8: both templates exist with the human sections and the AEP block; the tracker policy names them, states no body shape of its own, and says ticks are in the pull request only, the issue is written once, and log.md is linked; asserted.
- [ ] Criterion 12: the phrase Prepare the body; do not submit it appears nowhere under src/ or .aep/.
- [ ] Criterion 12: `node src/scripts/release.mjs 4.13.0` runs, `CHANGELOG.md` has a 4.13.0 entry, `.aep/` is reinstalled, and `node src/scripts/verify.mjs` passes.

## Relevant areas

src/templates/, src/policies/tracker.md, src/seed/rules/, src/seed/references/github.md, src/seed/references/gitlab.md, .aep/rules/version-control.md, .aep/references/github.md, specs.md, src/scripts/verify.mjs

## Constraints

One release, 4.13.0, cut after the change and its assertion. specs.md moves in the same pass. No new reviewer, pass, or sub-agent.
