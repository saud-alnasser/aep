# Changelog

## 4.5.0

AEP now uses each runtime's own tools for parallel work, review, and
handoffs, rather than only the subset every runtime shares.

### Added

- **Runtime playbooks.** `.aep/references/t3code.md` and a new
  `.aep/references/claude-code.md` each say how to build tickets, review,
  research, and continue an effort in that runtime.
  - Under T3 Code, each ticket runs as its own thread on the ticket's worktree,
    so it shows in the sidebar, and the orchestrator waits on it with
    `t3_thread_wait`. Review and research go through `delegate_task`, and a
    review can run on a second provider.
  - Under Claude Code, each ticket runs as a background implementer sub-agent,
    and continuing an effort enters its worktree with `EnterWorktree`.
- **`aep start` names the runtime.** Its JSON carries `runtime.name` and
  `runtime.reference`, detected from the environment. A session under T3 Code
  counts as T3 Code even though Claude Code is running inside it.

### Changed

- Both runtime references are installed in every repository, not only one
  with a `t3.json`, because the runtime is each developer's choice.
- Briefs name the ticket worktree by its absolute path, since a sub-agent
  starts in its parent's directory.

### Upgrading

`aep:update` writes whichever runtime reference is missing. An existing
`t3code.md` is yours and stays as it was; the upgrade notice says what to take
from the new one.

## 4.4.0

Moving an effort between runtimes no longer takes the developer. The agent
finds where the effort lives and moves there itself, and a lease keeps two
sessions from working in the same place.

### Added

- **`aep start` works from anywhere.** It returns the surface that holds the
  effort, whether that is `_run` or another runtime's worktree, with
  `move: true` when that isn't the current directory. The agent moves there. It
  stops only when the main checkout has the effort's branch checked out, or when
  another session is working in the surface.
- **Leases.** `.aep/scratch/lease.json` in a surface records which session works
  there, in which runtime, and when it last acted. `start` takes the lease once
  the session stands in the surface, and every command that acts on the effort
  renews it. `release` and `close` refuse a surface another session holds. A
  lease left unrenewed for an hour goes stale, and the next session takes it
  over. The session id comes from the runtime, or from `--session`.
- **`aep yield`** gives up this session's lease, so the next session can take
  the effort straight away.
- **Claude Code session hooks.**
  - At the start of a session, the hook tells the agent which effort it is
    standing in and the next step, or which efforts are open and where.
  - After every turn, the hook renews the lease.
  - At the end of the session, the hook gives the lease up.
- **`aep status`** shows each surface's lease and the effort's next step.

### Changed

- `start` used to stop with `continue_in` when another runtime's worktree held
  the branch. It now returns that worktree. `release` still refuses to remove
  a runtime's worktree.
- The implement and handoff skills leave every move to the agent.

### Upgrading

Nothing to do. The hooks come with the Claude Code plugin, and other runtimes
pick up the same behaviour from the skills.

## 4.3.0

An effort can now say which other efforts it needs. Before, tickets could wait
on each other inside one effort, but nothing ordered efforts. Running separate
issues in parallel threads was safe only if someone had checked by hand that
none of them needed another.

### Added

- **`builds-on:`** in a spec's frontmatter names the efforts it needs, by
  directory or by number. Under a tracker, the number is the issue number.
- **`aep open` respects it.** Once every named effort has merged, it opens as
  before. If one is still open and the repository stacks (`stack: true`), the
  new branch starts from that effort's branch. In a runtime thread made from
  that branch, `open` keeps the thread's branch; in one made from the default
  branch, even a newer one, `open` moves it onto the effort first. Naming a
  whole chain of open efforts stacks on its tip. If the repository doesn't
  stack, or two unrelated named efforts are open, `open` waits. It says what it
  waits on and keeps the draft.
- **`aep status`** shows each effort's `builds-on:` and whether each one has
  merged.
- **Under a tracker,** each edge becomes a real issue dependency
  (`--add-blocked-by`), and the pull request body opens with
  `Builds on #<issue>`.

### Upgrading

Nothing to do. Efforts without `builds-on:` behave exactly as before.

## 4.2.0

AEP already ran under T3 Code, because T3 Code drives the same provider CLIs AEP
installs into. But a few things went wrong at the seams. `aep open` in a T3
thread switched off the branch T3 had made, so T3's branch and pull request
views pointed at a branch nobody worked on. The other commands could not find an
effort on a branch called `t3/<slug>`. Setup ran twice. A child started through
T3's own delegation thought it was an orchestrator. And the seeded T3 Code
reference described worktree paths T3 no longer uses.

4.2 fixes those without tying AEP to T3 Code, which describes itself as very
early. Nothing in the policies, skills, or scripts names it, apart from the
reference and one line of data. The same changes let one effort move between
runtimes: begin it in a T3 thread, finish it in the Claude Code CLI, or the
other way round.

### Added

- **`aep release <effort>`.** It frees an effort's branch from AEP's own
  `_run` worktree so another runtime can take it in a worktree of its own. It
  refuses uncommitted work, removes `_run`, carries the session's handoff to
  the main checkout's `.aep/scratch/`, and leaves the effort open.
- **`continue_in`.** When another runtime's worktree holds an effort's branch,
  `aep start` stops and names that directory, so the next session can start
  there.
- **`runtime-setup:`** in `rules/version-control.md`: `auto` (the default),
  `aep`, or `runtime`. It says who sets up a worktree the runtime created.
  `auto` skips AEP's `setup:` where a known runtime file declares its own
  worktree setup, which today means a `t3.json` script with
  `runOnWorktreeCreate`. A lockfile change afterwards still runs `setup:`.

### Changed

- **`aep open` in a runtime's worktree commits on the runtime's branch.** It
  creates a branch only where the worktree is detached or stands on the
  default branch, and stops where the branch already holds an effort: one
  thread is one effort.
- **Every command finds an effort by what a branch's commits add.** A branch
  holds the efforts whose `spec.md` it adds, whatever it is called, and branch
  names may contain `/`. A ticket branch is never taken as its effort's branch.
  Where two branches hold one effort, the one holding fewer efforts is its own,
  since a branch stacked on it holds one more; a tie stops the command with both
  named.
- **Every command acts where the effort's branch is held.** `dispatch` works
  from a runtime's worktree and still puts each child under the main
  checkout's `.aep/worktrees/`. `record` and `raise` run from the main checkout
  no longer write into it.
- **Where a child runs.** An implementer runs only in a surface `aep dispatch`
  created, as a sub-agent or as a runtime thread opened there, and stops if
  its surface reports any other role. A runtime's own delegation, such as T3
  Code's `delegate_task`, carries read-only work only.
- **The protocol's write zones** name the runtime's worktree you stand in.
- **The T3 Code reference** is rewritten from T3 Code's source, pinned to the
  commit it was read from, with a way to re-check each fact. It covers where
  thread worktrees live, how branches are named and renamed, setup, the three
  ways to run a child, continuing in another runtime, and the sandbox setting
  `aep dispatch` needs under Claude Code.

### Upgrading

`/aep:update` brings the new command line, policies, and skills. Nothing you
own changes shape. If you run AEP through T3 Code, the update asks you to
compare your `.aep/references/t3code.md` with the shipped one, since an upgrade
never edits a reference you own, and to set `runtime-setup:` if the default
guess about T3's setup action is wrong for you. Efforts already open keep
working: a branch named for its effort resolves exactly as before.

## 4.1.0

Until now AEP had one way of writing for everything a human reads. `prose`
taught the craft of a written document: a voice, varied rhythm, *I* where it
fits. That suits a README, which a stranger reads once and cold. It does not
suit a turn report that a developer scans mid-task, often in a second language.
And text written for another agent had no rules at all. A brief was exempt,
which in practice meant each agent wrote briefs its own way, and a brief is the
only thing a child builds from.

4.1 chooses the register by who reads the text.

### Added

- **A controlled register for session text and agent text.** Session output,
  the turn report, commit messages, pull request titles and bodies, briefs,
  returns, relayed questions, and new effort artifacts are now written in a
  register based on ASD-STE100 Simplified Technical English, at 80% adherence.
  The core principles come first: one topic per sentence, active voice with the
  actor named, short sentences, one meaning per word. Then the vocabulary: try
  the approved word first, and keep an outside word where it carries the meaning
  better. Domain and AEP terms are kept exactly. The rules live in
  `policies/reporting`, in AEP's own words; no part of the standard ships.
- **`/aep:plain`, the eighteenth skill.** It holds the worked examples:
  word swaps, a word kept because no approved word fits, text sketches, the
  option-set template, a brief, a return, and turn report slots. It governs
  nothing.
- **Text sketches.** When a session explains a flow, a hierarchy, a change of
  state, or a comparison, it draws one in characters inside a fenced block,
  Excalidraw style. A sketch needs no tool and looks the same on every runtime.
- **Option sets.** Every choice put to the developer explains each option,
  illustrates it where the options differ in structure, and recommends one with
  its reason. It goes through the runtime's interactive picker where there is
  one, and as lettered text with the same content where there is not. `refine`,
  `plan`, `design-it-twice`, `specify`, `install`, `update`, `prune`, the UI
  prototype's pick, the tracker ask, and the protocol's architecture rule all
  link to that one rule. The old "reply yes or b" line is gone.

### Changed

- **`prose` is for public text only**: a README, a docs page, an API
  reference, user-interface text, a changelog, a code comment, or a docstring.
  Its catalogue is unchanged. A pull request body moves to the controlled
  register, since it is read in review as part of the work.
