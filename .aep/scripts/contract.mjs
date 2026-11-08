// The AEP artifact contract: the values it allows, how an artifact is parsed,
// and how a tree of them is located and walked. Shared by every AEP script.
//
// A deliberately small YAML subset rather than a dependency: AEP artifacts use
// scalars, inline arrays, and block arrays, and nothing else. A parser that
// accepts more than the contract allows would silently pass frontmatter that
// `[[policies/artifacts]]` forbids, which is the opposite of what these scripts are
// for. Anything outside the subset is reported as a parse error, not guessed at.

import fs from 'node:fs';
import path from 'node:path';

/**
 * Frontmatter AEP 3 no longer carries.
 *
 * Rejected on a path the protocol ships and tolerated elsewhere: a repository's
 * own artifacts were written under the old contract and an upgrade never edits
 * them, so failing those would fail a tree for holding what AEP gave it.
 */
export const RETIRED_FIELDS = ['aep', 'date', 'kind', 'mode', 'report', 'owner', 'part-of'];

/**
 * Ownership, as a fact about location.
 *
 * A file under `policies/` is AEP's law and a file under `rules/` is the
 * repository's, and the same holds for every other row: an upgrade replaces what
 * the protocol ships and preserves everything else. Stating it once, here and in
 * the bootstrap, is what lets sixty-nine artifacts stop declaring it.
 *
 * The two root files are named because no directory rule reaches them:
 * `protocol.md` is the protocol's, and `index.md` is derived and regenerated in
 * place.
 */
export const PROTOCOL_DIRS = ['policies', 'skills', 'agents', 'templates', 'scripts'];

/**
 * The repository's own entrypoint, and the only file AEP writes outside `.aep/`
 * that a harness loads by name.
 *
 * Named here because two things need it and neither may guess: the seed that
 * writes it, and every runtime target whose own entrypoint has to point at it.
 * A runtime that reads this file needs no pointer of its own, and one that reads
 * something else gets a pointer whose entire content is a redirect here. Which
 * of the two a runtime is belongs in the target table, stated once.
 */
export const CANONICAL_ENTRYPOINT = 'AGENTS.md';
export const REPOSITORY_DIRS = ['rules', 'contexts', 'references', 'efforts'];

/**
 * Directories that stay local to a working tree and are gitignored. Nothing in
 * them is an artifact, so a walk of the tree skips them, and `.aep/.gitignore`
 * must exclude every one.
 */
export const PER_CLONE_DIRS = ['position', 'scratch', 'worktrees'];
export const PROTOCOL_ROOT_FILES = ['protocol.md'];
export const REPOSITORY_ROOT_FILES = ['index.md', 'friction.md'];

// generated:protocol-files. Run `node src/scripts/manifest.mjs`
export const PROTOCOL_FILES = [
  '.gitignore',
  'agents/implementer.md',
  'agents/researcher.md',
  'agents/reviewer-correctness.md',
  'agents/reviewer-standards.md',
  'policies/artifacts.md',
  'policies/execution.md',
  'policies/execution/parallel.md',
  'policies/reporting.md',
  'policies/tracker.md',
  'protocol.md',
  'scripts/aep.mjs',
  'scripts/check.mjs',
  'scripts/contract.mjs',
  'scripts/frontier.mjs',
  'scripts/index.mjs',
  'scripts/position.mjs',
  'scripts/reconcile.mjs',
  'scripts/scope.mjs',
  'scripts/validate.mjs',
  'skills/domain.md',
  'skills/handoff.md',
  'skills/help.md',
  'skills/implement.md',
  'skills/implement/conflicts.md',
  'skills/implement/diagnosing.md',
  'skills/implement/dispatch.md',
  'skills/install.md',
  'skills/plain.md',
  'skills/plan.md',
  'skills/plan/depth.md',
  'skills/plan/design-it-twice.md',
  'skills/prose.md',
  'skills/prototype.md',
  'skills/prototype/logic.md',
  'skills/prototype/ui.md',
  'skills/prune.md',
  'skills/refine.md',
  'skills/research.md',
  'skills/review.md',
  'skills/review/findings.md',
  'skills/review/smells.md',
  'skills/specify.md',
  'skills/specify/out-of-scope.md',
  'skills/survey.md',
  'skills/survey/report.md',
  'skills/tasks.md',
  'skills/tdd.md',
  'skills/tdd/mocking.md',
  'skills/tdd/tests.md',
  'skills/update.md',
  'skills/update/conversion.md',
  'skills/update/from-2.md',
  'skills/update/migration.md',
  'templates/agent.template.md',
  'templates/agents.template.md',
  'templates/context.template.md',
  'templates/plan.template.md',
  'templates/protocol.template.md',
  'templates/prototype.template.md',
  'templates/reference.template.md',
  'templates/research.template.md',
  'templates/rule.template.md',
  'templates/skill.template.md',
  'templates/spec.template.md',
  'templates/ticket.template.md',
];
// end generated:protocol-files

