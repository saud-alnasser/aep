---
use-when: "a reviewer is about to report findings, or a run is deciding which findings block"
---

# Review — how a finding is reported

Every reviewer follows this, on both axes. It keeps a review short enough to
end, and honest about what the diff caused.

## The tag

Every finding carries one tag.

| Tag | Means | Blocks |
| --- | --- | --- |
| **Important** | a defect this diff introduced or exposed | yes |
| **Nit** | a small issue this diff introduced; nothing breaks | never |
| **Pre-existing** | a defect in code the diff did not change | never |

**Only Important blocks.** A defect in code the diff did not change is
Pre-existing, however severe.

**A Pre-existing finding is never fixed in this effort.** It is not the
author's, and a fix grows the scope that the next round then reviews. Record it:

```
node .aep/scripts/aep.mjs record <effort> --note "pre-existing: <path:line> <what>"
```

## The order

Important first, then Nit, then Pre-existing. Within a tag, the most severe
first.
