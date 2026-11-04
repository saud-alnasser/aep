---
status: resolved
blocked-by: [03]
---

# feat(cli): an effort declares the efforts it builds on, and stacks on or waits for them

## Outcome

A spec's `builds-on:` names the efforts it needs. `aep open` stacks the new
branch on an open one where the repository stacks, adopts a runtime branch made
from it, and otherwise waits; `aep status` shows each edge. Under a tracker the
edge becomes a GitHub dependency. 4.3.0 ships it.

## Acceptance Criteria

- [x] Criterion 11: `validate.mjs` accepts `builds-on:` on a spec and refuses it
      elsewhere; `open` with a merged dependency opens from the base; with an
      open one and `stack: true` the branch's parent is that effort's tip; a
      runtime branch carrying the dependency is adopted, and one carrying any
      other effort is not; `stack: false` and two open dependencies stop with the
      draft kept; an unknown name stops; `status` shows the edge and its state.
      Verified: `node --test tests/aep.test.mjs` passes the five builds-on tests
      ("builds-on is legal on a spec and nowhere else" through "an effort waits
      where it cannot stack..."); whole run 36 pass, 0 fail.
- [x] Criterion 12: the suite asserts the tracker policy's dependency step
      (`--add-blocked-by`, and the pull request naming what it builds on) and the
      specify skill writing the field.
      Verified: `node src/scripts/verify.mjs` passes "the tracker policy sets each
      builds-on edge as an issue dependency..." and "the specify skill writes
      builds-on...".
- [x] Requirement 20, for 4.3.0: `specs.md` states requirements 11 to 13 with
      rationale, including the frontmatter contract; `release.mjs 4.3.0` runs;
      the changelog has a 4.3.0 entry (no notice: nothing asks a repository to act); `verify.mjs` passes.
      Verified: release printed the changed artifacts; verify printed "2419
      passed, 0 failed"; `aep check` is clean.

## Relevant areas

`src/scripts/aep.mjs` (`open`, `effortIndex`, the status board),
`src/scripts/validate.mjs`, `src/templates/spec.template.md`,
`src/skills/specify.md`, `src/policies/tracker.md`, `src/policies/artifacts.md`,
`specs.md` (§8 frontmatter, §19), `src/scripts/verify.mjs`,
`src/scripts/payload.mjs`, `tests/aep.test.mjs`, `CHANGELOG.md`.

## Notes

Ticket `blocked-by` under `stack: true` already means "stack on top of";
`builds-on:` carries the same meaning one level up. Watch the policy word
budgets: `aep check` must stay clean.
