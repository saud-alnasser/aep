---
status: resolved
blocked-by: [09]
---

# feat(tracker): issues are optional, and reconcile reads the AEP block

## Outcome

Every tracked effort has one pull request and an issue only when named or a roadmap item; an effort with no issue is numbered for its pull request; reconcile links a pull request by its effort: line and falls back to the closing reference (requirements 10 and 11).

## Acceptance Criteria

- [x] Criterion 10: the tracker policy states the two issue cases and numbering by the pull request; aep open's tracker steps no longer always say create the issue; a test shows both cases.
      Verified: src/policies/tracker.md and templates/issue.template.md state both cases and the numbering; aep open steps branch on --issue; test 'under a tracker, open names an issue only where --issue says one carries the number' passes (45/45).
- [x] Criterion 11: reconcile.mjs links by the effort: line and falls back to the closing reference; tests show a block-only, a keyword-only, and a neither pull request.
      Verified: reconcile.mjs effortOfBody + fallback; verify 'review and bodies' asserts block-only, keyword-only, neither, and block-beats-keyword, each confirmed by perturbation.
- [x] Criterion 12: aep check is clean, the adapters are current, and protocol.md reads 4.15.0.
      Verified: aep check 0 failures, hot_path 4198/4200; adapters regenerated; protocol.md reads 4.15.0.
- [x] Criterion 12: `node src/scripts/release.mjs 4.15.0` runs, `CHANGELOG.md` has a 4.15.0 entry, `.aep/` is reinstalled, and `node src/scripts/verify.mjs` passes.
      Verified: release.mjs 4.15.0 ran; CHANGELOG 4.15.0 entry; .aep/ reinstalled; verify 2523 passed, 0 failed.

## Relevant areas

src/policies/tracker.md, src/scripts/aep.mjs (open), src/scripts/reconcile.mjs, tests/, src/seed/references/github.md, src/seed/references/gitlab.md, src/seed/automation/, specs.md, src/scripts/verify.mjs

## Constraints

One release, 4.15.0, cut after the change and its assertion. specs.md moves in the same pass. No new reviewer, pass, or sub-agent.
