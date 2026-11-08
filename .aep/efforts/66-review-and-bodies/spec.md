---
status: accepted
lane: standard
---

# Problem

Two parts of AEP cost the developer time and tokens.

**Review does not separate kinds of finding.** A reviewer reports a new bug, a
style nit, and a bug that was in the code before the diff in one list. An agent
author then fixes all three in the effort. Scope grows, and the next round finds
more old code. Nothing caps nits. A finding can rest on a guess from a name.
A clean review has no plain way to say so. Round 2 rereads the whole branch.
Nothing tells a reviewer what failure looks like in this repository, or what to
skip. A review with no `spec.md` asks the human for intent, even when a pull
request body states it.

The source of these points is the post "Solving code review at Anthropic". It
reports that 59% of the findings a reviewer kept raising were old code, and that
one pull request ran more than 50 rounds.

**Tracker bodies are hard to read, and every effort needs an issue.**
`[[policies/tracker]]` requires one issue and one pull request per effort. The
issue body is all of `spec.md`, and it is rewritten on every spec change. The
pull request body mirrors `log.md` after every land. Agent detail and human
detail are mixed in both bodies. The shape of the pull request body is stated in
three places, and they disagree:

- `[[policies/tracker]]`, Opening: approach and ticket criteria.
- `[[policies/tracker]]`, Closing: a visual, before and after, merge danger.
- `rules/version-control.md`: problem, solution, architectural impact, testing,
  related issues, breaking changes.

`references/github.md` says "Prepare the body; do not submit it". That
contradicts the rule that the runner opens the draft pull request itself.

`reconcile.mjs` links a pull request to its effort only by
`closingIssuesReferences`. So an effort with no issue cannot be reconciled.

# Goal

A review reports only what the diff caused as blocking, with evidence, and its
later rounds read only what changed. Every tracked effort has one pull request
and an issue only when one is wanted. A person reads the top of each body in
plain words. Agents read and write one collapsed block at the bottom.

# Scope

`src/`: the review skill, both reviewer agents, the execution and tracker
policies, the GitHub and GitLab seed references, new issue and pull request
templates, `reconcile.mjs`, `aep.mjs` open's tracker steps, `specs.md`, and
`verify.mjs`. This repository's own `.aep/rules/review.md`,
`.aep/rules/version-control.md`, and `.aep/references/github.md`. One minor
release per feature, 4.6.0 to 4.15.0.

# Requirements

Review:

1. **R1 Finding tags (4.6.0).** Each finding carries one tag: `Important`,
   `Nit`, or `Pre-existing`. `Pre-existing` means the defect is in code the
   diff did not change. Only `Important` blocks. A `Pre-existing` finding is
   never fixed in this effort. It is recorded in `log.md` `## Recorded`, and
   with a tracker it is proposed as a roadmap issue (R10).
2. **R2 Nit cap (4.7.0).** A reviewer reports at most 3 nits per axis. A nit
   never blocks and never starts a round. It is fixed only in the commit the
   run is already making.
3. **R3 Opened citation (4.8.0).** Every finding cites `path:line`. The reviewer
   opens that line before it reports the finding. A finding without a citation
   is dropped, and the return says how many were dropped.
4. **R4 Clean review (4.9.0).** The review summary starts with the count per
   tag. A review with no findings says "Nothing to fix" and adds nothing more.
5. **R5 Later rounds (4.10.0).** `log.md` `## Rounds` records the commit each
   round reviewed. Round 2 and later read the diff from that commit to the
   current one, plus the findings still open. They never raise again a finding
   already fixed or accepted.
6. **R6 Review rule (4.11.0).** `/review` loads `rules/review.md` where it
   exists. It is optional and repository-owned. A template states its shape:
   what failure looks like per area, and paths to skip. This repository gets
   its own: `.aep/` is installer output, `src/stamps.json` and the adapters are
   generated, and in `src/` failure means a shipped surface disagrees with
   `specs.md`.
7. **R7 Intent from bodies (4.12.0).** Where no `spec.md` answers, `/review`
   step 2 reads the pull request body and its linked issue body, before it asks.
   It reads bodies only, never comment threads.

Tracker:

8. **R8 Body templates (4.13.0).** `templates/pull-request.template.md` and
   `templates/issue.template.md` are the one home of each body shape.
   `[[policies/tracker]]` and the version-control seed point at them. Each body
   has a human part on top in the controlled register, and one collapsed
   `<details>` block titled `AEP` at the bottom, holding `key: value` lines.
   - Pull request, human part: summary, closing or building-on line, why, what
     changed, done when, how it was tested, risk.
   - Issue, human part: what is wrong or wanted, done when, notes.
   - A run writes the human part at opening and at close only. Between them it
     edits only the AEP block.
   - Criteria are ticked in the pull request only. The issue lists them as
     plain bullets.
   - The issue is written once, then edited once more when an effort opens for
     it, to add the effort and pull request lines. It is never resynced with
     `spec.md`.
   - The AEP block links `log.md`. The body never mirrors it.
9. **R9 How to revert (4.14.0).** The pull request's risk section states how to
   undo the change, or that it cannot be undone and why.
