---
use-when: "a reviewer is about to report findings, a run is deciding which findings block, or a later review round is being pinned"
---

# Review — how a finding is reported

Every reviewer follows this, on both axes. It keeps a review short enough to
end, and honest about what the diff caused.

## The tag

Every finding carries one tag.

| Tag | Means | Blocks |
| --- | --- | --- |
| **Important** | a defect this diff introduced or exposed | yes |
| **Nit** | a small issue this diff introduced; nothing breaks | never |
| **Pre-existing** | a defect in code the diff did not change | never |

**Only Important blocks.** A defect in code the diff did not change is
Pre-existing, however severe.

**A Pre-existing finding is never fixed in this effort.** It is not the
author's, and a fix grows the scope that the next round then reviews. Record it:

```
node .aep/scripts/aep.mjs record <effort> --note "pre-existing: <path:line> <what>"
```

With a tracker, also propose it as a roadmap issue, with the exact title and
body, as `[[templates/issue.template]]` says.

## The citation

**Every finding cites `path:line`, and you open that line before you report
it.** Read the code there, not its name: a function called `validate` may not
validate. A finding whose line you did not open is dropped, and the return says
how many were dropped. One reviewer checking its own citation is the cheap
form of a second reviewer voting on the finding.

## Nits

**At most 3 Nits per axis.** Report the three that matter most and drop the
rest. A Nit never starts a round. It is fixed only in a commit the run is
already making, and otherwise it is reported and left. An agent author fixes
every finding it is given, each with a commit and a round, so an uncapped Nit
list is a review that does not end.

## The summary

Lead with the count per tag: `2 Important, 1 Nit, 0 Pre-existing`. A review
with no findings says **"Nothing to fix"** and adds nothing more: no praise, no
observations to fill the space. A clean review is a result, and filler read as
a finding costs the author a round.

## Later rounds

Each review round's line in `log.md` `## Rounds` ends `(reviewed <commit>)`,
the commit that round judged. The run records it with `aep record --review
"<result>" --at <commit>`, taken before any fix lands.

**Round 2 and later read only what changed**: the diff from that commit to the
working tree (`git diff <commit>`), plus the findings still open from the last
round. Never raise again a finding already fixed or accepted. Code unchanged
since that commit was the earlier round's to judge, so a new finding there
belongs only where a fix made it reachable.

## The order

Important first, then Nit, then Pre-existing. Within a tag, the most severe
first.