- **The reporting policy sorts text into three registers**, public, controlled,
  and exempt, in one table. Shipped protocol text stays exempt.
- **The standard-lane `/implement` load budget is 4,200 words**, up from 4,000,
  to carry the controlled register's core. Today's load is 4,129.
- **`specs.md` §15.2** states the three registers. §35.12 records why the 4.0
  decision to exempt a brief was reversed.

### Upgrading

`/aep:update` brings the new skill, the new reporting policy, and the updated
skills and agents. A runtime adapter you installed gains a wrapper for `plain`
when the update regenerates it. Effort artifacts written before the update are
not rewritten: the controlled register applies to what is written after it.
Nothing you own changes shape. The update asks you to check one thing: a rule
of yours that says how commit messages, pull request bodies, or briefs read, or
that uses the retired words "governed" and "exempt", now meets the three
registers, and a rule may tighten the policy but never soften it.

## 4.0.0

AEP 3 made every change pay for the largest one. A typo fix loaded about 15,100
words of process before it touched a file, opened an issue and a draft pull
request, cut a ticket, ran two review agents, and asked the human about the
lane, the priority, the spec's acceptance, and every finding. One run invented a
path at a drive root because a skill told it to write "outside the repository"
and never said where.

4.0 sizes the ceremony to the change, moves the git and worktree choreography
out of prose and into one tested script, makes the tracker opt-in, and keeps
every write inside the project.

### Added

- **Lanes.** `spec.md` declares `lane: quick`, `standard`, or `full`, and the
  lane sets the ceremony. Quick is one commit with no tickets, tracker, review
  agents, or questions. Standard builds tickets in order, with one converge round
  and one review round run by a single reviewer covering both axes. Full adds
  parallel waves of children and two of each. `/specify` picks the lane and
  reports it; the human may override it. Lanes only go up: a quick change that
  reaches a public contract, data at rest, or a second area is raised to
  standard, and nothing lowers one.
- **One command line, `node .aep/scripts/aep.mjs`.** `status` (the board, and
  what waits on you, across repositories with `--repos`), `open`, `start`,
  `dispatch`, `land`, `record`, `raise`, `close`, and `check`. Each prints JSON
  the agent acts on and quotes. The orderings 3.x had to explain in prose (commit
  before release, detach before remove) live there once, and every command is
  idempotent, so a crashed run re-runs its last step. 19 tests under
  `node --test`.
- **Warm worktrees.** `setup:` in the version-control rule runs in each new
  worktree, and `aep start` reruns it only when a lockfile changed.
- **A write boundary.** The protocol names where a run may write (the main
  checkout, the effort's worktrees, `.aep/scratch/`, where a project tool writes,
  and the OS temp directory through the temp API) and makes anything else a
  stop. Every turn report carries `Outside writes`. `aep check` rejects wording
  that sends a write elsewhere. The Claude adapter merges guardrails into
  `.claude/settings.json`: the sandbox where the platform has one, and edit-deny
  rules for places that never hold a project. No documented rule can deny
  everything outside the project, and native Windows has no sandbox, so there
  the protocol's rule is the safeguard and the settings are the backup.
- **`.aep/scratch/`**, gitignored, for handoffs, notes, and drafts. `/specify`
  drafts there and `aep open` moves the draft in.
- **A friction log.** `aep close` appends up to three lines to
  `.aep/friction.md`: what got in the way, read between projects.
- **Word budgets, enforced.** `aep check` holds each skill to 1,200 words, a
  skill's note to 600, a policy to 800, and the protocol to 1,000, and the
  standard-lane `/implement` load to 4,000. It also rejects a rationale
  sentence in an agent-facing file.
- **A scenario suite**, `tests/scenarios/`: twelve short prompts run against a
  fixture repository, judged by checks that read the repository and the run's
  report rather than its transcript.

### Changed

- **The standard-lane `/implement` load is 3,923 words, from about 15,100.**
  `policies/execution` (6,268 words) is split into `execution` (797, every lane)
  and `execution/parallel` (waves and integration, full lane only).
  `policies/authority` and `policies/engineering` are folded into the
  protocol's invariants. `reporting` is 605 words, `review` 497.
- **The tracker is opt-in.** `tracker: none`, `github`, or `gitlab` in the
  version-control rule, `none` by default. With `none` there is no issue, pull
  request, label, milestone, or forge call, and the effort's `log.md` is the
  whole run log. Everything tracker-shaped (the issue, the draft pull request,
  the label ladder, the merge-time job) lives in the new `policies/tracker` and
  loads only when the tracker is on.
- **The turn report is nine lines**, emitted once at the end of the turn:
  `Doing`, `Lane`, `Position`, `Assuming`, `Done`, `Stopped on`, `Needs you`,
  `Outside writes`, `Next`. `aep status` reads `Needs you` from the run log. The
  four prose prohibitions are one line in the protocol, and `skills/prose` loads
  only for a README, a pull request body, a changelog, or docs.
- **Fewer questions.** In the quick and standard lanes a product question
  becomes an assumption in the spec rather than an ask. `refine` runs in the full
  lane, at most five questions, one at a time, each with a recommended answer.
  The run accepts its own spec unless an architecture choice is pending. A
  review finding is fixed, ticketed, or recorded for the human to accept, and
  never stops the run to ask.
- **Trip-wire 2 reads "the work alters an existing public contract, or touches
  data at rest".** An addition the spec asks for is the standard lane's API
  addition, not a stop; renaming or removing what callers rely on still is.
- **Tickets are vertical slices**, each a thin path through every layer that can
  be checked on its own, and a wide rename goes expand, migrate in batches,
  contract. Dispatch briefs point at the spec, the ticket, and the notes instead
  of restating them.
- **An open visual question runs `prototype/ui` as a stage** once `/specify` has
  opened the effort, on a throwaway branch, and the human picks a variant.
- **A child's ticket branch is `<effort>--<ticket>`.** Git cannot create
  `<effort>/<ticket>` beside a branch named `<effort>`. Existing branches keep
  their names.
- **Rationale moved to `specs.md`**, Part VII, which no run loads. Each entry
  names the shipped rule it explains.
- **`/aep:update`** splits its 2.x branch into `update/from-2` and the 1.x
  conversion map into `update/conversion`, and a 1.x tree is converted straight
  to the current contract.
- `index.mjs` refuses an unknown option instead of writing the index on `--help`.

### Removed

- `policies/authority.md` and `policies/engineering.md`. Their law is in
  `protocol.md`; an upgrade removes the old files and repairs links to them.
- The opening and closing four-slot report, replaced by the nine lines above.

### Measured

| Target | Result |
| --- | --- |
| standard-lane `/implement` process text, at most 4,000 words | 3,923 |
| scenario suite, 12 of 12 | 12 of 12 (`tests/scenarios/results/4.0.0.md`; 3.5.0 was 6 of 12) |
| outside writes in any test run: none | one: a scenario agent wrote and deleted `/tmp/x.js` through a typed path, against the rule |
| quick lane at least 3x faster than the 3.x baseline | not yet measured: the baseline and the comparison are run on real items |
| no asks after the request in quick and standard, tracker off, except architecture | 0 in every quick and standard scenario; to be confirmed on real items |

### Upgrading

`/aep:update` prints what to do. Set `tracker:` in
`.aep/rules/version-control.md` to the forge you used under 3.x (`github` or
`gitlab`), or issues and pull requests stop being made; add `setup:` and
`stack:` where they apply. Put `lane: full` on every effort whose spec is still
`draft` or `accepted`, so it finishes under the rules it started with (a spec
with no lane is read as full already). Repository-owned files are untouched, as
before.

## 3.5.0

The status ladder ended on a row nothing executed. Every row above it projects
`spec.md`'s own `status:`, but merged turns on an event no run is still alive
for: `/implement`'s close moves both objects to `in review`, marks the pull
request ready, and stops, and the merge is deliberately the human's. So the last
agent act in an effort's life left both objects reading `in review` for ever.

It is not hypothetical. Pull request #46 merged at 15:47:25 and issue #45 still
read `status: in review` until a person removed it by hand seven minutes later.
The label was right only because somebody noticed.

The row's premise was unowned too. "Closed by the pull request" is a claim about
a closing keyword, and nothing shipped put one anywhere, so an issue closed on
its own merge only when somebody remembered. #46 carried `Closes #45` and the
issue closed itself. #52 carried `Refs #51`, which is the referencing form, and
#51 survived its own merge until a person closed it. Same protocol, different
luck.

### Added

- **A merge-time job for your forge, offered once.** It fires on the forge's own
  merge event, moves `status: done` onto the change request and the issue it
  closes, and reaches the same value for a change request closed without merging,
  so an abandoned effort leaves more than a flag behind. On GitHub it needs
  nothing provisioned and runs on the built-in token. On GitLab it needs a project
  access token with `api` scope, because no pipeline fires at merge and the job
  token cannot write to a merge request, and the offer says so before it says
  anything else.

  Offered at install and at update, written only if you accept, and never by
  default. Where you already run a workflow that assigns labels it is proposed as
  an addition to that file rather than a second one, and where that file's shape
  cannot take the addition the obstacle is named and nothing is proposed.

- **A refusal is recorded rather than re-asked.** Decline and nothing is written:
  the decision goes into your own `.aep/rules/version-control.md` as an
  decision, and it is read before the offer is made again. Delete that paragraph
  and you are asked once more, which is how you change your mind. It is not filed
  as a declared deviation, which would have `/update` report a settled answer as
  an open fork on every upgrade.

