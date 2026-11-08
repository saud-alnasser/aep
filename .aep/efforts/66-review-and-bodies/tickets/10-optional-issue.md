---
status: open
blocked-by: [09]
---

# feat(tracker): issues are optional, and reconcile reads the AEP block

## Outcome

Every tracked effort has one pull request and an issue only when named or a roadmap item; an effort with no issue is numbered for its pull request; reconcile links a pull request by its effort: line and falls back to the closing reference (requirements 10 and 11).

## Acceptance Criteria

- [ ] Criterion 10: the tracker policy states the two issue cases and numbering by the pull request; aep open's tracker steps no longer always say create the issue; a test shows both cases.
- [ ] Criterion 11: reconcile.mjs links by the effort: line and falls back to the closing reference; tests show a block-only, a keyword-only, and a neither pull request.
- [ ] Criterion 12: aep check is clean, the adapters are current, and protocol.md reads 4.15.0.
- [ ] Criterion 12: `node src/scripts/release.mjs 4.15.0` runs, `CHANGELOG.md` has a 4.15.0 entry, `.aep/` is reinstalled, and `node src/scripts/verify.mjs` passes.

## Relevant areas

src/policies/tracker.md, src/scripts/aep.mjs (open), src/scripts/reconcile.mjs, tests/, src/seed/references/github.md, src/seed/references/gitlab.md, src/seed/automation/, specs.md, src/scripts/verify.mjs

## Constraints

One release, 4.15.0, cut after the change and its assertion. specs.md moves in the same pass. No new reviewer, pass, or sub-agent.