/**
 * True when a path under `.aep/` is one the protocol ships.
 *
 * The exact list rather than the directory, because the directory answers *this
 * is a protocol area* and this answers *this is the protocol's file*. An
 * installer needs the second before it overwrites anything, and a validator
 * needs the difference between them to name a stray.
 */
export function isProtocolPath(relative) {
  return PROTOCOL_FILES.includes(relative);
}

/**
 * A note the repository wrote beside a skill the release ships.
 *
 * The one file a repository may add inside a protocol directory. A skill's own
 * file is paid for on every invocation, so knowledge that applies only to one
 * branch of a run lives beside it and is reached by a link; that is the shape
 * that keeps *this is how we prototype here* out of a file an upgrade
 * replaces. Ownership is a lookup on the path, so a note the release does not
 * ship is not on the manifest and an upgrade preserves it exactly as it
 * preserves any other file the repository owns.
 *
 * Exactly one level deep, and beside a **shipped** skill. A note is a branch of
 * a skill, so a directory answering to no skill is not one, and nesting deeper
 * would be depth reached from nothing. The skill set itself is fixed: a
 * top-level file here that the manifest does not name is still refused.
 */
export function isRepositoryNote(relative) {
  const parts = relative.split('/');
  return parts.length === 3
    && parts[0] === 'skills'
    && relative.endsWith('.md')
    && isProtocolPath(`skills/${parts[1]}.md`);
}

/** The top-level directory of a path under `.aep/`, or null for a root file. */
export function topDirOf(relative) {
  const parts = relative.split('/');
  return parts.length > 1 ? parts[0] : null;
}

/**
 * The longest a `use-when` may be, in words.
 *
 * Measured rather than chosen. Across the sixty-eight triggers in the corpus the
 * longest legitimate one runs to thirty-seven words, and it earns them by listing
 * the cases it fires on. Forty is that plus headroom, so this catches a paragraph
 * and never a real trigger. A tighter bound picked from taste would have failed
 * artifacts that are correct, which is the more expensive mistake: a check that
 * rejects good work gets switched off.
 */
export const USE_WHEN_MAX_WORDS = 40;

/**
 * The shortest a `use-when` may be, in words.
 *
 * Also measured. The shortest legitimate trigger in the corpus is five words, so
 * four is the floor. It exists because the predicate test over-accepts by design:
 * "policies" ends in `es` and satisfies it, and a one-word noun is a topic no
 * matter what its last two letters are. A clause is not this short.
 */
export const USE_WHEN_MIN_WORDS = 4;

/**
 * A predicate, roughly. Copulas, auxiliaries, and the verbs this corpus uses.
 *
 * The distinction that matters is clause against noun phrase: "a task exists and
 * is ready to build" says when, and "Database documentation" says what about. A
 * clause needs a verb and a topic has none, so verb-presence is the test.
 *
 * Chosen against the corpus rather than from intuition. An earlier version of
 * this check looked for a gerund or a `when`, which is one idiom out of several,
 * and it failed thirty-five of the sixty-eight triggers here, every one of them
 * correct. This list leaves none of them failing.
 */
