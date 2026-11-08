---
status: resolved
blocked-by: [08]
---

# feat(tracker): the risk section says how to revert

## Outcome

The pull request template's risk section states how to undo the change, or that it cannot be undone and why (requirement 9).

## Acceptance Criteria

- [x] Criterion 9: the pull request template's risk section has a revert line; asserted.
      Verified: the section reads the risk section of the template and finds "To revert:"; with it renamed to "Undo:" it printed "FAIL the pull request template has a revert line".
- [x] Criterion 12: `node src/scripts/release.mjs 4.14.0` runs, `CHANGELOG.md` has a 4.14.0 entry, `.aep/` is reinstalled, and `node src/scripts/verify.mjs` passes.
      Verified: "released 4.14.0"; verify.mjs printed "2510 passed, 0 failed"; aep check clean.

## Relevant areas

src/templates/pull-request.template.md, specs.md, src/scripts/verify.mjs

## Constraints

One release, 4.14.0, cut after the change and its assertion. specs.md moves in the same pass. No new reviewer, pass, or sub-agent.