- **`.aep/scripts/reconcile.mjs`, which needs no decision and arrives either way.** It
  reads an observation you already fetched, on stdin or from a file, and prints
  which efforts have tracker labels disagreeing with their `spec.md`, including an
  issue left open after its change request merged. It makes no network call of its
  own, which is the point rather than an omission: this is the component that
  exists for a repository which declined the job, so a forge call inside it would
  make the fallback carry the cost it was built to avoid.

  With no observation it reports every effort `unobserved` and exits 0. A
  repository with no tracker runs it and learns nothing, which is the answer
  rather than a fault.

- **The ladder is a value as well as a table.** `contract.mjs` exports
  `STATUS_LADDER`, one entry per row, carrying the spec status a row projects and
  the observed change-request state that selects a terminal one. That second input
  is what `spec.md` cannot supply: it stops at `implemented`, so `status: done` is
  reachable from no file at all. The suite holds the value and the policy equal
  row for row, in both directions.

### Changed

- **The terminal row names two owners, at two latencies.** The job the forge fires
  on its own merge event, and the reconciliation the next run computes from what
  it already fetched. No row in the ladder is left without one, and the ladder now
  covers a change request closed without merging as well as one merged.

- **The runner writes the closing keyword, in the half your repository's shape
  puts it.** `/specify` owns the body half when it opens the pull request and
  `/implement` owns the commit half on the amend that finishes the work, and each
  reads which half applies from `.aep/rules/version-control.md` rather than
  shape. Where a repository stacks, the keyword names the change that merges last:
  a stack merges bottom-first, so a keyword below the top would close the issue
  with the effort still unbuilt.

- **The specification stops contradicting the ladder.** Its prohibition on
  labelling a fact the tracker already models is narrowed rather than lifted: a
  `status:` family AEP maintains keeps its terminal value, because a family with a
  hole cannot be filtered on, and the value is a projection of the effort's state
  rather than a second copy of the forge's. Outside such a family the prohibition
  stands.

- **A tracker reference cannot ship without its merge-time job.** The two are
  declared together, so a forge reference added later fails the suite rather than
  shipping half.

### Upgrading

Nothing you own changes shape and no file of yours stops validating. `/update`
makes the offer once and acts on your answer. Your forge reference is yours, so
the fetch that produces the reconciliation's observation is not added to it for
you: read it from the shipped seed and copy it across, or run the two commands
the notice names.

## 3.4.0

Shipped text made claims about the implementation and nothing tied the two
together. Three failed in one week, each caught by a person, each with a green
suite: a path with no root, an entrypoint describing a frontmatter field a
release had retired, and a skill sending its output to a file the specification
had reassigned two releases earlier.

A path with no root is the sharpest of the three, because following the
instruction literally writes a protocol artifact outside the protocol tree,
where nothing indexes it, nothing validates it, and the ownership rules reach
no opinion about it at all.

### Added

- **An artifact written outside `.aep/` fails validation.** `validate.mjs` reads
  the repository root's immediate children and reports a directory holding AEP
  artifacts, naming what it found, where it sits, and where it belongs. Until
  now such an artifact was not wrong to the check, it was absent, and absent is
  indistinguishable from never having existed.

  Recognition is by what a file is and never by the name of the directory
  holding it. Your own `templates/`, `references/`, `contexts/`, or `scripts/`
  at the root is not a finding, because a check that fires on ordinary
  repositories teaches people it is noise and after that it catches nothing. It
  reports and moves nothing: relocating your files is a write nobody asked for
  and the right destination is not always the obvious one.

- **The bootstrap states the convention for paths as well as for links.** A
  filesystem path naming an AEP artifact carries the `.aep/` root where it has
  two segments or more; a single-segment area name such as `policies/` stays
  bare. The reason for that split, rather than a uniform prefix or a leading
  slash, is recorded in the artifacts policy where an author will meet it.

- **A retired frontmatter field cannot be described as one a file carries.** The
  check reads the list a release already edits when it retires something, so the
  next retirement is covered without a new assertion. Its unit is the sentence,
  because a field is named legitimately in order to say it is gone and
  illegitimately in order to say what it holds, and only the words around it
  separate the two.

- **A skill's declared output is checked against the specification's own table.**
  A release that reassigns an output edits that table, and the table is then what
  fails the skill.

### Changed

- **Thirty files now say where their paths start from.** Sixty-five sites across
  the skills, the policies, the templates, the agents, the bootstrap, the seeds,
  and the generated adapters. The migration table's 1.x column takes `<runtime>/`
  rather than `.aep/`, because 1.x lived in whichever directory the runtime
  owned and this repository's own text names three of them.

- **Ten sites stopped describing the retired `owner:` field as current.** Five
  templates, two skills, an agent, and the version-control seed. Ownership has
  been a fact about location since 3.0.0, and each of these now names the
  directory that answers the question instead of a field nothing carries. The
  seed mattered most: it is written once into a repository and never touched
  again, so a stale claim there had no route by which it would ever be corrected.

- **A repository's own note beside a shipped skill validates.** The
  specification has said since 3.0.0 that a repository may add one, calling it
  the extension point that keeps *this is how we prototype here* out of a file
  an upgrade replaces, and the validator refused it for exactly as long. It is
  accepted now at `.aep/skills/<skill>/<note>.md`, one level deep and beside a
  skill the release ships. The skill set itself is unchanged: a top-level file
  under `skills/` that the manifest does not name is still refused, and no other
  protocol directory gains anything.

- **The skill template stops offering an extension point that does not exist.**
  The conforming skill set is fixed, and `validate.mjs` has refused a file under
  `skills/` that the release does not ship since 3.0.0, but the template's own
  trigger read "adding a capability this repository wants alongside the shipped
  skills". It now says what a repository may actually add: a note beside a
  shipped skill, with governance under `rules/`, orientation under `contexts/`,
  and tool operation under `references/`.

- **The entrypoint is checked rather than excused.** It kept one exemption, from
  the prohibitions the reporting policy fixes for prose, and had inherited from
  it a pass on every claim it made about the implementation. Every backticked
  path an entrypoint names must now exist, every command it shows must name a
  script that exists, and every flag it documents must be one that command
  accepts.

### Upgrading

A tree that validated before this release can fail after it, and what changed is
that a defect you already had became visible. The fix is to move the directory
under `.aep/` and run validate again. Nothing here moves it for you.


## 3.3.0

3.2.0 moved the work into surfaces. `/specify` creates the effort branch into a
worktree of AEP's own, `/plan` enters it, `/implement` enters it before its first
read of source. Position did not move with them, and review never moved at all.

Both are the same defect seen twice: a unit chosen before the work moved to where
it now happens.

An orchestrator and a child implementer of one effort returned byte-identical
answers from `scope.mjs` and `position.mjs`, differing only in which path printed
as self, while being bound by opposite rules that neither could derive from where
it stood. And `/implement` checked the marker in the checkout it was invoked in,
then stamped one inside the surface it entered, so it checked a file it never
stamped and quoted drift for a tree it was about to leave.

### Added

- **`scope.mjs` reports the surface a run stands in and the role it carries**, in
  both `read` and `read --json`, beside the claim and isolation it already
  printed. `.aep/worktrees/<effort>/_run` is the orchestrator of that effort, a
  sibling directory is a child on that ticket, the common checkout is `main` with
  role `none`, and a linked worktree elsewhere is one the runtime supplied.

  Both are computed from Git and the path on every read and stored nowhere, so
  the marker keeps exactly `tree`, `head` and `sessions`. `surfaceOf` reads no
  branch name at all, which is why a branch cannot mislead it.

- **A total table, and it fails open.** A path matching no shape resolves to
  `unknown`, every rule keyed on the role declines to fire, and no exit code
  moves. `role: none` in the main checkout is not a gap: it is the condition that
  already required a surface be taken before a first write, and it is now
  something a run can compute rather than infer.

- **The role refuses, in the policy and in the implementer's brief**, keyed on
  what a run computes rather than on a brief still being in context. A run over an
  effort outlives the session that started it, so a rule that lives only in a
  dispatched brief is a rule a cleared context no longer has.

- **Every surface AEP creates is anchored on the main checkout's
  `.aep/worktrees/`**, and that is normative rather than a convention. The path is
  what decides a run's role, so the derivation is sound only if the paths it reads
  are the ones AEP said it would create. A child surface created relative to the
  orchestrator's own surface nests inside it and reads `unknown`; one created
  outside `.aep/worktrees/` reads as a runtime surface, whose occupant is an
  orchestrator, and that child would compute the permissions its brief exists to
  refuse it.

- **A leading underscore is reserved, and it carries the discriminator.** `_run`
  is the orchestrator's surface, any other underscored name is a surface AEP made
  for something that is not a ticket, and every sibling without one is a ticket
  surface. Prototypes moved under `_prototype-<slug>` accordingly, so a prototype
  stops computing `implementer` and stops being refused a dispatch by a rule
  written for children.

### Changed

- **Review's unit is the effort, not the ticket.** The two reviewer agents are
  dispatched once, at the close, against the effort branch, which is the diff a
  human is asked to merge and the only unit the single pull request carries.
  Every defect living between tickets was structurally invisible to a per-ticket
  review, and converge was previously described as the only stage with the whole
  diff in view and nobody reviewing it. That hole is closed.

