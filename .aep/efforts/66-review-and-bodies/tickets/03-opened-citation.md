---
status: open
blocked-by: [02]
---

# feat(review): every finding cites a line the reviewer opened

## Outcome

Every finding cites path:line, opened before it is reported; an uncited finding is dropped and counted (requirement 3).

## Acceptance Criteria

- [ ] Criterion 3: both reviewer agents require path:line, opened before reporting, and a dropped count in the return; asserted.
- [ ] Criterion 12: `node src/scripts/release.mjs 4.8.0` runs, `CHANGELOG.md` has a 4.8.0 entry, `.aep/` is reinstalled, and `node src/scripts/verify.mjs` passes.

## Relevant areas

src/agents/reviewer-*.md, specs.md, src/scripts/verify.mjs

## Constraints

One release, 4.8.0, cut after the change and its assertion. specs.md moves in the same pass. No new reviewer, pass, or sub-agent.