10. **R10 Optional issue (4.15.0).** Every tracked effort outside the quick lane
    has one pull request. It has an issue only when:
    - the human names an existing issue, so the effort is numbered for it and
      the pull request closes it; or
    - the work is a roadmap item, which is an issue with no branch until
      `/specify` picks it up and reads its body as input.
    An effort with no issue is numbered for its pull request. A `builds-on:`
    edge to such an effort is written as `Builds on #<n>` in the pull request
    body, and the stack carries it.
11. **R11 Reconcile by block.** `reconcile.mjs` links a pull request to its
    effort by the `effort:` line in its AEP block. It falls back to
    `closingIssuesReferences` for a pull request with no block. The observation
    adds `body` to the pull request list. The GitHub and GitLab references show
    the new invocation.
12. **R12 Contradictions removed.** The pull request body shape is stated only
    in the template. `references/github.md` no longer says the agent never
    opens a pull request. It says the runner opens the draft and marks it
    ready, as `rules/version-control.md` allows.

# Acceptance Criteria

1. AC1: the review skill and both reviewer agents define the three tags and say
   only `Important` blocks. A `verify.mjs` assertion fails when a tag is
   removed.
2. AC2: both reviewer agents state the cap of 3 nits and that a nit starts no
   round. Asserted.
3. AC3: both reviewer agents require `path:line`, opened before reporting, and
   a dropped count in the return. Asserted.
4. AC4: the review skill's report step requires the count per tag first and the
   exact words "Nothing to fix" for a clean review. Asserted.
5. AC5: `aep record` writes the reviewed commit into `## Rounds`. A test shows
   it. The review skill tells round 2 to diff from it. Asserted.
6. AC6: `templates/review.template.md` exists, the review skill loads
   `rules/review.md`, and `.aep/rules/review.md` exists here with the three
   points in R6. Asserted for the template and the skill.
7. AC7: the review skill's step 2 lists the pull request and issue bodies after
   `spec.md` and before asking, and forbids comment threads. Asserted.
8. AC8: both templates exist with the human sections and the `AEP` block.
   `[[policies/tracker]]` names them and states no body shape of its own. It
   states that ticks are in the pull request only, the issue is written once,
   and `log.md` is linked. Asserted.
9. AC9: the pull request template's risk section has a revert line. Asserted.
10. AC10: `[[policies/tracker]]` states the two cases where an issue exists, and
    numbering by the pull request otherwise. `aep open`'s tracker steps no
    longer always say "create the issue". A test shows both cases.
11. AC11: `reconcile.mjs` links by the `effort:` line, and falls back to the
    closing reference. Tests show: a block-only pull request, a keyword-only
    pull request, and a pull request with neither, which is reported against
    no effort.
12. AC12: `node src/scripts/verify.mjs` passes, `aep check` is clean, the
    adapters are current, and `protocol.md` reads 4.15.0. The phrase "Prepare
    the body; do not submit it" appears nowhere under `src/` or `.aep/`.

# Constraints

- **Tokens.** No feature adds a reviewer, a pass, or a sub-agent. The source
  post uses many voting agents. This effort takes only what one agent can do.
  The reason is the developer's plan limits.
- **One release per feature.** The developer asked for it. Each release is cut
  with `release.mjs`, so the baseline moves once per feature.
- **`spec.md` stays canonical.** The tracker bodies are projections. The file
  wins, as `[[policies/tracker]]` already states.
- **Both forges.** GitLab renders `<details>` too. Every tracker change holds for
  `tracker: gitlab`.
- **Shipped text cites only what resolves** in an installed repository
  (`rules/authoring.md`). The source post is named in `specs.md` only.
- **Old pull requests still reconcile.** A body with no AEP block falls back to
  the closing reference.

# Out of Scope

- **Repeated findings fixed at the source.** It is a protocol-wide behaviour,
  and the developer wants it only if it were specific to this repository. It is
  not, so it is dropped.
- Verifier voting, parallel bug hunters, nightly sweeps, an eval set from
  incidents, risk classifiers, human approval tiers, a merge queue, and feature
  flags. Each needs many agents or a team.
- Reading comment threads, review threads, or check logs as intent.
- Migrating the bodies of pull requests and issues already open or merged.
- Making tickets tracker objects. They stay local.

# Assumptions

- **Numbering by the pull request.** Recommended over unnumbered efforts. GitHub
  numbers issues and pull requests in one sequence per repository, so the
  number stays unique there and `builds-on: <n>` keeps working.
  The caller reads the highest issue or pull request number and passes the next
  one to `aep open --number`. Where the pull request then gets another number,
  the existing "rename the effort if it differs" step applies. GitLab numbers
  merge requests and issues apart, so there the pull request number can repeat
  an issue number. Under GitLab the effort is numbered for its merge request,
  and `builds-on:` resolves by directory there.
- **A roadmap issue is an ordinary issue.** It carries no special label. Its
  AEP block is empty until an effort opens for it.
- `<details>` renders collapsed on both forges, and `gh pr list --json body`
  returns the raw body with the block intact.

# Risks

- **Ten releases in one effort** move the baseline ten times. A feature commit
  without its release fails the suite by name, which is the intended guard.
- **A human edits the AEP block** and breaks the `effort:` line. Reconcile then
  falls back to the closing reference, or reports the pull request against no
  effort. That is visible, not silent.
- **Body reads cost tokens.** `reconcile.mjs` reads bodies, but the caller pipes
  them to the script, so the model does not read them.
