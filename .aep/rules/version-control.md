---
use-when: "committing, branching, or preparing work to land"
# Read by .aep/scripts/aep.mjs. This repository uses GitHub issues and pull
# requests, and stacks with Graphite (below).
tracker: github
setup: ""
stack: true
---

# Rule — version control

Corrected from the seed against this repository's actual history and remote.

## The line an agent does not cross

`[[protocol]]` states it: never push, never publish. What that covers:

| Allowed | Not allowed without the human asking |
| --- | --- |
| `git add`, `git commit`, `git commit --amend`, `git branch`, local `git rebase`, `git worktree` | `git push` of anything but the effort branch below |
| reading remotes: `git fetch`, `gh pr view`, `gh issue list` | **merging** a pull request |
| local `git tag` | pushing a tag, publishing a release |
| **pushing the effort branch, opening its pull request as a draft, and marking that draft ready** when the effort closes (below) | merging it, at any point, ready or not |

*Why the line sits where it does: a commit is reversible in this clone, and a
draft pull request is reversible on the remote. Everything past those two is
not.*

## What the runner may push

**For an effort the human opened, the runner pushes the effort branch and opens
its pull request as a draft.** It does not ask, and it does not wait to be told.

**It also marks that draft ready** at the one moment the effort is finished:
converge found no gap, so the run finalises the description and hands the work
over. Readying is how the run says it is done, and a run that could not say so
would need the human back for a click.

Stated here rather than left to be inferred from the invocation, because this is
the first irreversible act AEP performs and an agent reading only the table above
would have to reason its way past a flat prohibition to do the thing the runner
exists to do. A permission an agent has to derive is a permission it will
sometimes derive the other way.

The permission is exactly that wide. **Still the human's to give:**

- **merging** a pull request, draft or ready;
- **publishing a release**;
- **pushing a tag.**

*Why the line moved: `/implement` carries a whole effort with nobody in the room,
and the pull request is where the run keeps its memory — the ledger, the ticked
criteria, the converge round (`[[policies/execution]]`). A run that cannot push
has nowhere durable to write, so a killed session loses the run rather than
resuming it. Draft is what keeps the act reversible: nobody has been asked to
review, and a draft that gets closed is a draft nobody read.*

## Commits

**Conventional Commits** — `type(scope): summary` — confirmed from the log, where
scopes name the surface changed (`protocol`, `configure`, `tracker`).

- Say what capability changed and why. **Never a file-by-file account.**
- Never `--no-verify`; never bypass signing.
- **Committing is part of finishing** — `[[skills/implement]]` lands reviewed
  work without waiting to be asked. Everything in the right-hand column above
  does wait.

## How work reaches the default branch

**A stack, submitted with Graphite, merged bottom-first by a human.** Switched on
2026-08-24, when `artifact-paths`, `post-merge-labels`, and the branch carrying
this rule were tracked into one stack in priority order. Every merge in the log
up to `#52` is a flat squash from a single branch, so the history below that line
is what the old shape produced rather than a description of what this repository
does now.

`gt` is installed and `gt init`ed against trunk `main`, and **every branch in
flight is tracked in it**. An untracked branch is not in the stack: nothing
restacks it when what sits under it moves, and it will be reviewed against a base
that has drifted.

Tracking lives in `.git/.graphite_metadata.db`, with `.graphite_pr_info` beside
it, on `gt` 1.8.6. An older note in this file took the absence of
`refs/branch-metadata` as proof that nothing was tracked; this version never
writes that path, so its absence proved nothing either way. `gt log --stack` is
the check that answers.

So a commit **carries the closing keyword** — `Closes #<n>` on the commit that
completes the work. A stacked commit reaches the default branch only through its
own branch's pull request, so the cherry-pick hazard that makes a keyword unsafe
in a flat repository cannot arise here. The pull request body still names the
issue in prose; the keyword itself is the commit's.

*Why this row matters more than it looks: it is the whole difference between the
two shapes, and getting it backwards leaves an issue open after its own merge.
That is exactly what happened to #51, under the flat rule, when the keyword was
written as `Refs`.*

Consequently `blocked-by` means **stack on top of**, not wait until resolved. A
ticket declaring an edge is built on a branch cut from the branch of the ticket
it names.

**Merging is bottom-first and the human's.** The lowest pull request merges into
`main`, everything above it restacks, and the next one merges. A stack merged out
of order asks a reviewer to read work against a base that does not exist yet.

## Branches

One branch per effort or task, named for the work, and **tracked in Graphite from
the moment it exists**.

**A new effort's branch is cut from the branch you are standing on**, the top of
the current stack, and tracked with that branch as its parent. That is what
stacking means, and it replaces the rule this file carried until 2026-08-24,
which had a new effort start from `main`'s tip precisely because nothing here
stacked. Where new work genuinely depends on nothing unmerged, cut it from `main`
and start a second stack rather than lengthening an unrelated one.

