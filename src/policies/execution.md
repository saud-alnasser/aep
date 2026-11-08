---
use-when: "an effort is in progress — deriving tasks, implementing, converging, or reviewing"
---

# Policy — executing an effort

Every lane. Children add `[[policies/execution/parallel]]`; a tracker adds
`[[policies/tracker]]`.

## The hierarchy

`spec.md → tasks → implementation`. **A task that conflicts with `spec.md` is a
defect in the task:** stop, surface it, never bend the architecture to fit it.

A requirement, criterion, or scope boundary lives only in `spec.md`; `plan.md`
holds how. Tasks cite the spec and never copy it, and `validate.mjs` fails one
that traces to no numbered requirement or criterion.

## Lanes

`lane:` in `spec.md`; absent means `full`.

| | quick | standard | full |
| --- | --- | --- | --- |
| tickets | none: `# Check` is the ticket | files, built in order | files, in waves |
| children | none | none | one per ticket, for a wave of two or more |
| converge rounds | 0 | at most 1 | at most 2 |
| review | self-check against `# Check` | 1 round, one reviewer, both axes | 2 rounds, two reviewers |

**Lanes only go up** (`aep raise`). A quick change touching a public contract,
data at rest, or more than one area is raised to standard; say so and continue.

## What stops a run

Exactly three; no fourth:

1. **evidence invalidates the technical plan:** stop, record the evidence,
   `[[skills/plan]]`, update `spec.md`, update the tasks, continue. Never patch
   the architecture in place;
2. **the work alters an existing public contract, or touches data at rest;**
3. **a task contradicts `spec.md`.**

Anything else, including a review that passed after its fix, goes in `log.md`,
carried to the close.

## Scope stays where it was put

`[[skills/plan]]` and `[[skills/refine]]` never expand product scope; discovery
that exposes a product change stops and surfaces it. An improvement outside the
task is raised, never taken. A requirement nobody asked for is a review finding.

## Done means checked

Verify each criterion **explicitly, one at a time, against the running system**,
and tick it then, with what verified it inline: the command and its output, or the
case traced. **Every criterion ticked, or the ticket is not resolved.** One
that cannot be met parks the ticket with what blocked it, or marks it `obsolete`
with a reason; it is never ticked to get past.

## Claims and surfaces

The claim is a branch and its surface (a worktree), taken before the first read
of source, by `aep open` or `aep start`. `scope.mjs` computes claim and role from
git and the tree's path; **never infer either from a branch name**, and never
`git switch` to an effort branch.

| `role` | May | Never |
| --- | --- | --- |
| `orchestrator` | integrate in the surface it holds; dispatch | integrate anywhere else |
| `implementer` | build its one ticket; request what it may not do | integrate, dispatch |
| `none` (main checkout) | take a surface | write before holding one |
| `unknown` | what it could already do | — |

- **A claim held elsewhere is never taken** — not renamed around, branched from,
  force-created over, or entered. Report it; move on.
- **A scoped run never writes a file or takes a ticket of an effort outside its
  claim.** Reading is free. No skill is exempt: one that reaches another
  effort's artifact stops and names it.
- An empty claim takes any effort; a claim of several, given none, ends the turn
  listing them. Given another effort while this surface is dirty: stop, naming
  claim, effort, and paths.

## The run's memory is on disk

| What | Where |
| --- | --- |
| tickets landed | commits on the effort branch; `log.md` `## Ledger` |
| criteria verified, and by what | ticks in the ticket (quick: in `spec.md`) |
| converge and review rounds | `log.md` `## Rounds`, via `aep record` |
| recorded, not acted on; waiting on the human | `## Recorded`; `## Needs you` |

A failed `log.md` write is reported, never continued past. A resumed run
reads only these: **re-verify nothing ticked; trust nothing unticked.** Never
stop for auto-compaction, and never depend on triggering it.

## Converge

Tickets running out is not the spec met. With none unresolved, read the whole
diff against `spec.md` and `plan.md`: is every criterion met — not every
ticket closed — and did the change move a boundary, retire a concept, or
falsify a `[[contexts]]` or `[[references]]` entry? Correct what it falsified here;
an unnamed concept is a finding, never a licence.

| The gap is | Do |
| --- | --- |
| work nobody built | append tickets and build them: the next round |
| an approach that cannot satisfy a requirement | trip-wire 1. Never ticket around it |

**Converge never edits `spec.md` or `plan.md`,** except `status: implemented` at
the close. The lane's cap on rounds is fixed. A review finding's ticket
spends none. At the cap with gaps left, name them; the effort ends
not ready.

## Review, then close

Once converge finds no gap, `[[skills/review]]` judges the whole effort branch,
as a stage of this turn. An Important finding is fixed,
ticketed, or left in `## Needs you` for the human to accept, never asked
mid-run; one open at the last round ends the effort not ready.

**The runner never merges.** `aep close` releases the branch, then removes the
surface, or keeps it on a stop. A dead run releases nothing; the next re-enters.