- **A marker belongs to the surface it sits in**, and a conforming implementation
  may not check one surface's marker while stamping another's. `/implement`'s
  check moved to after the surface is entered, so its check and its stamp address
  one file. `/specify` reads position by script rather than by prose. `/prune` and
  `/survey` check on entry and stamp at close, because the marker records the tree
  a run read rather than the tree it committed, so reading is what earns a stamp.

- **The ticking rule is narrowed, not dropped.** The orchestrator ticks what it
  verified, carrying inline what verified it, and a dispatched child still never
  ticks its own. The case given up is a wave of one, which the runner builds
  inline, and what pays for it is that the effort review is now guaranteed to run
  over that work.

- **An open finding blocks the handover**, replacing the rule that parked a ticket
  after two rejections. A finding against the effort names no single ticket, so
  what carried forward is the bound rather than the parking: a validated finding
  becomes a ticket the run schedules, and two rounds is the limit. Correcting one
  costs nothing extra, because the effort branch is held in the orchestrator's own
  surface and its pull request is a draft, so nothing has left the run's reach.

- **The commit rule is restated against the handover.** An agent must not hand
  work to a human while a review finding against it is open. As written before, it
  forbade committing work that had failed review, which nothing can satisfy once
  review runs after every commit, and a requirement nothing can satisfy is one
  every implementation quietly ignores.

## 3.2.0

AEP has isolated every sub-agent since worktrees arrived, and never isolated the
run itself. The orchestrator created its effort branch in whatever checkout it
was invoked from, and every wave landed there.

On 2026-08-24 two sessions ran in one clone and corrupted each other's refs. One
cherry-picked a ticket onto the other effort's branch, then read a clean status
and reset to undo it, which moved its own effort's branch onto the other's
commit. Branch scoping answered correctly on every call throughout, because
identity is not exclusion and 3.1.0 shipped identity.

### Added

- **A run claims the working surface it writes through, not only the branch it is
  on.** Where `scope.mjs` reports the isolation as `checkout`, the run takes a
  worktree of AEP's own at `.aep/worktrees/<effort>/_run` and creates its effort
  branch into it in one act, so the branch is never unheld. Where it reports
  `worktree`, the runtime already supplied a surface and no second one is taken.

  Git supplies the whole exclusion from there. It refuses a second worktree on a
  held branch, refuses another checkout switching to it, and refuses
  `branch -f` against it. Nothing arbitrates, nothing leases, nothing checks
  liveness.

- **The decision keys on the isolation's kind, never on its enforcement.**
  Enforcement describes the clone rather than this checkout, so it reads
  `enforced` on a shared checkout whenever other worktrees exist anywhere in the
  clone, which is the one case that most needs a surface of its own.

- **`position.mjs stamp --session <id>`**, recording the identifier the runtime
  supplied in the marker's `sessions` field. That field has been specified since
  section 20 was written and populated by nothing until now. Entries are
  deduplicated by id, because a run stamps once per ticket and an appending list
  would report one agent as a dozen.

### Changed

- **Releasing a claim and removing a surface are separate acts.** The close
  detaches the run's worktree, which frees the effort branch at once for whoever
  reviews it, and removes the directory afterwards. Detaching succeeds where
  removal fails, and a run cannot remove the directory it is standing in. The
  surface is removed on a clean close and kept on a stop.

- **The runner re-enters an existing surface rather than creating a second.** A
  run that died left one still holding its branch, and re-entry is what stops
  that locking an effort against its own resumption. Where that tree is dirty,
  the turn ends naming the uncommitted paths.

- **The position marker is described as per working tree throughout.** It never
  was per-clone: gitignored state is per working tree, so two linked worktrees
  hold two markers and two agents sharing one checkout hold one between them. The
  old wording sat in five shipped places.

### Fixed

- **`position.mjs` carried a raw NUL byte** as its fingerprint separator, so grep
  treated the file as binary and refused to read it. Every guard sweeping the
  shipped tree was passing on this file by not looking at it. Written `'\u0000'`
  instead, and the hashed byte is unchanged.

- **Argument parsing took a flag's value as the command**, so
  `--session abc stamp` ran `abc`.

### Compatibility

`--session` is optional and a stamp without one leaves `sessions` untouched, so
no installed marker needs migrating and every existing caller works unchanged.

**`sessions` is a diagnostic, and nothing may read it to decide whether to
proceed.** An identifier carries no liveness: it cannot be told apart from one
left by a process that was killed, so a run gating on it would block on the
leavings of every abnormal exit.

**The guarantee is git's, and it stops at two places** that the specification
names rather than glosses. `git update-ref` writes a held ref without complaint,
and nothing refuses anything between two clones.

Taking a worktree is a new requirement of every conforming runner, which is the
part worth reading before upgrading.

## 3.1.0

AEP has said the branch is the claim since 2.x, in three places, and nothing
ever read it. A run learned which effort it was inside from the human, in the
conversation, on every invocation. That holds while one session runs at a time
and stops holding the moment a runtime opens a thread per branch, because
threads share no conversation and the branch is the only thing telling them
apart.

### Added

- **`scripts/scope.mjs`, which answers where a run is from git alone.** `read`
  prints the efforts the branch claims, the efforts the tree is touching now,
  the isolation in force, and the base it measured against. `check` compares the
  second against the first and lists what falls outside. Exit 1 is the notable
  condition rather than an error, matching `position.mjs` and `frontier.mjs`:
  for `read` it means unscoped, for `check` it means something is outside the
  claim, and exit 2 means git could not be read.

- **The claim, and the working set.** The claim is the set of efforts the
  branch's own commits touch, measured against the default branch. The working
  set is what the tree is touching now. Confinement is the second measured
  against the first, and the order matters: a scope computed from the working
  tree can never fire a guard, because the first illegal write enlarges the
  scope that was supposed to catch it.

- **Resolution reads content first and the branch name second.** What a branch
  is called belongs to the repository, and under a runtime that generates one
  per thread it belongs to the runtime. A rule that recognised an effort by
  branch name would resolve `t3code/a1b2c3d4` to nothing, which is safe and
  worth nothing on the runtime this was built for. The name survives as the
  fallback for a branch with no commits of its own, which is the only signal
  such a branch carries.

- **Isolation is detected and reported, never required.** A linked worktree is
  distinguished from a main checkout by `git rev-parse --git-dir` differing from
  `--git-common-dir`, and the sibling worktrees with the branch each holds come
  from `git worktree list --porcelain`. Inside one clone git refuses a second
  worktree on a branch already checked out and names the holder, so the claim is
  enforced. Across clones nothing refuses anything, so it is advisory and the
  run says so. AEP creates, names, and removes nothing the runtime owns, and a
  runtime that offers no worktrees changes nothing but the strength of the claim
  reported.

### Changed

- **A run establishes its claim before it acts.** `specify`, `plan`, `tasks`,
  `implement`, `refine`, `review`, `prune`, and `survey` each read the scope on
  entry, quote it, and put the claim and the isolation in `Position` beside
  whatever that skill already verifies. `implement` keeps its position marker
  read: two questions, two answers, printed together and never merged.

- **A scoped run writes nothing belonging to an effort outside its claim**, and
  takes no ticket of one. Reading is unrestricted, and source outside the
  efforts is untouched by the rule, since changing it is what an effort exists
  to do. There are no exemptions, including for a skill whose subject is the
  whole tree: a `prune` or `survey` run that would reach another effort's
  artifact stops and names it, and belongs on an unscoped checkout. An exemption
  list would be a second mechanism deciding how strong the first one is.

- **An empty claim is unscoped and takes any effort**, which is the default
  branch and the state an effort is opened in. A claim of more than one is not
  an error, and stops only a run that must act on a single effort and was given
  none. A named effort outside the claim switches on a clean tree and stops on a
  dirty one, naming the claim, the effort it was given, and the uncommitted
  paths.

- **A ticket branch name must be unique across efforts**, ticket ids being
  per effort. The seeded version-control rule now names one
  `<effort>/<ticket-id>-<slug>`, and says why: two efforts each holding a ticket
  `03` otherwise want one branch name for two claims, which git refuses outright
  where threads have worktrees and which the second run quietly takes where they
  do not. How uniqueness is reached stays the repository's; that it holds is the
  protocol's.

- **A new effort's branch base is read from the repository's rule.** Where a
  repository stacks, a new effort stacks on the current branch; where it does
  not, the base is the default branch's tip, whatever `HEAD` happens to be.
  `specify` used to branch from wherever it was standing, so an effort opened
  from another effort's branch inherited that effort's unmerged commits and its
  pull request asked for a review of work nobody in it wrote.

- **Position is per working tree, not per clone.** The specification said
  per-clone, and gitignored state is not: two linked worktrees of one clone hold
  two markers, and two agents sharing one checkout hold one between them, which
  is the opposite of a claim in both directions. The marker therefore does not
  carry which effort a run is inside, and the correction is the sentence that
  used to make it look like it could.

### Fixed

- **`/plan` said it extended `spec.md` with the technical approach**, while the
  specification and the plan template both put that approach in `plan.md` beside
  the spec. The skill contradicted the specification it implements, so an agent
  reading both had to pick one. It writes `plan.md` now, and `status` stays the
  spec's, an effort having one state.

- **The seeded t3 Code reference now says the worktree path must be gitignored.**
  A thread runs in `.t3-worktrees/<thread-id>/`, and AEP fingerprints the tree
  with `git ls-files --others`, so an unignored worktree directory makes every
  thread read as drifted the moment a sibling exists.