const PREDICATE = new RegExp(
  '\\b(is|are|was|were|be|being|been|has|have|had|does|do|did|need|needs|exist|exists|' +
  'differ|differs|carry|carries|reach|reaches|turn|turns|will|must|should|may|can|look|' +
  'looks|read|reads|find|finds|get|gets|go|goes|come|comes|stop|stops|live|lives|sit|' +
  'sits|hold|holds|say|says|want|wants|make|makes|take|takes|took|leave|leaves|stand|' +
  'stands|run|runs|ran|fail|fails|passes|become|becomes|becomes)\\b',
  'i',
);

/**
 * An inflected verb, roughly: a word ending in `-ed` or `-es`.
 *
 * The explicit list above is present-tense heavy, which a fixture caught: "a
 * trigger that predates the move" is a clause and the list did not know the
 * word. Rather than chase word forms one at a time, this accepts the two endings
 * that mark an English verb inflection, so `predates`, `vacated`, and `matches`
 * pass without being enumerated.
 *
 * It over-accepts. "advanced features" would satisfy it and is a noun phrase.
 * That direction is the right one to err in: a check that rejects correct work
 * gets switched off, and a check that misses one topic still catches the rest.
 */
const INFLECTED = /\b[a-z]{3,}(ed|es)\b/i;
const OPENS_WITH_GERUND = /^[a-z]+ing\b/i;

