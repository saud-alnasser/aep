---
status: implemented
lane: standard
---

# Problem

AEP runs under T3 Code through the provider, and most of it works: the skills
appear, a T3 thread worktree resolves as a `runtime` surface with the
`orchestrator` role, and `aep close` leaves that worktree alone. Seven things do
not work, and one rests on facts that have changed.

1. **`aep open` renames the runtime's branch away.** In a runtime surface it runs
   `git switch -c <n>-<slug>`. The runtime made that worktree on a branch of its
   own and records that branch for the thread, so its branch, diff, and pull
   request views can point at a branch the run left. AEP's own specification
   says a conforming implementation MUST NOT create, name, or remove a worktree
   the runtime owns, and that the branch name belongs to the runtime.
2. **The command line finds an effort by its branch name.** `effortBranches()`
   keeps only a branch whose name equals an effort directory, and drops every
   name holding a `/`. `scope.mjs` already resolves a claim by what the branch's
   commits touch. So an effort on a runtime-named branch is invisible to
   `start`, `land`, `record`, `raise`, `close`, `dispatch`, and `status`.
3. **The commands look for the effort in `_run`, not where its branch is.**
   `dispatch` reads the effort from `.aep/worktrees/<effort>/_run` and stops
   with "no run surface yet" in a runtime surface. `record` and `raise`, run
   from the main checkout, write into the main checkout when no `_run` exists.
4. **Setup runs twice.** A runtime can run its own setup when it creates a
   worktree (T3 Code: a `t3.json` script with `runOnWorktreeCreate`). `aep open`
   then runs the repository's `setup:` in the same worktree.
5. **A runtime's own delegation gives a child the wrong role.** A child the
   runtime places in the parent's checkout, or in a worktree of the runtime's
   making, computes `orchestrator` from its path. It then believes it may
   integrate and dispatch, and some runtimes let it delegate again, which breaks
   the one-layer rule. No policy says which surfaces an implementer may run in.
6. **The write boundary does not name the runtime's worktree.** The protocol's
   zone table lists the main checkout and `.aep/worktrees/`. A runtime worktree
   can sit outside both, for T3 Code under the home folder, which the protocol
   forbids unless the human asked.
7. **Work cannot move between runtimes.** An effort begun in a T3 thread
   cannot be picked up from the Claude Code CLI in the main checkout: `start`
   stops with "held by another surface" and says nothing about where to go. An
   effort begun in `_run` cannot be handed to a T3 thread on its branch without
   `close --stop`, which marks it stopped and leaves a surface nothing reaps. A
   handoff in one worktree's scratch is invisible from every other worktree.
8. **The seeded T3 Code reference is stale.** It places thread worktrees at
   `.t3-worktrees/<thread-id>/` inside the project and asks for a gitignore
   line. Current T3 Code places them outside the project, at a configurable
   location, and discovers skills per provider.

T3 Code is in early development and says so. Every fix above has to keep
working when T3 Code changes its paths, branch names, or configuration keys,
without an AEP release.

The 4.2 fixes make AEP correct under a runtime. Three gaps keep it from being
fast and effortless there:

