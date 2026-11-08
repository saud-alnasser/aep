---
use-when: "a change is wanted and no effort describes it yet"
---

# /specify — define WHAT is changing and WHY

Writes an effort's `spec.md`, picks its lane, and opens it.

**Posture.** Separate the problem from the solution, even when the solution is
obvious: the first solution offered is evidence of what the human wants, not the
requirement. **What this gives up** is speed to code — it ends with nothing
runnable, because a wrong problem statement costs the whole effort and is
cheapest to fix here.

## Procedure

1. **Orient.** Read `[[index]]`, then run both and quote what they print:

   ```
   node .aep/scripts/position.mjs check
   node .aep/scripts/scope.mjs read
   ```

   Both read the surface you stand in; the effort has none until it opens. A
   non-empty claim confines this run to the efforts it names
   (`[[policies/execution]]`). Claim, isolation, and marker go in `Position`.
   **This run stamps nothing.**
2. **Check for an existing effort, and an existing boundary.** A request that
   extends a specified effort belongs in that spec, not a new one. A request
   that needs another effort's work names it in `builds-on:`; `aep open` then
   stacks on it or waits for it. A request
   this repository already declined is not re-argued:
   `[[skills/specify/out-of-scope]]`.
3. **Load what applies** — policies and `[[rules]]` first, then
   `[[contexts]]`, by `use-when` and `paths`, never everything.
4. **Inspect the repository.** Never describe a change to code you have not read.
5. **State your understanding**, including the assumptions you are making, as a
   position rather than a question. Never skip it; obvious work is where wrong
   models survive longest. The unverified half fills `Assuming`
   (`[[policies/reporting]]`).
6. **Resolve material uncertainty here.** Material means the spec would differ
   by the answer; the rest is written down as an assumption or an open question
   and left alone.

   | The uncertainty is | Resolve it by, as a stage of this turn |
   | --- | --- |
   | factual — what an API does, whether a bug is fixed | `[[skills/research]]`, into `evidence/research/` |
   | product, or a tradeoff | full lane: `[[skills/refine]]`, at most 5 questions, one at a time, each an option set (`[[policies/reporting]]`) with a recommended answer. Quick and standard: no question — write your recommendation under `# Assumptions` |
   | technical, and argument will not settle it | `[[skills/prototype]]`, in a worktree |
   | an open visual question in a UI change | `[[skills/prototype/ui]]`, once step 9 has opened the effort and before any plan: radically different variants on one route, on a throwaway branch. The human picks one; it becomes evidence |

   Stages hand nothing back for the human to type and open no report of their
   own. A turn that ends by naming a command has renamed the uncertainty, not
   resolved it.
7. **Choose the lane — now, never earlier.**

   | The change is | Lane | Before tasks |
   | --- | --- | --- |
   | docs, config, a bug fix, an isolated refactor | `quick` | nothing; no tasks either |
   | a feature, an API addition, a schema change, a UI change | `standard` | `[[skills/plan]]`, where the approach is not obvious |
   | a migration, cross-domain work, security or performance work, too big for one context | `full` | evidence, then refine and plan |

   Raise it — **never lower it** — if a load-bearing assumption is unverified,
   the change crosses a boundary, a public contract, or data at rest, it is too
   large for one context, or it is too foggy to scope. Report the floor, what
   fired, and the lane — it decides what this turn's `Next` names. Report it;
   never ask it. The human may override either way, and the override stands.
8. **Write the draft** at `.aep/scratch/<slug>/spec.md` from
   `[[templates/spec.template]]`, with `status: draft` and `lane:`. A quick spec
   has only `# Problem`, `# Change`, and `# Check` — one screen, each Check item
   a box someone else could verify. Nothing is written in the main checkout.
9. **Open the effort.** Where `tracker:` is on and the lane is not quick, first
   `[[policies/tracker]]`'s one ask. Then:

   ```
   node .aep/scripts/aep.mjs open <slug> --lane <lane> [--number <n>] [--issue]
   ```

   It numbers the effort, creates the branch and its surface in one act from the
   base `[[rules/version-control]]` names, moves the draft in, writes `log.md`,
   commits once, and warms the surface. Quote its `summary`. A refusal at the ask
   opens nothing, and the draft stays in scratch. For an issue the human named,
   or a roadmap issue picked up, read its body as input at step 1, and open with
   `--number <issue> --issue`.

**After opening,** every revision to `spec.md`, `plan.md`, `evidence/`, or
`tickets/` is a `docs` commit on the effort branch, made in its surface.
The run accepts the spec itself (`status: accepted`) once nothing in it waits on
the human; it never asks for acceptance.

## Output

`.aep/efforts/<number>-<slug>/spec.md`. A standard or full spec:

```markdown
# Problem
# Goal
# Scope
# Requirements
# Acceptance Criteria
# Constraints
# Out of Scope
```

Number the requirements and the criteria: tickets cite them. Add
`# Assumptions`, `# Open Questions`, `# Risks` where they have content; omit a
heading rather than writing "N/A".

## Constraints

- **No `# Architecture`.** How is `[[skills/plan]]`'s.
- Every requirement has an acceptance criterion; one without is a wish.
- **Out of Scope is mandatory** outside the quick lane. An exclusion about the
  repository rather than this change belongs in
  `[[skills/specify/out-of-scope]]`.
- Create `evidence/` and `tickets/` only when something goes in them.

## Done when

The spec says what changes, why, what does not, and how anyone would know it
worked; material uncertainty was resolved in this turn; the lane is reported;
and the effort is open, or the human refused and that is said plainly.

## Next

Quick: `[[skills/implement]]`. Otherwise `[[skills/plan]]` where the approach is
not obvious, then `[[skills/tasks]]`. Ambiguity is never a next step.