### Upgrading

Nothing to do. `scope.mjs` arrives with the upgrade, an existing effort branch
resolves by what its commits touched with no rename and no marker, and an
unscoped run behaves exactly as it did before.

**One thing to read rather than to run.** An upgrade never edits `rules/`, so a
repository seeded before this release keeps a version-control rule naming a
ticket branch `<task-id>-<slug>`, which is not unique across efforts. `/aep:update`
reconciles rules against law that changed under them and will report the
divergence; the decision is yours. The convention is forward-only either way:
existing branches keep the names they have, still resolve by what their commits
touched, and renaming a live one takes away a claim somebody may be holding.

## 3.0.0

Ownership stops being something an artifact claims about itself, frontmatter
shrinks to what decides whether to load a file, and `modes/` folds into the
skills that entered it.

### Changed

- **Ownership is a lookup, not a declaration.** `scripts/contract.mjs` carries
  the directory table and a generated manifest of the exact paths a release
  ships. The installer consults it to decide what it may write and what it must
  preserve, and the validator uses it to name a file standing in a protocol
  directory that this release does not ship. Nothing reads `owner:` any more,
  and the case the field could never catch, a file that simply omits it, is now
  the same case as any other.

- **Frontmatter is `use-when`, and `paths` where applicability follows the
  repository.** Seven fields are gone: `aep`, `date`, `kind`, `mode`, `report`,
  `owner`, and `part-of`. `kind` restated the directory, `date` was a freshness
  claim nothing checked, `report` chose between two shapes the reporting policy
  now fixes at one, `part-of` restated the effort directory a ticket is filed
  under, and the release is named once, in the bootstrap's `version:`, instead of
  on every shipped file.

  A tree you own is not edited by the upgrade, so your own rules and contexts
  keep whatever they carry. Validation rejects a retired field only on a path
  the protocol ships.

- **`use-when` is checked rather than trusted.** Four mechanical checks, since
  discovery now rests on this one field: it states an occasion rather than a
  topic, it is not a restatement of the heading, it is not the file or directory
  name, and it stays inside a word bound measured from the shipped corpus.

- **`modes/` is gone.** A mode stated a posture, its mindset and what that
  mindset gives up, and every one of those now sits inside the skill that used
  to enter it, read at the moment it applies rather than fetched. Delete
  `.aep/modes/`: the validator fails a tree that still has it. If you wrote a
  mode of your own, its content belongs in your own skill or rule.

### Added

- **`scripts/frontier.mjs`**, shipped and installed. It reads an effort's
  tickets and prints what is ready, what is blocked and on what, and what is
  parked. Exit 0 while work remains, 1 when nothing is unresolved, 2 when the
  graph cannot be read, so an unreadable effort never looks like a finished one.

- **`scripts/manifest.mjs`**, build-only. It regenerates the shipped-path
  manifest from the payload, and the suite fails when the committed one is
  stale. A stale manifest fails open: a new file would be treated as the
  repository's and never installed.

- **Two skills are gone, and one note moved.** `/commit` is no longer a command:
  landing a task is part of finishing it, so the mechanics run inline at the end
  of `/implement`, and the two judgements `/commit` made about a whole effort,
  whether the effort is implemented and whether the change falsified a context or
  a reference, are made once the effort has no unresolved task left.
  `skills/tasks/labels.md` is gone with its ladder and its approval gate; what
  replaces it asks which of your labels describe an effort rather than which
  label carries a grouping fact. `skills/commit/conflicts.md` is now
  `skills/implement/conflicts.md`, beside the skill that reads it.

- **One invocation runs the effort, not the wave.** `/implement` reads the
  frontier, builds every task on it, and reads it again, until nothing is
  unresolved. It stops on exactly three conditions and there is no fourth: a task
  that cannot be built as specified, a criterion the plan cannot satisfy, and a
  change that would widen the effort's scope. Everything else it decides and
  records.

- **An effort is one issue and one pull request.** The tracker carries the effort,
  not the tasks: tasks are files under `efforts/<effort>/tickets/` in the
  repository, and the pull request body is the run's durable memory, rewritten as
  the run proceeds so that a session that dies is resumed from it.

- **`plan.md` is back.** `spec.md` holds what is changing and why, `plan.md` holds
  how. 2.0 folded them into one file, and the fold made every reader of a change
  pay for its design. An effort whose approach is obvious still needs no plan.

- **A status is not written without the evidence it claims.** Two gates, one per
  level. The run that closes an effort stamps `spec.md` to `status: implemented`
  before it readies the pull request, which is the answer it just gave recorded
  in the file that asked for it; `/tasks`, `/prune`, and the validator all read
  that value and until now nothing set it. And a task cannot be `resolved` while
  one of its acceptance criteria is unticked, because the status is the claim
  that the work is done and the ticks are the evidence for it. Validation fails
  both by name.

  A criterion that cannot be met parks the task unresolved or marks it
  `obsolete`; ticking it is not one of the ways out. Efforts you have already
  landed are exempt from both checks: a merged effort is the record of what was
  reviewed, and this release does not rewrite it.

- **Having no tracker is a posture with a procedure, not the absence of one.**
  Every step that closes an effort was written against a pull request, so a
  repository without one was not losing a projection, it was losing the run's
  memory. It now has a stated shape: the effort is a branch, `/specify` makes no
  tracker call and a local counter supplies the number, the run's record is the
  commits and the ticked criteria in the ticket files, and the close stamps
  `spec.md` and stops there. **The human merges.** The runner never does, with a
  tracker or without.

  The other half is that **where a tracker exists, the issue and the pull request
  are required**, and each links to the effort in both directions: the effort
  directory is named for the issue number, both bodies name the effort's path.
  A run that finds one missing opens it and says so. Until now nothing said the
  two objects were required, which made the smaller shape reachable by not
  asking.

  Nothing shipped now reaches for a tracker before establishing there is one:
  `/install` skips the label offer and says it skipped it, the 2.x reshape runs
  its tree half and says the tracker half did not apply, and the correctness
  reviewer ticks a box that is in the pull request or in the ticket file
  depending on which posture the repository is in.

- **An upgrade reconciles your rules against the law that changed under them.**
  A rule may tighten a policy and may never contradict one, and that judgement
  was made against the release the rule was written under. `/update` now reads
  every rule citing a policy the crossed releases changed and classifies it:
  a restatement of changed law is rewritten to cite the policy, a contradiction
  is rewritten to the new law or recorded as a declared deviation, and a rule
  tightening a policy the release did not touch is left byte-identical.

  The candidates are computed from the rule's own citations rather than judged,
  so the same tree raises the same list. **Every edit is shown as exact
  before-and-after strings, as one set, before the first is made, and a refusal
  writes nothing**, the gate a tracker write passes, because it is the same act.
  A rule is never deleted. This release is its own instance: 3.0 gives the runner
  permission to push the effort branch, and a repository whose `version-control`
  rule still reads "never push" carries a rule the protocol now contradicts.

### Upgrading

- **Two mechanisms classify a tree, and the older one has a stated end.** `/update`
  reads the layout before the version, because a version field is a claim and the
  files are a fact. A tree carrying `owner:` on its artifacts was written under
  the contract where that field decided ownership, and is classified by it; a tree
  without one is classified by the manifest this release ships. The `owner:`
  branch goes when no repository the maintainer knows of still carries that
  layout, which is written in `skills/update.md` rather than left to judgement.

- **The upgrade names what it will not convert, and converts nothing on its own.**
  An artifact still carrying a retired field, and an effort still in flight whose
  `spec.md` holds a `# Architecture` section, are both reported and left. Dropping
  a field decides its content is really answered elsewhere, and splitting a spec
  decides what is WHAT and what is HOW: those are judgements, and a script that
  made them silently would have edited a file you own to do it. `/update` makes
  them with you.

- **An effort that has already landed is left alone.** Its spec is not split, and
  its issues and pull request are not reshaped. They are the record of what was
  built and reviewed, and rewriting them to match a layout the work was never done
  under loses the record and gains nothing.

## 2.7.0

What an agent writes for a human becomes governance, and an orchestrator owes one
account of the work its children did in parallel.

### Added

- **`policies/reporting` governs everything a human reads**, not only the turn
  report. Which texts it covers is decided by a test rather than a list: a human
  reads it, it is governed; a protocol agent reads it, it is exempt, and exempt
  means written for that reader instead, never written carelessly.

  Governed: session output, commit messages, pull request titles and bodies,
  comments and docstrings in source, what a script prints to a person, and a
  repository's own documentation. Exempt: prose inside `.aep/` artifacts, a brief
  written for a sub-agent, data a script writes for another agent to read, and
  normative protocol text wherever it lives, including a repository root.

  Four prohibitions sit in the policy rather than the catalogue, because a script
  can check them: no em dashes, no curly quotes, no decorative emoji, no
  title-case headings. The first of them rules out its own substitutes, since
  parentheses and an en dash trade one tell for another.

  *Why a test and not only a list: a list settles the cases somebody thought of,
  and every case it missed gets decided by whoever hits it first, differently each
  time.*

- **`skills/prose`, the eighteenth skill**, carries the craft the policy does not:
  the patterns that mark writing as machine-made, how to spot each one, and what
  to do about it. It is a sub-skill, reached from whichever skill is about to emit
  text a human will read.

  The split is deliberate. A skill carrying the prohibitions would be governance
  under another name, which the protocol forbids, and a policy carrying the whole
  catalogue would be thirty rules where four are checkable.

