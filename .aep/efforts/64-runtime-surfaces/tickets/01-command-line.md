---
status: resolved
---

# feat(cli): the command line works from a runtime's worktree on any branch name

## Outcome

`aep open` in a worktree the runtime supplied commits the effort on the
runtime's branch. Every command finds an effort by what a branch's commits
touch, acts in the worktree holding that branch, and dispatches children from
it under the main checkout. A runtime that sets up its own worktrees is not set
up twice. `aep release` frees a branch `_run` holds for another runtime, and a
branch another runtime holds is named as `continue_in`.

## Acceptance Criteria

- [x] Criterion 1: adoption on a named runtime branch, a new branch on a
      detached one, and a stop where the branch already holds an effort.
      Verified: `node --test tests/aep.test.mjs` passes "open in a runtime
      surface commits on the branch the runtime named" and "open in a surface
      the runtime supplied takes no second one" (the detached case).
- [x] Criterion 2: every command finds an effort on `t3code/abc123` from either
      surface; two holders stop naming both; a ticket branch is never the
      effort's branch.
      Verified: passes "every command finds an effort on a runtime-named
      branch" and "two branches holding one effort stop the command".
- [x] Criterion 3: dispatch from a runtime surface places children under the
      main checkout, as implementers, and land integrates into the runtime
      branch; record from the main checkout writes the runtime surface.
      Verified: passes "dispatch from a runtime surface puts each child under
      the main checkout"; `scope.mjs read --json` in each child printed
      `role: implementer`. The record case is in the criterion 2 test.
- [x] Criterion 4: setup is deferred where `t3.json` declares a worktree
      setup, `runtime-setup` overrides it both ways, a lockfile change reruns
      it, and a child surface is always warmed.
      Verified: passes "a runtime that sets up its own worktrees is not set up
      twice" over four settings cases; the dispatch test asserts each child's
      setup ran.
- [x] Criterion 10: continuing across runtimes in both directions, with
      `continue_in`, `release`, and the carried handoff.
      Verified: passes "work begun in a runtime's worktree continues in
      another runtime" and "release frees an effort begun in AEP's own
      surface". Whole run: 26 tests, 26 pass, 0 fail.

## Relevant areas

`src/scripts/aep.mjs`, `src/scripts/scope.mjs`, `tests/aep.test.mjs`,
`src/seed/rules/version-control.md`.
