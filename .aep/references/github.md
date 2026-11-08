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
with their `spec.md`, and it fetches nothing itself. That is deliberate: it is
the component that exists for a repository which declined the merge-time job, so
a forge call inside it would be the one unconditional tracker call the protocol
does not allow. The caller fetches, because the caller is already here.

Two lists, and the exact fields the script reads:

```sh
gh issue list --state all --limit 200 --json number,state,labels
gh pr list --state all --limit 200 --json number,state,labels,closingIssuesReferences
```

`closingIssuesReferences` is what ties a pull request to its effort, and it is
populated by the closing keyword. A pull request that carries none is reported
against no effort, which is the same omission the keyword exists to remove.

They are combined into one object with an `issues` key and a `changeRequests`
key, each holding that command's output unmodified. Nothing beyond `gh` is
needed to do it:

```sh
{ printf '{"issues":'
  gh issue list --state all --limit 200 --json number,state,labels
  printf ',"changeRequests":'
  gh pr list --state all --limit 200 --json number,state,labels,closingIssuesReferences
  printf '}'
} | node .aep/scripts/reconcile.mjs --observed -
```

It prints one line per finding and exits 1 where anything disagrees. Drift is a
label to correct, never a spec to edit, including where a person moved the label
by hand.

## Tasks as issues

Where this repository keeps AEP tasks in GitHub Issues rather than under the
effort, **GitHub already models everything a task needs.** Nothing is invented on
top of it and no label is created for a fact the tracker carries itself.

| The fact | Carried by | Never |
| --- | --- | --- |
| which effort this task belongs to | **one issue for the effort, tasks as its sub-issues** | a label, where the hierarchy serves |
| what gates this task | **issue dependencies** — `blocked by` | a `blocked-by-<n>` label |
| open, resolved, obsolete | the issue's **state** and close reason | a status label |
| bug, feature, chore | the issue's **type** | a type label, where types are enabled |

**The effort is an issue, and its tasks are that issue's sub-issues.** The effort
gets a real home in the tracker — a body, a thread, a progress count — and the
shape matches how the set is created anyway: root first, then children.

```sh
gh issue create --title "<effort>" --body-file <file>          # the effort

gh issue create --title "<type(scope): summary>" --body-file <file> \
  --parent <effort-number> --blocked-by <number> --type <name>

gh issue edit <number> --add-blocked-by <number>
gh issue edit <number> --add-sub-issue <number>
gh issue edit <number> --add-label <name>

gh issue close <number> --reason completed     # resolved
gh issue close <number> --reason "not planned" # obsolete
```

**A milestone is the alternative**, and it is worth taking where the repository
already runs efforts as milestones. It filters server-side (`--milestone`), which
the hierarchy does not — but it has no `gh` command to create one, milestones
usually already mean releases here, and an effort is not a release. Sub-issues
cap at **100 per parent and eight levels deep**; past that, the effort was too
big before the tracker said so.

**Creating an issue publishes.** It lands in other people's workspace, so it is
gated exactly as opening a pull request is: write the whole set first — issues,
and anything the resolution needs created alongside them — show it, get it
approved, and only then create. Root first, then children, then the links.

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

This is the query the task graph is read from, rather than listing every open
issue and judging from prose:

```sh
gh issue list --state open --limit 200 \
  --json number,title,state,blockedBy,parent \
  --jq '[.[] | select(.parent.number == <effort-number>)]'
```

`blockedBy` comes back as the issues gating each one, so **the frontier is
computed, not guessed**: the open issues whose `blockedBy` is empty or entirely
closed. `[[policies/execution]]` requires exactly that — independence read off
declared edges rather than inferred from which files a task looks like it
touches.

**Raise `--limit` deliberately.** There is no server-side filter for a parent, so
`--jq` narrows a page that `gh` has already truncated — the default is 30. A
truncated page filters to a short list that looks like a complete answer, and the
tasks it dropped read as *not in this effort* rather than as *not fetched*. Where
the repository carries more open issues than one page, filter on a milestone
instead, which the server applies before truncating.

The parent's own view is the cheaper read when the edges are not needed:

```sh
gh issue view <effort-number> --json subIssues,subIssuesSummary
```

Other fields `--json` accepts here: `labels`, `milestone`, `issueType`,
`stateReason`, `blocking`.

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

## Gaps in `gh`

- **There is no `--parent` filter on `gh issue list`.** The `parent` field comes
  back in `--json` and is narrowed with `--jq`, which filters client-side, after
  truncation — see the limit warning above. `parent-issue:` exists, but it is a
  **Projects** filter and not an issue-search qualifier, so `--search` does not
  reach it either.

- **There is no `gh milestone` command.** Milestones are filtered and assigned by
  `--milestone`, but creating one goes through the API:

  ```sh
  gh api repos/{owner}/{repo}/milestones -f title="<effort>" -f description="<text>"
  ```

  This is the reason the hierarchy is the default and the milestone the
  alternative: creating a parent issue is `gh issue create`, and creating a
  milestone is a drop to the REST API.

## AEP tasks in this tracker

**Draft — this table is the part to correct.** It records what carries each fact
*here*, so no later session has to work it out again. Confirm it once, then it is
read rather than rederived.

| Fact | Carried by | Kind |
| --- | --- | --- |
| effort membership | one issue per effort; tasks are its sub-issues | native |
| the gating edge | issue dependencies | native |
| status | open / closed, with close reason | native |
| — | no AEP label is required on GitHub | — |

Record the effort issue's number where the effort is defined, so the query above
has its `<effort-number>` without a search.

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

**The runner opens an effort's pull request as a draft, and marks it ready** at
the close (`[[rules/version-control]]`). **Merging is the human's.** The body
takes the shape `[[templates/pull-request.template]]` gives.

## Failure handling

- `gh` unauthenticated fails with a message naming the login command. Report it;
  do not attempt to authenticate.
- A rate limit is a wait, not a reason to switch to scraping the web UI.
- Issue types and dependencies are newer than much of `gh`; an older binary
  rejects the flag rather than the value. Report the version, do not fall back to
  a label silently.
- An operation not listed here is a gap — say so rather than guessing a flag.
