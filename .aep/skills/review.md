---
use-when: "work is finished and about to land, or a diff needs judging against what was asked"
---

# /review — judge the work against the change

Two axes, judged **independently**, and no third (architecture is Standards):

- **Correctness**: does this implement what was asked, and does it work?
- **Standards**: does it follow this repository's rules and conventions?

Merged, the stronger axis hides the weaker.

**Posture.** Skeptical: assume defects exist and you have not found them yet,
and judge the diff against the spec. **What this gives up** is charity toward
the author, and speed.

## 1 — Pin the fixed point

Read the scope (`node .aep/scripts/scope.mjs read`); a non-empty claim confines
the run to its efforts. Take the ref the caller supplied (a SHA, branch, tag, or
`main`), or ask.

The subject is the committed range **plus** staged, unstaged, and untracked
changes: review their union. Diff against the **merge-base**, not the raw ref.
`[[references]]` has the invocations. Before dispatching, prove the ref resolves
and the subject is **non-empty**; both go in `Position` with the claim and the
isolation. A later round's subject is `[[skills/review/findings]]`'s.

## 2 — Find what was asked for

The first that answers: the effort's `spec.md`; task references in the commit
messages; the pull request and linked issue bodies, never threads; a path the
human passed. An effort-level review
(`[[skills/implement]]`'s close) is the ordinary case, and resolves to
`spec.md`. If none answers, ask; with genuinely no spec, Correctness reports
**no spec available** for the requirements half.

**Never infer the requirements from the code under review.**

## 3 — Find what this repository requires

`.aep/rules/review.md` first, where it exists, then `[[policies]]` and `[[rules]]` by
`use-when` and `paths` for the files in the
diff, `[[contexts]]` for the areas touched, then `CONTRIBUTING.md` and other
repository docs. **Skip what a linter, formatter, or type-checker enforces.** A
design problem nothing here covers is judged with `[[skills/review/smells]]`,
as judgement, never as breach.

## 4 — Run the axes

| Lane | Reviewers |
| --- | --- |
| standard, or a review outside an effort | one `[[agents/reviewer-correctness]]`, told to run the `[[agents/reviewer-standards]]` pass after its own, separately |
| full | `[[agents/reviewer-correctness]]` and `[[agents/reviewer-standards]]`, in parallel, dispatched in one message |

Each brief gives the fixed point, both diff invocations, and where the spec is;
the reviewer reads the rest itself. An axis never sees the other's findings.
Without sub-agents, run both passes yourself, separately, carrying no
conclusion between them. Cap each report.

## 5 — Report

`## Correctness` and `## Standards`, never merged and never reranked across,
each finding reported as `[[skills/review/findings]]` says: only Important
blocks. Lead each axis with its count per tag. One with none says "Nothing to
fix" and nothing more.

## 6 — Every finding gets an outcome

| Outcome | Where it goes |
| --- | --- |
| **Fixed** | the code |
| **Ticketed** | a new task, out of scope for this diff |
| **Accepted** | the task or the spec, with the reason |

**Accepting is the human's call, never the reviewer's.** Inside a run, a finding
to accept is recorded with `aep record <effort> --needs-you`.

There is no reviews directory: what is durable graduates to the code, a
`[[contexts]]`, the spec, or a task.

## Done when

Every axis the lane calls for has run and is reported unmerged, and each
Important finding is fixed, ticketed, or awaiting the human's acceptance.
