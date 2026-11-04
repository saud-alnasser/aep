---
status: resolved
blocked-by: [05]
---

# feat(runtime): each runtime gets a playbook, chosen by detecting the runtime

## Outcome

A runtime table in `aep.mjs` detects T3 Code and Claude Code from the
environment, and `start` reports which one runs and where its reference is. The
T3 Code reference and a new Claude Code reference each carry a playbook for
building tickets, reviewing, researching, and continuing, using that runtime's
own tools. Both references are seeded in every repository. 4.5.0 ships it.

## Acceptance Criteria

- [x] Criterion 15: `start` under `T3CODE_THREAD_ID` reports T3 Code and its
      reference, under `CLAUDECODE=1` alone reports Claude Code, under both
      reports T3 Code, and under neither reports none. Verified:
      `node --test tests/aep.test.mjs`, test "start names the runtime it runs
      under and its seeded playbook, T3 Code before Claude Code"; 39 pass, 0
      fail.
- [x] Criterion 16: the suite asserts each reference's playbook section, and
      that both references are seeded into a repository with no `t3.json`.
      Verified: `node src/scripts/verify.mjs`, assertions "the T3 Code playbook
      builds tickets as launched threads...", "the Claude Code playbook builds
      tickets as background implementers...", and "a repository with no runtime
      config still gets both runtime playbooks"; 2438 passed, 0 failed.
- [x] Criterion 17: `specs.md` states requirements 18 and 19 with rationale;
      `release.mjs 4.5.0` runs; `protocol.md` declares 4.5.0; the changelog has a
      4.5.0 entry and its notice; `verify.mjs` passes. Verified: §21.1 "**Each
      runtime has a playbook.**" with its *Why*; `release.mjs 4.5.0` stamped;
      `.aep/protocol.md` `version: 4.5.0`; the 4.5.0 notice printed by
      `install.mjs --update`; `verify.mjs` 2438 passed, 0 failed; `aep check`
      clean.

## Relevant areas

`src/scripts/aep.mjs` (a `RUNTIMES` table beside `RUNTIME_SETUP`, `start`'s
JSON, the lease's session id), `src/seed/references/t3code.md`, a new
`src/seed/references/claude-code.md`, `src/scripts/payload.mjs` (seeding),
`src/skills/implement.md` and `src/skills/implement/dispatch.md` (pointing at
the playbook), `specs.md`, `src/scripts/verify.mjs`, `tests/aep.test.mjs`,
`CHANGELOG.md`.

## Notes

T3 facts at commit `9e85538535c8`: `t3_thread_launch` takes `title`,
`modelSelection`, `message`, and `workspaceStrategy`; launched threads inherit
the caller's modes; `t3_thread_wait` and `t3_thread_read` join and read a
child; `delegate_task` takes `target` for the provider and returns `summary`,
with no read-only mode, so read-only stays a policy. Claude Code under T3 has
`CLAUDE_CODE_ENTRYPOINT=t3-code`. Pin the reference to the new commit.
