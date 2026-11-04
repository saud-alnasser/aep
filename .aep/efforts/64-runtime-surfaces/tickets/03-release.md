---
status: resolved
blocked-by: [02]
---

# chore(dist): release 4.2.0 and reinstall this repository's tree

## Outcome

4.2.0 ships the runtime work. This repository reinstalls onto it, and the suite
passes with nothing edited and unreleased.

## Acceptance Criteria

- [x] Criterion 9: `node src/scripts/release.mjs 4.2.0` re-stamps what changed
      and sets the version of record; `node src/scripts/verify.mjs` passes.
      Verified: release printed "released 4.2.0, 8 artifacts changed, 115
      unchanged", after `git fetch` showed `origin/main` still at 4.1.0.
      `node src/scripts/verify.mjs` printed "2413 passed, 0 failed", with the
      seeded failure discarded.
- [x] Criterion 9: `CHANGELOG.md` has a 4.2.0 entry, and the upgrade notice
      for 4.2.0 is declared.
      Verified: the entry has Added, Changed, and Upgrading sections; the
      reinstall printed the 4.2.0 notice under "1 thing to check".
- [x] This repository's `.aep/` is reinstalled onto 4.2.0, and
      `node .aep/scripts/aep.mjs check` is clean.
      Verified: `install.mjs --into . --update`, then `validate.mjs` printed
      "253 artifacts checked, no failures", and `aep check` printed "validate 0
      failure(s); 0 over budget; 0 rationale; 0 outside-write wording".

## Relevant areas

`src/scripts/release.mjs`, `CHANGELOG.md`, `src/stamps.json`, `.aep/`.
