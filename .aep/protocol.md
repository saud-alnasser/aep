---
version: 4.14.0
use-when: "at the start of every session, before doing anything else in a repository that has a .aep/ directory"
---

# AEP — the Agentic Engineering Protocol

The bootstrap. It orients; `[[policies]]` and `[[rules]]` govern.

AEP is a **filesystem protocol** for engineering work: plain files under
`.aep/`, no runtime or database, the same for every agent. **The repository is
authoritative**; every AEP artifact describes it and loses to it.

## The primitives

| Primitive | Answers | Lives in |
| --- | --- | --- |
| **Policies** | what MUST be done — AEP's, everywhere | `policies/` |
| **Rules** | what MUST be done **here** — yours | `rules/` |
| **References** | how a tool or procedure is operated here | `references/` |
| **Contexts** | what to know about an area, and where to look | `contexts/` |
| **Efforts** | what change is being made | `.aep/efforts/<e>/` |
| **Agents** | who performs work, in what role | `agents/` |
| **Skills** | reusable capabilities | `skills/` |

An effort holds `spec.md`, `plan.md` where the approach is not obvious,
`evidence/`, tickets under `tickets/`, and `log.md`. Never substitute one
primitive for another. **A policy is AEP's and never edited here; a rule is
yours and may tighten a policy, never soften, contradict, or opt out of one.**
Down the chain policies → rules → effort rules → task constraints, each only
tightens what it sits under.

```
.aep/
├── protocol.md  index.md (derived: regenerate, never edit)  friction.md
├── policies/  rules/  agents/  contexts/  references/  scripts/  skills/  templates/
├── efforts/<effort>/{spec.md, plan.md, log.md, evidence/, tickets/}
└── position/  scratch/  worktrees/   per working tree, gitignored, script-managed
```

Worktrees and the position marker are script-managed. New artifacts copy their
shape from `templates/`. Each path's owner and contents: `[[policies/artifacts]]`.

## Discovery

**Load by applicability, never by existence:** by `use-when:`, `paths:`, and
wiki links from what you loaded; `index.md` lists them. Order: repository state
→ `index.md` → current effort → applicable policies and rules → contexts →
references → evidence → task → work. A link (`[[policies/artifacts]]`) that does
not resolve is repaired or reported, **never invented**.

## The workflow

```
/specify → /plan? → /tasks → /implement
```

**Four commands, nothing else to type.** `refine`, `research`, `review`, and
`converge` are stages those four run; `prototype`, `survey`, and `prune` are
capabilities (`[[skills/help]]`). `/specify` sets the lane (quick, standard, or
full), and the lane sets the ceremony (`[[policies/execution]]`). Every git and
worktree step runs through `node .aep/scripts/aep.mjs`; quote its `summary`.

## The invariants

**Repository wins.** On conflict, trust: the human in this conversation (say
so, and follow it); the repository's source, config, tests, and build; git
history and systems it designates; `spec.md`; policies; rules; references;
contexts; evidence; derived state; your own reasoning. An artifact the source
contradicts is wrong: correct the artifact where you find it, never the source,
and never explain the contradiction away. A reference never authorises; a context never
instructs. Where the order does not settle it, put both sides and their costs to
the human.

**Claims are checked.** Read the source before any claim about this repository;
names, memory, and a plausible API are not proof. A CLI is an API: read its
reference, never try a flag to see; an operation no reference covers is a gap
to name, not invent. Say what you verified and what you assume. Climb only as
far as the uncertainty warrants: known fact → repository → context and evidence
→ `[[skills/research]]` (factual) → `[[skills/prototype]]` (technical) →
`[[skills/refine]]` (product).

**Change is small and fits.** The smallest sufficient change; read all of what
you change; match its idiom; fix the root cause, or record why a workaround
exists, what else was considered, and when it goes. Obeying a rule means
letting its check fire: ask what it would catch, and keep that reachable.

**Humans decide.** Merging, releasing, and publishing are theirs. Never push,
publish, or open a pull request unasked (`[[rules/version-control]]`). **Never
silently choose between reasonable architectures:** offer an option set
(`[[policies/reporting]]`) with costs and risks, one recommended; the human
chooses. A sub-agent at a decision it may not make records it and stops.

**Every turn reports**, once, from the outermost skill, in the shape
`[[policies/reporting]]` fixes. Text a human reads has no em dashes (and no
parentheses, en dash, or hyphen standing in for one), no curly quotes, no
decorative emoji, and no title-case headings.

**Ownership is where a file sits.** AEP's, installed verbatim, replaced by
upgrades, never edited here: `policies/`, `skills/`, `agents/`, `templates/`,
`scripts/`, and `protocol.md`. Yours, never touched by an upgrade: `rules/`,
`contexts/`, `references/`, `efforts/`, and `friction.md`; `index.md` is
derived. Variation is a declared deviation in a rule.

**No hidden memory.** Durable knowledge lives in files: policies, rules,
contexts, evidence, specs, `log.md`, the source; never only in a session.
Knowledge that outlives its effort graduates into a context, a rule, or a
reference; the evidence file stays as the record of how it was learned.

**Write only inside the project.** Read anywhere; write only in these zones.
Anything else is a stop: say what you wanted to write and why.

| Zone | Holds |
| --- | --- |
| the main checkout | source, config, tests, docs, `.aep/` artifacts |
| `.aep/worktrees/<effort>/…`, or the runtime's worktree you stand in | effort and child surfaces |
| `.aep/scratch/` | handoffs, notes, drafts — one per surface, gone with it |
| where a project tool writes, run the project's way | `node_modules/`, build output, its cache |
| the OS temp dir, through the language's temp API | never a typed path; removed before the run ends |

Never, unless the human asked in this conversation: a drive root, the home
folder, another repository, global config, or a global install.

**One repository.** Another repository may be read, never written, planned, or
run against; this one's worktrees are not another. Work for it leaves as a
write-up (what was found, what it costs, what would close it), never an offer
to do it here. Being told to fix something is not being told to fix it here;
ask if that is genuinely unclear. A clean position check never licenses it. Say
so when you reach it.

**Nothing is invented.** Where an artifact defines protocol state, use it;
where a script computes an answer, run it and quote it.

## Governance that loads when it applies

| Load when | Policy |
| --- | --- |
| an effort is in progress — tasks, implementation, converge, review | `[[policies/execution]]` |
| a wave of children is dispatched | `[[policies/execution/parallel]]` |
| `tracker:` is on and an effort opens, lands, or closes | `[[policies/tracker]]` |
| creating, changing, or removing anything under `.aep/` | `[[policies/artifacts]]` |
| writing anything a human reads | `[[policies/reporting]]` |

Your own rules sit beside these in `rules/`, selected the same way.
