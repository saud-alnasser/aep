---
status: resolved
blocked-by: [06]
---

# fix(runtime): under T3 Code, tickets run inside the effort's thread

## Outcome

Under T3 Code, an effort's tickets run as sub-agents of the provider inside the
effort's thread. T3 shows each one under that thread, with its transcript, and
gives it no sidebar row, so the sidebar holds one row per effort. The T3 Code
playbook no longer launches a thread per ticket. 4.5.1 ships it.

## Acceptance Criteria

- [x] Criterion 18: the suite asserts that the T3 Code playbook builds tickets
      as sub-agents of the effort's thread, never with `t3_thread_launch`, and
      that `specs.md` states one thread per effort; `protocol.md` declares
      4.5.1; the changelog has a 4.5.1 entry; `verify.mjs` passes. Verified:
      `node src/scripts/verify.mjs`, assertions "the T3 Code playbook builds
      tickets as sub-agents of the effort's thread..." and "specs.md §21.1
      keeps one T3 thread per effort"; 2441 passed, 0 failed; `.aep/protocol.md`
      `version: 4.5.1`; `aep check` clean.

## Relevant areas

`src/seed/references/t3code.md` (the playbook), `specs.md` §21.1,
`src/scripts/verify.mjs`, `CHANGELOG.md`.

## Notes

Read from T3 Code at `9e85538535c8`, in
`evidence/research/t3code-subagents.md`: T3 turns each Claude Code Agent-tool
sub-agent, foreground or background, into a child thread of the thread that
started it, with no sidebar row; Codex sub-agents too. The child records the
parent's `worktreePath`, so T3's diff and checkpoint views do not show the
ticket's changes. Below `full-access`, writes outside the thread's worktree are
prompted (Claude) or blocked (Codex `workspaceWrite`).