9. **Efforts cannot declare what they build on.** `blocked-by` orders tickets
   inside one effort, and nothing orders efforts. An effort that needs another
   effort's unmerged work cannot be stacked on it under a runtime either: `aep
   open` in a T3 thread made from the other effort's branch stops with
   "already holds". So parallel threads on separate issues are safe only when a
   human has checked by hand that none of them needs another.
10. **Moving between runtimes still takes the developer.** `start` stops with
    `continue_in` and leaves the move to a person, `aep release` is a command
    the developer is told to run, and nothing stops two sessions from working in
    one surface: T3 Code binds a thread to an existing worktree without checking
    whether another thread uses it.
11. **AEP uses a runtime's own tools only for read-only work.** Under T3 Code it
    builds tickets as hidden sub-agents, though T3 can run each ticket as a
    thread of its own on any provider and wait on it. It never reviews on a
    second provider, though `delegate_task` picks one. Under Claude Code,
    nothing resumes an effort when a session starts. The agent cannot tell which
    runtime it runs in, so it cannot pick the right way.

# Goal

A T3 Code thread is one effort. The runtime owns the thread's worktree and
branch; AEP owns the ticket worktrees under `.aep/worktrees/`. Every `aep`
command works from a runtime surface on any branch name. Nothing AEP does keys
on a T3 Code path, branch name, or setting where git or the repository can
answer instead, and where a runtime fact is needed, the repository can override
it.

Beyond 4.2: independent efforts run in parallel threads, and an effort that
needs another one stacks on it or waits for it, by what its spec declares. The
agent moves an effort between runtimes by itself; the developer runs no command.
In each runtime, the agent builds, reviews, and resumes with that runtime's own
tools, chosen from a reference the runtime is detected by. The GitHub record
stays one issue and one pull request per effort, with dependencies set where
GitHub shows them.

# Scope

- `src/scripts/aep.mjs` and `src/scripts/scope.mjs`: branch adoption, effort
  resolution by content, the effort's surface, and the runtime setup.
- `src/policies/execution/parallel.md`, `src/skills/implement/dispatch.md`,
  `src/agents/implementer.md`, and `src/protocol.md`: where an implementer
  runs, and the write zone.
- `src/skills/implement.md` and `src/skills/handoff.md`: continuing in another
  runtime, and the new `aep release`.
- `src/seed/references/t3code.md`, rewritten from verified facts.
- `src/seed/rules/version-control.md`: the new setting.
- `specs.md`, `CHANGELOG.md`, the suite, and the 4.2.0 release.
- 4.3: `builds-on:` on a spec, through `aep.mjs`, `validate.mjs`, the spec
  template, `skills/specify`, `policies/tracker`, and `policies/artifacts`.
- 4.4: leases, `start` from anywhere, `aep yield`, the Claude adapter's
  session hooks, and the implement and handoff skills.
- 4.5: a runtime table in `aep.mjs`, a seeded `references/claude-code.md`,
  a playbook section in both runtime references, and seeding both in every
  repository.

# Requirements

1. In a runtime surface on a named branch, `aep open` commits the effort on that
   branch: it creates no branch and switches none. On a detached `HEAD` it
   creates `<n>-<slug>` there, as today. It stops where the branch already
   claims an effort.
2. Every command resolves an effort to the branch holding it: a branch named
   for the effort, or one whose own commits add the effort's `spec.md`, measured
   from the merge base with the default branch. The default branch holds none.
   A branch name may contain `/`. A ticket branch is never taken as its
   effort's branch. Where two branches hold one effort, the one holding fewer
   efforts is its own (a branch stacked on it holds one more); a tie stops the
   command, naming both.
3. Every command that acts on an effort acts in the worktree holding the
   effort's branch, whether `_run` or a runtime surface. `dispatch` from a
   runtime surface creates each child from that branch's tip under the main
   checkout's `.aep/worktrees/<effort>/<ticket>`.
4. In a runtime surface, AEP's `setup:` does not run where the runtime runs its
   own worktree setup. Detection is a declared table in one place, matched so a
   moved key still matches. A `runtime-setup:` field in
   `rules/version-control.md` (`auto`, `aep`, or `runtime`; default `auto`)
   overrides it. The JSON says which applied and why.
5. `policies/execution/parallel` requires an implementer to run only in a
   surface `aep dispatch` created. A runtime's own delegation that shares the
   parent's checkout or makes its own worktree carries only read-only work, and
   its child dispatches and delegates nothing. A runtime thread started inside
   the ticket surface is allowed, because the path still decides the role.
6. The protocol's write-zone table names the worktree the runtime supplied, when
   the run stands in one, as the effort's surface.
7. `src/seed/references/t3code.md` states only facts verified against T3 Code's
   source, says which version they were read from, tells the reader how to
   re-check each one, and covers the three ways to run a child under T3 Code.
8. `specs.md` states 1 to 6 normatively, with rationale.
9. 4.2.0 is released with a changelog entry and an upgrade notice for the
   user-owned T3 Code reference.
10. An effort continues in any runtime. Where another runtime's worktree holds
    its branch, `start` stops naming that directory as `continue_in`. A new
    `aep release <effort>` frees a branch `_run` holds, refusing uncommitted
    work, removing `_run`, and carrying the handoff to the main checkout's
    scratch; it never releases a runtime's worktree and leaves the effort open.
    The implement and handoff skills say how to continue. Requirement 14
    replaces the stop.
11. **`builds-on:`** is a spec field: a list of efforts, each named by its
    directory or its number. It is legal only on a spec. An effort it names is
    *merged* where its `spec.md` is on the default branch, *open* where a branch
    holds it, and unknown otherwise, which stops `open`.
12. `aep open` respects `builds-on:`. With every named effort merged it opens as
    today. With one open effort and `stack: true`, the branch is cut from that
    effort's branch, and in a runtime surface the adopted branch may carry that
    effort, and what that effort's own branch carries, and no other. A chain
    of open efforts named together is one edge to its tip. With `stack: false`, or more than one open effort,
    `open` stops naming what it waits on, and the draft stays in scratch.
    `aep status` shows each effort's `builds-on:` and whether each one has
    merged.
13. Where `tracker:` is on, `policies/tracker` sets each `builds-on:` edge as a
    GitHub dependency between the issues (`--add-blocked-by`), and the pull
    request body names what it builds on. `skills/specify` writes the field when
    the request depends on another effort.
14. **`start` from anywhere** returns the surface holding the effort's branch,
    `_run` or another runtime's worktree, with `move: true` where it is not the
    directory the command ran in. It stops only where the main checkout has the
    branch checked out, or where another session's live lease holds the
    surface. `release` still never removes a runtime's worktree.
15. **A lease** in the surface's `.aep/scratch/lease.json` names the session
    working there, the runtime, and when it was last renewed. `start` takes it
    where the session stands in the surface, `release` and `close` stop on a
    live one,
    every command run in the surface renews it, and a new `aep yield` clears it.
    A lease older than 60 minutes is stale and is taken over, which the JSON
    reports. The session id comes from the runtime table or `--session`; with
    neither, `start` writes no lease and still honours a live one.
16. The Claude adapter's hooks: `SessionStart` adds, as facts, the effort whose
    surface the session stands in and its next step, or the open efforts with
    their surfaces and leases; `Stop` renews the lease of the surface the
    session stands in; `SessionEnd` yields it. Each hook is silent where the
    repository runs no AEP, or runs a release without these commands.
17. The implement and handoff skills have the agent make every move itself: on
    `move: true` it moves into the surface the way its runtime's reference
    says, and the developer runs no command.
18. **A runtime table** in `aep.mjs` names each runtime AEP drives, the
    environment that detects it, the variable carrying the session id, and its
    reference. `start` reports the detected runtime and its reference path.
    T3 Code is tried before Claude Code, since T3 starts Claude Code.
19. `references/t3code.md` and a new `references/claude-code.md` each carry a
    playbook: how to build tickets, review, research, and continue an effort in
    that runtime. Under T3 Code, tickets run as T3 threads bound to the ticket
    surface and joined with `t3_thread_wait`; review and research run through
    `delegate_task`, review optionally on a second provider; continuing launches
    a thread on the effort's surface. Under Claude Code, tickets run as
    background implementer sub-agents; continuing enters the surface with
    `EnterWorktree`. Both references are seeded in every repository.
20. 4.3.0 ships 11 to 13, 4.4.0 ships 14 to 17, and 4.5.0 ships 18 and 19, each
    with a changelog entry, and an upgrade notice where a repository must act.
    `specs.md` states each normatively, with rationale.

# Acceptance Criteria

1. A test opens an effort in a linked worktree outside `.aep/worktrees/` on a
   branch `t3code/abc123`; afterwards `HEAD` is still `t3code/abc123`, the
   effort's spec is committed on it, and no `<n>-<slug>` branch exists. A
   detached runtime worktree still gets `<n>-<slug>`. A branch already claiming
   an effort stops `open`.
2. A test runs `start`, `record`, `raise`, `status`, and `close` against an
   effort on `t3code/abc123`, from the runtime surface and from the main
   checkout, and each finds the effort. Two branches claiming one effort stop
   `start` naming both. A `<effort>--<ticket>` branch is not reported as the
   effort's branch.
3. A test dispatches two tickets from a runtime surface: both child surfaces
   sit under the main checkout's `.aep/worktrees/<effort>/`, branch from the
   runtime branch's tip, resolve `role: implementer`, and `land` integrates
   each into the runtime branch. `record` run from the main checkout writes the
   runtime surface's log, never the main checkout.
4. A test with `setup:` set and a `t3.json` declaring a worktree-create script
   shows `open` in a runtime surface not running setup, with a reason naming
   `t3.json`; `runtime-setup: aep` runs it; `runtime-setup: runtime` skips it
   with no `t3.json`; a dispatched child surface is still warmed.
5. The suite asserts the parallel policy's three surface rules, and the implement
   dispatch note points to them.
6. The suite asserts the protocol's zone table carries the runtime row, and
   `aep check` passes the hot-path budget.
7. The suite asserts the T3 Code reference names no `.t3-worktrees` path, names
   the version it was read from, and covers `delegate_task` as read-only.
8. The suite asserts the new `specs.md` statements.
9. `node src/scripts/verify.mjs` passes, `protocol.md` declares 4.2.0, and the
   changelog has a 4.2.0 entry with an upgrade notice.
10. A test begins an effort in a runtime worktree: `start` from the main
    checkout stops with `continue_in` set to it, `release` refuses it, and once
    the worktree is gone `start` makes `_run` on the runtime's branch and the
    work lands there. A second test releases `_run`: a dirty surface is refused,
    a clean one is removed, the handoff reaches the main checkout's scratch, a
    second release is a no-op, and a runtime worktree on the branch then
    starts as `runtime`. The suite asserts the skill and spec text.
11. Tests: `validate.mjs` accepts `builds-on:` on a spec and refuses it
    elsewhere; `open` with a merged dependency opens from the base; with an open
    one and `stack: true` the branch's parent is that effort's tip; a runtime
    branch carrying the dependency is adopted, and one carrying any other effort
    is not; `stack: false` and two open dependencies stop with the draft kept;
    an unknown name stops; `status` shows the edge and its state.
12. The suite asserts the tracker policy's dependency step and the specify
    skill's field.
13. Tests: `start` from the main checkout on an effort held by a runtime
    worktree returns that path with `move: true`; a live foreign lease stops it
    naming the holder; a stale one is taken over and reported; the same session
    renews; `yield` clears; with no session id no lease is written.
14. Tests run each hook script with a hook input on stdin: `SessionStart` in a
    surface names its effort and next step, in the main checkout lists open
    efforts, and is silent without AEP; `Stop` renews; `SessionEnd` yields. The
    suite asserts `hooks.json` registers all three.
15. Tests: `start` under `T3CODE_THREAD_ID` reports T3 Code and its reference,
    under `CLAUDECODE=1` alone reports Claude Code, under both reports T3 Code,
    and under neither reports none.
16. The suite asserts each reference's playbook section, and that both
    references are seeded into a repository with no `t3.json`.
17. `node src/scripts/verify.mjs` passes, `protocol.md` declares 4.5.0, and the
    changelog has 4.3.0, 4.4.0, and 4.5.0 entries, each with its notice.

# Constraints

- **AEP stays agent-agnostic.** No policy, skill, or script names T3 Code or
  Claude Code except the seeded references, the Claude adapter, and the data
  tables in `aep.mjs`. A runtime fact lives in data, not in branching code, so
  a runtime change is a one-line edit or a repository override.
- **Scripts never call a runtime.** The agent calls the runtime's tools; the
  references say which. A script reads the environment and git, and nothing
  else.
- **A lease is advisory.** It guards against two sessions in one surface. It
  never locks git or a file, so a crashed session costs at most the stale
  window.
- **The path still decides the role.** `surfaceOf()` is unchanged, and child
  surfaces stay under the main checkout's `.aep/worktrees/`, because the role
  derivation is sound only for paths AEP said it would create.
- **No dependency.** Scripts stay bare Node, reading git and files.
- **The reference is the repository's.** An upgrade never overwrites a
  repository's `t3code.md`; the notice asks the human to compare.

# Out of Scope

- A configurable worktrees root outside the project. It would ease the test
  runner and watcher problem of nested copies, but `surfaceOf()` and the write
  boundary would have to read the setting too. Recorded as a risk.
- Launching T3 Code threads or calling its MCP tools from a script. AEP never
  calls a runtime; the reference describes the calls for the agent.
- A command-line refusal keyed on the role. The role refuses nothing by itself;
  the policy binds it.
- Testing under T3 Code itself and under the Claude Code sandbox. Neither runs
  here; the reference says how to check.

# Assumptions

- T3 Code records a thread's branch at launch and does not follow an agent's
  `git switch`. Requirement 1 is right either way: adopting the branch cannot
  orphan anything.
- A runtime surface on a named branch is the runtime's branch for this thread,
  not a branch the human checked out by hand.
- T3 Code runs the Claude Code plugin's hooks when it starts Claude Code. Not
  verified. Without them, the skills still resume the effort, only later.
- `EnterWorktree` accepts `.aep/worktrees/<effort>/_run` and a T3 worktree, both
  worktrees of the same repository. Documented, not run here. In Claude Code's
  default mode it asks the developer once; no setting AEP should recommend
  removes that.

# Risks

- Resolving every effort by content diffs every local branch against the base
  once per command. In a repository with hundreds of branches this is slow.
  Branches named for an effort resolve first, without a diff.
- Under the Claude Code sandbox, a run in a runtime worktree outside the main
  checkout may be refused writes to the main checkout's `.git` and
  `.aep/worktrees/`. Untested here; the reference says how to check.
- Nested ticket worktrees are full copies of the repository inside it. A tool
  that ignores `.gitignore` sees them.
