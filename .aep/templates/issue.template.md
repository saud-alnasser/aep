---
use-when: "writing the body of an issue: a roadmap item, or the issue an effort opens for"
---

# Template — issue body

The one home of the issue's shape, and of when an issue exists.
`[[policies/tracker]]` governs the rest.

## When there is an issue

An effort always has a pull request. **It has an issue only where:**

| The case | Then |
| --- | --- |
| **the human names one** | the effort is numbered for it, and the pull request closes it |
| **it is a roadmap item**: an idea, or a Pre-existing review finding, with no branch yet | the issue is all there is. `[[skills/specify]]` reads its body as input when it picks it up, and numbers the effort for it |

**Otherwise there is no issue, and the effort is numbered for its pull
request.** Read the highest issue or pull request number, and pass the next
one to `aep open --number`. Where the pull request then gets another number,
rename the effort to match. On GitHub, issues and pull requests share one
sequence, so the number is unique there. On GitLab they do not: an effort
numbered for its merge request may share a number with an issue, so name it
in `builds-on:` by its directory.

A Pre-existing finding is proposed as a roadmap issue with the exact strings,
as any write to the tracker is, and created only once the human agrees.

## The body

**Two parts.** The top is for a person, in plain words. The bottom is one folded
block for agents, `key: value` lines a script can read.

**Written once.** The issue is written when it is created. A run edits it once
more, when an effort opens for it, to fill the `AEP` block, and never again: it
is not kept in step with `spec.md`, which is canonical and lives in the
repository.

```markdown
<What is wrong, or what is wanted, in plain words. A few lines.>

## Done when

- <Each outcome that would show it is done, as a plain bullet>

## Notes

<Anything that helps whoever picks this up. Omit the heading when empty.>

<details><summary>AEP</summary>

effort: .aep/efforts/<effort>/
pr: #<n>
priority: <the priority label's value>
</details>
```

## The rules of the body

- **Bullets, never checkboxes.** The criteria are ticked in the pull request
  only, so the two can never disagree.
- **A roadmap item's `AEP` block is empty** until an effort opens for it: leave
  the block out until then.
- **Never the whole spec.** The spec lives in the repository; the issue says
  what a person needs to decide whether it matters.
