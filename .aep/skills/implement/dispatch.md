---
use-when: "writing the brief a sub-agent will build from"
---

# Implement — writing the brief

`[[policies/execution/parallel]]` fixes what a brief contains and the bounds a
child works under; this is how to write it. The brief is the **only**
parent-to-child channel: **what is not in the brief did not happen.** Write it
in the controlled register (`[[policies/reporting]]`), so the child can read
each sentence only one way.

## Point, don't restate

The child reads for itself. Point it at the effort's `spec.md`, its ticket file,
the commits already on the effort branch, and any notes in scratch; never paste
them. Restate only what lives nowhere on disk — what the conversation settled.

## Durable

- **Do** describe interfaces, types, and behavioural contracts, and name the
  types, signatures, or configuration shapes to look for.
- **Do not** give a file path as the location of a concept, a line number, or
  today's internal structure as if it will survive. Say where a concept lives,
  never what is there now.
- Paths as **inputs to read** are required; paths as **the definition of the
  work** are forbidden.

## Behavioural, not procedural

Say what must be true when it is done, never how to do it.

| | |
| --- | --- |
| ✓ | *"`SkillConfig` accepts an optional `schedule` field of type `CronExpression`."* |
| ✗ | *"Open the config type and add a schedule field."* |
| ✓ | *"Invoked with no arguments, it reports what needs attention."* |
| ✗ | *"Add a branch in the main handler."* |

## Criteria someone else could check

Every criterion is verifiable by someone who did not write the code:
*"`node .aep/scripts/validate.mjs` exits zero"* is one; *"validation should
work correctly"* is not. The brief carries the ticket's criteria **unedited**.

## Out of scope

Say what must not change, and name the adjacent thing that looks related and is
not.

## The shape

```markdown
**Objective:** one line — what has to become true

**Current behaviour:**
What happens now. For a bug, the broken behaviour; for a change, the status quo
it builds on.

**Desired behaviour:**
What is true when the work is done, including edge cases and error paths.

**Key interfaces:**
- `TypeName` — what changes and why
- `operationName` — what it returns now, versus what it should

**Read first:** `spec.md`, the ticket, prior commits, scratch notes — as paths
**Task:** the task this child owns, whole
**Worktree:** the surface `aep dispatch` created for this task, by its
absolute path, and nowhere else (`[[policies/execution/parallel]]`)
**Scratch:** `.aep/scratch/` inside that worktree, for its notes and exploration
output — never a folder outside the project or one shared with another child
**Returns:** the shape of the result
**Acceptance criteria:** copied from the task, verifiable by a third party
**Out of scope:** what must not change; the adjacent thing that is not this
**Cap:** the bound on the work
```

## Before sending

Read the brief as though you had never seen this repository; that is its
reader. *"Fix the triage bug. Look at the main handler — the function around
line 150 has the issue"* fails: no current or desired behaviour, no criteria, no
boundary, and a line number that will be wrong first.