- **`policies/execution` states what the orchestrator owns once its last child
  returns.** Reconciling a claim against a diff is an honesty check and not the
  same as making the result coherent. Three things a child structurally could not
  do are the orchestrator's: the seams where children's diffs meet, every decision
  a child recorded and stopped on, and one account of the work written as though
  one agent had done it in sequence rather than each child's summary concatenated.

  **The seam pass is bounded at the surfaces the diffs share.** Anything else the
  orchestrator notices inside one child's work is raised, not taken, and returns
  to the frontier as a task. A bound read off `spec.md` cannot tell reconciling a
  seam from rebuilding a task a child already delivered, and the orchestrator is
  the one agent with no reviewer above it.

  The account describes the work rather than the workers, and sub-agent structure
  surfaces where it changed the outcome: a child that failed, a child that stopped
  on a decision the human must make, a task that returned to the frontier. That is
  not permission to suppress a failure. A fan-out that lost a task changed the
  outcome by definition.

  **A child writes its question plainly and the orchestrator presents it.** Wording
  may be reshaped and substance never is: what is being asked, and which options
  are offered, survive unchanged, and attribution names the source rather than the
  author of the words. This runs the opposite way to the answer, which still
  travels verbatim, because an answer carries the human's authority and a question
  does not.

- **Guards for all of it.** Thirty-four assertions, each broken once and watched
  to fail by name: every clause of the widened policy, each of the three
  obligations separately, both halves of the account clause, the substance clause
  without which the presentation clause licenses a rewritten question, and a scan
  for the prohibited character over every shipped script and this repository's own
  documentation.

### Changed

- **This repository's own governed text lost its em dashes.** All 177 across the
  ten shipped scripts, 16 in `README.md`, and 67 in `CHANGELOG.md`. Comments and
  the strings a person reads were rewritten rather than deleted: where a dash was
  carrying a clause, the sentence ends or takes a comma.

  `specs.md` and `AGENTS.md` keep theirs, and the suite asserts they are not in
  the swept list and that they still carry the character. Their reader is the
  agent building the protocol, which is exactly what the test exempts, and it is
  where the vocabulary is defined that a catalogue of tells would otherwise flag.

  The places that still have to produce or match the character write it as a
  Unicode escape, so the guard is a flat scan with no whitelist. `index.mjs`'s
  empty-cell placeholder became one named constant, and the index it renders is
  byte-identical.

- **`specs.md` 16.2 is now *What the human reads*.** It opens with the reader
  test, the worked lists, and the exemption, then keeps everything it already
  fixed about slots, forms, and stage names. The skill set is eighteen and the
  sub-skills are three, in 16, 16.1, 29, and the conformance list.

- **The bootstrap says who a text is written for.** The `Every turn reports`
  invariant carries one clause pointing at the policy, and the governance table's
  trigger widens to agree with it. `skills/implement`'s close-out routes to the
  reconciliation section, so the obligation is reachable from the skill that
  dispatches rather than only from the policy that states it.

### Fixed

- **`skills/help` did not know about the eighteenth skill.** A skill could ship,
  be wrapped by every adapter, be named in the specification, and still be missing
  from the one artifact whose job is answering what to reach for.

  Nothing in the suite asserted anything about `help.md` at all. Something does
  now, derived from the shipped skill set rather than from a second hand-written
  list, which would be the same failure one level up with nothing catching it
  either.

## 2.6.0

AEP reaches OpenCode, and a repository driven through T3 Code knows why it
behaves the way it does.

### Added

- **An OpenCode adapter.** `--adapters opencode` writes `.opencode/skills/` and
  `.opencode/agents/`. OpenCode already found AEP's skills through its
  Claude-compatibility scan, but only while that flag was left on, and **skills
  only**. Its agents load from a config directory or from nowhere, so the four
  AEP agents reached it by no path that existed.

  Names carry an `aep-` prefix. OpenCode registers `init` and `review` as
  built-in commands before skills, and a skill whose name is already taken never
  becomes a command, so an unprefixed `review` would have been silently
  unreachable, which reads exactly like a skill nobody invoked.

- **A runtime-neutral `.agents` adapter.** `--adapters agents` writes
  `.agents/skills/`, the one location read by more than one runtime: OpenCode
  scans it, and T3 Code's picker scans it for whichever provider it is driving.

  **It is an alternative to `opencode`, not a companion.** OpenCode reads both
  locations, so asking for both loads every skill twice under one name and the
  loader keeps whichever finished first. The installer warns and writes both,
  because a repository driven through a harness with another provider can
  genuinely want it; the install skill offers one.

- **Seeds for OpenCode and T3 Code**, detected by `opencode.json` /
  `opencode.jsonc` and by `t3.json`, never by `.opencode/`, which AEP's own
  adapter creates and which would make an installation the evidence that the
  repository uses OpenCode.

  The T3 Code reference records what T3 Code is: a control surface over provider
  CLIs, defining no format of its own, so what a session gets is whatever the
  provider loads.

### Changed

- **`--adapters` takes a list.** It compared its whole value against the string
  `claude`, so every other name was silently a no-op. A user asking for a
  runtime saw a successful install and got nothing. Names now resolve before the
  first write, so a typo in the third cannot leave a half-installed tree, and
  each adapter is named in the report with its wrapper count instead of
  disappearing into a total.

- **A runtime is a row in a table rather than a function of its own.** One
  renderer walks the payload for every target. The alternative, a render
  function per runtime, would have stated the pointer contract once per
  runtime, and a stale adapter is mechanically detectable while three wordings
  of one rule drifting apart is not.

  §29.1 of the specification defines targets and shapes, including that a
  rendered tree is committed exactly where that directory is itself what a user
  registers, and that a distribution shape's reach is derived from where the
  wrapper sits rather than written out.

### Fixed

- **Every agent wrapper sent its sub-agent to a file that does not exist.** They
  said *"Then read `.aep/rules/sub-agents.md`, which binds you"*. That artifact
  moved into `policies/execution` in 2.2.0, and the installer has declared the move
  ever since. The wrappers went on naming the old path for four releases,
  so every dispatched agent was told to read nothing.

  A role definition already states what binds it, so the wrapper now names the
  role definition and nothing else.

  *Why it survived four releases: nothing compared wrapper text against an
  installed tree. The guard that now does is the point of the fix: every
  `.aep/` path a wrapper names, in prose and in frontmatter alike, must exist in
  an install.*

### Upgrading

Nothing to do. No artifact moves, no installed tree changes shape, and a
repository that never asks for a new adapter is untouched.

To pick one up: `/aep:update`, and ask for the adapter your runtime reads.
Regenerate a Claude adapter you already have, because the agent wrappers changed.

## 2.5.1

### Fixed

- **`policies/artifacts` said the opposite of what a release does.** It claimed
  every release stamps every protocol-owned artifact, and that an upgrade
  compares that field to decide whether a file came from the release. Both were
  wrong: `release.mjs` stamps only what changed, nothing anywhere reads an
  individual artifact's `aep:` for provenance, and `/update` detects a locally
  edited file by comparing content against the release it declares.

  The policy now says what is true. `aep:` is the release an artifact's content
  last changed in, `protocol.md` alone is stamped every release because the
  tree's version is read from it, and provenance is established by comparing
  content. §7 of the specification carried the same error and is corrected with
  it; §6 and §8 already said this.

  *Why it mattered: acting on the policy meant sweeping every artifact to the
  current release, which destroys the only thing the field says per artifact and
  makes the suite's stale-stamp guard true by construction.*

- **A section of the verification suite was aborting silently.** A helper was
  declared below a section that used it, so `policies` threw before its
  assertions ran, and an aborted section skips everything after the throw. It
  was hiding **14** checks. The helper moved up with the others, and the comment
  there now says why that position is not a style preference.

## 2.5.0

A monorepo can namespace its contexts by project.

### Added

- **`contexts/<project>/<area>.md`, beside `contexts/<area>.md`.** A monorepo has
  the same area in more than one project, auth in the web app and auth in the API,
  and a flat directory gave them one namespace to share. The project directory is
  where that name goes.

  *Why it needed saying rather than building: nesting already validated, already
  indexed, and already resolved as a wiki link. Nothing said so, so the capability
  was accidental. The template told authors to write `contexts/<area>.md`, the
  specification never mentioned placement, and contexts were walked rather than
  flat-listed only because nobody had passed a flag.*

- **The directory names; `paths:` scopes.** `web/auth` and `api/auth` can both be
  called `auth`, and a nested context still declares `paths:`, and nothing derives
  applicability from a directory name. A guard now proves it behaviourally: a
  nested context with no `paths:` must acquire none.

- **One project directory deep, and no more.** `validate.mjs` rejects anything
  deeper, naming the file and both legal forms. It ships in the validator rather
  than the build suite because contexts are authored in the consuming repository,
  where the build suite never runs.

### Changed

- **The bound applies to contexts alone**, deliberately. `rules/` and
  `references/` are repository-wide. A reference is picked up by whoever needs
  the tool, and a rule scopes with `paths:`, so neither has a namespace two
  projects can collide in. A limit keyed by directory would advertise a nesting
  nothing wants.

### Upgrading

Nothing to do unless you have a context nested two or more levels deep, which
nothing ever told you was legal. If you do, move it up to
`contexts/<project>/<area>.md` or flatten it. The upgrade will not touch it,
because `contexts/` is yours.

## 2.4.0

What a turn tells the human stops being invented once per skill.