/** Lowercased, punctuation-stripped, single-spaced. For comparing two phrasings. */
function normalise(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * What is wrong with a `use-when`, as a list of reasons, empty when it is fine.
 *
 * `use-when` is the whole of applicability-first loading, and it is the one
 * field a machine cannot fully judge: "Database documentation" satisfies every
 * structural check and is a topic rather than a trigger, so an artifact carrying
 * it is loaded always or never. These are proxies. Each catches a real instance
 * of that failure; none of them catches a trigger that is well formed and wrong,
 * which is why the summary still says what it does not check.
 *
 * Four reasons, each firing on something the others do not:
 *
 *   clause     "Database documentation" is a subject with no predicate
 *   heading    a use-when that repeats the artifact's own title is its topic
 *   name       "policies", "engineering": the file saying its own name back
 *   length     past the bound it is a summary wearing a trigger's clothes
 *
 * "Is not a bare noun phrase" is not a fifth test. It is what the first one
 * catches, and stating it separately would report one check as two.
 */
export function useWhenProblems(value, { heading = '', name = '', directory = '' } = {}) {
  if (!isNonEmptyString(value)) return ['is missing'];

  const text = String(value).trim();
  const problems = [];
  const words = text.split(/\s+/);

  const hasPredicate = OPENS_WITH_GERUND.test(text) || PREDICATE.test(text) || INFLECTED.test(text);
  if (!hasPredicate || words.length < USE_WHEN_MIN_WORDS) {
    problems.push(
      'is a topic rather than a trigger. It names a subject and never an occasion, ' +
      'and an artifact that cannot be selected is loaded always or never',
    );
  }
  if (heading && normalise(text) === normalise(heading)) {
    problems.push('restates the artifact\'s own heading, which states its topic rather than its trigger');
  }
  for (const [label, candidate] of [['name', name], ['directory', directory]]) {
    if (candidate && normalise(text) === normalise(candidate)) {
      problems.push(`is the artifact's ${label} said back. That names it rather than saying when to load it`);
    }
  }
  if (words.length > USE_WHEN_MAX_WORDS) {
    problems.push(
      `is ${words.length} words, over ${USE_WHEN_MAX_WORDS}. Past that it summarises the artifact ` +
      'rather than saying when to reach for it',
    );
  }
  return problems;
}

/** Legal `status` values, by what declares them. */
export const SPEC_STATUSES = ['draft', 'accepted', 'implemented'];
export const TICKET_STATUSES = ['open', 'resolved', 'obsolete'];

/**
 * The lanes an effort runs in, lowest first, and what each one runs. A spec
 * declares `lane:`; one without it is `full`, which is how every effort ran
 * before lanes. A lane only goes up.
 *
 *   tickets   whether the work is split into tickets, or the spec is the ticket
 *   children  whether a wave of two or more ready tickets is dispatched
 *   converge  the most converge rounds a run takes
 *   review    the most review rounds, and the reviewers per round
 */
export const LANES = ['quick', 'standard', 'full'];
export const LANE_RULES = {
  quick: { tickets: false, children: false, converge: 0, review: 0, reviewers: 0 },
  standard: { tickets: true, children: false, converge: 1, review: 1, reviewers: 1 },
  full: { tickets: true, children: true, converge: 2, review: 2, reviewers: 2 },
};

/**
 * The status ladder, as rows a script can compute with.
 *
 * `[[policies/execution]]` states this table in prose, one row per state an
 * effort passes through, and a script wanting to answer *what `status:` label
 * should this effort's issue carry* had nothing to read but that prose. The rows
 * are here so it can read a value instead, and the suite asserts the two equal
 * row for row, because a projection written down twice is a projection that
 * drifts.
 *
 * Two inputs, and two outputs:
 *
 *   spec           the `spec.md` `status:` this row projects, and null on a row
 *                  no file reaches
 *   changeRequest  `merged` or `closed`, the observed state that selects a
 *                  terminal row, and null everywhere else
 *   issue          the label the issue carries
 *   pullRequest    the label the change request carries
 *
 * The terminal rows are why the second input is here rather than left to
 * whoever reads this. `spec.md` stops at `implemented`, so `status: done` is
 * reachable from no file at all: it turns on whether a human merged the change
 * request or closed it without merging, and a consumer that has to know that on
 * its own is a consumer that can get it wrong.
 *
 * `accepted` reaches two rows, `ready` and `in progress`, because taking the
 * first ticket moves the label without moving the field. So a spec status
 * projects onto the set of labels it may legitimately show, and a consumer that
 * compares an observation against the first matching row rather than all of them
 * reports a run in flight as drift.
 *
 * `effort` is the policy's own wording of the row, verbatim, which is what lets
 * the equality check catch a reworded row rather than only a deleted one. The
 * policy's fourth column, what moves each label, is deliberately absent: it
 * names who acts, which is something to read rather than something to project,
 * and the policy is where it is checked.
 *
 * Nothing here reads these rows. This file is the contract, and a script's logic
 * living in it is how the contract stops being readable as one.
 */
export const STATUS_LADDER = [
  {
    effort: 'the spec is being drafted',
    spec: 'draft',
    changeRequest: null,
    issue: 'status: backlog',
    pullRequest: 'status: backlog',
  },
  {
    effort: 'the spec is accepted and the tickets are cut',
    spec: 'accepted',
    changeRequest: null,
    issue: 'status: ready',
    pullRequest: 'status: ready',
  },
  {
    effort: 'the runner is working',
    spec: 'accepted',
    changeRequest: null,
    issue: 'status: in progress',
    pullRequest: 'status: in progress',
  },
  {
    effort: 'converge found no gap, and the spec is stamped `implemented`',
    spec: 'implemented',
    changeRequest: null,
    issue: 'status: in review',
    pullRequest: 'status: in review',
  },
  {
    effort: 'merged',
    spec: null,
    changeRequest: 'merged',
    issue: 'status: done',
    pullRequest: 'status: done',
  },
  {
    effort: 'closed without merging',
    spec: null,
    changeRequest: 'closed',
    issue: 'status: done',
    pullRequest: 'status: done',
  },
];

/**
 * Directories that must never exist under `.aep/`.
 *
 * A retired directory is not the same as one this release happens not to ship.
 * The stray-file check names a file standing where the protocol ships and asks a
 * human to move it; this names a directory whose whole concept is gone, where
 * the answer is always the same and there is nothing to decide.
 *
 * `modes/` joins them at 3.0.0: each mode's posture now sits inside the skill
 * that entered it, so a tree keeping the directory is governed by two copies of
 * one text, which is the failure a retirement exists to prevent.
 */
export const FORBIDDEN_DIRS = ['decisions', 'tools', 'grill', 'modes'];

/** The eighteen conforming skills. */
export const SKILLS = [
  'specify',
  'refine',
  'plan',
  'tasks',
  'implement',
  'review',
  'research',
  'prototype',
  'survey',
  'install',
  'update',
  'prune',
  'handoff',
  'help',
  'tdd',
  'domain',
  'prose',
  'plain',
];

/**
 * Files whose `kind` requires a `use-when`, by the directory they live in.
 *
 * `skills` is here for the note a repository may write beside a shipped skill.
 * A note is selected on exactly the terms every other conditionally-loaded
 * artifact is, and until that path was permitted at all the requirement was
 * enforced by refusing it outright. Every shipped skill carries one already, so
 * the directory costs the payload nothing.
 */
export const USE_WHEN_REQUIRED_DIRS = ['policies', 'rules', 'references', 'contexts', 'skills'];

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/**
 * Strips one layer of YAML quoting from a scalar.
 * Unquoted values are returned trimmed, which is what every AEP scalar wants.
 */
function unquote(raw) {
  const value = raw.trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/** Splits an inline `[a, b, c]` array, tolerating an empty one. */
function parseInlineArray(raw) {
  const inner = raw.slice(1, -1).trim();
  if (inner === '') return [];
  return inner.split(',').map(unquote);
}

/**
 * Parses a frontmatter block into a plain object.
 *
 * Returns `{ fields, errors }` rather than throwing: a malformed artifact is a
 * finding to report alongside the others, not a reason to abandon the sweep.
 */
export function parseFrontmatterBlock(block) {
  const fields = Object.create(null);
  const errors = [];
  const lines = block.split(/\r?\n/);

  let pendingKey = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;

    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item) {
      if (!pendingKey) {
        errors.push(`line ${i + 1}: list item with no key above it`);
        continue;
      }
      fields[pendingKey].push(unquote(item[1]));
      continue;
    }

    const pair = /^([A-Za-z][A-Za-z0-9_-]*):(.*)$/.exec(line);
    if (!pair) {
      errors.push(`line ${i + 1}: not a "key: value" pair, ${JSON.stringify(line)}`);
      continue;
    }

    const key = pair[1];
    const rest = pair[2].trim();
    if (rest === '') {
      // A key with nothing after it opens a block array. If no items follow it
      // stays an empty array, which the contract checks reject where the field
      // is required to have content.
      pendingKey = key;
      fields[key] = [];
      continue;
    }

    pendingKey = null;
    fields[key] = rest.startsWith('[') && rest.endsWith(']')
      ? parseInlineArray(rest)
      : unquote(rest);
  }

  return { fields, errors };
}

