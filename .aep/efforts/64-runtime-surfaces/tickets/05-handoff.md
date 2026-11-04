---
status: resolved
blocked-by: [04]
---

# feat(cli): the agent moves an effort between runtimes by itself, guarded by a lease

## Outcome

`aep start` from any directory hands back the surface holding the effort, with
`move: true` where the agent must move. A lease keeps two sessions out of one
surface, and `aep yield` gives it up. The Claude adapter's hooks resume an
effort at session start, renew the lease each turn, and yield it at session
end. The skills have the agent make every move. 4.4.0 ships it.

## Acceptance Criteria

- [x] Criterion 13: `start` from the main checkout on an effort held by a
      runtime worktree returns that path with `move: true`; a live foreign lease
      stops it naming the holder; a stale one is taken over and reported; the
      same session renews; `yield` clears; with no session id no lease is
      written. The 4.2 `continue_in` tests are updated to the new behaviour.
      Verified: `node --test tests/aep.test.mjs` passes "start from anywhere
      hands back the surface, and a lease keeps one session in it" and the
      updated 4.2 tests; whole run 38 pass, 0 fail.
- [x] Criterion 14: each hook script, run with a hook input on stdin:
      `SessionStart` in a surface names its effort and next step, in the main
      checkout lists open efforts, and is silent without AEP; `Stop` renews;
      `SessionEnd` yields. The suite asserts `hooks.json` registers all three.
      Verified: passes "the session hooks resume an effort, renew its lease each
      turn, and give it up at the end"; verify passes "the Claude adapter
      registers the session hooks for start, every turn, and the end".
- [x] Requirement 20, for 4.4.0: `specs.md` states requirements 14 to 17 with
      rationale; the implement and handoff skills leave no command to the
      developer; `release.mjs 4.4.0` runs; the changelog has a 4.4.0 entry;
      `verify.mjs` passes.
      Verified: release 4.4.0 ran; verify printed "2421 passed, 0 failed";
      `aep check` is clean.

## Relevant areas

`src/scripts/aep.mjs` (`start`, `enterSurface`, every command that renews,
a new `yield`), `src/adapters/claude/hooks/`, `src/skills/implement.md`,
`src/skills/handoff.md`, `specs.md` (§21.1), `src/scripts/verify.mjs`,
`tests/aep.test.mjs`, `CHANGELOG.md`.

## Notes

Facts: `evidence/research/claude-code-continuation.md` (hook inputs and
outputs, `CLAUDE_CODE_SESSION_ID`, `EnterWorktree`) and
`evidence/research/t3code-orchestration.md` (no T3 tool maps a worktree to a
thread, and `existing_worktree` does not check exclusivity, so the lease is the
only guard). Hook text states facts, never commands.