### Added

- **`policies/reporting`, one shape for every turn.** Four opening slots in a
  fixed order (standing, request, assumptions, stages) and three closing ones
  (state, next, unsettled-with-how-to-settle-it). The unit is **the turn**, not
  the skill entry: one thing the human asked for produces one opening report and
  one closing block, emitted by the outermost skill, so a skill reached from
  inside another is a stage of that run rather than a second preamble.

  *Why this was worth governing: `/implement` mandated a position report,
  `/specify` a stated understanding, `/review` two fixed headings, and eleven
  skills said nothing. Every shape was invented locally, so nothing could be
  found by position, and a routing decision taken on the human's behalf was
  usually invisible.*

- **A slot with nothing in it says so**, rather than being dropped. Silence is
  indistinguishable from a check that never ran, and an omissible slot destroys
  reading by position, which was the whole benefit.

- **The closing block is a lantern, not a map.** The near next step and what is
  unsettled, with how to settle it. A turn that **stops early** carries it too:
  an empty frontier or a surfaced conflict is where it is worth the most.

- **`report: full | short` on every skill**, assigned once when the skill is
  authored by one test: does it write to the repository, dispatch a sub-agent,
  or decide on the human's behalf? Never selected during a run, so the shape is
  known before the turn starts. The two forms differ in the **stage markers**:
  the preamble is paid once per turn and a marker is paid per stage, so that is
  where the only saving worth a second form lives.

### Changed

- **Stage names are read out of each skill's own procedure**, never declared a
  second time. Seventeen numbered steps that carried no bolded lead gained one;
  `handoff`, which had no numbered steps, now carries the two it always had in
  prose, and `tdd`'s stage list is its loop rather than its loop plus its bug
  path. Exempting the two that fitted no shape was rejected. A guard that skips
  what it cannot handle passes by not looking.

- **`/implement`'s position report, `/specify`'s stated understanding and sizing
  floor** now fill slots instead of rendering shapes of their own. Nothing they
  did changed: the position script still runs on every invocation, and *nothing
  to report is still reported* survives verbatim. `/review`'s two headings and
  `/tasks`' graph are untouched, since they are output rather than a preamble.

- **The standing slot is filled with whatever a skill already verifies**, never
  with a new check. Thirteen skills read no position and none of them started.

### Upgrading

A skill you wrote yourself needs one new field: `report: full`, or
`report: short` if it neither writes, dispatches, nor decides. `validate.mjs`
fails a skill without one, and an upgrade never edits a file you own, so the
release declares a notice rather than changing it for you.

## 2.3.0

An effort's work is findable in the tracker that holds it, and AEP stops
inventing vocabulary a tracker already has.

### Added

- **An external task is attributable to its effort by a query the tracker
  answers natively.** Where tasks live in GitHub, GitLab, Jira, or anything
  else, exactly one fact has to be carried, which effort the task belongs to,
  and it has to be carried where the tracker can answer it, not in prose an agent
  reads issue by issue.

  *Why this was a hole: `policies/execution` computes the frontier from declared
  edges and forbids inferring independence from a guess. A repository whose work
  lives in a tracker had no way to ask which issues belong to an effort, so the
  rule stood with nothing behind it, and the cheapest way to satisfy it was to
  work serially and say nothing.*

- **`skills/tasks/labels`**, the procedure, reached from `/tasks` when the
  answer to *where do tasks live* is a tracker. It resolves one fact against one
  tracker, once, and records the answer so later sessions read it instead of
  working it out again.

- **Declared notices: what a release asks of the reader.** A release can now
  declare what must be *checked* when crossing it, and an upgrade reports exactly
  the notices for the releases actually being crossed. A tree already at the
  release is shown nothing; a dry run previews them; `/update` acts on each or
  reports it as outstanding.

  *Why: `MOVES` covers everything a release does to a tree, and nothing a release
  requires of the reader. That gap is not hypothetical. This very release has
  one. The reference section below is repository-owned, so an upgrade correctly
  refuses to write it, and without a notice every existing installation would get
  the new behaviour and never the section it writes into.*

  Gated by the same predicate as declared moves, so a notice and a move from one
  release cannot disagree about whether that release is being crossed. Relevance
  is two release numbers compared, never judged at runtime.

  **Not the changelog.** `CHANGELOG.md` is not payload, so a repository running
  an upgrade has never received one; shipping the whole history into every
  installation to deliver two lines is a poor trade for a filter that already
  existed. A notice is the narrow, actionable subset, and a release with nothing
  to ask of the reader declares none.

### Changed

- **`aep:` now means the release an artifact's content last changed in**, one
  meaning for both owners, and computed rather than typed. `date:` answers the
  same question by the same mechanism.

  It previously meant two things at once. Protocol-owned artifacts were swept to
  the new release every time, changed or not; repository-owned ones were left
  alone and so already recorded when they last changed. The specification
  described only the first, and nothing declared the split.

  *Why it was worth changing rather than automating: under a sweep the field said
  the same thing on every artifact, so it distinguished nothing, and an artifact
  edited without being restamped was undetectable, because a stale stamp and a
  current one were the same value. Only `protocol.md` is exempt, and it is exempt
  for a reason: it is the tree's release marker, read by the installer to decide
  which moves and notices apply.*

- **`node src/scripts/release.mjs <version>` cuts a release.** Version of record,
  stamps for what actually moved, the baseline in `src/stamps.json`, plugin
  manifest, and adapter, one command, so the steps cannot be performed in part.
  Running it twice changes nothing the second time.

  The baseline is a committed hash per shipped artifact rather than git tags:
  `verify.mjs` is the only thing that catches a broken build here, and making it
  depend on tags being present in whatever checkout runs it puts the suite at the
  mercy of how the repository was cloned.

  `verify.mjs` now compares every shipped artifact against that baseline, so
  **an edit that never got released fails by name**, the defect the old scheme
  could not see at all.

- **Native mechanism before label.** The resolution is a ladder: a first-class
  feature of the tracker, then an existing label that already serves the fact,
  then, only then, a new label, named in the style the tracker's own labels are
  named in. **A label is never created for a fact the tracker already models.**

  On a tracker that models milestones, dependencies and issue state itself, every
  fact lands on the first rung and **no label is created at all.** That is the
  intended outcome, not a degenerate one.

- **`status` and dependency edges are excluded, deliberately.** An issue's own
  state already carries open and resolved, and a second copy disagrees with the
  first as soon as somebody closes an issue from the tracker's interface. An edge
  is not set membership: a `blocked-by-42` marker has to be withdrawn when 42
  closes, and nothing in the tracker knows to do it, so it is wrong exactly when
  it matters.

- **The GitHub and GitLab references, rewritten against primary sources.** Both
  now say what the tracker models natively, which commands reach it, and where
  the gaps are.

  GitHub carries every fact itself. An effort is an issue and its tasks are that
  issue's sub-issues, gates are issue dependencies, state carries a close reason,
  and types are native, so the frontier is *computed*: one query returns the
  effort's open issues with `blockedBy` attached.

  Two gaps are stated rather than smoothed over. There is no `gh milestone`
  command, which is what makes the hierarchy the default and the milestone the
  alternative: creating a parent issue is `gh issue create`, creating a milestone
  is a drop to the REST API. And there is no `--parent` filter on `gh issue
  list`: `parent` comes back in `--json` and is narrowed client-side with `--jq`,
  *after* `gh` has truncated the page. The reference says plainly what that costs:
  a truncated page filters to a short list that reads as a complete answer.

  GitLab has neither. `glab` has no subcommand for issue links at all, and
  `blocks` / `is blocked by` are Premium and Ultimate, so the edge is carried in
  the issue description, named in the reference as a **hand-maintained
  convention rather than state**, because that is what it is. GitLab also has no
  close reason, which makes `obsolete` the one fact on either tracker with no
  native carrier, and the single place a derived label is genuinely the answer.

- **What body text does, and does not do** is now written down on the GitHub
  side. Only the closing keywords in a pull request body drive anything;
  `Blocked by #123` in a body does **nothing at all**, and `- [ ] #123` is a
  checklist item rather than a relationship.

  *Why it earned a table: it fails silently. The sentence reads correctly to
  every human who sees it, the tracker holds nothing, and the frontier query
  returns that task as ready to start.*

### Fixed

- The GitLab reference had been shipping `--description-file`, which is not among
  `glab issue create`'s flags. A seeded command the repository does not have is
  worse than no reference at all, because it will be trusted.

## 2.2.0

Governance splits into two named primitives, and the nine shipped rules become
four policies.

### Added

- **Policies, at `.aep/policies/`.** AEP's own governance, protocol-owned,
  installed verbatim, and never edited in a repository. Four ship: `authority`
  (which source wins, and which repository is yours to act on), `engineering`
  (how a claim is made, and what to do on finding you cannot make one),
  `execution` (an effort from accepted spec to landed change, sub-agents
  included), and `artifacts` (whose a file is, where it goes, what shape it
  takes).

  *Why a second directory when `owner:` already said this: `rules/` already held
  two layers, the shipped nine and whatever the repository added, separated
  only by a field inside each file. An agent listing the directory could not tell
  AEP's law from local convention without opening every file. The hierarchy in
  §10 has not changed; it was already `protocol rules → repository rules`. What
  changed is that you can now see it.*

