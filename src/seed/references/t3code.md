---
use-when: "running AEP through T3 Code, choosing how to run a child under it, or explaining why a skill is or is not offered there"
---

# Reference — T3 Code

**This file is yours.** Installed in every repository, because any developer
may open it under T3 Code, with or without a `t3.json`. Read from T3 Code
`main` at commit `9e85538535c8`, 2026-11-04, nightly `v0.1.8`. T3 Code is very
early and these areas change weekly, so each fact below says how to check it
against the version your team runs. Correct this file where it differs.

## What T3 Code is, and what that means for AEP

T3 Code is a **control surface**, not an agent runtime. It drives provider CLIs,
Claude Code, Codex, Cursor, OpenCode, and others, and serves them to desktop,
web, and mobile clients. It defines no skill, agent, or instruction format of
its own, so **AEP reaches T3 Code through the provider**. The adapter that
matters is the one the provider reads.

The split that works:

```
T3 thread      = one effort    -> T3's worktree, T3's branch     role: orchestrator
  aep dispatch -> .aep/worktrees/<effort>/<ticket>, in the main checkout
                                                                 role: implementer
```

T3 owns the thread's worktree, its branch, and its cleanup. AEP owns the ticket
worktrees, because their path is what gives a child its role.

## Thread worktrees

- **Where:** `~/.t3/worktrees/<repo>/<dir>`, or under `$T3CODE_HOME`. The
  machine-wide setting "Worktree location" (`worktreesDirectory`) moves it; it
  must be absolute. `<dir>` is named from the branch at creation, so it is
  usually `t3-<8 hex>` even after the branch is renamed.
- **Check:** `git worktree list --porcelain` from the main checkout lists every
  thread worktree and the branch it holds. In one, `node .aep/scripts/scope.mjs
  read` prints `surface runtime at <path>` and `role orchestrator`.
- **Outside the project by default**, so nothing needs ignoring. If you point
  the location inside this repository, that path must be gitignored: AEP
  fingerprints the tree with `git ls-files --others`, and an unignored worktree
  reads as drift in every thread.
- **The write zone.** A thread's worktree is outside the main checkout, often
  under the home folder. The protocol counts the worktree the runtime supplied,
  when you stand in it, as the effort's surface. Nothing else under
  `~/.t3/` is a place to write.

## Branches

- A thread starts on `t3/<8 hex>`, and T3 renames it, by default to
  `t3/<slug>` (setting `branchNamingMode`: `static`, `semantic` gives names
  like `feat/...`, or `custom`). T3 records the branch at launch and expects
  that name when it renames.
- **`aep open` commits the effort on that branch** and creates none of its own.
  AEP finds the effort by what the branch's commits touch, so the rename moves
  nothing. Never `git switch` away from the thread's branch: T3's sidebar, its
  pull request lookup, and its post-run refresh keep the recorded name.
- **One thread is one effort.** `aep open` stops where the thread's branch
  already holds one.
- **Check:** `node .aep/scripts/aep.mjs status` shows each effort with
  `on <branch>` where the branch is not named for the effort.

## Setup

- T3 runs a project action marked `runOnWorktreeCreate` in each new thread
  worktree. `t3.json` can declare one, but T3 runs it only after it is imported
  under Settings, Projects, Actions.
- `aep open` in a thread worktree skips the repository's `setup:` when
  `t3.json` declares `runOnWorktreeCreate`, and runs it again only when a
  lockfile changes. AEP's ticket worktrees are always set up by AEP.
- **Set `runtime-setup:` in `[[rules/version-control]]` when that guess is
  wrong:** `aep` where the action was never imported, `runtime` where the setup
  lives in T3's actions and not in `t3.json`. The JSON from `aep open` says
  which applied, under `setup.reason`.

## Playbook

How an orchestrator under T3 Code does each kind of work. `aep start` reports
`runtime.name` as `T3 Code` when it runs here.

**One thread is one effort**, and so one pull request. The sidebar holds one row
per effort. Everything the effort runs, its tickets, reviewers, and researchers,
runs inside its thread, as a sub-agent T3 shows under it.

### Building tickets

1. `aep dispatch <effort> <ticket>` makes the ticket surface,
   `.aep/worktrees/<effort>/<ticket>`, and prints the brief.
2. Start each ticket as a sub-agent of your provider, in the background, with
   the brief, which names the ticket surface by its absolute path. Under Claude
   Code, that is the playbook in `[[references/claude-code]]`: the Agent tool
   with `subagent_type: "aep:implementer"` and `run_in_background: true`.
3. Start every ticket the graph leaves free at once. Each finished one notifies
   you; never poll.
4. `aep land <effort> <ticket>` for each one that returns done.

T3 turns each sub-agent of Claude Code or Codex, foreground or background, into
a child thread of yours: no sidebar row, and shown in your thread's details and
timeline with its status, its result, a Stop action, and its full transcript.

