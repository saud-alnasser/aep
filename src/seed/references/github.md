---
use-when: "reading or writing GitHub issues, pull requests, or checks for this repository"
---

# Reference — GitHub

**This file is yours.** Installed because a GitHub remote was detected. Correct
it where this repository differs.

Commands below were checked against `gh` 2.96.0. Where a version here is older,
the gaps are the parts to re-check first.

## Reading

```sh
gh issue view <number> --json number,title,body,state,labels
gh issue list --state open --limit 50
gh pr view <number> --json number,title,body,state,files
gh pr checks <number>
gh repo view --json nameWithOwner,defaultBranchRef
```

Reading is always allowed. `[[protocol]]` still applies: read another
repository freely, write to none.

### The observation `reconcile.mjs` reads

`.aep/scripts/reconcile.mjs` computes which efforts have tracker objects
disagreeing with their `spec.md`, and it fetches nothing itself. That is
deliberate: it is the component that exists for a repository which declined the
merge-time job, so
a forge call inside it would be the one unconditional tracker call the protocol
does not allow. The caller fetches, because the caller is already here.

Two lists, and the exact fields the script reads:

```sh
gh issue list --state all --limit 200 --json number,state,labels
gh pr list --state all --limit 200 --json number,state,labels,closingIssuesReferences,body
```

**The `effort:` line in the body's `AEP` block** is what ties a pull request to
its effort. `closingIssuesReferences` is the fallback, for a pull request with
no block: it is populated by the closing keyword. A pull request with neither
is reported against no effort.

They are combined into one object with an `issues` key and a `changeRequests`
key, each holding that command's output unmodified. Nothing beyond `gh` is
needed to do it:

```sh
{ printf '{"issues":'
  gh issue list --state all --limit 200 --json number,state,labels
  printf ',"changeRequests":'
  gh pr list --state all --limit 200 --json number,state,labels,closingIssuesReferences,body
  printf '}'
} | node .aep/scripts/reconcile.mjs --observed -
```

It prints one line per finding and exits 1 where anything disagrees. Drift is a
label to correct, never a spec to edit, including where a person moved the label
by hand.


## An effort here: one pull request, and an issue when wanted

**AEP creates one pull request per effort, and an issue only where one is
wanted** (`[[policies/tracker]]`, `[[templates/issue.template]]`). The
tickets stay in the repository under `.aep/efforts/<effort>/tickets/`, and so
does the dependency graph.

| The fact | Carried by | Never |
| --- | --- | --- |
| what the effort is, for a person deciding whether it matters | **the issue body**, shaped by `[[templates/issue.template]]`, written once | a copy of `spec.md`, kept in step |
| what changed, the ticked criteria, and a link to `log.md` | **the pull request body**, shaped by `[[templates/pull-request.template]]` | one pull request per ticket; `log.md` copied in |
| what gates a ticket | **`blocked-by` in the ticket file** | an issue dependency, a `blocked-by-<n>` label |
| draft, accepted, implemented | **`spec.md`'s `status:`**, projected onto a label | a label that is the source of truth |

*Why the graph never comes here: it is read on every scheduling pass. Local, it
is a field a script reads; here, it is a paginated fetch to interpret before a
frontier can be computed, and nobody schedules by hand anyway.*

```sh
gh issue create --title "<effort>" --body-file <file>   # only where there is an issue
gh pr create --draft --title "<effort>" --body-file <file>
gh pr edit <number> --body-file <file>       # the AEP block
gh pr ready <number>                         # converge found no gap

gh issue close <number> --reason "not planned"   # abandoned
gh pr close <number>                             # with it, both labelled flag: wontfix
```

**Creating an issue or a pull request publishes.** It lands in other people's
workspace, so the whole set is written out first with exact strings, shown, and
approved before anything is created (`[[rules/version-control]]`). `/specify`
asks once, at the opening step, and a refusal leaves the effort local.

## Sub-issues, and why they are not used

GitHub models a task hierarchy well: `--parent`, `--blocked-by`,
`gh issue edit --add-sub-issue`, and a `subIssuesSummary` progress count. **This
repository does not use it**, and the reason is not that it is missing anything.

An effort is what a human agreed to and the unit they review and merge. Fifteen
issues for one change is fifteen things to close and one thing nobody can see the
shape of, and the dependency graph would then live where a scheduling pass has to
fetch it. Sub-issues also cap at **100 per parent and eight levels deep** — past
that the effort was too big before the tracker said so.

Milestones are the other alternative, and they are declined for a nearer reason:
they usually already mean releases here, and an effort is not a release.

## What the body does, and does not do

Body text is mostly **not** a control surface. One keyword family genuinely
drives GitHub; the rest is convention that other trackers taught people to
expect:

| Written in a body | What GitHub does |
| --- | --- |
| `Closes #123` in a **pull request** | links it, and closes the issue when the PR merges. The full set: `close`/`closes`/`closed`, `fix`/`fixes`/`fixed`, `resolve`/`resolves`/`resolved` |
| `#123` anywhere | a cross-reference in the issue's timeline. Real, but directionless and carrying no meaning |
| `Blocked by #123` | **nothing.** It is prose. Dependencies are set through the UI, the CLI flags, or the API — never parsed out of a body |
| `- [ ] #123` | a checklist item, not a relationship. Tasklist blocks stopped rendering on 30 April 2025 and sub-issues replaced them; converting one is a deliberate action, not a side effect of the syntax |

