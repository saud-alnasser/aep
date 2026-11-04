---
use-when: "writing or extending an effort's spec.md"
---

# Template — effort spec

Copy to `.aep/scratch/<slug>/spec.md`, where `<slug>` is kebab-case and names the
change. `aep open` moves it to `.aep/efforts/<number>-<slug>/spec.md`.

**What is changing and why.** How it will be built belongs in
`[[templates/plan.template]]`, written by `/plan` where the approach is not
obvious. This file is what a reviewer agrees to; the plan is what an
implementer follows.

**Omit a heading rather than writing "N/A" under it.** An empty section reads as
considered-and-empty; an absent one reads as not yet reached, which is the truth.

```markdown
---
status: draft            # draft → accepted → implemented
lane: standard           # quick | standard | full; only ever raised
builds-on: [<effort>]    # efforts this needs, by directory or number; omit when none
---

# Problem
What is wrong or missing today, and what it costs. Not the solution.

# Goal
What is true once this lands.

# Scope
What this change covers.

# Requirements
Numbered. Each one gets an acceptance criterion below, or it is not a requirement.

# Acceptance Criteria
How anyone would know each requirement was met. Checkable, not aspirational.

# Constraints
What the solution must respect — and why each constraint exists, so a later
reader can tell a requirement from a preference.

# Out of Scope
Mandatory. The nearest things this deliberately does not do. The obvious
exclusion is the one that gets built.

# Assumptions
Things believed but not verified. Naming one costs a line; leaving it implicit
turns it into a requirement nobody agreed to.

# Open Questions
What is still unresolved. A spec that quietly drops a question it could not
answer is worse than one that admits it.

# Risks
What could go wrong, and how it would show up.
```

**A quick-lane spec** has only these three sections, and fits on one screen:

```markdown
---
status: draft
lane: quick
---

# Problem
What is wrong, in a sentence or two.

# Change
What will be different.

# Check
- [ ] One box per thing someone else could verify, and how.
```

**Write no `# Architecture` section here.** The moment a spec starts saying how,
it stops being reviewable as a statement of what: a reader who disagrees with
the approach cannot tell whether they also disagree with the problem.