- **Never `t3_thread_launch` a ticket.** A launched thread is a top-level
  thread with a sidebar row of its own, which reads as a second effort.
- The child records your thread's worktree, not the ticket surface, so T3's
  diff and checkpoint views do not show a ticket's changes. `aep land` and the
  effort's branch are the record.
- In the ticket surface, the child's `scope.mjs read` prints `role: implementer`
  before it writes; any other role means it stands somewhere else, and it stops.
- **Modes.** The ticket surfaces are outside your thread's worktree. At
  `full-access` nothing in T3 stops a child writing there. At a narrower mode,
  Claude asks for each such write, and Codex's `workspaceWrite` sandbox refuses
  it. Run the effort's thread at `full-access`, or build the tickets one at a
  time in your own thread.
- **Check:** after the first dispatch, the ticket shows under your thread and
  not in the sidebar. Where it shows in the sidebar, T3 changed how it projects
  sub-agents; correct this playbook.

### Reviewing

`delegate_task` with `isolation: "shared"` and the reviewer's brief as `task`.
Set `target` to a second provider, `{ providerInstanceId, model }`, for a review
by a different model than the one that wrote the code. The child's last message
comes back as `summary`, and a finished child wakes you.

`delegate_task` has no read-only mode. `[[policies/execution/parallel]]` keeps
the child read-only: it edits no file, returns its findings, and never
dispatches, integrates, or delegates. A `delegate_task` child reads `role:
orchestrator`, and T3 lets it delegate again with no depth limit, so the brief
says this.

### Researching

`delegate_task`, the same way, with the question as `task`. The child returns
its findings as `summary`; you write the one evidence file from it, since the
child writes nothing.

### Continuing an effort

An effort is its branch and the files on it, so any runtime continues it, and
the agent makes every move. Commit or land first; uncommitted work does not
cross.

| Begun in | Continue in | The agent |
| --- | --- | --- |
| a T3 thread | the Claude Code CLI, or any other runtime | runs `aep start <effort>` wherever it stands. It returns the thread's worktree with `move: true`, and the agent moves there, by its own runtime's way to enter a directory |
| a T3 thread whose worktree T3 removed | anywhere | runs `aep start <effort>`, which makes `_run` on the thread's branch, `t3/...` included, while the branch exists |
| `_run`, or any surface, from another runtime | T3 | launches a thread with `existing_worktree` on that surface's path and `branch` set to the branch it has checked out, then names the thread to the developer. T3 has no tool to focus it. Without `branch`, T3 stores none and its pull request features stay off for that thread |

A lease in the surface's `.aep/scratch/lease.json` keeps two sessions out of one
worktree, which T3 itself does not check. Only a session standing in the
surface takes it, so the session that launches a thread there leaves it free
for that thread. `aep yield` gives it up at the end of a session.

- **Check:** T3's tools appear to Claude Code as `mcp__t3-code__<name>`. Where a
  name above is missing, T3 changed it; correct this playbook.

## Skills

What T3 shows in its picker, per provider. The provider still loads skills its
own way.

| Provider | T3 reads |
| --- | --- |
| Claude Code | `<config>/skills`, `<cwd>/.claude/skills`, each `--add-dir`, and enabled plugins from `installed_plugins.json`, so the AEP plugin's skills appear |
| Cursor | `.cursor/skills`, `.agents/skills`, `.codex/skills`, `.claude/skills` |
| Antigravity | `.gemini/skills`, `.agents/skills`, `.agent/skills` |
| Codex, OpenCode, Grok, Pi | whatever the provider reports |

So `.agents/skills/`, AEP's `agents` adapter, serves Cursor and Antigravity,
not Claude Code. Where the provider is OpenCode, prefer the `opencode` adapter.

## The sandbox

With Claude Code's sandbox on, a command run in a thread worktree may write the
worktree, a temp directory, and the main repository's `.git`, so commits work.
`aep dispatch` also writes the ticket worktrees into the main checkout's
`.aep/worktrees/`, which is outside the thread worktree, so the sandbox refuses
it. Add the main checkout to `permissions.additionalDirectories` in the
settings the thread loads, then run `aep dispatch` once to check. Native
Windows has no sandbox.

## Failure handling

- **A skill that does not appear is a provider question first.** Check what the
  provider loads from this repository before changing anything here.
- **`aep start` stops with `held_by`.** Another session, often another thread,
  is working in the surface. Leave the effort to it, or wait out the lease,
  which goes stale an hour after its last renewal.
- **`aep start` stops with "held by more than one branch".** Two branches carry
  the effort's commits equally. Delete the stale one; never rename the
  thread's branch.
- `T3CODE_THREAD_ID` is set in Claude Code and Codex shells under T3. It is the
  runtime-supplied id to pass as `--session`; never invent one.
- `t3.json` is checked in and shared. Scripts declared there run for everyone
  who imports them, including on worktree creation.
