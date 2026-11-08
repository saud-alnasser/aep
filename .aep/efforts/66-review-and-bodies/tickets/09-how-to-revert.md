---
status: open
blocked-by: [08]
---

# feat(tracker): the risk section says how to revert

## Outcome

The pull request template's risk section states how to undo the change, or that it cannot be undone and why (requirement 9).

## Acceptance Criteria

- [ ] Criterion 9: the pull request template's risk section has a revert line; asserted.
- [ ] Criterion 12: `node src/scripts/release.mjs 4.14.0` runs, `CHANGELOG.md` has a 4.14.0 entry, `.aep/` is reinstalled, and `node src/scripts/verify.mjs` passes.

## Relevant areas

src/templates/pull-request.template.md, specs.md, src/scripts/verify.mjs

## Constraints

One release, 4.14.0, cut after the change and its assertion. specs.md moves in the same pass. No new reviewer, pass, or sub-agent.