- **Declared moves.** A release states which protocol-owned artifacts it
  relocated, and an upgrade applies them: it removes the old file, repairs links
  that pointed at it inside repository-owned artifacts, and reports every
  removal, repair, and collision. A move is not a retirement. The content still
  exists, and leaving the old file would govern a repository with two copies of
  one text, both of which resolve.

  This is the **only** circumstance in which an upgrade writes into a file the
  repository owns. It is confined to the declared targets, only where the source
  path is now vacant, and only the link target changes.

### Changed

- **Rules are now repository-owned, exclusively.** `rules/` ships nothing and
  arrives holding only the version-control seed. `policies/` admits only
  `owner: protocol` and `rules/` only `owner: repository`, the one place a
  directory constrains ownership, and it does not weaken the rule that ownership
  is read off the declared field: an installer still reads the field before
  overwriting anything, so a misplaced file is **preserved and then reported**,
  never silently corrected.

- **A repository cannot author a policy.** However non-negotiable a local
  constraint is, it is a rule. The moment the directory admits either owner,
  reading it tells an agent nothing.

- **Rigidity is authority, not loading.** A policy outranks every rule and cannot
  be edited, but it is selected by its `use-when` exactly like any other
  conditional artifact. Nothing became always-on.

- **Nine rules became four policies**, grouped by the moment they fire rather
  than by subject. Two of the merges were already visible in the old text:
  `evidence` opened by conceding that *how a claim is made at all* belonged to
  `engineering`, and `ownership` closed by handing the reader to `artifacts`. A
  rule that must point at another rule to be complete is one file split in two.

  The cost, recorded because it was priced rather than missed: merging drops
  `mode:` from all four, since each union covered six or seven of the eight. It
  is honest for `engineering`, whose trigger already fired in modes its `mode:`
  did not list, and least honest for `execution`, whose sub-agent half is
  genuinely narrow.

### Migration

Existing 2.1.x trees upgrade in place. The nine rule files are removed, links
are repaired, and anything the repository owns is untouched. Read the report.

**`policy` means the opposite of what it meant in 1.x.** A 1.x policy was the
repository's, derived per repository; an AEP policy is protocol law, identical
everywhere. So a 1.x `policies/<concern>.md` converts to a **rule**, never to a
policy, because converting one the other way would hand the repository's own decisions
to the protocol, and the next upgrade would overwrite them. 1.x detection stays
scoped to the runtime's own directory, so `.aep/policies/` never reads as 1.x.

## 2.1.1

A link that only resolved on the machine that wrote it, and one field that now
answers one question.

### Changed

- **`aep:` is the release an artifact ships in, and every release stamps every
  protocol-owned artifact**, reversing the 2.1.0 decision below, which made the
  field the release that *last changed* the artifact. Both readings cannot hold
  at once, so this supersedes it rather than sitting beside it.

  The comparison an upgrade actually makes is *did this artifact come from the
  release the tree declares*, one question, answered by equality. Per-artifact
  provenance answered a different question and made the first one unanswerable,
  since a legitimately old stamp and a file the installation never received were
  the same value. Provenance is what this changelog and the git history are for.

  `verify.mjs` enforces it as equality rather than a range: a stamp behind the
  release now fails exactly as a stamp ahead of it always did. Confirmed to fire
  before landing.

### Fixed

- **The prototype skill and mode no longer link to `worktrees/`.** It was the one
  link in the distribution pointing at a gitignored, per-clone directory, so it
  resolved wherever an install had created the empty directory and resolved to
  nothing in every fresh clone, passing locally and failing in CI. The path is
  stated as text; there was nothing to link to, and creating something to satisfy
  a link is what a dangling link must never cause.

## 2.1.0

A repository is met by a reference for every tool it actually runs.

### Added

- **A wide reference catalogue.** Fifty-three tools join the ten 2.0.0 shipped,
  each gated on that tool's own evidence: the JavaScript and TypeScript
  toolchain, test runners, bundlers, monorepo orchestration, application
  frameworks, desktop and mobile shells, the Rust, Go, Python, Ruby, PHP, JVM,
  .NET and Nix toolchains, database and schema tooling, containers,
  infrastructure and deployment targets, release automation, task runners, and
  git hooks.

  Ten references left most repositories with a nearly empty `references/`, which
  is where an agent starts guessing invocations, the failure references exist to
  prevent. Breadth is safe because the detector decides: a repository receives a
  starting point only for what it demonstrably runs, and each still opens by
  saying it is a draft.

  Each leads with the hazard that tool actually presents rather than its feature
  list: a cached task that ran nothing, a `--remote` flag one word from real
  data, a generated migration that drops a column, a `--fix` that rewrites files
  nobody reviewed.

### Changed

- **The seed manifest takes a `reference` helper**, so a seed is one line and
  the catalogue reads as a catalogue.
- **`aep:` is enforced as the release that last changed an artifact**, rather
  than as the current one. Every payload artifact and seed must declare a real
  release no newer than the one being built; only what a release touches is
  restamped. A blanket stamp would make every artifact look changed on every
  release, which destroys the comparison an upgrade makes.
- **`protocol.md` is the exception, and is now specified as one.** Every release
  stamps it, because it is what an installed tree declares its release *as*. The
  index reads the version from there and `/update` compares it. The suite
  asserts both halves.
- **`/update`'s field mapping no longer names a literal release.** A migration
  stamps converted artifacts with the release it just installed, read from the
  `protocol.md` it wrote.

### Fixed

- **Three gaps in the verification suite**, each confirmed to fire before
  landing: a seed file the manifest declares nowhere, shipped and installed
  nowhere, and invisible because the tree looks complete; a detector whose
  `paths` are empty, which reads as gated and behaves as retired; and any
  reference installing into a repository that shows no evidence of its tool. The
  last replaces a hand-written check naming two references, which would not have
  scaled past them.

## 2.0.0

A rewrite of the framework. AEP 1.x was a Claude Code skill framework rooted in
`.claude/`; 2.0 is an agent-agnostic filesystem protocol rooted in `.aep/`. The
framework is replaced; a repository's own knowledge is converted across.

**No 1.x file upgrades in place, and this is deliberate.** The two architectures
disagree about where state lives, what governs, and how knowledge is selected, so
converting 1.x's framework files would have carried its shape into a design that
exists because that shape was wrong.

What does move is everything 2.0 has a representation for. `/update` recognises a
1.x layout by content, installs 2.0 fresh, and **converts**: contexts, tool
guides, specs, tickets and their states, evidence, repository-authored rules,
and the repository content 1.x kept *inside* framework-owned files, which is the
part a migration loses most easily. A file is dropped only where this release
ships the thing it was, never for having declared `owner: framework`.

Every derivable field is derived, including `date` from the file's own history;
`use-when` is proposed and flagged, because it is the one field nothing can
compute. Nothing is deleted, every collision stops, and the result passes
`validate.mjs` with no exemption. `skills/update/migration.md` has the mapping.

### Added

- **`.aep/` as the single canonical location.** Every runtime, whether Claude Code,
  Codex, Cursor, or another, reaches the same files through an adapter. A
  repository never carries one AEP state per agent.
- **Applicability metadata on every artifact.** `use-when`, `paths`, and `mode`
  decide what loads, so knowledge is selected by relevance rather than by stage.
- **A declared ownership boundary.** `owner: protocol` installs verbatim and is
  replaced by upgrades; `owner: repository` is preserved. Ownership is read off
  the declared field, never inferred from a path.
- **Seeds**, repository-owned starting points installed once, only where their
  evidence is detected: a version-control rule, a repository context, an
  entrypoint, and references for git, GitHub, GitLab, Graphite, pnpm, npm, yarn,
  Bun, Docker, and Make.
- **Templates** for every artifact kind, so a new rule, reference, context,
  spec, ticket, or role starts from the shape it must hold.
- **Skill notes**, depth at `skills/<skill>/<note>.md`, reached by link from the
  skill that owns it and paid for only by the run that takes that branch. The
  skill file stays what is true on every invocation; UI and logic prototyping,
  test and mocking judgement, the fallback smell vocabulary, module depth and
  designing twice, bug diagnosis, brief writing, conflict resolution, declining a
  request, the survey report, and the 1.x migration all live there.
- **A derived index**, regenerable byte-identically, gaining a tickets section
  exactly when local tickets exist.
- **A verification suite** asserting the shipped surfaces against `specs.md`,
  including a fixture install that proves the produced tree validates, and a
  seeded failure proving the harness can still fail.

### Changed

- **One governance layer.** Policies are gone; rules are the only one, each
  loading on its own trigger. What holds on every turn lives in the bootstrap
  instead, so no norm has two homes.
- **One spec file per effort.** `spec.md` evolves from WHAT/WHY to WHAT/WHY/HOW.
- **Scripts are JavaScript**, dependency-free ESM named `.mjs` so a consuming
  repository's `package.json` cannot change how they parse. `verify.ps1` is
  retired, and verification now covers the shipped surfaces only.
- **Everything that ships lives under `src/`.**

### Removed

- `.claude/` as canonical state, demoted to an adapter.
- Policies, the decisions database, `tools/`, the stage→dependency table, the
  boot-tier budget, discussions as an artifact kind, mandatory local tickets, and
  `plan.md`. `specs.md` §33 lists each with what replaced it.
- **Sub-agent fan-out.** A task is never split across children; independence is
  read off declared edges, never inferred. A task too large for one child is too
  large, and returns to `/tasks`.
- The third-party `NOTICE`. 2.0 vendors no upstream text, so no licence
  condition attaches to it. See `specs.md` §34, which also states what happens
  the moment that stops being true.