/**
 * Reads a Markdown file and returns `{ fields, errors, body, hasFrontmatter }`.
 * A file with no leading `---` block is reported rather than treated as empty,
 * because under `.aep/` the absence is itself a contract violation.
 */
export function readArtifact(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    return { fields: {}, errors: [`unreadable: ${error.message}`], body: '', hasFrontmatter: false };
  }

  const match = FRONTMATTER.exec(text);
  if (!match) {
    return { fields: {}, errors: [], body: text, hasFrontmatter: false };
  }

  const { fields, errors } = parseFrontmatterBlock(match[1]);
  return { fields, errors, body: text.slice(match[0].length), hasFrontmatter: true };
}

/**
 * A body with its fenced blocks removed, and nothing else touched.
 *
 * Fenced content is being *shown*, in a template or in an example, so a check
 * reading a body for claims about the tree reads it through this first.
 *
 * Inline code spans are deliberately NOT stripped, even though they also hold
 * examples occasionally. The convention throughout the payload is to wrap real
 * links in backticks so they render as monospace, so stripping inline code
 * silently excused almost every link in the corpus from being checked, a
 * checker that passes by not looking. Generic placeholders are written without
 * bracket syntax instead, which costs a word and keeps the check honest. A
 * caller wanting spans gone too is asking for that trade a second time, from a
 * call site where none of it is visible.
 *
 * The opening and closing fences may be indented, which is not decoration: this
 * corpus puts most of its examples inside numbered list items, where the fence
 * is indented to the item's content. Anchored at column zero the strip skipped
 * every one of them, so a path or a field name being *shown* was read as one
 * being written. A tilde fence and four backticks wrapping three are still read
 * as prose, and neither appears in the corpus.
 */
