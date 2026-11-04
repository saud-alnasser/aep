---
use-when: "running AEP in Claude Code, choosing how to run a child there, or moving an effort into or out of a Claude Code session"
---

# Reference — Claude Code

**This file is yours.** Installed in every repository, because any developer
may open it in Claude Code. Read from the Claude Code documentation and
changelog at 2.1.318, 2026-11-04. Claude Code changes often, so each fact below
says how to check it against the version your team runs. Correct this file
where it differs.

## What Claude Code reads from this repository

- **The AEP plugin**, `aep@aep-marketplace`, installed at user scope. It brings
  the skills, the four sub-agents (`aep:implementer`, `aep:reviewer-correctness`,
  `aep:reviewer-standards`, `aep:researcher`), and the hooks below.
- **`CLAUDE.md`**, which only points at `AGENTS.md`.
- **Check:** `/plugin` lists `aep` as enabled; `/agents` lists the four.

## Hooks

The plugin's hooks keep a session and its effort in step, so the developer runs
nothing:

| Event | What it does |
| --- | --- |
| `SessionStart` | says which effort this session stands in and its next step, or which efforts are open and where |
| `Stop` | renews this session's lease on the surface |
| `SessionEnd` | gives the lease up, so the next session takes the effort at once |

Hooks run outside the sandbox. `--bare` skips them and every plugin; a session
started that way gets no context and leaves its lease to go stale.

## Playbook

How an orchestrator in Claude Code does each kind of work. `aep start` reports
`runtime.name` as `Claude Code` when it runs here, and as `T3 Code` when T3
Code started this Claude Code; then `[[references/t3code]]` applies.

### Building tickets

1. `aep dispatch <effort> <ticket>` makes the ticket surface,
   `.aep/worktrees/<effort>/<ticket>`, and prints the brief.
2. The Agent tool with `subagent_type: "aep:implementer"`, the brief as
   `prompt`, and `run_in_background: true`.
3. Send every ticket the graph leaves free in one message, so they run at once.
   Each finished child notifies you; never poll.
4. `aep land <effort> <ticket>` for each one that returns done.

A sub-agent starts in your working directory, and its `cd` does not persist.
The brief names the ticket surface by its absolute path, and the child works
there by absolute paths and `git -C`. Its `scope.mjs read` prints `role:
implementer` before it writes; any other role means it stands somewhere else,
and it stops. Never pass `isolation: "worktree"`: it makes a fresh temporary
worktree, not the ticket surface.

### Reviewing

`aep:reviewer-correctness` and `aep:reviewer-standards`, each with the diff's
base and head. They read; they never edit.

### Researching

`aep:researcher`, with the question. It writes the one evidence file the brief
names.

### Continuing an effort

1. `aep start <effort>`, wherever the session stands.
2. Where it reports `move: true`, the `EnterWorktree` tool with `path` set to
   the `surface` it returned. The session's working directory, write access,
   and project settings move with it.
3. `aep start <effort>` again, now in the surface. It takes the lease there,
   which the hooks then renew and give up. Work on from its next step.

`EnterWorktree` asks the developer to approve any path outside
`.claude/worktrees/`, and both AEP's `_run` and a T3 thread's worktree are
outside it. That one approval is the only step the developer takes. No
permission rule silences it; only `bypassPermissions` mode does, which AEP does
not ask for.

Where the move cannot happen, start a new session in the surface instead, and
name the surface to the developer:

- the developer declines the prompt;
- the session already stands in a worktree, where `EnterWorktree` accepts only a
  target under `.claude/worktrees/`;
- `blockWritesOutsideWorkingDirectories` is on, which removes the tool.

A session that works on a surface by absolute paths without standing in it
takes no lease, so nothing keeps a second session out.

To continue in T3 Code instead, follow the last row of the table in
`[[references/t3code]]`.

- **Check:** the `EnterWorktree` tool takes a `path`. It was added in 2.1.105;
  an older release can only create worktrees.

## The session id

`CLAUDE_CODE_SESSION_ID` names the session to `aep start`, and each hook takes
the id from its own input, which is the same value. `/clear` starts a new id;
its `SessionEnd` hook names the session that ended, so that session's lease is
the one given up. Under T3 Code, `T3CODE_THREAD_ID` names the session for both.

## The sandbox

With the sandbox on, a command writes only to the working directory, a temp
directory, and the directories in `permissions.additionalDirectories`. After
`EnterWorktree` into `_run`, `aep dispatch` writes the ticket surfaces into the
main checkout's `.aep/worktrees/`, outside `_run`. Add the main checkout to
`permissions.additionalDirectories`, then run `aep dispatch` once to check.
Native Windows has no sandbox.

## Failure handling

- **`aep start` stops with `held_by`.** Another session's lease is live. Leave
  the effort to it, or wait out the lease, which goes stale an hour after its
  last renewal.
- **The session got no AEP context at start.** The plugin is off, or the
  session ran with `--bare`. `aep status` shows the same board.
- **A sub-agent wrote in the wrong place.** Its brief named a relative path.
  Briefs name surfaces by their absolute path.
