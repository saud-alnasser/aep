---
paths:
  - .aep/**/*.md
use-when: "about to create, change, move, or remove anything under .aep/ — whose it is, where it belongs, and what shape it takes"
---

# Policy — AEP's own artifacts

Three questions, in order: **whose is it, where does it go, and what must it
contain.**

## Whose it is

**Ownership is where a file sits; no artifact declares it.** A release ships an
exact set of paths, the installer and the validator both consult it, and a file
is the protocol's if and only if it is in that set.

| Path | Owner |
| --- | --- |
| `protocol.md`, `policies/`, `skills/`, `agents/`, `templates/`, `scripts/` | protocol |
| `rules/`, `contexts/`, `references/`, `efforts/`, `friction.md` (appended by `aep close`) | repository |
| `index.md` | derived: regenerate with `.aep/scripts/index.mjs`, never hand-edit |

**The protocol's:**

- **MUST NOT be edited in a repository**: not improved, healed, or corrected in
  passing. Installed verbatim; replaced or migrated by an upgrade.
- **The release is named once**, in the bootstrap's `version:`. No artifact
  carries its own stamp; the distribution keeps a content baseline.
- An upgrade establishes provenance by **comparing content**, never by reading a
  claim. A protocol-owned file that differs from its release is a **defect to
  report and reinstall** (`[[skills/update]]`), never drift to heal.

**The repository's:**

- Evolve it freely.
- **An upgrade MUST preserve it** and never silently overwrite repository-owned
  governance; the installer writes only paths the release ships.
- **A file of yours where the protocol ships is a defect the validator names.**
  Rules go under `rules/`, orientation under `contexts/`, tool operation under
  `references/`. `policies/` and `rules/` admit one owner each, with no
  exception.

**When the protocol does not fit.** Variation enters a protocol-owned artifact
only through an extension point it names. Otherwise it is a **declared
deviation**:

1. Record it in a repository-owned rule under `[[rules]]`.
2. State what differs, **why**, and the release it was declared under.
3. Expect `[[skills/update]]` to report it on every run until the protocol grows
   the point or the repository conforms.

## Where it goes

| Lives where | What |
| --- | --- |
| `.aep/` | every AEP artifact: protocol, policies, rules, skills, agents, templates, contexts, references, efforts, scripts, position, scratch, worktrees |
| repository root | the entrypoint (`AGENTS.md`, and a runtime's equivalent), which **points at** `[[protocol]]` and never restates it |
| a runtime's directory | adapters only, such as `.claude/skills/` wrappers; never canonical state |

**The test: were AEP removed, would this file still have a reason to exist?** If
yes, it is not AEP's to place. It decides by **whose process the file serves**,
not by what it is made of or whether it runs: a script regenerating AEP's index
goes in `.aep/scripts/`; a script building what the repository produces stays
where the repository keeps scripts, **neither moved nor claimed**.

- **A runtime directory never holds canonical AEP state.** `.claude/`,
  `.cursor/`, `.codex/` hold pointers; a repository has one AEP state.
- **Never reference `.aep/` from source comments or the repository's own
  documentation.**
- **Local state stays local.** `position/`, `scratch/`, and `worktrees/` are
  gitignored, and nothing shared depends on them. Gitignored means **per working
  tree**: two linked worktrees hold two markers; two agents in one checkout share
  one.
- **Placed by scope.** What belongs to one effort (spec, evidence, tickets, log)
  lives in its directory; what spans every effort lives at the root of `.aep/`.

**A path naming an AEP artifact carries `.aep/` where it has two segments or
more** (`.aep/efforts/<effort>/spec.md`). A bare area name does not, as in
`policies/`. Never a leading slash.

## What it must contain

Every Markdown file under `.aep/` opens with YAML frontmatter:

```yaml
---
use-when: "<the occasion on which this is the thing to read>"
---
```

**Frontmatter carries what decides whether to load the file, and nothing
else.** Situational fields:

| Field | When | Contract |
| --- | --- | --- |
| `paths` | applicability follows repository paths | glob patterns |
| `status` | efforts and local tickets **only** | spec: `draft` `accepted` `implemented`; ticket: `open` `resolved` `obsolete`. `implemented` is written by the run that closed the effort (`aep close`), never by hand ahead of it |
| `lane` | efforts only | `quick` `standard` `full`; only ever raised |
| `blocked-by` | tickets only | ticket identifiers this one waits on |
| `builds-on` | efforts only | efforts this one needs, by directory or number |

**`use-when` states a trigger, never a topic.** `"working with database schema
or migrations"` is a trigger; `"documentation about the database"` is a topic,
and wrong. No check catches this one for you.

**Links** to another AEP artifact use double brackets, relative to `.aep/`,
without `.md`:

```
[[policies/execution]]   [[contexts/authentication]]   [[efforts/auth/spec]]
```

- A link is a **relationship, not a copy**: never follow it with a summary of
  what it says.
- A link that does not resolve is **repaired or reported, never invented**:
  search for where the concept moved; never create a file to satisfy it.
- `paths:` is a matching field, not a substitute for a link.

## Structures that must not exist

`.aep/` MUST NOT contain `decisions/`, `tools/`, `grill/`, or `modes/`. Each was
retired; do not reintroduce one because it seems locally convenient.

Run `.aep/scripts/validate.mjs` to check a tree against everything above.