**The failure this prevents is silent, which is why it is written down.** An agent
that puts *Blocked by #12* in an issue body has recorded the gate nowhere: the
sentence reads correctly to every human who sees it, the tracker knows nothing,
and the frontier query below returns that task as ready to start. Set the edge
with `--blocked-by` or `--add-blocked-by`, where the query can see it.

## Finding the effort, and the frontier

**The frontier is computed locally, and this tracker is not consulted for it:**

```sh
node .aep/scripts/frontier.mjs <effort>
```

The tickets and their `blocked-by` edges are files in this repository, so
scheduling reads them directly. `[[policies/execution]]` requires independence
read off declared edges rather than inferred, and a field in a file is the
cheapest declaration there is.

What is read from GitHub is the effort's own two objects:

```sh
gh issue view <effort-number> --json number,title,body,state,labels
gh pr view <pr-number> --json number,title,body,state,isDraft,files
```

Other fields `--json` accepts on an issue here: `milestone`, `issueType`,
`stateReason`, `blockedBy`, `blocking`, `subIssues`, `subIssuesSummary` — none of
which AEP writes.

Record the effort's issue and pull request numbers where the effort is defined,
so neither has to be found by search.

## Labels, where a label is actually the answer

A label is the last resort, not the first. Before creating one, check in this
order: does GitHub model this natively (the table above), then does a label
already exist that serves the purpose, and only then create.

```sh
gh label list --limit 100          # the whole vocabulary — the default is 30
gh label list --search <term>
gh label create <name> --description <text> --color <hex>
```

**A new label matches the vocabulary already there** — its separator, its
casing, its prefixing. A tracker labelled `area/api` and `type: bug` does not
want `aep:effort/x` beside them. Read the list before naming anything.

**Creating one is reported, with the reason.** A label that appears here with no
explanation is one nobody can tell from a mistake.

### The five families, and which of them re-sync

`[[policies/tracker]]` decides this; what belongs here is the vocabulary *this
tracker* uses for each, so no later session has to work it out again.

| Family | Set from | Maintained |
| --- | --- | --- |
| `status:` | `spec.md`'s `status:`, and where the run has reached | **derived** — re-synced on every write |
| `type:` | what the spec describes | **derived** |
| `size:` | the diff, when the pull request goes ready | **derived**, against the thresholds in each `size:` label's own description |
| `priority:` | the human, once, when the effort opens | **initial** — never updated by an agent |
| `flag:` | a fact: the diff, the trip-wire, a diagnosis | **derived**, except `discussion` and `wontfix`, which invite a person and are initial |

```sh
gh issue edit <number> --add-label "status: ready" --remove-label "status: backlog"
gh pr edit <number> --add-label "size: m"
gh pr diff <number> --name-only        # what the size and the flags are computed from
```

**The file wins when a label disagrees with it.** Correct the label; never edit
`spec.md` to match a label somebody moved by hand.

## Gaps in `gh`

- **There is no `gh milestone` command.** Milestones are filtered and assigned by
  `--milestone`, but creating one goes through the API:

  ```sh
  gh api repos/{owner}/{repo}/milestones -f title="<effort>" -f description="<text>"
  ```

- **There is no `--parent` filter on `gh issue list`.** Irrelevant while AEP
  creates no sub-issues, and recorded because it is the first thing anybody
  reaching for the hierarchy runs into.

## AEP in this tracker

**Draft — this table is the part to correct.** It records what carries each fact
*here*, so no later session has to work it out again. Confirm it once, then it is
read rather than rederived.

| Fact | Carried by | Kind |
| --- | --- | --- |
| what the effort is | the pull request; an issue only where one is wanted | native |
| what it will land as | one draft pull request per effort | native |
| which tickets exist, and what gates each | files under `.aep/efforts/<effort>/tickets/` | **not in this tracker** |
| the effort's state | `spec.md`'s `status:`, projected onto a `status:` label | projection |

## Referencing a task from a commit

Which form to use is `[[rules/version-control]]`'s, and it depends on how work
reaches the default branch:

```
Refs #123          a reference that closes nothing
Closes #123        only where the commit reaches the default branch through
                   its own branch's pull request
```

A closing keyword in a commit stays live: a later cherry-pick or rebase closes an
issue nobody merged.

## Pull requests

**Merging is the human's, never an agent's** (`[[rules/version-control]]`, which
also states what the runner may push and open here). `/specify` opens the
effort's draft after asking once; converge marks it ready when the effort is
done. Nothing merges it but a person.

## Failure handling

- `gh` unauthenticated fails with a message naming the login command. Report it;
  do not attempt to authenticate.
- A rate limit is a wait, not a reason to switch to scraping the web UI.
- Issue types and dependencies are newer than much of `gh`; an older binary
  rejects the flag rather than the value. Report the version, do not fall back to
  a label silently.
- An operation not listed here is a gap — say so rather than guessing a flag.
