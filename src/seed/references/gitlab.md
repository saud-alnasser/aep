---
use-when: "reading or writing GitLab issues, merge requests, or pipelines for this repository"
---

# Reference — GitLab

**This file is yours.** Installed because a GitLab remote or CI configuration was
detected. Correct it where this repository differs.

Commands below were checked against the `glab` documentation. Confirm them
against your installed binary — `glab <command> --help` is the authority for the
version you have.

## Reading

```sh
glab issue view <id>
glab issue list --all
glab mr view <id>
glab ci status
```

Reading is always allowed; `[[protocol]]` still governs writing.

### The observation `reconcile.mjs` reads

`.aep/scripts/reconcile.mjs` computes which efforts have tracker objects
disagreeing with their `spec.md`, and it fetches nothing itself: it is the
component that exists for a repository which declined the merge-time job, so a
forge call inside it would be the one unconditional tracker call the protocol
does not allow. The caller fetches, because the caller is already here.

```sh
glab issue list --all --output json
glab mr list --all --output json
```

Each merge request's `description` carries its `AEP` block, whose `effort:` line
ties it to its effort. The closing link below is the fallback, for a merge
request with no block.

**A merge request list carries no link to the issue it closes**, which is where
this differs from the GitHub side rather than mirroring it. The link is its own
endpoint, one call per merge request:

```sh
glab api projects/:id/merge_requests/<iid>/closes_issues
```

Each merge request is given a `closesIssues` key holding that call's result, and
the two lists are then combined into one object with an `issues` key and a
`changeRequests` key:

```json
{
  "issues": [{ "iid": 45, "state": "closed", "labels": ["status: done"] }],
  "changeRequests": [
    {
      "iid": 46,
      "state": "merged",
      "labels": ["status: done"],
      "closesIssues": [{ "iid": 45 }]
    }
  ]
}
```

Piped in with `node .aep/scripts/reconcile.mjs --observed -`. The script reads
either forge's shape and says which one it read, so a shape it does not
recognise reports that rather than answering with an empty list of findings.


## An effort here: one merge request, and an issue when wanted

**AEP creates one merge request per effort, and an issue only where one is
wanted** (`[[policies/tracker]]`, `[[templates/issue.template]]`). The
tickets stay in the repository under `.aep/efforts/<effort>/tickets/`, and so
does the dependency graph.

| The fact | Carried by | Never |
| --- | --- | --- |
| what the effort is, for a person deciding whether it matters | **the issue description**, shaped by `[[templates/issue.template]]`, written once | a copy of `spec.md`, kept in step |
| what changed, the ticked criteria, and a link to `log.md` | **the merge request description**, shaped by `[[templates/pull-request.template]]` | one merge request per ticket; `log.md` copied in |
| what gates a ticket | **`blocked-by` in the ticket file** | a linked issue, a `blocked-by-<n>` label |
| draft, accepted, implemented | **`spec.md`'s `status:`**, projected onto a label | a label that is the source of truth |

```sh
glab issue create --title "<effort>" --description "$(cat <file>)"   # only where there is an issue
glab mr create --draft --title "<effort>" --description "$(cat <file>)"
glab mr update <id> --description "$(cat <file>)"
glab mr update <id> --ready                  # converge found no gap

glab issue close <id>                        # abandoned, with the merge request
glab mr close <id>
```

`--description` takes text rather than a path, so a file is read in through the
shell as above, or `--description -` opens an editor.

**Creating an issue or a merge request publishes.** It lands in other people's
workspace, so the whole set is written out first with exact strings, shown, and
approved before anything is created (`[[rules/version-control]]`). `/specify`
asks once, at the opening step, and a refusal leaves the effort local.

## Finding the effort, and the frontier

**The frontier is computed locally, and GitLab is not consulted for it:**

```sh
node .aep/scripts/frontier.mjs <effort>
```

The tickets and their `blocked-by` edges are files in this repository.
`[[policies/execution]]` requires independence read off declared edges rather
than inferred, and a field in a file is the cheapest declaration there is.

What is read from GitLab is the effort's own two objects:

```sh
glab issue view <id>
glab mr view <id>
```

Record the effort's issue and merge request ids where the effort is defined, so
neither has to be found by search.

## The dependency gap that no longer applies

Worth knowing, because it is the reason this shape is a relief here rather than
merely a simplification. Had the tickets lived in GitLab, two limits would
compound: **`glab` has no subcommand for issue links at all**, and **`blocks` and
`is blocked by` are Premium and Ultimate** — on Free only *relates to* exists,
and it carries no direction, so it cannot express a gate even where it can be
set. The fallback was an edge written into a description, which GitLab parses as
nothing and which is only as current as the last person who edited it.

**None of that is reachable now.** The graph is `blocked-by` in a file, read by a
script, on every tier.

## Labels

A label is the last resort. Check whether GitLab models the fact natively (the
table above), then whether a label already serves it, and only then create one.

```sh
glab label list
glab label list --group <group>
glab label list --output json
glab label create --name <name> --color "#RRGGBB" --description "<text>"
```

**A new label matches the vocabulary already there** — separator, casing,
prefixing. Read the list before naming anything. Group labels are shared across
every project in the group, so creating one there reaches further than it looks.

## AEP in this tracker

**Draft — this table is the part to correct.** It records what carries each fact
*here*, so no later session has to work it out again.

| Fact | Carried by | Kind |
| --- | --- | --- |
| what the effort is | the merge request; an issue only where one is wanted | native |
| what it will land as | one draft merge request per effort | native |
| which tickets exist, and what gates each | files under `.aep/efforts/<effort>/tickets/` | **not in this tracker** |
| the effort's state | `spec.md`'s `status:`, projected onto a label | projection |

## Referencing a task from a commit

```
Refs #123           references without closing
Closes #123         only where the commit reaches the default branch through
                    its own merge request
```

`[[rules/version-control]]` has the rule and the hazard behind it.

## Merge requests

**Merging is the human's, never an agent's** (`[[rules/version-control]]`, which
also states what the runner may push and open here). `/specify` opens the
effort's draft after asking once; converge marks it ready when the effort is
done. Nothing merges it but a person.

## Failure handling

- `glab` unauthenticated reports the login command. Report it; do not attempt to
  authenticate.
- A flag rejected outright usually means the binary predates it. Report the
  version rather than falling back to a label silently.
- A feature refused on tier grounds is not a bug and not a gap in this file —
  report which tier it needs.
- An operation not listed here is a gap — say so rather than guessing a flag.