export function outsideFences(body) {
  return body.replace(/^[ 	]*```[\s\S]*?^[ 	]*```/gm, '');
}

/**
 * Every `[[wiki-link]]` target in a body, in order of appearance.
 *
 * Read outside fences: a link inside one is the syntax being *shown* rather
 * than a reference to a file that must exist. A target is a path, so a
 * bracketed literal carrying quotes, commas, or brackets -- a nested array in a
 * criterion such as `toCsv([["a","b"]])` -- is data, not a link.
 */
export function wikiLinks(body) {
  const prose = outsideFences(body);
  const links = [];
  const pattern = /\[\[([^\]|#"',[]+?)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
  let match;
  while ((match = pattern.exec(prose)) !== null) {
    links.push(match[1].trim());
  }
  return links;
}

/** Recursively lists files under `dir`, as absolute paths, sorted. */
export function walk(dir, { skip = [] } = {}) {
  const found = [];
  const visit = (current) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (skip.includes(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) found.push(full);
    }
  };
  visit(dir);
  return found;
}

/**
 * The `.md` files directly inside `dir`, sorted, as absolute paths.
 *
 * `skills/` is the reason this exists: a skill is a top-level file, and
 * `skills/<skill>/<note>.md` is depth reached from it. Every caller that means
 * "the skills" rather than "every file under skills/" uses this, so a note can
 * never be counted as, listed as, or wrapped as a skill.
 */
export function topLevel(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

/** A repo-relative path with forward slashes, so output is identical on every platform. */
export function toPosix(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

/** True when `value` is a non-empty string. */
export function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/** True when `value` is `YYYY-MM-DD`, and a real calendar date. */
export function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Locates the `.aep/` directory these scripts should act on.
 *
 * Resolution order, so the same script works from both places it legitimately
 * runs: an explicit argument, alone where one is given; otherwise the installed
 * position, where the script itself sits at `.aep/scripts/`, then `<cwd>/.aep`.
 * Returns null when there is none, which callers report rather than treating as
 * an empty tree, since "no AEP here" and "AEP here with nothing in it" are
 * different answers.
 */
export function resolveAepRoot(explicit, scriptUrl) {
  // An explicit root is an instruction rather than a hint, so a wrong one ends
  // here. Falling through to the other candidates meant a script pointed at a
  // directory that is not an AEP tree answered about whichever tree it happened
  // to sit in, which reads as an answer about the one that was asked for.
  if (explicit) {
    const named = path.resolve(explicit);
    return fs.existsSync(path.join(named, 'protocol.md')) ? named : null;
  }

  const candidates = [];
  if (scriptUrl) {
    const scriptDir = path.dirname(new URL(scriptUrl).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    if (path.basename(scriptDir) === 'scripts') candidates.push(path.dirname(scriptDir));
  }
  candidates.push(path.join(process.cwd(), '.aep'));

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'protocol.md'))) return candidate;
  }
  return null;
}
