---
use-when: "writing the body of an issue: a roadmap item, or the issue an effort opens for"
---

# Template — issue body

The one home of the issue's shape. `[[policies/tracker]]` says when an issue
exists; this says what it holds.

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
