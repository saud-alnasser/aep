---
use-when: "a task exists and is ready to build"
---

# /implement — carry the effort to a finished branch

Builds what the tickets say, wave after wave, until converge finds no gap or a
trip-wire fires. **It never redesigns.** It reads the ticket, not the
conversation, so context can be cleared between any two steps. Law:
`[[policies/execution]]`.

**Posture.** Correctness over exploration. Read before you modify, and match the
code around you. **What this gives up** is creative latitude: an improvement you
notice is raised, not taken, and the diff stays about one thing.

A request with no effort goes to `[[skills/specify]]` — never hand back a
command to type.

## 1 — Start

```
node .aep/scripts/aep.mjs start [<effort>|<effort>/<ticket>]
```

It reads the scope, enters or re-enters the effort's surface (never a second
one), checks it is clean, checks the marker in that surface, and computes the
frontier. Act on its JSON:

| Field | Do |
| --- | --- |
| `stop` | end the turn quoting it: a dirty surface names its paths; a claim held elsewhere is not taken (another session's live lease) |
| `surface` | work only there. Never switch branches anywhere else |
| `move: true` | move into `surface` yourself, the way `runtime.reference` says, and `start` again there, which takes the lease; never hand the move to the developer |
| `role: implementer` | you are a child: build your one ticket, integrate nothing |
| `drift`, `marker` | quote the marker; a match skips the drift read and nothing else — still check every claim you rely on against the source |
| `next` | `build`, `converge`, `review`, `close`, or `blocked` |

Quote `summary` in `Position`, with the contexts this work touches and every
claim the source contradicted (`[[policies/reporting]]`).

Named a ticket: build that one, and the run ends there. Named an effort, or
nothing: the whole effort. Nothing named and no claim: end the turn saying so.

## 2 — Build

**Every lane.** Build matching the surrounding idiom, naming, error handling,
and comment density. Code explains itself: a comment says why, a comment saying
what marks code to improve, and a workaround needing a paragraph of
justification is wrong code. Document every public API. Name a file for the one
thing it holds; directories carry the qualifiers. No abbreviations unless
clearer or necessary. Tests sit as near the code as the tooling allows, and the
repository's convention wins.

**Quick lane.** `spec.md` is the ticket. Make the change, then verify each item
under `# Check` and tick it with what verified it. Self-check the diff against
`# Problem` and `# Change`. Then `aep.mjs land <effort> --message "<message>"`:
one commit. If the change turns out to touch a public contract, data at rest,
or more than one area: `aep.mjs raise <effort> standard --reason "<why>"`, say
so, expand `spec.md` to the full template, cut tickets with `[[skills/tasks]]`,
and continue.

**Standard and full.** For each ticket in `frontier`:

1. Read the ticket, `spec.md`, and all the code you will change. **Ticket
   contradicts the spec: stop** (trip-wire 3).
2. Load the `[[rules]]`, `[[contexts]]`, and `[[references]]` whose `use-when`
   or `paths` match. Nothing else.
3. `wave: dispatch` (full lane, two or more ready): follow
   `[[policies/execution/parallel]]` — `aep.mjs dispatch`, one
   `[[agents/implementer]]` per ticket, run the way the playbook in
   `runtime.reference` says, briefs per `[[skills/implement/dispatch]]`.
   Otherwise build here.
4. Test-first where the rules require it (`[[skills/tdd]]`). A bug of unknown
   cause: `[[skills/implement/diagnosing]]`. Technical uncertainty that
   survives: `[[skills/prototype]]`, whose code is never promoted as-is.
5. Build, as **Every lane** says.
6. Verify each acceptance criterion and tick it with the command and what it
   printed.
7. **Confirm, do not repeat:** the tests the rules require ran, and every
   criterion is ticked. Then
   `aep.mjs land <effort> <ticket> --message "<message>" --session <id>`. It
   refuses an unticked criterion, marks the ticket resolved, appends the ledger
   line, regenerates the index, commits — one commit per ticket; where the
   ticket only verified something, an empty one whose message carries what was
   checked and what it printed — releases a child's branch and surface, and
   stamps the marker. Pass the session id your runtime gives you, or none;
   never invent one. A conflict: `[[skills/implement/conflicts]]`, then land
   again.

The message follows the repository's demonstrated convention (`git log
--oneline -30`, `CONTRIBUTING.md`, any template), falling back to
`[[rules/version-control]]` for the form and the ticket reference. Say what
capability changed and why; never list files.

A ticket already done or no longer needed is marked `obsolete` with a one-line
reason. Then `start` again, until `next` is not `build`. `blocked` means the
blocking ticket is what to build.

## 3 — Converge

Rounds by lane: quick 0, standard 1, full 2. Judge the whole diff against
`spec.md` (`[[policies/execution]]`), then record the round:

```
node .aep/scripts/aep.mjs record <effort> --converge "no gap"
node .aep/scripts/aep.mjs record <effort> --converge "gap, tickets 05 06"
```

Unbuilt work: append tickets, back to step 2. An approach that cannot work:
stop (trip-wire 1). **Never edit `spec.md` or `plan.md` here.**

## 4 — Review

Standard and full only, once converge found no gap. `[[skills/review]]` over the
effort branch against `spec.md`, as a stage of this turn: one reviewer covering
both axes in standard, two reviewers in full. Validate each finding, then fix
it, ticket it, or record it with `--needs-you` for the human to accept — never
stop to ask. A fix to a landed ticket amends that
ticket's commit (`git commit --fixup`, then an autosquash rebase in this
surface), and re-stamps (`position.mjs stamp`). Record the round and the commit
it reviewed:

```
node .aep/scripts/aep.mjs record <effort> --review "2 Important, 2 fixed" --at <reviewed>
node .aep/scripts/aep.mjs record <effort> --review "Nothing to fix"
```

Review again after the fixes land, up to the lane's cap. A round with no
Important finding ends review.

## 5 — Close

```
node .aep/scripts/aep.mjs close <effort> [--friction "<line>"]
```

Run it from the main checkout, never from inside the surface it removes. It refuses while a ticket is unresolved, stamps `status: implemented`, detaches,
then removes the surface. With the cap reached and gaps or findings open, close
with `--stop "<what is open>"` instead: the branch is released, the surface
kept, and the effort ends not ready. Up to three `--friction` lines record what
got in the way. Where `tracker` is on, `[[policies/tracker]]` lists what follows.
**Never merge.** Report `Outside writes`.

## Stop only for

The three trip-wires (`[[policies/execution]]`). On one, record it with
`--needs-you`, then `aep.mjs close <effort> --stop "<the trip-wire>"`: the
branch is released and the surface kept to inspect. Record anything else with
`aep.mjs record <effort> --note "<line>"`, or `--needs-you` for what only the
human can settle, and carry it to the close.

## Resume

Run step 1 again. It re-enters the same surface, from any runtime, and hands
back another runtime's worktree to move into. Re-verify nothing
ticked; trust nothing unticked. A detached `HEAD` names no branch and holds no claim: start
properly rather than guessing the ticket from the diff.
