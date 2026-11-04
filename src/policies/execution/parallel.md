---
use-when: "a full-lane wave of two or more tickets is dispatched to sub-agents, or a child returns"
---

# Policy — parallel execution

Adds to `[[policies/execution]]` where the runtime supports sub-agents. Where it
does not, the work is serial and none of this binds.

## The unit is a whole ticket

**A ticket is never split across sub-agents.** One child builds one whole ticket
against its own acceptance criteria, or no child is dispatched. A ticket too
large for one child returns to `[[skills/tasks]]` to be split into tickets with
their own criteria — never divided at dispatch. Findings, reviews, and research
are dispatched the same way: one child, one whole question.

## Independence is read, never inferred

The wave is **computed from the declared `blocked-by` edges** — the frontier's
tickets that gate none of each other — never chosen, and never inferred from a
guess about which files each touches. An edge gates work and says nothing about
files: two independent tickets may still collide on a path, and where isolation
cannot be guaranteed, serial is correct. Parallelism never compromises
governance, the spec, repository integrity, or acceptance criteria.

## Claiming, before dispatching

**Every branch and surface in the wave exists before any child starts:**
`aep dispatch <effort> <ticket>...` creates them all from the effort branch's
current tip, under the main checkout's `.aep/worktrees/<effort>/`, never
relative to the surface you stand in — the path is what gives a child its role.
State the plan first — which tickets, which role, which branches. Stated, not
gated. A ticket the command reports `held` is not taken. The next wave branches
from the new tip.

## Where a child runs

- **An implementer runs only in a surface `aep dispatch` created**, as a
  sub-agent or a runtime thread. It stops unless `scope.mjs read` prints
  `role: implementer`.
- **A runtime's own delegation that shares your checkout or makes its own
  worktree carries read-only work:** research or review. Its child computes
  `orchestrator`: it edits no file, returns its findings, and never dispatches,
  integrates, or delegates.

## What a child gets

A **brief** (`[[skills/implement/dispatch]]`): objective, inputs as paths, the
ticket it owns whole, its surface, its return shape, its criteria, its cap, and
its own `.aep/scratch/` inside its surface. The brief and the child's return
are in the controlled register (`[[policies/reporting]]`).

- The brief is the only parent-to-child channel; anything the child needs from
  the conversation is in it. Everything else the child reads for itself — never
  paste an AEP artifact into a brief.
- **One layer.** A child never dispatches and never integrates. It may request
  exactly two things: a capability that needs dispatch, which the orchestrator
  performs at depth one and returns the result to the child, or a question for
  the human, recorded as an option set (`[[policies/reporting]]`).

## Human authority is never delegated downward

No agent's message is another agent's consent.

- A child that reaches a decision it may not make records it and stops; the
  orchestrator raises it. Work known to need a human decision is never given to
  a child.
- Where the orchestrator can ask the human, the child stops pending rather than
  failing. The question travels attributed to the child and the ticket; **the
  answer travels verbatim**, or the child is stopped rather than told a
  paraphrase.
- The orchestrator may reshape a question's wording, never its substance: no
  option dropped, merged, or narrowed. The question is the child's; the words
  the human reads are the orchestrator's.

## Returning

A child returns **done, failed, stopped, or waiting**, a path to what it
produced, and a summary capped in size whatever the work was. Never a pasted
diff. **A child never ticks its own criteria.**

## Integrating

**The orchestrator is the only integrator, in the surface it holds.** Before
anything lands, reconcile what the child claims against what it changed. Then
integrate **each child as it returns, one at a time** — a conflict then surfaces
at that ticket and is named against it (`[[skills/implement/conflicts]]`).
Verify and tick its criteria yourself, then `aep land <effort> <ticket>`: it
commits, then releases the ticket branch and its surface. A parked or failed
child keeps both, and its ticket returns to the frontier; its siblings land.

## Once the last child returns

Three things no child could do are the orchestrator's:

- **The seams** where children's diffs meet: drifted naming, a helper two of
  them wrote, a pattern one followed and another did not. **The seam is the
  bound:** a surface two children touched, or a name one introduced and another
  consumed. Anything else noticed inside one child's work is raised and returns
  to the frontier as a ticket.
- **Every decision a child recorded and stopped on**, raised as above.
- **One account of the work**, as though one agent had done it in sequence. It
  describes the work, not the workers: sub-agent structure appears only where it
  changed the outcome — a child that failed, stopped on a decision, or sent a
  ticket back. A lost ticket always changed the outcome; it is never hidden.
