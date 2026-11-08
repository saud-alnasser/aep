---
use-when: "committing, branching, or preparing work to land"
# none, github, or gitlab. none: no issue, pull request, label, or forge call;
# the effort's log.md is the whole record. The rest: policies/tracker.
tracker: none
# Run in every new worktree before work starts, e.g. pnpm install --frozen-lockfile.
setup: ""
# In a worktree an agent runtime created: auto skips setup where the runtime
# declares its own worktree setup; aep always runs it; runtime leaves it to the
# runtime. Either way a lockfile change afterwards runs it.
runtime-setup: auto
# true where changes are stacked by a stacking tool (see below).
stack: false
---

# Rule — version control

**This file is yours.** AEP installed it as a starting point because how work
lands is specific to this repository, and nothing under `rules/` is ever
replaced by an upgrade. Correct anything below that this repository does
differently — what is here was detected or assumed at install, and detection is
not certainty. The settings above are read by `.aep/scripts/aep.mjs`.

## The line an agent does not cross

`[[protocol]]` states it: never push, never publish. What that covers:

| Allowed | Not allowed without the human asking |
| --- | --- |
| `git add`, `git commit`, `git branch`, local `git rebase`, `git worktree` | `git push` in any form |
| reading remotes: `git fetch`, and the forge's read commands | opening or merging a pull request |
| local `git tag` | pushing a tag, publishing a release, publishing a package |

*Why the line sits exactly there: a commit is reversible in this clone and
everything past it is not. That asymmetry is what makes committing unasked safe
and makes the prohibition load-bearing.*

## Commits

Conventional Commits — `type(scope): summary`.

- One logical change per commit. A summary needing "and" describes two commits.
- Say what capability changed and why. **Never a file-by-file account** — the
  diff already lists the files.
- Never `--no-verify`; never bypass signing. A failing hook is a finding, not an
  obstacle.
- **Committing is part of finishing.** `[[skills/implement]]` lands work when it is
  reviewed and ready; it does not wait to be asked. What waits to be asked is
  everything in the right-hand column above.

## Branches

In the quick and standard lanes, work lands on the effort's own branch: one
commit per ticket, and none of its own. In the full lane, a ticket a child
builds gets one branch, cut from the branch its effort is on by `aep dispatch`
and named
`<effort>--<ticket-id>-<slug>`, where `<effort>` is the effort directory's own
name: `51-branch-scope--03-execution-policy`. The separator is `--`, not `/`,
because git cannot create `<effort>/...` while the effort branch `<effort>`
exists.

**The prefix is what makes the name unique**, and uniqueness across efforts
is required: `aep dispatch` builds every ticket branch this way. Ticket ids restart at `01` in every
effort, so two efforts each holding a ticket `03` want one bare `03-<slug>` for
two different claims. Under a runtime that gives each thread its own worktree,
git refuses the second outright; without one, the second run quietly takes a
claim the first is already holding. The prefix also gives a fresh branch an
effort before it has any commits: what precedes `--` is an effort directory name,
and that is the only signal a branch with nothing on it carries.

**Existing branches keep the names they have.** The convention is forward-only:
a branch already called `03-execution-policy` still resolves to its effort by
what its commits touch, and renaming one breaks the claim whoever is on it
holds.

**The branch is the claim** (`[[policies/execution]]`): create it before the first
read of source, not after the first edit.

## How work reaches the default branch

Two things turn on which of these a repository does, and getting either wrong is
expensive. The first is how a commit references its task:

| This repository | Then |
| --- | --- |
| a branch merged by a pull request | the commit references the task but **closes nothing** — a closing keyword in a commit fires on a later cherry-pick or rebase, closing something nobody merged. The keyword belongs in the pull request body, and `[[skills/specify]]` writes it there as it opens the effort |
| stacked changes, submitted by a stacking tool | the commit **carries the closing keyword** — it reaches the default branch only through its own branch's pull request, so the hazard above cannot arise. A stack merges bottom-first, so the keyword goes on the change that merges **last** and everything under it carries a plain reference — `[[policies/tracker]]` says so |

The second is where a new effort's branch starts, and it is the same row that
answers it. `[[skills/specify]]` reads this rule rather than branching from
whatever `HEAD` happens to be checked out:

| This repository | A new effort's branch is based on |
| --- | --- |
| a branch merged by a pull request | the default branch's tip, fetched first. An effort opened from another effort's branch carries that effort's unmerged commits, and its pull request then asks for a review of work nobody in it wrote |
| stacked changes | the current branch, which is what stacking means. The parent change is reviewed on its own branch and lands through its own pull request |

**Confirm which applies rather than assuming**, and set `stack:` above to match. With stacked changes,
`blocked-by` means *stack on top of*, not *wait for* — assume plain git on a
stacking repository and the frontier empties; assume stacking on a plain one and
branches get built on unmerged work that was supposed to wait.

## Pull request descriptions

An effort's pull request takes the shape `[[templates/pull-request.template]]`
gives, and an issue the shape `[[templates/issue.template]]` gives. Tighten
either here where this repository asks for more, such as a section its own
template on the forge requires.

---

`[[references]]` records the actual invocations — flags included. This rule says
what is required; a reference says how it is typed.
