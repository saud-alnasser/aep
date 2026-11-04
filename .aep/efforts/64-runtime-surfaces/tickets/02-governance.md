---
status: resolved
blocked-by: [01]
---

# docs(protocol): where a child runs, the runtime's worktree, and the T3 Code reference

## Outcome

The parallel policy, the dispatch note, and the implementer agent run an
implementer only in a surface `aep dispatch` created, and keep a runtime's own
delegation to read-only work. The protocol's write zones name the runtime's
worktree. The implement and handoff skills say how to continue in another
runtime. The T3 Code reference is rewritten from verified facts. `specs.md`
states all of it, the suite asserts it, and an upgrade notice reaches
repositories that own a stale reference.

## Acceptance Criteria

- [x] Criterion 5: the suite asserts the parallel policy's surface rules, the
      dispatch note's pointer, and the implementer's stop.
      Verified: `node src/scripts/verify.mjs` passes "the parallel policy runs
      an implementer only where aep dispatch put it", "...keeps a runtime's own
      delegation to read-only work", "the dispatch note sends a child only to
      the surface aep dispatch created", and "the implementer stops where its
      surface reports another role".
- [x] Criterion 6: the suite asserts the protocol's zone row, and
      `aep check` passes the budgets.
      Verified: passes "the protocol's write zones name the runtime's
      worktree"; `node src/scripts/check.mjs --root src` printed "check:
      clean" (protocol 1000 of 1000 words, parallel policy 800 of 800).
- [x] Criterion 7: the suite asserts the reference names no `.t3-worktrees`,
      names the commit it was read from, and keeps `delegate_task` read-only.
      Verified: passes the seven "the T3 Code reference ..." assertions and
      "the T3 Code reference says how to continue in another runtime".
- [x] Criterion 8: the suite asserts the new `specs.md` statements.
      Verified: passes the five "specs.md §18.2/§18.3/§19.3/§21.1 ..."
      assertions. The suite printed 2405 passed, 8 failed; all 8 are release
      stamps and notice checks against the unreleased version, which ticket 03
      cuts.

## Relevant areas

`src/policies/execution/parallel.md`, `src/skills/implement/dispatch.md`,
`src/agents/implementer.md`, `src/protocol.md`, `src/skills/implement.md`,
`src/skills/handoff.md`, `src/seed/references/t3code.md`, `specs.md`,
`src/scripts/verify.mjs`, `src/scripts/payload.mjs`.

## Notes

The facts come from `evidence/research/t3code-runtime.md` and
`evidence/research/claude-code-sandbox.md`.
