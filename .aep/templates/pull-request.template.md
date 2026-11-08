---
use-when: "writing or finalising the body of an effort's pull request or merge request"
---

# Template — pull request body

The one home of the pull request's shape. `[[policies/tracker]]` says when it is
written; this says what it holds.

**Two parts.** The top is for a person: plain words in the controlled register
(`[[policies/reporting]]`), with no AEP terms a reader would have to look up.
The bottom is one folded block for agents, `key: value` lines a script can read.

**When each part is written.** The top is written when the effort opens and
again at the close, and at no other time. Between them a run edits only the
`AEP` block. A person may edit the top, and a run never overwrites what they
wrote there except at the close.

```markdown
<Two or three lines: what changes for the person who uses this, and why.>

Closes #<issue> · Builds on #<n>

## Why

<The problem, in plain words. Where an issue holds the story, one or two lines
and the link are enough. Where there is no issue, three to six lines.>

## What changed

<The smallest picture that explains it: a before-and-after table, or a sketch.
Before the work is built, the plan in one table.>

## Done when

- [ ] <Each acceptance criterion of the spec, in plain words>

## How it was tested

<Each command that verified the change, and what it printed.>

## Risk

<A one-way or a two-way door, and the blast radius: what breaks, for whom, if
this is wrong.>

<details><summary>AEP</summary>

effort: .aep/efforts/<effort>/
spec: .aep/efforts/<effort>/spec.md
log: .aep/efforts/<effort>/log.md
lane: <quick | standard | full>
status: <the status label's value>
issue: <#n, or none>
review: <round, and the count per tag>
tickets:
- [ ] <id> <title>
</details>
```

## The rules of the body

- **Leave out a line that has nothing to say.** No `Closes` line without an
  issue; no `Builds on` without a `builds-on:` edge.
- **Criteria are ticked here, and only here.** An issue lists them as plain
  bullets and is never ticked.
- **`log.md` is linked, never copied in.** It is committed and pushed with the
  branch, so the `log:` line is enough.
- **The `effort:` line is what ties this pull request to its effort.** Keep it
  exact: the effort directory, under `.aep/efforts/`, with the trailing slash.
- **Never a commit-by-commit account**, and never a file-by-file one.
