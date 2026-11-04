---
use-when: "this session is ending or has run long, and the next session must pick the work up"
---

# /handoff — carry the work into a fresh session

Writes what the next session needs to continue, so that context ending does not
mean progress ending.

## Why this exists

A long thread stops reasoning well before it stops working, and the tell is
subtle: it keeps answering, just worse. Handing off is the deliberate exit —
compaction keeps you here and loses the verbatim history; a handoff forks.

## Procedure

1. **Put durable knowledge where it belongs, first.** A handoff is not a place
   to store knowledge (`[[protocol]]`: no hidden memory). Before writing it,
   move anything durable to its home:

   | What you learned | Where it goes |
   | --- | --- |
   | a fact established from sources | `.aep/efforts/<e>/evidence/research/` |
   | an experiment's outcome | `.aep/efforts/<e>/evidence/prototypes/` |
   | a change to what is being built | the effort's `spec.md` |
   | how an area of the repository works | `.aep/contexts/<area>.md` |
   | how a tool is operated here | `.aep/references/<tool>.md` |
   | a requirement on behaviour | `.aep/rules/<name>.md` |

   **What is left over is what a handoff is for**: the state of *this session's*
   work, which belongs to no artifact.

2. **Write the handoff** to `.aep/scratch/handoff-<effort>.md` on the surface
   you are working in. Scratch is gitignored: a handoff is session state, not
   repository knowledge, and committing one puts a conversation in the history.
   Never write it outside the project (`[[protocol]]`).

```markdown
# Handoff — <effort or task>

## Where the work stands
## What is done, and verified how
## What is in progress, and exactly where it stopped
## What is decided — and by whom
## What is still open
## What was tried and rejected, and why
## Files that matter
## Resume with
```

3. **Continuing in another runtime?** Commit or land the work first; nothing
   uncommitted crosses. Then `node .aep/scripts/aep.mjs yield`, so the next
   session takes the surface at once. The next session's `aep start` hands it
   the surface wherever it stands, and it moves there itself. Only where it must
   take the branch in a worktree of its own does it run `aep release <effort>`
   from the main checkout, which frees `_run` and carries this file to the main
   checkout's `.aep/scratch/`. **The developer runs none of this.**

## Constraints

- **`Resume with` is one copy-pasteable line** that opens the next session
  against this file. A handoff the human has to reconstruct an invocation for
  has failed at its only job.
- **Record rejected approaches.** Without them the next session re-derives them,
  confidently, at full cost.
- State what is **decided** versus what is **assumed**. A fresh session cannot
  tell them apart from the artifacts alone, and will treat both as settled.
- Never leave uncommitted work unexplained: say what is in the tree and why.

## Done when

A session with no memory of this one could read the artifacts plus the handoff
and continue without asking what happened.