*The chain exception went with it.* A chain of efforts used to share a single
branch, on the reasoning that the alternative was a stack and this repository had
never used one. It uses one now, so each effort in a chain takes its own branch
and its own pull request, stacked in order, and each stays reviewable against the
one below it.

**A branch in the stack is one commit**, and changes to it are **amended into
that commit** rather than landed beside it. Amend, then `gt restack` so everything
above it moves with the change. `gt squash` is how a branch that grew several
commits is brought back to the shape.

*Why: a level of the stack is one reviewable change. A branch carrying four
commits asks its reviewer to work out which of them is the point, and it makes
every branch above it rebase across four moving parts instead of one.*

So the unit changed with the shape. Until 2026-08-24 an effort branch carried one
commit per ticket, `aep-3` being the worked example. Under stacking a ticket is a
**branch** with a single commit, its parent is the branch of the ticket its
`blocked-by` names, and the effort is the stack rather than one branch inside it.
An effort small enough to be one ticket is one branch, which is most of them.

### No, a ticket branch is not a stack level

**Stack levels are effort branches. A ticket branch is a build claim, and it is
not tracked.**

It exists so git refuses a second run the same ticket, and it holds nothing once
the orchestrator has integrated its work into the effort branch. The step that
lands the work deletes it (`[[policies/execution]]`). Tracking something that
lives for one ticket and is then deleted leaves metadata describing a level
nobody will ever review.

Stated because three implementers in one wave of effort 48 each reached this
question independently, and all three declined and escalated. Three agents
hitting one ambiguity is an underspecified rule, not three cautious agents.

**What made it ambiguous is a conflation worth naming.** Tracking a branch and
opening a pull request for one are different acts, and the answer turns on
neither of them:

| | Is | Applies to |
| --- | --- | --- |
| `gt track` | **local metadata**, in `.git/.graphite_metadata.db` | branches that will be reviewed, so effort branches |
| a pull request | a **tracker object** | one per effort, for the effort branch |

`[[policies/execution]]` allows exactly two tracker objects per effort, one issue
and one pull request, and says AEP creates no other. A ticket branch therefore
never gets one, which means it never merges on its own, which means it is not a
level of anything. **A branch integrated rather than merged is not a stack
level**, and that is the whole answer.

*This corrects the sentence above saying that under stacking the effort is the
stack rather than one branch inside it. The commits are arranged that way while
the work is being built; the reviewable unit is the effort branch, and the ticket
branches collapse into it as each one lands. Effort 54 answered the tracking
question the other way first, tracked twelve ticket branches, and then had to
delete all twelve and their metadata, which is what made the right answer
visible.*

**If ticket branches should instead be separately reviewable, each with its own
pull request, that is a change to `[[policies/execution]]`'s two-object rule and
it is the human's to make.** A rule may tighten a policy and never soften one, so
this file cannot grant it.

The closing keyword goes on the commit that completes the work (above), so a
branch still being amended carries `Refs #<n>` and gains `Closes #<n>` on the
amend that finishes it.

Check `git show --stat` after any amend — an amend here can pick up files no
command staged.

**A ticket branch is named `<effort>/<ticket-id>-<slug>`** — the effort
directory's full name as the namespace, so ticket `06` of effort
`51-branch-scope` is `51-branch-scope/06-seeds`. The directory name and not the
effort branch's, which drops the number here: `branch-scope` is what the effort
is on, and `51-branch-scope` is what a run resolves a name against.

The namespace is there because ticket ids restart at `01` in every effort, so a
bare `06-seeds` is a name two efforts can both want, and each ticket here runs
in its own worktree under `.aep/worktrees/`, where git refuses the second claim
on a branch outright. `[[policies/execution]]` requires the uniqueness; this is
how it is reached.

**Ticket branches already cut keep their names.** `04-skills-entry` and
`06-seeds` resolve to their effort by what their commits touch, with no help
from the name, and renaming a branch a live worktree is holding takes that
thread's claim out from under it.

*The 2.0 rewrite used to be named here as a standing exception, a single amended
commit on a branch `2.0`. That branch exists neither locally nor on the remote,
and the rewrite is in `main`. The exception was removed rather than kept as
history, because a rule read for instructions is the wrong place to keep a
finished one.*

## Pull request descriptions

An effort's pull request takes the shape `[[templates/pull-request.template]]`
gives, and an issue the shape `[[templates/issue.template]]` gives. This
repository adds one line to the risk section: the release or releases the
change cuts.

---

`[[references/git]]` has the invocations; `[[references/build]]` has the checks
that must pass before a commit.
