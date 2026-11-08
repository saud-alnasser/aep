---
use-when: "the repository's version-control rule sets tracker to github or gitlab, and an effort is opened, landed, closed, or abandoned"
---

# Policy — the tracker

Applies only where `tracker:` in `[[rules/version-control]]` is `github` or
`gitlab`. With `tracker: none`, the default, nothing here runs: no issue, no
pull request, no label, no forge call. The effort is a branch a human merges,
and `log.md` is its whole record (`[[policies/execution]]`).

## One pull request per effort, and an issue when wanted

**One pull request per effort**, an issue only where one is wanted, and no other
tracker object — not per ticket, wave, or review. `[[templates/issue.template]]`
says when an issue exists. The `effort:` line in the pull request's `AEP` block
ties it to the effort.

- A ticket is never a tracker object, and the ticket graph never leaves the
  repository; the spec stays canonical.
- The tracker is read, never mirrored into `.aep/`. `log.md` is canonical; the
  pull request links it, never copies it.
- **Each body is a human part on top and one folded `AEP` block at the
  bottom**, shaped by `[[templates/pull-request.template]]` and
  `[[templates/issue.template]]`. Criteria are ticked in the pull request only;
  the issue is written once.
- A run that finds an effort short of its pull request opens what is missing and
  says so.
- A write to shared tracker data is proposed first, with the exact strings.

## Opening

`/specify` asks **once**, before `aep open`, as an option set
(`[[policies/reporting]]`), for two things together: permission
to push and open a public pull request, with the exact branch name and pull
request title, and the issue's title and body where one is created; and the
effort's `priority:`. A refusal stops the opening: the draft stays in scratch
and nothing is created. Then: `aep open <slug> --lane <lane> --number <n>`, with
`--issue` where an issue carries `<n>`; push, and open a draft pull request from
its template; then, where there is an issue, fill its `AEP` block.

**Each `builds-on:` edge is named in the pull request body,** `Builds on
#<its number>`, and where both efforts have an issue it is also a dependency:
`gh issue edit <issue> --add-blocked-by <its issue>`. Where `aep open` waits on
an unmerged effort, nothing is created, and an issue stays in `status: backlog`.

The quick lane never uses the tracker.

**The closing keyword's place is the repository's** (`[[rules/version-control]]`),
and only where there is an issue. Merged through a pull request: `Closes
#<issue>` in the pull request body, written at opening, and never in a commit. Stacked: every commit carries
`Refs #<issue>` except the change that merges last, which carries
`Closes #<issue>`.

## While the run works

After each `aep land` and `aep record`, update the pull request's `AEP` block,
its `tickets:` lines included; the rest of the body waits for the close. **A failed
write is reported, never continued past.** Every later revision to `spec.md`,
`plan.md`, `evidence/`, or `tickets/` is a `docs` commit, and the issue is never
rewritten to match it.

## Labels are projections

**The file wins.** Where a label and `spec.md` disagree, correct the label,
never the file.

| | Set | Then |
| --- | --- | --- |
| **derived** — `status:`, `type:`, `size:`, every flag a fact establishes | from a file or the diff | re-synced on every write |
| **initial** — `priority:`, any flag inviting a person to act | once, at opening | never changed by an agent |

| The effort | Issue | Pull request | What moves it |
| --- | --- | --- | --- |
| the spec is being drafted | `status: backlog` | `status: backlog` | `[[skills/specify]]`, opening the objects |
| the spec is accepted and the tickets are cut | `status: ready` | `status: ready` | `[[skills/specify]]`, on acceptance |
| the runner is working | `status: in progress` | `status: in progress` | `[[skills/implement]]`, on taking the first ticket |
| converge found no gap, and the spec is stamped `implemented` | `status: in review` | `status: in review` | `[[skills/implement]]`, at the close |
| merged | `status: done`, and the pull request closes it | `status: done` | the forge's merge-time job, and `reconcile.mjs` on the next run where none is installed |
| closed without merging | `status: done` | `status: done` | the forge's merge-time job, and `reconcile.mjs` on the next run where none is installed |

- **Flags need a fact:** `breaking changes` from the public-contract trip-wire;
  `dependencies` when a manifest or lockfile moved; `release` when what a
  release publishes moved; `discussion` while the spec has open questions, and
  the human removes it; `triage` on a fresh draft; `confirmed`, `unconfirmed`,
  `cant reproduce` from a diagnosis; `wontfix` when abandoned.
- **`size:` is computed from the diff** at ready-for-review, against the
  thresholds the repository's own label descriptions state.
- **Use labels that already exist here.** Read the list first; a new one matches
  the separator, casing, and prefixing in use, and creating it is reported with
  the reason. No label names AEP.

## Closing

After `aep close`: rewrite the pull request's human part from its template, set
`size:`, move each object to `status: in review`, and mark the pull request
ready — only with every Important finding closed. A stop updates the `AEP`
block and leaves the pull request a draft. **Abandoning closes every object**,
labelled `flag: wontfix`.
