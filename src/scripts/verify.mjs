// Asserts the shipped public surfaces against specs.md.
//
// AEP ships as Markdown and JavaScript, so there is no compiler to catch a
// broken build. This is the substitute, and its scope is deliberate: it checks
// what the protocol *distributes*, everything under `src/` plus the plugin
// manifest that points at it, against the specification that defines them. It
// does not audit this repository's own installed `.aep/`; that tree is an
// installation, checked by `validate.mjs` exactly as any other repository's is.
//
// Every mechanically checkable requirement in specs.md gets an assertion here,
// named after the section that demands it. A requirement that cannot be checked
// mechanically, whether a `use-when` states a trigger rather than a topic or
// whether a mode really gives something up, is reported as unchecked at the
// end rather than quietly omitted.
//
// Where this file has to match an em dash a shipped surface legitimately carries,
// it is written as `\u2014`: the shipped scripts are scanned flat for the
// character, and a literal here would be indistinguishable from a stray one.
//
//   node src/scripts/verify.mjs [--section <name>] [--verbose]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  SKILLS,
  FORBIDDEN_DIRS,
  RETIRED_FIELDS,
  PROTOCOL_DIRS,
  PROTOCOL_FILES,
  PROTOCOL_ROOT_FILES,
  REPOSITORY_ROOT_FILES,
  LANES,
  LANE_RULES,
  SPEC_STATUSES,
  STATUS_LADDER,
  isProtocolPath,
  useWhenProblems,
  USE_WHEN_MAX_WORDS,
  USE_WHEN_MIN_WORDS,
  isIsoDate,
  isNonEmptyString,
  outsideFences,
  readArtifact,
  toPosix,
  topLevel,
  walk,
  wikiLinks,
} from './contract.mjs';
import { render as renderManifest, shippedPaths } from './manifest.mjs';
import { renderAdapter, STAGE_SKILLS, TARGETS } from './adapters.mjs';
import { contentHash, readStamps, shippedArtifacts } from './release.mjs';
import {
  BUILD_ONLY_SCRIPTS,
  GITIGNORE_SOURCE,
  MOVES,
  NOTICES,
  PAYLOAD_DIRS,
  STAMPS_SOURCE,
  PAYLOAD_FILES,
  PAYLOAD_SCRIPTS,
  REPOSITORY_DIRS,
  SEEDS,
  LABEL_SEED,
  RETIRED_DIRS,
  CANONICAL_ENTRYPOINT,
} from './payload.mjs';
import { expectedFor } from './reconcile.mjs';
import { RUNTIMES } from './aep.mjs';
import { BUDGETS, HOT_PATH, budgetOf, countWords, runChecks } from './check.mjs';

/** `src/`, the distribution. */
const SRC = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** The reference each runtime `aep.mjs` detects points at, seeded in every repository. */
const RUNTIME_REFERENCES = RUNTIMES.map((runtime) => `references/${runtime.reference}.md`);

// Every fixture the suite makes goes through the temp API, and the boundary
// says such a directory is removed before the run ends. Recorded as each is
// made and removed on exit, so a fixture whose own cleanup was skipped by a
// failing assertion is not left behind either.
const madeTemp = [];
const mkdtempSync = fs.mkdtempSync.bind(fs);
fs.mkdtempSync = (...args) => {
  const dir = mkdtempSync(...args);
  madeTemp.push(dir);
  return dir;
};
process.on('exit', () => {
  for (const dir of madeTemp) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // A directory a child process still holds is reported by the leak check
      // on the next run rather than failing this one at exit.
    }
  }
});
/** The repository that builds it. */
const REPO = path.dirname(SRC);

const PROTOCOL_BUDGET_BYTES = 10240;

/**
 * The em dash, as an escape.
 *
 * The scan in the `governed text` section looks for this character across the
 * shipped scripts, so a literal here would be the first thing it found.
 */
const EM_DASH = '\u2014';

/**
 * The documentation this repository writes for a human, and the documentation
 * it writes for the agent building the protocol.
 *
 * Pinned rather than derived from a glob over the root. A glob would sweep the
 * second list into the first the moment either grew, and the exemption is the
 * half that cannot defend itself: an over-broad sweep reads as thoroughness.
 *
 * The exempt list is named for the one thing it exempts, the prohibitions the
 * reporting policy fixes for prose. Under a general name it read as a general
 * pass: the entrypoint inherited an exemption written about how a sentence may
 * be punctuated and was thereby excused from every claim it made about the
 * implementation, which is how it came to describe a frontmatter field two
 * releases after that field was retired. A boolean on one constant would leave
 * the same confusion available, so the scope is in the name.
 */
const GOVERNED_DOCS = ['README.md', 'CHANGELOG.md'];
const EXEMPT_FROM_PROSE_RULES = ['specs.md', 'AGENTS.md'];

/**
 * The release the upgrade fixture pretends to be coming from.
 *
 * It is a literal on purpose and must stay behind the release being built: it
 * names a tree that predates the declared moves, which is the only kind of tree
 * those moves apply to. Bumping it with the release would quietly turn the
 * upgrade fixture into a no-op that still reads as a pass.
 */
const PRE_MOVE_RELEASE = '2.1.1';

// The commit that removed the moved rules, so `^` holds the protocol's own text
// for each. Pinned rather than searched: this repository squash-merges, so the
// commit is permanent, and a search that found the wrong one would build a
// fixture that silently tests nothing.
const PRE_MOVE_COMMIT = '8752757^';
// The 3.5.0 release, the last to ship policies/authority.md and engineering.md.
const RELEASE_350_COMMIT = 'd1635d2';
// The 4.0.0 release, whose prose catalogue 4.1 narrows the reach of and keeps.
const RELEASE_400_COMMIT = '87adbd0';

const args = process.argv.slice(2);
const only = args.includes('--section') ? args[args.indexOf('--section') + 1] : null;
const verbose = args.includes('--verbose');

const failures = [];
let passes = 0;
let current = '';

function section(name, body) {
  if (only && only !== name) return;
  current = name;
  process.stdout.write(`\n${name}\n`);
  try {
    body();
  } catch (error) {
    failures.push(`[${name}] section aborted: ${error.message}`);
    process.stdout.write(`  ABORT ${error.message}\n`);
  }
}

function assert(because, condition, { silent = false } = {}) {
  let ok = false;
  let detail = '';
  try {
    ok = Boolean(typeof condition === 'function' ? condition() : condition);
  } catch (error) {
    ok = false;
    detail = error.message;
  }
  if (ok) {
    passes += 1;
    if (verbose && !silent) process.stdout.write(`  PASS  ${because}\n`);
  } else {
    failures.push(`[${current}] ${because}${detail ? `: ${detail}` : ''}`);
    // `silent` exists for the self-test below, whose assertion is *meant* to
    // fail. Printing it would put the word FAIL in the output of a passing run,
    // which is the one thing a reader scans for.
    if (!silent) process.stdout.write(`  FAIL  ${because}${detail ? `: ${detail}` : ''}\n`);
  }
}

const readSrc = (...parts) => fs.readFileSync(path.join(SRC, ...parts), 'utf8');

/**
 * Prose with line wrapping and blockquote markers flattened.
 *
 * A guard should pin the meaning, not where a line happened to break: a phrase
 * that a reflow would split makes the suite fail on a change that altered
 * nothing, which teaches the next author to weaken the guard.
 *
 * Declared up here with the other helpers rather than beside its first caller.
 * Section bodies run as they are declared, so a helper defined below a section
 * that uses it is a temporal-dead-zone abort, and an aborted section skips
 * every assertion after the throw, which reads as a smaller failure than it is.
 */
const flat = (text) => text.replace(/^\s*>\s?/gm, '').replace(/\s+/g, ' ');
const inSrc = (...parts) => fs.existsSync(path.join(SRC, ...parts));

/**
 * The body of one `## ` section of a document, up to the next `## `.
 *
 * Scoping an assertion to a section is what separates "this file says it
 * somewhere" from "this step says it". A phrase that drifts out of the step it
 * governs and into a paragraph three sections away still satisfies a whole-file
 * match, and it no longer governs anything.
 */
const headingBlock = (text, heading) => {
  const start = text.indexOf(`## ${heading}`);
  if (start < 0) return '';
  const rest = text.slice(start);
  const end = rest.slice(1).search(/^##\s/m);
  return end < 0 ? rest : rest.slice(0, end + 1);
};
const listMarkdown = (dir) =>
  inSrc(dir) ? walk(path.join(SRC, dir)).filter((f) => f.endsWith('.md')) : [];

/** Every Markdown artifact the release installs as protocol-owned. */
function payloadArtifacts() {
  const files = PAYLOAD_FILES.map((file) => path.join(SRC, file));
  for (const dir of PAYLOAD_DIRS) files.push(...listMarkdown(dir));
  return files;
}

/**
 * The nine directories AEP owns, protocol-side and repository-side.
 *
 * Not the whole tree, which also holds `position/`, `worktrees/`, and two root
 * files. These nine are the ones a path can name an artifact inside, so §9.1
 * governs how a path starting with one of them is written down.
 */
const TREE_DIRS = [...PROTOCOL_DIRS, ...REPOSITORY_DIRS];

/**
 * A tree path written without its root: a tree directory, a slash, and a second
 * segment behind it.
 *
 * Two exclusions carry the whole rule. The lookbehind is what makes
 * `.aep/efforts/<effort>/spec.md` invisible here, since that `efforts` sits
 * behind a slash and the path already says where it starts from.
 *
 * The second is what a segment may begin with, and it is narrower than *any
 * character* for a reason found in review: a glob is not a segment. `scripts/*`
 * names an area, the way `scripts/` does, and §9.1 leaves an area name bare
 * because nobody writes a file to one. Matching a name character keeps the two
 * together and keeps trailing punctuation out of the reported path.
 */
const BARE_TREE_PATH = new RegExp(`(?<![\\w./-])(?:${TREE_DIRS.join('|')})/[\\w<][^\\s\`]*`, 'g');

/**
 * What a line's own number rides on, through a strip that would lose it.
 *
 * A NUL, because no Markdown holds one, so nothing in the corpus collides with
 * it. Written as an escape because a literal one makes this a binary file to
 * grep, which answers `Binary file matches` and prints nothing.
 */
const LINE_TAG = '\u0000';

/**
 * Every line of a body outside a fenced block, still knowing where it sat.
 *
 * `outsideFences` hands back prose with the blocks gone, and with them the
 * correspondence between what survived and the line it came from. A failure
 * nobody can locate is one nobody can act on, so the number rides through the
 * strip on the line itself. Fence detection is untouched: the tag lands where
 * an info string would, which is content the fence regex never reads.
 */
function numberedProse(body) {
  const tagged = body.split('\n').map((line, i) => `${line}${LINE_TAG}${i + 1}`);
  return outsideFences(tagged.join('\n'))
    .split('\n')
    .filter((line) => line.includes(LINE_TAG))
    .map((line) => {
      const cut = line.lastIndexOf(LINE_TAG);
      return { text: line.slice(0, cut), line: Number(line.slice(cut + 1)) };
    });
}

/**
 * Every site in a body where a path names an artifact without saying where it
 * starts from.
 *
 * Read inside inline code spans only. The convention is about paths written as
 * paths, and this corpus writes those in backticks; a sentence that happens to
 * mention efforts and tickets is not an instruction anybody resolves. Wiki
 * links come out first, because they are the other convention entirely: already
 * resolved against `.aep/`, already checked by `links`, and a relationship
 * rather than a place anybody writes to.
 */
function barePathSites(body) {
  const sites = [];
  for (const { text, line } of numberedProse(body)) {
    for (const span of text.match(/`[^`\n]+`/g) ?? []) {
      const written = span.slice(1, -1).replace(/\[\[[^\]]*\]\]/g, '');
      for (const found of written.match(BARE_TREE_PATH) ?? []) sites.push({ line, path: found });
    }
  }
  return sites;
}

/**
 * Where one sentence ends and the next begins.
 *
 * A terminator, optional closing markup, whitespace, then something that opens
 * a sentence. Requiring the opener is what keeps `3.0.0` and `validate.mjs`
 * from splitting mid-token, since neither has whitespace after its dots.
 *
 * A digit opens a sentence here as readily as a capital does, because this
 * corpus starts them with `1.x`, `2.x` and a release number. Left out of the
 * class, such a sentence merged into the one above it, and since `1.x` is
 * itself a retirement marker the merge licensed whatever its neighbour said.
 */
const SENTENCE_BREAK = /(?<=[.!?][)"'`*_\]]*)\s+(?=[A-Z0-9*_`"([])/;

/**
 * A line that starts a block of its own rather than continuing the one above.
 *
 * A bullet, a numbered item, a table row, a heading, a quote. Each is a record
 * rather than a clause, and running them together is how a scope meant to be a
 * sentence quietly becomes a section: one bullet saying a field was removed
 * would license a live claim three bullets below it, which is the looseness
 * the sentence scope was chosen over.
 */
const BLOCK_START = /^\s*(?:[-*+]\s|\d+\.\s|\||#{1,6}\s|>)/;

/**
 * Every sentence of a body outside a fenced block, flattened onto one line.
 *
 * The unit is the sentence because that is where a claim's tense lives. A
 * retired field is named legitimately in "the `aep:` field was retired in
 * 3.0.0" and illegitimately in "`aep:` is the release an artifact last changed
 * in", and the two are the same token in the same position: only the words
 * around it separate them. Widening to the paragraph or the section lets an
 * unrelated mention of retirement excuse every live claim beside it.
 *
 * A blank line ends a sentence whether or not it was punctuated, and so does
 * the start of any block: a table row, a bullet, a heading. Otherwise a table
 * with no blank lines in it arrives as one sentence, and the marker in its
 * last row licenses every claim in the rows above.
 */
function proseSentences(body) {
  const out = [];
  let buffer = '';
  const flush = () => {
    for (const part of buffer.split(SENTENCE_BREAK)) {
      if (part.trim() !== '') out.push(part.trim());
    }
    buffer = '';
  };
  for (const { text } of numberedProse(body)) {
    if (text.trim() === '' || BLOCK_START.test(text)) flush();
    if (text.trim() === '') continue;
    buffer += (buffer === '' ? '' : ' ') + text.trim();
  }
  flush();
  return out;
}

/**
 * A retired frontmatter field, named as a field.
 *
 * The colon is what separates the field from the English word, and what
 * follows the colon is what separates it from a namespace: the shipped GitHub
 * reference writes `aep:effort/x` to show a tracker label nobody should create,
 * which is `aep:` in backticks outside a fence and is not this field at all.
 */
const RETIRED_FIELD = new RegExp(`(?<![\\w-])(?:${RETIRED_FIELDS.join('|')}):(?![\\w-])`, 'g');

/**
 * What makes a sentence a description of something gone.
 *
 * Deliberately short. Every word here is a licence to name a retired field, so
 * a wide vocabulary is a wide hole. `no longer` and `stopped` were in it and
 * are not: both are ordinary English about degree, so "a skill's `mode:` is no
 * longer optional" bought a licence while describing the field as live.
 *
 * **What this catches is a claim written with no retirement language at all**,
 * which is the failure that occurred: an entrypoint went on describing `aep:`
 * as the release an artifact last changed in. A claim worded to include one of
 * these words passes, and no vocabulary fixes that, because the words are about
 * the sentence rather than about the field. The bound is stated here so nobody
 * reads the check as stronger than it is.
 */
const RETIREMENT_SAID = /retire|removed|removal|used to|1\.x|2\.x/i;

/**
 * Files where a retired field may be named without its own sentence saying so,
 * and the reason each one is here.
 *
 * Named for what it grants rather than for what it holds, which is the lesson
 * `EXEMPT_FROM_PROSE_RULES` above was renamed to carry.
 *
 * **Both describe a tree where the field is live.** An upgrade reads a 1.x or
 * 2.x tree, where `owner:` and the rest are present and load-bearing, and says
 * what each becomes. A rule about a field being gone cannot be applied sentence
 * by sentence to prose whose subject is the tree it is still in. The first
 * version of this comment said their hits were table cells; both hold prose
 * hits as well, so that reason was untrue of the files it excused.
 *
 * `AGENTS.md` is deliberately absent. It is the file that failed, and the
 * sentence scope exists so the entrypoint is checked rather than excused.
 */
const EXEMPT_FROM_RETIREMENT_SCAN = {
  'src/skills/update.md': 'the upgrade skill, which reads a 2.x tree where owner: is still live',
  'src/skills/update/migration.md': 'the 1.x migration, converting trees that still carry them',
  'src/skills/update/from-2.md': 'the 2.x note, which names each retired field it drops from a 2.x tree',
};

/**
 * Every sentence in a body that names a retired field without saying it is
 * retired.
 *
 * Reported as the sentence rather than as a line, because a sentence is what
 * the rule is about and it routinely spans two of them. It is also its own
 * locator: a grep for the quoted text lands on it.
 */
function retiredFieldSites(body) {
  const sites = [];
  // Frontmatter comes off first. It is where a field *lives* rather than
  // where one is described, so a hit there is a different defect with its own
  // check: `validate.mjs` fails a protocol path carrying a retired field, and
  // the `frontmatter` section asserts it. The adapters are why it matters:
  // their wrappers carry a runtime key that merely shares the name.
  const prose = body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  for (const sentence of proseSentences(prose)) {
    if (RETIREMENT_SAID.test(sentence)) continue;
    const found = [...new Set(sentence.match(RETIRED_FIELD) ?? [])];
    for (const field of found) sites.push({ field, sentence });
  }
  return sites;
}

/**
 * Every backticked token in a body that names a path.
 *
 * A path is a token ending in a slash or in an extension this repository ships.
 * That is deliberately mechanical: the net costs nothing to maintain and
 * catches the whole class of *the entrypoint names a file that moved*, which no
 * hand-written assertion generalises to. Merely holding a slash was the first
 * test and it admitted `WHAT/WHY`, which is a pair of words.
 *
 * A span holding whitespace is prose rather than a path, so a flag shown with
 * its argument, or a label written `type: bug`, is not a token here, and
 * `use-when` is a field name with neither a slash nor an extension. No flag is
 * spelled out anywhere in this file: the suite is invoked by the entrypoint it
 * checks, so a flag named here would satisfy a search of the scripts the
 * entrypoint runs, and the guard would pass on its own text.
 */
function pathTokens(body) {
  const found = [];
  for (const { text } of numberedProse(body)) {
    for (const span of text.match(/`[^`\n]+`/g) ?? []) {
      const token = span.slice(1, -1).replace(/[.,;:]+$/, '');
      if (!/^[\w@.\/-]+$/.test(token)) continue;
      if (!token.endsWith('/') && !/\.(?:md|mjs|json)$/.test(token)) continue;
      found.push(token);
    }
  }
  return [...new Set(found)];
}

/**
 * Every flag a body documents, paired with the command it is documented under.
 *
 * The nearest `node <script>` line above it, and a heading ends the
 * association, so a flag under one command is never attributed to another.
 * Pooling the flags against every script the entrypoint invokes was the first
 * shape and it failed open: this suite is one of those scripts and it names
 * what it checks, so a flag it mentions anywhere satisfied a search of the
 * pool.
 *
 * A flag with no command above it is reported against `null` rather than
 * dropped. Dropped, a flag documented before the first command was one the
 * check could never fail on, and nothing said so.
 */
function documentedFlags(body) {
  const pairs = [];
  let script = null;
  for (const line of body.split('\n')) {
    if (/^#{1,6}\s/.test(line)) script = null;
    const invoked = /^\s*node\s+(\S+)/.exec(line);
    if (invoked !== null) {
      script = invoked[1];
      continue;
    }
    for (const span of line.match(/`[^`\n]+`/g) ?? []) {
      for (const flag of span.match(/--[a-z][\w-]*/g) ?? []) pairs.push({ script, flag });
    }
  }
  return pairs;
}

/**
 * Every script a fenced command in a body invokes.
 *
 * Read inside the fences rather than outside them, which is the opposite of
 * every other scan here and is the point: a command is shown in a block, and a
 * command naming a script that no longer exists is the failure this catches.
 */
function fencedScripts(body) {
  const scripts = [];
  for (const block of body.match(/^[ 	]*```[\s\S]*?^[ 	]*```/gm) ?? []) {
    for (const line of block.split('\n')) {
      const invoked = /^\s*node\s+(\S+)/.exec(line);
      if (invoked !== null) scripts.push(invoked[1]);
    }
  }
  return [...new Set(scripts)];
}

/**
 * Every surface a release puts in somebody else's repository, plus this
 * repository's own entrypoint.
 *
 * One definition, because two checks now sweep it and a third would otherwise
 * take a third copy. Ticket 01 of this effort extracted `outsideFences` from
 * `wikiLinks` on exactly that reasoning, and the corpus is the same kind of
 * fact. Returned as named arms so each caller can assert its own is non-empty:
 * a clean run is also what an arm scanning nothing produces.
 *
 * The adapters are here because they are generated from the payload, and left
 * out they would hold whatever the last regeneration wrote until somebody
 * looked. What is deliberately absent is `src/scripts/`, and each caller states
 * why for itself, because the reasons differ.
 */
function shippedSurfaces() {
  return {
    payload: payloadArtifacts(),
    seeds: listMarkdown('seed'),
    adapters: listMarkdown('adapters'),
    entrypoint: [path.join(REPO, CANONICAL_ENTRYPOINT)],
  };
}

/**
 * The entrypoints whose claims are checked, and what each one is.
 *
 * Two, and they are different in kind. This repository's own is checked for
 * everything below; the seeded one is handed over on install and is checked
 * only for the paths it names, because every claim past that belongs to a
 * repository AEP will never see again.
 */
const ENTRYPOINTS = {
  [CANONICAL_ENTRYPOINT]: path.join(REPO, CANONICAL_ENTRYPOINT),
  'src/seed/AGENTS.md': path.join(SRC, 'seed', CANONICAL_ENTRYPOINT),
};

const specText = fs.readFileSync(path.join(REPO, 'specs.md'), 'utf8');
const specVersion = /^\*\*Version:\*\*\s*(\S+)/m.exec(specText)?.[1] ?? null;

/** A release, as three numbers, or null if the string is not one. */
const release = (value) => {
  const parsed = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value ?? ''));
  return parsed ? parsed.slice(1, 4).map(Number) : null;
};

/** Whether `a` precedes `b`, the installer's notice and move gate, mirrored. */
const precedesRelease = (a, b) => {
  const left = release(a);
  const right = release(b);
  if (!left || !right) return false;
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] < right[i];
  }
  return false;
};

/**
 * Whether `value` is a real release no later than the one being built.
 *
 * `aep:` is the release an artifact's content last changed in, so most shipped
 * artifacts legitimately declare an *older* release than this one, which is the
 * field carrying information rather than repeating `protocol.md`. What is never
 * legitimate is a stamp ahead of the release being built, which names a release
 * that does not exist yet.
 *
 * Whether the stamp is *correct* is not this check's job: `stamps` compares
 * content against the manifest, which is what catches an edit that never got
 * restamped.
 */
const atOrBeforeRelease = (value) => {
  const parsed = release(value);
  if (parsed === null || release(specVersion) === null) return false;
  return !precedesRelease(specVersion, value);
};

// --- the install fixture ----------------------------------------------------
// Declared before any section, because two of them use it and a section body
// runs the moment it is declared.

let fixtureCache = null;

/** Installs into a temporary repository once, and reuses it across sections. */
function installFixture() {
  if (fixtureCache) return fixtureCache;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-fixture-'));
  execFileSync('git', ['init', '--quiet'], { cwd: dir, stdio: 'ignore' });
  execFileSync(process.execPath, [path.join(SRC, 'scripts', 'install.mjs'), '--into', dir], {
    stdio: 'ignore',
  });
  const aep = path.join(dir, '.aep');
  execFileSync(process.execPath, [path.join(aep, 'scripts', 'index.mjs'), '--root', aep], {
    stdio: 'ignore',
  });

  fixtureCache = { dir, aep };
  return fixtureCache;
}

// --- §31 the manifest is complete ------------------------------------------

section('manifest', () => {
  assert('specs.md declares a version', isNonEmptyString(specVersion));

  // A move whose `was` is missing or wrong puts the installer back to deleting a
  // file it cannot identify, and nothing else would notice: the removal branch
  // simply stops firing and the tree quietly keeps two copies of one text.
  assert('every move carries the hash of the text it replaced', () => {
    const missing = MOVES.filter((move) => !move.was).map((move) => move.from);
    if (missing.length > 0) throw new Error(`no was: ${missing.join(', ')}`);
    return true;
  });

  assert('each was matches the protocol text at the commit that moved it', () => {
    for (const move of MOVES) {
      const name = path.basename(move.from);
      // 2.2.0 moved rules/ into policies/; 4.0.0 moved two policies into the
      // bootstrap, and 3.5.0 is the text a tree upgrading to it carries.
      const at = move.since === '4.0.0' ? `${RELEASE_350_COMMIT}:src/${move.from}` : `${PRE_MOVE_COMMIT}:src/rules/${name}`;
      const text = execFileSync('git', ['show', at], { encoding: 'utf8', cwd: REPO });
      if (contentHash(text) !== move.was) {
        throw new Error(`${move.from}: was does not match the text at ${PRE_MOVE_COMMIT}`);
      }
    }
    return true;
  });

  // The failure that started this: install.mjs read three fields the payload is
  // removing, and every one of them failed silently. Two returned undefined and
  // changed a branch; the third made a tree look like it declared no release, so
  // every move and notice replayed on every upgrade.
  assert('install.mjs reads no frontmatter field the payload is removing', () => {
    const text = fs.readFileSync(path.join(SRC, 'scripts', 'install.mjs'), 'utf8');
    const found = ['owner', 'aep', 'date', 'kind', 'mode', 'report']
      .filter((field) => new RegExp(String.raw`fields\.${field}\b`).test(text));
    if (found.length > 0) throw new Error(`still reads: ${found.join(', ')}`);
    return true;
  });

  // Ownership is a fact about location, and the exact list is what tells a
  // shipped file from a stray standing beside it. It is generated, so the only
  // way it can be wrong is by being stale, and stale is what this catches.
  assert('the protocol-files manifest matches the payload. Run scripts/manifest.mjs', () => {
    const contract = path.join(SRC, 'scripts', 'contract.mjs');
    const current = fs.readFileSync(contract, 'utf8');
    if (renderManifest(current, shippedPaths(SRC)) !== current) {
      throw new Error('scripts/contract.mjs names a different set of paths than the payload ships');
    }
    return true;
  });

  // Every path in it must exist, which a stale-check alone does not prove: a
  // generator run against a tree missing a file writes a manifest that agrees
  // with itself and names nothing.
  assert('every path the manifest names exists in the distribution', () => {
    const missing = PROTOCOL_FILES
      .filter((rel) => rel !== '.gitignore')
      .filter((rel) => !fs.existsSync(path.join(SRC, ...rel.split('/'))));
    if (missing.length > 0) throw new Error(missing.join(', '));
    return true;
  });

  // The specification and the payload cannot disagree about which primitives
  // exist, so the one that was added last is read back out of the table rather
  // than assumed to have been written there.
  assert('specs.md lists Policies among the primitives', () =>
    /\|\s*\*\*Policies\*\*\s*\|/.test(specText));

  // The specification and the generator cannot disagree about how many
  // runtimes there are. Each claim below is one the implementation now relies
  // on, so a specification that loses it leaves a shipped surface conforming to
  // nothing written down.
  assert('specs.md defines a target as a declaration, not a renderer per runtime', () =>
    /###\s*28\.1\s+Targets and shapes/.test(specText) &&
    /a \*\*target\*\* is a declaration rather than a program/.test(specText));

  assert('specs.md requires a prefix where a runtime would shadow a skill', () =>
    /MUST where the runtime's own built-in commands would otherwise shadow a skill/.test(specText));

  assert('specs.md says a rendered tree is committed only where it has a reader', () =>
    /committed to the protocol repository exactly when that directory is itself what a user registers/
      .test(specText));

  assert('specs.md requires a distribution reach to be derived from where the wrapper sits', () =>
    /MUST be \*\*derived from where the wrapper sits\*\*, never written out/.test(specText));

  assert('specs.md requires every path a wrapper names to exist in an installed tree', () =>
    /Every path a wrapper names MUST exist in an installed tree/.test(specText));

  assert('specs.md omits AEP fields where a runtime reserves no map for them', () =>
    /omitted rather than smuggled in/.test(specText));

  assert('specs.md asserts the adapters over every target and shape', () =>
    /\*\*for every target and every shape it renders\*\*, and not for one runtime/.test(specText));

  assert('specs.md requires the install to refuse an unknown runtime before writing', () =>
    /refuses an unknown runtime \*\*before writing anything\*\*/.test(specText) &&
    /warns where two requested targets are read by one runtime/.test(specText));

  assert('the distribution layout shows one directory per committed target', () =>
    /adapters\/<runtime>\/\s+runtime adapters, one directory per committed target/.test(specText));

  const scriptFiles = fs
    .readdirSync(path.join(SRC, 'scripts'))
    .filter((name) => name.endsWith('.mjs'))
    .sort();
  const declared = [...PAYLOAD_SCRIPTS, ...BUILD_ONLY_SCRIPTS].sort();
  assert('every script is declared either payload or build-only', () =>
    JSON.stringify(scriptFiles) === JSON.stringify(declared));
  if (JSON.stringify(scriptFiles) !== JSON.stringify(declared)) {
    process.stdout.write(`        on disk:   ${scriptFiles.join(', ')}\n`);
    process.stdout.write(`        declared:  ${declared.join(', ')}\n`);
  }

  assert('no script is both payload and build-only', () =>
    PAYLOAD_SCRIPTS.every((name) => !BUILD_ONLY_SCRIPTS.includes(name)));

  for (const file of PAYLOAD_FILES) assert(`payload file ${file} exists`, inSrc(file));
  for (const dir of PAYLOAD_DIRS) assert(`payload directory ${dir}/ exists`, inSrc(dir));
  assert(`the .aep/.gitignore source (${GITIGNORE_SOURCE}) ships`, inSrc(GITIGNORE_SOURCE));

  assert('scripts are .mjs, so a consuming package.json cannot change how they parse', () =>
    fs.readdirSync(path.join(SRC, 'scripts')).every((name) => name.endsWith('.mjs')));

  // Every shipped .mjs, not only the ones under scripts/. The adapter's hook is
  // just as much a thing a user runs, and a dependency there fails at the worst
  // possible moment, on somebody else's machine at session start.
  assert('no shipped script declares a third-party dependency', () => {
    for (const file of walk(SRC).filter((f) => f.endsWith('.mjs'))) {
      const text = fs.readFileSync(file, 'utf8');
      const imports = [...text.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
      for (const target of imports) {
        if (!target.startsWith('node:') && !target.startsWith('./') && !target.startsWith('../')) {
          throw new Error(`${toPosix(SRC, file)} imports "${target}"`);
        }
      }
    }
    return true;
  });

  assert('the distribution needs no package manifest to run', () =>
    !fs.existsSync(path.join(REPO, 'package.json')));

  // A move is only meaningful in both directions: the destination has to be
  // something this release ships, and the source has to be something it no
  // longer does. An entry failing either is a rename nobody finished.
  for (const move of MOVES) {
    assert(`MOVES: ${move.to} is shipped`, inSrc(...move.to.split('/')));
    assert(`MOVES: ${move.from} is no longer shipped`, !inSrc(...move.from.split('/')));
    assert(`MOVES: ${move.from} declares the release that moved it`,
      Boolean(release(move.since)));
  }

  // A payload directory at the repository root is a real hazard: a second
  // `skills/`, `agents/`, or `policies/` there reads as canonical and drifts
  // from the one that ships. Nothing needs to sit there, since the plugin is
  // published from the adapter's own directory, so the runtime's scans land
  // inside `src/`.
  assert('every shipped surface lives under src/', () => {
    const stray = ['skills', 'agents', 'policies', 'scripts', 'templates', 'protocol.md']
      .filter((name) => fs.existsSync(path.join(REPO, name)));
    if (stray.length > 0) throw new Error(`at the repository root: ${stray.join(', ')}`);
    return true;
  });
});

// --- §8 the stamps are current ----------------------------------------------
// The check the old sweep could not perform. When every artifact was restamped
// every release regardless of whether it moved, an artifact edited without being
// restamped was indistinguishable from one that had not been touched. Comparing
// content against the committed baseline is what makes the field mean something.

section('stamps', () => {
  const stamps = readStamps();
  const shipped = shippedArtifacts();

  assert('the release baseline exists. Run scripts/release.mjs to create it', () =>
    Object.keys(stamps).length > 0);

  for (const file of payloadArtifacts()) {
    const rel = toPosix(SRC, file);
    const hash = contentHash(fs.readFileSync(file, 'utf8'));
    assert(`${rel} is stamped for its current content. Run scripts/release.mjs <version>`, () => {
      if (!(rel in stamps)) throw new Error('not in the baseline: it has never been released');
      if (stamps[rel] !== hash) throw new Error('content changed since it was last stamped');
      return true;
    });
  }

  // An entry for a file that is gone means the baseline outlived what it
  // described, and a later release would compare against nothing.
  assert('the baseline names nothing the distribution no longer ships', () => {
    const live = new Set(shipped.map((file) => toPosix(SRC, file)));
    const orphans = Object.keys(stamps).filter((rel) => !live.has(rel));
    if (orphans.length > 0) throw new Error(orphans.join(', '));
    return true;
  });

  assert('the baseline is build-time only and never ships', () =>
    !PAYLOAD_FILES.includes(STAMPS_SOURCE) &&
    !fs.existsSync(path.join(installFixture().aep, STAMPS_SOURCE)));

  // The two computed lines are excluded from the hash on purpose: stamping a
  // file must not change what it hashes to, or a release would never converge
  // and every run would restamp everything again.
  assert('stamping an artifact does not change its own hash', () => {
    const sample = fs.readFileSync(path.join(SRC, 'protocol.md'), 'utf8');
    const restamped = sample
      .replace(/^aep:.*$/m, 'aep: 9.9.9')
      .replace(/^date:.*$/m, 'date: 1999-01-01');
    if (contentHash(sample) !== contentHash(restamped)) {
      throw new Error('the hash covers the stamp, so a release would never settle');
    }
    return true;
  });
});

// --- §8 the frontmatter contract -------------------------------------------

section('frontmatter', () => {
  for (const file of payloadArtifacts()) {
    const rel = toPosix(SRC, file);
    const artifact = readArtifact(file);

    assert(`${rel} has frontmatter`, artifact.hasFrontmatter);
    if (!artifact.hasFrontmatter) continue;

    assert(`${rel} frontmatter parses`, artifact.errors.length === 0);

    if (artifact.fields.mode !== undefined) {
      }
    assert(`${rel} declares no status (payload artifacts are not specs or tickets)`,
      artifact.fields.status === undefined);
  }

  // `use-when` is the whole of applicability-first loading, so every shipped
  // trigger is put through the same checks a consuming repository's will be.
  for (const file of payloadArtifacts()) {
    const rel = toPosix(SRC, file);
    const artifact = readArtifact(file);
    if (artifact.fields['use-when'] === undefined) continue;
    assert(`${rel} use-when reads as a trigger`, () => {
      const heading = (artifact.body.match(/^#\s+(.+)$/m) ?? [])[1] ?? '';
      const problems = useWhenProblems(artifact.fields['use-when'], {
        heading,
        name: path.basename(rel, '.md'),
        directory: rel.split('/')[0],
      });
      if (problems.length > 0) throw new Error(problems.join('; '));
      return true;
    });
  }

  // The two cases the specification names, pinned by name. A checker that
  // accepts the topic or rejects the trigger has stopped doing its job, and
  // neither shows up as a failure anywhere else.
  assert('use-when rejects a topic: "Database documentation"', () =>
    useWhenProblems('Database documentation', {}).length > 0);
  assert('use-when accepts a trigger: "changing anything under src/"', () =>
    useWhenProblems('changing anything under src/', {}).length === 0);
  assert('use-when rejects a one-word noun that ends like a verb', () =>
    useWhenProblems('policies', {}).length > 0);
  assert('use-when rejects one that restates its own heading', () =>
    useWhenProblems('the effort is in progress', { heading: 'The effort is in progress' }).length > 0);
  assert('use-when accepts the same words when they are not the heading', () =>
    useWhenProblems('the effort is in progress', {}).length === 0);

  // The bounds came from the corpus rather than from taste, so they are asserted
  // against it: a bound tightened past the longest real trigger fails good work.
  assert('the use-when bounds admit every trigger the payload ships', () => {
    const lengths = payloadArtifacts()
      .map((file) => readArtifact(file).fields['use-when'])
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim().split(/\s+/).length);
    const longest = Math.max(...lengths);
    const shortest = Math.min(...lengths);
    if (longest > USE_WHEN_MAX_WORDS) throw new Error(`longest is ${longest}, over the bound`);
    if (shortest < USE_WHEN_MIN_WORDS) throw new Error(`shortest is ${shortest}, under the floor`);
    return true;
  });

  // The release no longer writes itself into every artifact. The bootstrap is
  // the one file that names it, so the pass that stamped the rest is gone.
  assert('release.mjs stamps no artifact but the bootstrap', () => {
    const text = fs.readFileSync(path.join(SRC, 'scripts', 'release.mjs'), 'utf8');
    if (/setField\(text, 'aep', version\)/.test(text)) {
      throw new Error('the per-artifact stamping pass is still there');
    }
    return true;
  });

});

// --- §6 the bootstrap -------------------------------------------------------

section('protocol.md', () => {
  assert('protocol.md exists', inSrc('protocol.md'));
  const size = fs.statSync(path.join(SRC, 'protocol.md')).size;
  assert(`protocol.md is within the ${PROTOCOL_BUDGET_BYTES}-byte budget (is ${size})`,
    size <= PROTOCOL_BUDGET_BYTES);

  const artifact = readArtifact(path.join(SRC, 'protocol.md'));

  // Asserted separately from the blanket stamp above, because this one carries
  // more weight: protocol.md is what an installed tree declares its release
  // *as*. `index.mjs` reads the version from here, and `update` decides whether
  // a repository is behind by comparing it, so a stale stamp here makes a
  // current installation report itself as an old one.

  const body = artifact.body;
  for (const heading of [
    'The primitives',
    'Discovery',
    'The workflow',
    'The invariants',
    'Governance that loads when it applies',
  ]) {
    assert(`protocol.md answers "${heading}"`, body.includes(`## ${heading}`));
  }

  assert('protocol.md routes to both governance layers', () =>
    /\[\[policies\/\w/.test(body) && /`?\[\[rules/.test(body));
  assert('protocol.md does not become a second governance layer', () =>
    !/^##\s+(Rules|Policies)\s*$/m.test(body));

  /** The body of one `## ` section, to the next one. */
  const sectionOf = (heading) => {
    const start = body.indexOf(`## ${heading}`);
    if (start < 0) return '';
    const rest = body.slice(start);
    const end = rest.slice(1).search(/^##\s/m);
    return end < 0 ? rest : rest.slice(0, end + 1);
  };

  // 4.0: the link and path conventions are stated together in
  // policies/artifacts, which loads whenever anything under .aep/ is written
  // (asserted in the policies section). The bootstrap keeps the half every
  // reader needs: an unresolved link is repaired or reported, never invented.
  assert('the bootstrap keeps the rule for a link that does not resolve', () => {
    const discovery = flat(sectionOf('Discovery'));
    if (!/does\s+not resolve is repaired or reported, \*\*never invented\*\*/.test(discovery)) {
      throw new Error('the unresolved-link rule is no longer in Discovery');
    }
    if (!/\[\[policies\/artifacts\]\]/.test(body)) throw new Error('nothing points at where the conventions live');
    return true;
  });

  // Seven primitives, counted off the table rather than matched as prose. A
  // regex for the seven names passes while an eighth row sits beside them,
  // which is exactly how a cut grows back.
  const PRIMITIVES = ['Policies', 'Rules', 'References', 'Contexts', 'Efforts', 'Agents', 'Skills'];
  assert('the primitives table has exactly seven rows, and they are the seven', () => {
    const rows = [...sectionOf('The primitives').matchAll(/^\|\s*\*\*(\w+)\*\*\s*\|/gm)]
      .map((match) => match[1]);
    if (rows.length !== PRIMITIVES.length || rows.some((row, i) => row !== PRIMITIVES[i])) {
      throw new Error(`${rows.length} rows: ${rows.join(', ')}`);
    }
    return true;
  });

  // P2-13, one vocabulary: the README's model names the same seven, in order,
  // and no eighth. Read off the fenced block under its heading.
  assert('the README model lists exactly the seven primitives', () => {
    const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8').replace(/\r/g, '');
    const block = /## The model[\s\S]*?```\n([\s\S]*?)```/.exec(readme)?.[1] ?? '';
    const names = block.split('\n').filter(Boolean).map((line) => line.split(/\s+/)[0]);
    const expected = PRIMITIVES.map((name) => name.toLowerCase());
    if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error(names.join(', '));
    return true;
  });

  // The four that were cut are described where they are used, not deleted. A
  // reader who never hears of evidence again has lost a primitive rather than
  // a table row.
  for (const [cut, where] of [
    ['evidence', 'The primitives'],
    ['tickets', 'The primitives'],
    ['Worktrees', 'The primitives'],
    ['position marker', 'The primitives'],
  ]) {
    assert(`${cut} survives the cut as prose rather than a row`, () => {
      const section = sectionOf(where);
      if (!section.includes(cut)) throw new Error(`${cut} is named nowhere under ${where}`);
      return !new RegExp(`^\\|\\s*\\*\\*${cut}\\*\\*`, 'im').test(section);
    });
  }

  // Ownership is stated once, here, for every directory the lookup knows. A
  // directory the code classifies and the bootstrap never mentions is a reader
  // who has to guess, which is the situation `owner:` was removed to end.
  // Read from the ownership invariant alone, up to the next invariant, and split
  // at "Yours" so each directory is read on the side that claims it.
  const invariants = sectionOf('The invariants');
  const ownStart = invariants.indexOf('**Ownership is where a file sits.**');
  const ownEnd = ownStart < 0 ? -1 : invariants.slice(ownStart + 1).search(/\n\*\*[^*\n]+\.\*\* /);
  const ownership = ownStart < 0 ? ''
    : invariants.slice(ownStart, ownEnd < 0 ? undefined : ownStart + 1 + ownEnd);
  const yoursAt = ownership.indexOf('Yours');
  const protocolSide = yoursAt < 0 ? '' : ownership.slice(0, yoursAt);
  const repositorySide = yoursAt < 0 ? '' : ownership.slice(yoursAt);
  assert('the bootstrap states ownership as a fact about location', () =>
    /\*\*Ownership is where a file sits\.\*\*/.test(ownership));
  for (const dir of PROTOCOL_DIRS) {
    assert(`the ownership invariant names ${dir}/ as the protocol's`, () =>
      protocolSide.includes(`\`${dir}/\``));
  }
  for (const dir of REPOSITORY_DIRS) {
    assert(`the ownership invariant names ${dir}/ as the repository's`, () =>
      repositorySide.includes(`\`${dir}/\``));
  }
  // Named individually, because no directory rule reaches a file at the root.
  for (const file of PROTOCOL_ROOT_FILES) {
    assert(`the ownership invariant names ${file} as the protocol's`, () =>
      protocolSide.includes(`\`${file}\``));
  }
  for (const file of REPOSITORY_ROOT_FILES) {
    assert(`the ownership invariant names ${file} individually`, () =>
      repositorySide.includes(`\`${file}\``));
  }

  // And the other direction, which the loop above cannot see: a directory the
  // table claims and the lookup has never heard of. A retired directory left in
  // this table outlives the release that retired it, and the bootstrap is the
  // one file every session reads first.
  assert('the ownership table claims no directory the lookup does not classify', () => {
    const classified = [...PROTOCOL_DIRS, ...REPOSITORY_DIRS];
    const claimed = [...ownership.matchAll(/`(\w+)\/`/g)].map((match) => match[1]);
    const unknown = [...new Set(claimed)].filter((dir) => !classified.includes(dir));
    if (unknown.length > 0) throw new Error(`claims ${unknown.join(', ')}`);
    return true;
  });

  assert('the bootstrap no longer claims ownership is declared per file', () =>
    !/owner:\s*(protocol|repository)/.test(body));

  // Four commands, and the stages named as stages. A reader who types /review
  // has been told wrong by the bootstrap, which is the file they were told to
  // read first.
  const workflow = sectionOf('The workflow');
  assert('the workflow names exactly the four invocable commands', () => {
    const line = (workflow.match(/^\/specify.*$/m) ?? [])[0] ?? '';
    if (!line) throw new Error('no workflow line at all');
    const commands = [...line.matchAll(/\/(\w+)/g)].map((match) => match[1]);
    const expected = ['specify', 'plan', 'tasks', 'implement'];
    if (JSON.stringify(commands) !== JSON.stringify(expected)) {
      throw new Error(`the line reads ${commands.join(' → ')}`);
    }
    return true;
  });
  assert('the capability sentence names what became a stage', () =>
    /are stages those\s+four run/.test(workflow) &&
    ['refine', 'research', 'review', 'converge'].every((stage) => workflow.includes(`\`${stage}\``)));

  // The single release of record. Asserted over the payload rather than over
  // `src/`, because what a repository ends up carrying is what matters.
  assert('protocol.md carries version:, and it is a release', () =>
    /^\d+\.\d+\.\d+$/.test(String(artifact.fields.version ?? '')));
  assert('protocol.md is the only shipped file naming a release', () => {
    const offenders = shippedArtifacts()
      .filter((file) => path.basename(file) !== 'protocol.md')
      .filter((file) => {
        const { fields } = readArtifact(file);
        return fields.version !== undefined || fields.aep !== undefined;
      })
      .map((file) => toPosix(SRC, file));
    if (offenders.length > 0) throw new Error(`also named by: ${offenders.join(', ')}`);
    return true;
  });
});

// --- §15 the skill set ------------------------------------------------------

// The skills that entered a mode, and so carry a posture now that `modes/` is
// gone. Written here rather than in `contract.mjs`: nothing an installed tree
// runs needs to know which skills hold a posture, and an export no consumer
// reads is the shape this release spent four tickets removing.
const POSTURED_SKILLS = [
  'specify', 'plan', 'tasks', 'implement', 'review',
  'research', 'prototype', 'refine', 'tdd', 'prune', 'survey', 'plain',
];

section('skills', () => {
  // Top-level only: `skills/<skill>/<note>.md` is depth, not a skill (§15.1).
  const onDisk = topLevel(path.join(SRC, 'skills')).map((f) => path.basename(f, '.md')).sort();
  assert('the skill set is exactly the specs.md names', () =>
    JSON.stringify(onDisk) === JSON.stringify([...SKILLS].sort()));
  if (JSON.stringify(onDisk) !== JSON.stringify([...SKILLS].sort())) {
    process.stdout.write(`        on disk: ${onDisk.join(', ')}\n`);
    process.stdout.write(`        spec:    ${[...SKILLS].sort().join(', ')}\n`);
  }

  for (const name of SKILLS) {
    const file = path.join(SRC, 'skills', `${name}.md`);
    if (!fs.existsSync(file)) {
      assert(`skills/${name}.md exists`, false);
      continue;
    }
    const artifact = readArtifact(file);
    assert(`skills/${name} declares use-when`, isNonEmptyString(artifact.fields['use-when']));
  }

  // What the retired `modes/` directory used to hold. A mode stated a mindset
  // and what that mindset gave up, and the second half is the one a fold loses:
  // it is the uncomfortable half, and a skill that keeps only the first reads
  // like advice rather than like a trade. So both are asserted by name, and
  // only of the skills that entered a mode. A utility never had a posture and
  // gains nothing by being made to claim one.
  for (const name of POSTURED_SKILLS) {
    const file = path.join(SRC, 'skills', `${name}.md`);
    if (!fs.existsSync(file)) continue;
    const body = fs.readFileSync(file, 'utf8');
    assert(`skills/${name} states its posture`, () => /\*\*Posture\.\*\*/.test(body));
    assert(`skills/${name} states what that posture gives up`, () =>
      /\*\*What this gives up\*\*/.test(body));
  }

  // 4.1: plain is the controlled register's craft. The policy holds every MUST,
  // so the skill is checked for the worked items the spec names and for the
  // absence of each policy sentence: a copy here is the second home that drifts.
  const plain = fs.existsSync(path.join(SRC, 'skills', 'plain.md')) ? readSrc('skills', 'plain.md') : '';
  // Whitespace folded by hand: this section declares its own `flat` further down.
  const plainText = plain.replace(/\s+/g, ' ');
  const reportingPolicy = readSrc('policies', 'reporting.md').replace(/\s+/g, ' ');
  assert('the reporting policy sends the controlled register\'s craft to skills/plain', () =>
    /Its craft is in `\[\[skills\/plain\]\]`/.test(reportingPolicy));
  assert('skills/plain links to the reporting policy for its law', () =>
    /The law is `\[\[policies\/reporting\]\]`'s/.test(plainText));
  assert('skills/plain triggers on the controlled register\'s texts, a commit and a pull request among them', () => {
    const trigger = readArtifact(path.join(SRC, 'skills', 'plain.md')).fields['use-when'] ?? '';
    return ['session text', 'a commit message', 'a pull request', 'a brief', 'a return', 'an effort artifact',
      'a sketch', 'an option set'].every((item) => trigger.includes(item));
  });
  assert('skills/plain is a stage inside another skill, and reports when invoked', () =>
    /\*\*a stage of that turn\*\*, with no report of its own; invoked on a text, it reports like any other/.test(plainText));
  assert('skills/plain names ASD-STE100 as its source', () =>
    /based on ASD-STE100/.test(plainText) && /AEP ships none of it: no rule text and no word list/.test(plainText));
  // The content itself, not the sentence that disclaims it: a word list is many
  // swaps, so the count of worked swaps stays at what one example needs.
  const swaps = [...plainText.matchAll(/\*[^*]+\* becomes \*[^*]+\*/g)].length;
  assert('skills/plain ships no word list: at most five worked swaps', () => {
    if (swaps === 0 || swaps > 5) throw new Error(`${swaps} swaps`);
    return true;
  });
  assert('skills/plain carries a swap that loses nothing', () =>
    /\*\*A swap that loses nothing\.\*\* \*Prior to\* becomes \*before\*/.test(plainText));
  assert('skills/plain carries a word kept because no approved word carries it', () =>
    /\*\*A word kept because no approved word carries it\.\*\*/.test(plainText) && /So \*stale\* stays/.test(plainText));
  assert('skills/plain carries a technical name kept exactly', () =>
    /\*\*A technical name, kept exactly\.\*\*/.test(plainText) && /\*Claim\* and \*surface\* are AEP terms/.test(plainText));
  const plainFences = [...plain.matchAll(/```\n([\s\S]*?)```/g)].map((match) => match[1]);
  assert('skills/plain carries a sketch drawn with box-drawing characters', () =>
    plainFences.some((block) => /[╭╮╰╯]/.test(block) && /[─│]/.test(block) && /▶/.test(block)));
  assert('skills/plain carries an option set in its picker form and its lettered form', () =>
    /\*\*In a picker\.\*\*/.test(plainText) && /\*\*As text:\*\*/.test(plainText) &&
    plainFences.some((block) => /^a\. /m.test(block) && /^b\. /m.test(block)));
  assert('skills/plain carries a worked brief and a worked return', () =>
    /\*\*A brief:\*\*/.test(plainText) && /\*\*A return:\*\*/.test(plainText));
  // Outside the fences, which are examples. A policy sentence copied here, a
  // limit of its own, or an ordering rule is the skill governing; the phrases
  // are the policy's, and the shapes are the paraphrases a review found.
  const plainProse = plain.replace(/```[\s\S]*?```/g, '').replace(/\s+/g, ' ');
  assert('skills/plain restates no MUST from the reporting policy', () => {
    const copied = [
      'The reader picks the register', 'never drops a core principle', 'never counted against adherence',
      'option picker where there is one', 'are the same either way', 'A larger structure is split',
      'within a few hundred tokens', 'hold in both registers a human reads', 'An ASD-STE100 approved word first',
    ].filter((sentence) => plainProse.includes(sentence));
    if (/\bMUST\b/.test(plainProse)) copied.push('MUST');
    const limit = /\b(?:about |at most )?(?:\d+|ten|twenty|thirty) (?:words|lines|tokens)\b/i.exec(plainProse);
    if (limit) copied.push(limit[0]);
    const order = /\b(?:comes first|same order|only when the swap)\b/i.exec(plainProse);
    if (order) copied.push(order[0]);
    if (copied.length > 0) throw new Error(copied.join('; '));
    return true;
  });

  // The discovery surface. `protocol.md` gives `help` one job, answering *what do
  // I reach for*, so a skill it does not name is unreachable through the only
  // artifact whose purpose is reaching them. Derived from `SKILLS`, never from a
  // second hand-written list: that list is the same failure one level up, and
  // nothing would catch it drifting either. `help` is excluded from its own
  // table because a reader already holding it does not need telling where it is.
  const helpSkill = readSrc('skills', 'help.md');
  const unrouted = SKILLS
    .filter((name) => name !== 'help')
    .filter((name) => !helpSkill.includes(`[[skills/${name}]]`));
  assert('skills/help routes to every shipped skill but itself', () => unrouted.length === 0);
  if (unrouted.length > 0) {
    process.stdout.write(`        not reachable from help: ${unrouted.join(', ')}\n`);
  }

  assert('skills/plan forbids restating the spec', () =>
    /never restates the spec/i.test(readSrc('skills', 'plan.md')));

  // Four workflow commands and the utilities. Asserted against a real render
  // rather than against the list that drives it, which would only prove the list
  // equals itself.
  const publishedSkills = () => new Set(
    renderAdapter(SRC, TARGETS.claude, TARGETS.claude.committed)
      .filter((file) => file.kind === 'skill')
      .map((file) => file.name),
  );
  assert('the adapter publishes the four workflow commands', () => {
    const published = publishedSkills();
    const missing = ['specify', 'plan', 'tasks', 'implement']
      .filter((name) => !published.has(name));
    if (missing.length > 0) throw new Error(`not published: ${missing.join(', ')}`);
    return true;
  });
  // Pinned by name, never derived from `STAGE_SKILLS`. Asking the exclusion list
  // whether the things on it were excluded is a check that cannot fail: drop a
  // name and both sides move together, which is how this assertion passed the
  // first time it was perturbed.
  const NEVER_A_COMMAND = ['refine', 'research', 'review'];
  assert('the adapter publishes none of the three skills that became stages', () => {
    const published = publishedSkills();
    const leaked = NEVER_A_COMMAND.filter((name) => published.has(name));
    if (leaked.length > 0) throw new Error(`published as commands: ${leaked.join(', ')}`);
    return true;
  });
  assert('the mechanism that excludes them names exactly those three', () =>
    JSON.stringify([...STAGE_SKILLS].sort()) === JSON.stringify([...NEVER_A_COMMAND].sort()));
  assert('each of the three still ships as a file to be read', () => {
    const absent = NEVER_A_COMMAND
      .filter((name) => !fs.existsSync(path.join(SRC, 'skills', `${name}.md`)));
    if (absent.length > 0) {
      throw new Error(`removed rather than unregistered: ${absent.join(', ')}`);
    }
    return true;
  });

  const reviewSkill = readSrc('skills', 'review.md');
  assert('skills/review runs two independent axes', /Two axes, judged \*\*independently\*\*/.test(reviewSkill));
  assert('skills/review names both reviewer agents', () =>
    reviewSkill.includes('agents/reviewer-correctness') &&
    reviewSkill.includes('agents/reviewer-standards'));
  assert('skills/review requires an outcome per finding', /outcome/i.test(reviewSkill));

  // The two files this release removed, pinned by name. A suite that asserts
  // only what exists cannot tell a deliberate deletion from a file somebody
  // restored out of habit.
  assert('skills/commit.md is gone, its mechanics inline in the runner', () =>
    !fs.existsSync(path.join(SRC, 'skills', 'commit.md')));
  assert('skills/tasks/labels.md is gone with its ladder', () =>
    !fs.existsSync(path.join(SRC, 'skills', 'tasks', 'labels.md')));

  // Landing is the part of /implement that used to be a command. In 4.0 the
  // command line does its git, so what landing guarantees is asserted where it
  // now lives: the runner's step, and `aep land` itself.
  const runner = readSrc('skills', 'implement.md');
  const runnerFlat = runner.split(/\s+/).join(' ');
  const cliSource = readSrc('scripts', 'aep.mjs');
  const policyFlat = readSrc('policies', 'execution.md').split(/\s+/).join(' ');
  const parallelFlat = readSrc('policies', 'execution', 'parallel.md').split(/\s+/).join(' ');
  assert('the runner lands the work through aep land, with nothing for a human to type', () =>
    /aep\.mjs land <effort> <ticket> --message/.test(runnerFlat));
  assert('the bootstrap forbids pushing and publishing unasked', () =>
    /Never push, publish, or open a pull request unasked/.test(readSrc('protocol.md').split(/\s+/).join(' ')));
  assert('aep land stamps the marker after the commit exists', () => {
    const body = cliSource.slice(cliSource.indexOf('function land('), cliSource.indexOf('function close('));
    const commit = body.lastIndexOf('commitAll(here, message)');
    const stamp = body.lastIndexOf('stampMarker(');
    return commit > 0 && stamp > commit;
  });
  assert('aep land regenerates the index as part of landing', () =>
    /writeIndex\(aepIn\(here, where\)\)/.test(cliSource));
  assert('the runner detects the message convention rather than asserting one', () =>
    /git log\s+--oneline -30/.test(runner));
  assert('the runner reads the conflict note where landing hits one', () =>
    runner.includes('skills/implement/conflicts'));

  // The loop: start, build, start again, until next is not build.
  assert('a named effort is the whole effort, a named ticket that one alone', () =>
    /Named a ticket: build that one, and the run ends there\. Named an effort, or nothing: the whole effort/.test(runnerFlat));
  assert('tickets running out does not end the run', () =>
    /Tickets running out is not the spec met/.test(policyFlat));
  assert('the runner schedules from the computed frontier rather than its own graph', () =>
    /For each ticket in `frontier`/.test(runnerFlat) && /frontier\(tickets, \[\]\)/.test(cliSource));
  assert('an empty frontier with work left means building what blocks it', () =>
    /`blocked` means the blocking ticket is what to build/.test(runnerFlat));
  assert('the runner starts again until next is not build, then converges', () =>
    /Then `start` again, until `next` is not `build`/.test(runnerFlat));

  // Wave-based integration: where a child branches from, and who merges.
  assert('a wave branches from the effort branch tip and the next from the new tip', () =>
    /from the effort branch's current tip/.test(parallelFlat) && /The next wave branches from the new tip/.test(parallelFlat));
  assert('aep dispatch creates every surface under the main checkout', () =>
    /git\(where\.main, \['worktree', 'add', '--quiet', '-b', branch, at, tip\]\)/.test(cliSource));
  assert('the orchestrator integrates each child as it returns, one at a time', () =>
    /integrate \*\*each child as it returns, one at a time\*\*/.test(parallelFlat));
  assert('a conflict is named against the ticket whose integration raised it', () =>
    /a conflict then surfaces at that ticket and is named against it/.test(parallelFlat));
  assert('the orchestrator is the only integrator', () =>
    /\*\*The orchestrator is the only integrator, in the surface it holds\.\*\*/.test(parallelFlat));

  // `resolved` is a claim and the ticks are its evidence; the gate sits where
  // the status is written, which is aep land.
  assert('the policy gates resolved on every criterion being ticked', () =>
    /\*\*Every criterion ticked, or the ticket is not resolved\.\*\*/.test(policyFlat));
  assert('the gate names the two ways out, and neither is ticking it', () =>
    /parks the ticket with what blocked it, or marks it `obsolete` with a reason; it is never ticked to get past/.test(policyFlat));
  assert('aep land enforces the gate, so it is not advice', () =>
    /criteria of \$\{stem\} are not ticked/.test(cliSource));

  // One commit per ticket, including the ticket with nothing to commit.
  assert('each ticket lands as one commit with no exception for an empty diff', () =>
    /one commit per ticket; where the ticket only verified something, an empty one/.test(runnerFlat));
  assert('a ticket with no diff lands an empty commit carrying what was checked', () =>
    /an empty one whose message carries what was checked and what it printed/.test(runnerFlat));

  assert('no rule parks a ticket after two review rejections, anywhere shipped', () => {
    const parking = /rejects twice parks the ticket|parked after two rejections|Two fix attempts/;
    const holding = walk(SRC)
      .filter((file) => file.endsWith('.md') && parking.test(fs.readFileSync(file, 'utf8')))
      .map((file) => toPosix(SRC, file));
    if (holding.length > 0) throw new Error(`the parking rule survives in ${holding.join(', ')}`);
    return true;
  });

  const flatten = (text) => text.split(/\s+/).join(' ');
  const trackerFlat = flatten(readSrc('policies', 'tracker.md'));
  assert('an open Important finding blocks the pull request being marked ready', () =>
    /mark the pull request ready \u2014 only with every Important finding closed/.test(trackerFlat));
  assert('a finding is closed by a fix, a ticket, or the human accepting it, never asked mid-run', () =>
    /An Important finding is fixed, ticketed, or left in `## Needs you` for the human to accept, never asked mid-run/.test(policyFlat));
  assert('a review that passed after its fix still does not stop the run', () =>
    /including a review that passed after its fix, goes in `log\.md`/.test(policyFlat));

  // Review runs once, after converge, over the effort branch -- never per ticket.
  const runnerStep = (number) => {
    const start = runner.search(new RegExp(`^## ${number} `, 'm'));
    if (start < 0) throw new Error(`the runner has no step ${number}`);
    const rest = runner.slice(start);
    const end = rest.slice(1).search(/^## /m);
    return end < 0 ? rest : rest.slice(0, end + 1);
  };
  const building = runnerStep(2);
  const reviewing = runnerStep(4);
  assert('the runner names review after converge finds no gap', () =>
    /once converge found no gap/.test(flatten(reviewing)) && reviewing.includes('[[skills/review]]'));
  assert('the runner runs no review in the per-ticket build sequence', () => {
    if (building.includes('[[skills/review]]')) throw new Error('review is still named in the build step');
    return true;
  });
  assert('review stays a stage of the turn where it now runs', () =>
    /as a stage of this turn/.test(flatten(reviewing)));
  assert('a validated finding is fixed or ticketed, bounded by the lane', () =>
    /Validate each finding, then fix it, ticket it, or record it with `--needs-you` for the human to accept \u2014 never stop to ask/.test(flatten(reviewing))
    && /up to the lane's cap/.test(flatten(reviewing))
    && /at most \$\{cap\} \$\{kind\} round/.test(cliSource));
  assert('ticketing a finding needs no human, and accepting one does', () =>
    /for the human to accept/.test(policyFlat) && /Ticketed/.test(reviewSkill) && /Accepted/.test(reviewSkill));

  assert("review resolves to the effort's spec before anything else", () => {
    const step = /^## 2 [\s\S]*?(?=^## )/m.exec(reviewSkill);
    if (!step) throw new Error('skills/review has no step 2');
    const first = /The first that answers: ([^;]+);/.exec(flatten(step[0]));
    if (!first) throw new Error('step 2 lists nothing to resolve the requirements against');
    if (!/effort's `spec\.md`/.test(first[1])) throw new Error(`step 2 leads with: ${first[1]}`);
    if (/the task the caller is holding/.test(step[0])) {
      throw new Error('step 2 still offers the task the caller is holding');
    }
    return true;
  });
  assert('review says an effort-level subject is the ordinary case', () =>
    /An effort-level review \(`\[\[skills\/implement\]\]`'s close\) is the ordinary case/
      .test(flatten(reviewSkill)));
  // The lane sets the reviewers: one in standard, covering both axes as two
  // separate passes, and two in parallel in full.
  assert('review sets its reviewers by lane, and the axes stay independent', () => {
    const text = flatten(reviewSkill);
    if (!/\| standard, or a review outside an effort \| one `\[\[agents\/reviewer-correctness\]\]`/.test(text)) {
      throw new Error('no single reviewer for standard');
    }
    if (!/\| full \| `\[\[agents\/reviewer-correctness\]\]` and `\[\[agents\/reviewer-standards\]\]`, in parallel/.test(text)) {
      throw new Error('no pair for full');
    }
    if (!/An axis never sees the other's findings/.test(text)) throw new Error('independence is gone');
    return /run the `\[\[agents\/reviewer-standards\]\]` pass after its own/.test(text)
      && /run `\[\[agents\/reviewer-standards\]\]`'s\s+pass as a separate one/.test(flatten(readSrc('agents', 'reviewer-correctness.md')));
  });

  // The trip-wire set lives in the policy now; the runner links it.
  assert('the run says there is no fourth trip-wire', () => /Exactly three; no fourth/.test(policyFlat));
  assert('the three trip-wires are the plan, the public contract, and the contradiction', () =>
    /evidence invalidates the technical plan/.test(policyFlat) &&
    // 4.0: "alters an existing" contract, so an addition the spec asks for (the
    // standard lane's API addition) is not a stop, and a removal still is.
    /the work alters an existing public contract, or touches data at rest/.test(policyFlat) &&
    /a task contradicts `spec\.md`/.test(policyFlat));
  assert('the runner stops only on the three trip-wires, and links them', () =>
    /## Stop only for The three trip-wires \(`\[\[policies\/execution\]\]`\)/.test(runnerFlat));
  assert('a trip-wire stop releases the branch and keeps the surface', () =>
    /aep\.mjs close <effort> --stop "<the trip-wire>"`: the branch is released and the surface kept/.test(runnerFlat));

  // The session boundary.
  assert('the run is written to survive a cleared context', () =>
    /context can be cleared between any two steps/.test(runnerFlat));
  assert('a resumed run reads the disk and nothing else', () =>
    /A resumed run reads only these/.test(policyFlat));

  assert('the runner reaches converge as its own step', () => /^## 3 \u2014 Converge$/m.test(runner));
  assert('the parallel policy forbids splitting a ticket across sub-agents', () =>
    /never split across sub-agents/i.test(parallelFlat));

  assert('skills/update branches to the 1.x migration rather than upgrading in place', () =>
    readSrc('skills', 'update.md').includes('skills/update/migration'));

  assert('the frontier is computed from the local ticket files', () =>
    /readTickets\(/.test(cliSource) && /Tickets are files under `\.aep\/efforts\/<effort>\/tickets\/`/.test(flatten(readSrc('skills', 'tasks.md'))));
  assert('no tracker object carries a ticket', () =>
    /A ticket is never a tracker object/.test(trackerFlat));

  // §30.1, the migration's five rules, each pinned by the thing that goes wrong
  // when it is dropped. A migration that quietly loses knowledge still reports
  // success, so nothing downstream notices. 4.0: the conversion map is its own
  // note, and it writes only the current contract's fields, so no 1.x tree is
  // given fields the 2.x note would then have to drop.
  const migration = readSrc('skills', 'update', 'migration.md');
  const conversion = readSrc('skills', 'update', 'conversion.md');
  assert('the migration resolves every 1.x file to one of the three outcomes', () =>
    ['Converted', 'Superseded', 'Unrepresented'].every((word) => migration.includes(word)));
  assert('the migration does not treat owner: framework as grounds to drop a file', () =>
    /`owner: framework` does not mean superseded/.test(migration));
  assert('the migration links its conversion map', () =>
    /\[\[skills\/update\/conversion\]\]/.test(migration));
  assert('the conversion writes only the current contract, dropping every 1.x field', () =>
    /Only the current contract's fields are written/.test(conversion)
    && ['version:', 'owner:', 'date:', 'kind:', 'mode:', 'part-of:'].every((field) => conversion.includes(`\`${field}\``))
    && /is dropped/.test(conversion));
  assert('the migration proposes use-when rather than inventing it', () =>
    /proposed from the content, marked unconfirmed/i.test(conversion));
  assert('the migration converts every 1.x ticket state', () =>
    ['blocked', 'superseded', 'obsolete', 'resolved'].every((state) => conversion.includes(state)));
  assert('the migration deletes nothing', () => /\*\*Nothing is deleted\*\*/.test(migration));
  assert('the migration requires the converted tree to validate', () =>
    /`validate\.mjs` passes with no exemption/.test(migration));
  assert('a 1.x policy becomes a rule, never a policy', () =>
    /A 1\.x policy becomes a rule, never a policy/.test(conversion));

  // §30.1. Three layouts reach `/update` and only one of them is the one this
  // release writes. Every assertion here is about the classifier, because
  // routing a tree to the wrong branch is not a wrong answer -- it installs a
  // second governance layer beside a live one, or reconverts a current tree.
  const noCR = (text) => text.split(String.fromCharCode(13)).join('');
  const flat = (text) => text.split(/\s+/).join(' ');
  const update = noCR(readSrc('skills', 'update.md'));
  const routing = headingBlock(update, 'First: which layout is this?');

  assert('the upgrade routes every layout it can meet', () =>
    ['3 or later', '2.x', '1.x'].every((layout) => routing.includes(`| ${layout} |`))
    && routing.includes('skills/install'));
  assert('a 2.x tree is recognised by the field that declared ownership', () =>
    /carrying `owner:`/.test(routing)
    && /no artifact under `\.aep\/` carrying `owner:`/.test(routing));
  assert('the upgrade classifies by layout rather than by declared version', () =>
    /Read the tree, not the version field/.test(routing));
  assert('the upgrade does not read .aep/policies/ as a 1.x layout', () =>
    /`\.aep\/policies\/` is not evidence of 1\.x/.test(routing));
  assert('the 1.x migration no longer reads a bare version: as evidence', () =>
    /A\s+bare `version:` is evidence of nothing/.test(flat(migration))
    && !/or a bare `version:`/.test(migration));

  // The 2.x branch, now its own note. It exists because a shrinking contract
  // left content behind, and it has to say when it stops existing.
  const twoXBranch = noCR(readSrc('skills', 'update', 'from-2.md'));
  assert('the upgrade carries a 2.x branch', () =>
    /\[\[skills\/update\/from-2\]\]/.test(routing) && twoXBranch.length > 0);
  assert('the 2.x branch states its removal condition in the file', () =>
    /This note goes when no repository the maintainer knows of/.test(flat(twoXBranch)));
  assert('the 2.x branch drops every retired field rather than converting it', () =>
    /dropped, never converted/.test(twoXBranch)
    && RETIRED_FIELDS.every((field) => twoXBranch.includes(`\`${field}:\``)));
  assert('the 2.x branch splits an architecture section into a plan', () =>
    /plan\.md/.test(twoXBranch) && /verbatim/.test(twoXBranch));

  // Requirements 48 and 49. A tracker is shared, the writes are visible to
  // everyone in it, and a merged pull request is the record of what was
  // reviewed -- so the rules here are mostly about what is *not* written.
  assert('the 2.x branch reshapes no tracker artifact of a landed effort', () =>
    /A landed effort is a record/.test(twoXBranch)
    && /in flight/.test(twoXBranch));
  assert("the 2.x branch deletes milestones entirely AEP's and keeps labels", () =>
    /milestone \*\*entirely AEP's\*\*/.test(twoXBranch)
    && /\*\*any label\*\* \| \*\*keep\*\*, even where AEP created it/.test(twoXBranch));
  assert('the 2.x branch shows every tracker write before making one', () =>
    /exact string it will be/.test(twoXBranch)
    && /before the first is made/.test(flat(twoXBranch)));
  assert('the 2.x branch writes nothing at all on a refusal', () =>
    /On a\s+refusal, write nothing\*\*, not even the uncontroversial subset/.test(flat(twoXBranch)));
  assert('the 2.x tracker half runs only where the tracker is on', () =>
    /Only where `tracker:` is on/.test(twoXBranch));

  // Requirement 61. `rules/` is the one directory the upgrade preserves and
  // never reads, which is exactly where a rule and the policy under it stop
  // agreeing.
  const reconcileStart = update.indexOf('7. **Reconcile');
  const reconcileEnd = update.indexOf('8. **Report declared');
  assert('the upgrade reconciles rules against the law that changed under them', () =>
    reconcileStart > 0 && reconcileEnd > reconcileStart);
  const reconcile = flat(update.slice(reconcileStart, reconcileEnd));

  assert('the reconciliation computes its candidates rather than judging them', () =>
    /The candidates are computed\*\*/.test(reconcile)
    && /every rule citing a policy whose text changed between the declared release and the running one/.test(reconcile));
  assert('the reconciliation classifies three cases, and one of them writes nothing', () =>
    /restates law the release changed/.test(reconcile)
    && /contradicts the new law/.test(reconcile)
    && /did not touch \| \*\*nothing\*\*/.test(reconcile));
  assert('the reconciliation shows every edit before making one', () =>
    /exact before-and-after strings, as one list, before the first is made/.test(reconcile));
  assert('the reconciliation writes nothing at all on a refusal', () =>
    /On a refusal, write nothing\./.test(reconcile));
  assert('a rule is never deleted to settle a contradiction', () =>
    /\*\*Never delete a rule\*\*/.test(reconcile)
    && /declared deviation/.test(reconcile)
    && /never settle a contradiction by removing the side that lost/.test(reconcile));

  // A step with no closing condition is a step that gets skipped quietly.
  assert('the close names the reconciliation, so skipping it is not free', () =>
    /Every rule citing a changed policy is reconciled or reported/.test(flat(update))
    && /a refusal left every rule byte-identical/.test(flat(update)));

  // A step still saying "classify by declared owner" would classify a current
  // tree, where the field is absent, as owning nothing at all.
  assert('the upgrade classifies ownership by the manifest rather than a field', () =>
    /against the release's manifest/.test(flat(update))
    && /\*\*Never read an `owner:` field\*\* to decide/.test(flat(update)));

  // P2-14: the 4.0 crossing sets the tracker from what is there and pins
  // in-flight efforts to the lane whose rules they started under.
  assert('crossing 4.0.0 sets tracker from the forge the repository used', () =>
    /Crossing 4\.0\.0/.test(update)
    && /set `github`\s+or `gitlab` where `references\/` names that forge/.test(flat(update)));
  assert('crossing 4.0.0 puts lane: full on every in-flight effort', () =>
    /\*\*`lane: full`\*\* on every in-flight effort's `spec\.md`/.test(flat(update)));

  // The closing keyword, which is what makes an issue close on its own merge.
  // Nothing shipped used to put one anywhere, so the issue closed when somebody
  // happened to remember. Each skill owns one half, and which half a repository
  // takes is the version-control rule's answer rather than AEP's: a skill that
  // hard-codes the stacking form is the same defect as one hard-coding the flat
  // form, pointed the other way. So the half, the routing, and the neutrality are
  // separate assertions rather than one.
  //
  // Asserted against the single paragraph that states it, inside the step that
  // owns it. Both halves come from one row of one rule, so the paragraphs around
  // this one discuss the same two shapes. A check reading every paragraph that
  // mentions the keyword, joined, would let a skill name one shape in the
  // sentence that governs and pick the other up from a neighbour that governs
  // nothing: a green light for the exact defect the last assertion exists to
  // catch. Requiring exactly one paragraph is what keeps the surface that narrow.
  // 4.0: the closing keyword is a tracker concern, stated once in the tracker
  // policy's opening section, both shapes in one paragraph.
  const keywordParagraphs = headingBlock(noCR(readSrc('policies', 'tracker.md')), 'Opening')
    .split(/\n\s*\n/)
    .map(flat)
    .filter((paragraph) => /closing keyword/.test(paragraph));
  const stated = keywordParagraphs.length === 1 ? keywordParagraphs[0] : '';
  assert('policies/tracker states the closing keyword in exactly one paragraph', () =>
    keywordParagraphs.length === 1);
  assert('policies/tracker routes which shape applies to the version-control rule', () =>
    stated.includes('[[rules/version-control]]'));
  assert('policies/tracker names both repository shapes and neither as the only one', () =>
    /Merged through a pull request: `Closes #<issue>` in the pull request body/.test(stated)
    && /Stacked: every commit carries `Refs #<issue>` except the change that merges last/.test(stated));
});

// --- §15.1 skill notes ------------------------------------------------------
// Depth reached from a skill, never an entry point. Four ways a note goes
// wrong, and all four read as working: it sits under a directory no skill
// owns, nothing links to it, an adapter publishes it as a command, or the tree
// refuses to hold it at all. The fourth is a repository's own note rather than
// a shipped one, so it is checked against a live installed tree in the
// `install fixture` section rather than here.

section('skill notes', () => {
  const skillsDir = path.join(SRC, 'skills');
  const notes = walk(skillsDir)
    .filter((file) => file.endsWith('.md'))
    .filter((file) => path.dirname(file) !== skillsDir);

  assert('the release ships skill notes', notes.length > 0);

  // The link index is built once from the skills themselves, so "linked from its
  // own skill" is checked against the owning skill rather than the whole corpus.
  const linkedBy = new Map();
  for (const file of topLevel(skillsDir)) {
    const name = path.basename(file, '.md');
    linkedBy.set(name, new Set(wikiLinks(readArtifact(file).body)));
  }

  for (const file of notes) {
    const rel = toPosix(SRC, file);
    const owner = path.basename(path.dirname(file));
    const target = `skills/${owner}/${path.basename(file, '.md')}`;
    const artifact = readArtifact(file);

    assert(`${rel} sits under a real skill`, SKILLS.includes(owner));
    assert(`${rel} is one level deep, beside its skill`, () =>
      path.dirname(path.dirname(file)) === skillsDir);
    assert(`${rel} declares a use-when naming the branch it is for`,
      isNonEmptyString(artifact.fields['use-when']));
    assert(`${rel} is linked from skills/${owner}.md. An unlinked note is unreachable`, () =>
      linkedBy.get(owner)?.has(target) === true);
  }

  // Asked of each target rather than spelled here: a target is free to prefix
  // the names it publishes, and a hand-built `skills/<name>/SKILL.md` would
  // then match nothing and pass while a note was published under `aep-<name>`.
  assert('no adapter publishes a note as a command', () => {
    const published = [];
    for (const [runtime, target] of Object.entries(TARGETS)) {
      for (const shape of target.shapes) {
        const rendered = new Set(renderAdapter(SRC, target, shape).map((f) => f.relativePath));
        for (const file of notes) {
          const name = path.basename(file, '.md');
          if (SKILLS.includes(name)) continue;
          const where = target.path('skill', `${target.prefix}${name}`, shape);
          if (where && rendered.has(where)) published.push(`${runtime}/${shape}: ${where}`);
        }
      }
    }
    if (published.length > 0) throw new Error(published.join(', '));
    return true;
  });
});

// --- §21 a skill writes what the specification assigns it -------------------

/** The header of the spine table, and the reason this check has an input. */
const SPINE_HEADER = '| Stage | Establishes | Writes | Reached |';

/**
 * The spine table of §21, as what each stage establishes and what it writes.
 *
 * Read out of `specs.md` rather than restated here. A release that reassigns an
 * output edits that table, and the table is then what fails the skill. A list
 * of outputs maintained beside the specification would be a second home for one
 * fact, and would drift exactly the way the skill it is meant to check did.
 */
function spineTable() {
  const start = specText.indexOf(SPINE_HEADER);
  if (start < 0) return [];
  const rows = [];
  for (const line of specText.slice(start).split('\n').slice(2)) {
    if (!line.startsWith('|')) break;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length === 4) rows.push({ stage: cells[0].replace(/`/g, ''), writes: cells[2] });
  }
  return rows;
}

section('skill output', () => {
  const rows = spineTable();

  // The vacuous-pass guard, and it earns its lines here more than usual. A
  // parse that matched nothing returns no rows, and asserting over no rows
  // passes every row it does not have: a green run and a dead check, which is
  // indistinguishable from a corpus that agrees. So a reformat of `specs.md`
  // has to fail as a broken check rather than read as a clean one.
  assert('the spine table is where the check reads it', () => specText.includes(SPINE_HEADER));
  assert('the spine table parses, with every stage the specification lists', () => {
    if (rows.length < 8) throw new Error(`parsed ${rows.length} rows, expected at least 8`);
    return true;
  });

  // A row binds when its Writes cell names an artifact. Four of the eight
  // describe an outcome instead, such as repository source or findings, and
  // there is no file for a skill to disagree with about those.
  const assigned = rows
    .map(({ stage, writes }) => ({ stage, artifact: /`([^`]+)`/.exec(writes)?.[1] ?? null }))
    .filter(({ artifact }) => artifact !== null);
  assert('the specification assigns a named artifact to at least four stages', () => {
    if (assigned.length < 4) throw new Error(`${assigned.length} stages write a named artifact`);
    return true;
  });

  const everyArtifact = [...new Set(assigned.map(({ artifact }) => artifact))];

  // The specification's other skill table, against this one. §15 lists the
  // eighteen with a line of description each, and one of those lines said
  // `plan` adds technical detail to the same spec while §21 two hundred lines
  // below assigned it `plan.md`. The correction is this effort's, and until
  // now nothing stopped the two drifting apart again.
  //
  // What this catches is a description **naming** an artifact assigned
  // elsewhere. It does not catch one describing the wrong artifact in words,
  // which is what the stale cell did, because no mechanical rule reads that.
  const skillRows = headingBlock(specText, '15. Skills')
    .split('\n')
    .filter((line) => line.startsWith('| `'))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.length === 2)
    .map(([stage, describes]) => ({ stage: stage.replace(/`/g, ''), describes }));
  assert('the specification describes each of its skills in one line', () =>
    skillRows.length === 18);

  // The pairings, counted before any of them is judged. A `continue` past a
  // stage §15 does not name is the same vacuum the row-count guard exists to
  // close: rename a stage in one table and every cross-check for it vanishes
  // without a word, which reads exactly like a corpus that agrees.
  const paired = assigned.filter(({ stage }) =>
    skillRows.some((candidate) => candidate.stage === stage));
  assert('the two skill tables name the same stages, for every assigned artifact', () => {
    const orphaned = assigned.filter(({ stage }) => !paired.includes(
      assigned.find((candidate) => candidate.stage === stage)));
    if (orphaned.length > 0) {
      throw new Error(`named by §21 and not by §15: ${orphaned.map((r) => r.stage).join(', ')}`);
    }
    return paired.length === assigned.length && paired.length >= 4;
  });

  for (const { stage, artifact } of paired) {
    const row = skillRows.find((candidate) => candidate.stage === stage);
    assert(`the specification describes ${stage} without naming another stage's artifact`, () => {
      const foreign = everyArtifact.filter((other) => other !== artifact
        && row.describes.includes(other));
      if (foreign.length > 0) throw new Error(`assigned ${artifact}, described with ${foreign.join(', ')}`);
      return true;
    });
  }

  for (const { stage, artifact } of assigned) {
    if (!inSrc('skills', `${stage}.md`)) continue;
    const output = headingBlock(readSrc('skills', `${stage}.md`), 'Output');
    assert(`skills/${stage} has an Output section to check`, () => output !== '');
    assert(`skills/${stage} names ${artifact}, the artifact §21 assigns it`, () =>
      output.includes(artifact));

    // The other half, and the half that catches what happened: the stale skill
    // named `spec.md` while §21 assigned it `plan.md`, so naming the right one
    // is not enough on its own. A skill that named both would still be sending
    // its reader to the wrong file half the time.
    const foreign = everyArtifact.filter((other) => other !== artifact && output.includes(other));
    assert(`skills/${stage} names no artifact §21 assigns to another stage`, () => {
      if (foreign.length > 0) {
        throw new Error(`assigned ${artifact}, also names ${foreign.join(', ')}`);
      }
      return true;
    });
  }
});

// --- §17 agents -------------------------------------------------------------

section('agents', () => {
  const agents = listMarkdown('agents').map((file) => path.basename(file, '.md'));
  assert('at least one agent role ships', agents.length > 0);

  const skillText = listMarkdown('skills').map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  for (const name of agents) {
    const artifact = readArtifact(path.join(SRC, 'agents', `${name}.md`));
    assert(`agents/${name} declares use-when`, isNonEmptyString(artifact.fields['use-when']));
    assert(`agents/${name} states a purpose the adapter can derive`,
      /\*\*Purpose\.\*\*/.test(artifact.body));
    assert(`agents/${name} is bound by the sub-agent policy`,
      /policies\/execution/.test(artifact.body));
    assert(`agents/${name} is dispatched by some skill`, skillText.includes(`agents/${name}`));
  }
});

// --- §10 policies -----------------------------------------------------------
// Governance ships as policies; `rules/` is the repository's own and ships
// nothing but the version-control seed. So this section asserts the shipped
// governance layer, and the fixture asserts that the other one arrives empty.

section('policies', () => {
  const policies = listMarkdown('policies');
  assert('at least one policy ships', policies.length > 0);
  for (const file of policies) {
    const rel = toPosix(SRC, file);
    const artifact = readArtifact(file);
    assert(`${rel} declares use-when. Without it, it cannot be selected`,
      isNonEmptyString(artifact.fields['use-when']));
  }

  for (const expected of ['execution', 'execution/parallel', 'tracker', 'artifacts', 'reporting']) {
    assert(`policies/${expected}.md ships`, inSrc('policies', ...`${expected}.md`.split('/')));
  }
  // Folded into the bootstrap at 4.0.0, and moved there for an upgrading tree.
  for (const retired of ['authority', 'engineering']) {
    assert(`policies/${retired}.md no longer ships`, !inSrc('policies', `${retired}.md`));
  }

  // The consolidation is the point: a governance layer that grows a file per
  // concern is the sprawl this shape replaced, so the count is asserted rather
  // than left to drift back.
  assert('the shipped governance layer stays small', () => {
    if (policies.length > 5) throw new Error(`${policies.length} policies ship`);
    return true;
  });

  assert('the distribution ships no rules/. That directory is the repository\'s', () =>
    !inSrc('rules'));
  assert('version-control is a repository-owned seed, not protocol governance', () =>
    inSrc('seed', 'rules', 'version-control.md'));

  // What `aep:` answers. The policy said the opposite until 2.5.1, that every
  // release stamps every protocol-owned artifact, which contradicted §6, §8,
  // The policy governs ownership, so what it says about ownership is checked
  // against what ships rather than against the sentence that used to be there.
  // Both directions: it states the rule that holds, and denies the one that did.
  const artifacts = flat(readSrc('policies', 'artifacts.md'));
  assert('policies/artifacts makes ownership a fact about location', () =>
    /Ownership is where a file sits; no artifact declares it/.test(artifacts));
  assert('policies/artifacts no longer says the owner is read off a field', () =>
    !/the owner is read off that field/.test(artifacts) &&
    !/never inferred from a directory/.test(artifacts));
  assert('policies/artifacts names the release once, in the bootstrap', () =>
    /The release is named once/.test(artifacts) &&
    /No artifact\s+carries its own stamp/.test(artifacts));
  assert('policies/artifacts establishes provenance by comparing content', () =>
    /establishes provenance by \*\*comparing content\*\*/.test(artifacts));
  // Matched with the colon optional, because the field table writes the name
  // bare and the prose writes it with one. Requiring the colon missed every row
  // in the table, which is the half of this file most likely to keep a dead
  // field: a row costs one line and reads as complete.
  assert('policies/artifacts describes no retired frontmatter field', () => {
    const held = RETIRED_FIELDS
      .filter((field) => new RegExp(`\`${field}:?\``).test(artifacts));
    if (held.length > 0) throw new Error(`still documented: ${held.join(', ')}`);
    return true;
  });

  // Read from the contract, so the policy and the validator cannot disagree
  // about which directories are retired.
  assert('policies/artifacts names every retired directory the validator rejects', () => {
    const unnamed = FORBIDDEN_DIRS.filter((dir) => !artifacts.includes(`\`${dir}`));
    if (unnamed.length > 0) throw new Error(`not named in the policy: ${unnamed.join(', ')}`);
    return true;
  });
  assert('policies/artifacts no longer forbids an effort plan file', () =>
    !/effort's `plan\.md`/.test(artifacts));

  // Where the path convention lives, with the reason the bootstrap has no room
  // for. Scoped to "Where it goes", because the question it answers is the one
  // the ownership table beside it already half-answers: that section is what a
  // reader opens when they are about to put a file somewhere.
  //
  // The convention and the reason are two assertions rather than one. A
  // convention whose reason has been edited away still reads like a rule and is
  // one the next author overrules with a preference, which is how these
  // surfaces drifted apart in the first place. The reason has to be able to go
  // red on its own.
  const placement = flat(headingBlock(readSrc('policies', 'artifacts.md'), 'Where it goes'));
  assert('policies/artifacts states the path convention where it states location', () => {
    if (!placement) throw new Error('the section answering where a file goes is gone');
    if (!/carries `\.aep\/` where it has two segments or more/.test(placement)) {
      throw new Error('nothing says when a filesystem path carries the root');
    }
    if (!/bare area name does not/.test(placement)) {
      throw new Error('the single-segment case is left to be guessed');
    }
    return true;
  });
  // 4.0: the reason lives in specs.md, which a run never loads; the policy
  // keeps the rule, including the rejected sigil.
  assert('policies/artifacts rejects a leading slash, and specs.md says why the convention takes this form', () => {
    if (!/Never a leading slash/.test(placement)) throw new Error('the root sigil is not rejected in the policy');
    const specs = fs.readFileSync(path.join(REPO, 'specs.md'), 'utf8');
    if (!/Why the split rather than a uniform prefix/.test(specs)) {
      throw new Error('nothing says why the rule turns on the segment count');
    }
    if (!/A leading-slash sigil is rejected/.test(specs)) throw new Error('the root sigil is not recorded as rejected');
    if (!/read from the middle/.test(specs)) {
      throw new Error('stating the root once at the top is not recorded as rejected');
    }
    return true;
  });

  // The statements that carry the most weight, pinned by name so a rewrite of
  // the surrounding prose cannot quietly drop them.
  const execution = flat(readSrc('policies', 'execution.md'));
  const parallel = flat(readSrc('policies', 'execution', 'parallel.md'));
  const tracker = flat(readSrc('policies', 'tracker.md'));

  assert('policies/execution no longer forbids plan.md', () =>
    !/NEVER create `plan\.md`/.test(execution));
  assert('policies/execution keeps a claim in one file: the spec, and plan.md holds how', () =>
    /A requirement, criterion, or scope boundary lives only in `spec\.md`; `plan\.md` holds how/.test(execution));
  assert('policies/execution replaces the ban with the traceability check', () =>
    /`validate\.mjs` fails one that traces to no numbered requirement or criterion/.test(execution));

  // The loop's half, now the parallel policy's.
  assert('policies/execution/parallel caps what a child returns', () =>
    /a summary capped in size whatever the work was/.test(parallel));
  assert('policies/execution/parallel integrates each child as it returns', () =>
    /integrate \*\*each child as it returns, one at a time\*\*/.test(parallel));
  assert('policies/execution/parallel makes the orchestrator the only integrator', () =>
    /\*\*The orchestrator is the only integrator, in the surface it holds\.\*\*/.test(parallel));

  // Counted, not matched. A fourth condition is exactly how this grows.
  assert('policies/execution names exactly three conditions that may stop a run', () => {
    const block = /## What stops a run([\s\S]*?)(?=\n## )/.exec(readSrc('policies', 'execution.md'));
    if (!block) throw new Error('the policy names no stopping conditions');
    const items = [...block[1].matchAll(/^\d+\. /gm)];
    if (items.length !== 3) throw new Error(`${items.length} conditions listed`);
    return true;
  });
  assert('policies/execution records everything else rather than raising it', () =>
    /goes in `log\.md`, carried to the close/.test(execution));

  assert('policies/execution/parallel forbids splitting one ticket across children', () =>
    /\*\*A ticket is never split across sub-agents\.\*\*/.test(parallel));
  assert('policies/execution/parallel requires independence to be read, not inferred', () =>
    /## Independence is read, never inferred/.test(parallel)
    && /never inferred from a guess about which files each touches/.test(parallel));

  // Two tracker objects per effort, and no third; the graph stays local.
  assert('policies/tracker fixes exactly one issue and one pull request per effort', () =>
    /\*\*One issue and one pull request\*\*, and no other tracker object/.test(tracker));
  assert('policies/tracker keeps the ticket and its graph in the repository', () =>
    /A ticket is never a tracker object, and the ticket graph never leaves the repository/.test(tracker));
  assert('policies/tracker keeps the tracker read-only into .aep/', () =>
    /The tracker is read, never mirrored into `\.aep\/`/.test(tracker));
  assert('policies/tracker proposes a tracker write before making it', () =>
    /A write to shared tracker data is proposed first, with the exact strings/.test(tracker));

  // The three things a child structurally could not do, each on its own.
  for (const [name, pattern] of [
    ['the seams between children\'s diffs', /\*\*The seams\*\*/],
    ['the decisions a child stopped on', /\*\*Every decision a child recorded and stopped on\*\*/],
    ['one account of the work', /\*\*One account of the work\*\*/],
  ]) {
    assert(`policies/execution/parallel makes the orchestrator own ${name}`, () => pattern.test(parallel));
  }
  assert('policies/execution/parallel bounds the seam pass at the shared surfaces', () =>
    /\*\*The seam is the bound:\*\*/.test(parallel) && /is raised and returns to the frontier as a ticket/.test(parallel));
  assert('policies/execution/parallel says the account describes the work, not the workers', () =>
    /It describes the work, not the workers/.test(parallel));
  assert('policies/execution/parallel surfaces sub-agent structure where it changed the outcome', () =>
    /sub-agent structure appears only where it changed the outcome/.test(parallel)
    && /A lost ticket always changed the outcome; it is never hidden/.test(parallel));

  // The question a child stopped on: wording may move, substance may not.
  assert('policies/execution/parallel has the child record the question as an option set', () =>
    /a question for the human, recorded as an option set \(`\[\[policies\/reporting\]\]`\)/.test(parallel));

  // 4.1: what one agent writes for another is in the controlled register. Each
  // site is asserted by name, because a brief and a return are written in
  // different files, and either alone reads as the whole rule.
  const registerLink = /in the controlled register \(`\[\[policies\/reporting\]\]`\)/;
  assert('skills/implement/dispatch writes the brief in the controlled register', () =>
    registerLink.test(flat(readSrc('skills', 'implement', 'dispatch.md'))));
  assert('policies/execution/parallel puts the brief and the return in the controlled register', () =>
    /The brief and the child's return are in the controlled register \(`\[\[policies\/reporting\]\]`\)/.test(parallel));
  for (const name of ['implementer', 'researcher', 'reviewer-correctness', 'reviewer-standards']) {
    assert(`agents/${name} writes its return in the controlled register`, () => {
      const section = /## Return\n[\s\S]*?(?=\n## |$)/.exec(readSrc('agents', `${name}.md`))?.[0] ?? '';
      return /Write\s+it in the controlled\s+register\s+\(`\[\[policies\/reporting\]\]`\)/.test(section);
    });
  }
  assert('policies/execution/parallel keeps substance out of what may be reshaped', () =>
    /may reshape a question's wording, never its substance: no option dropped, merged, or narrowed/.test(parallel));
  assert('policies/execution/parallel attributes the question to its source, not its author', () =>
    /The question is the child's; the words the human reads are the orchestrator's/.test(parallel));

  // Reachable from the skill that dispatches.
  const implementSkill = readSrc('skills', 'implement.md');
  assert('skills/implement routes a wave to the parallel policy', () =>
    /`wave: dispatch`[\s\S]{0,80}`\[\[policies\/execution\/parallel\]\]`/.test(implementSkill));

  const agentBriefs = topLevel(path.join(SRC, 'agents'))
    .filter((f) => /skills\/prose|catalogue of tells/.test(fs.readFileSync(f, 'utf8')))
    .map((f) => toPosix(SRC, f));
  assert('no agent brief carries the catalogue down to a child', () =>
    agentBriefs.length === 0);
  if (agentBriefs.length > 0) {
    process.stdout.write(`        carried by: ${agentBriefs.join(', ')}\n`);
  }

  // Authority now lives in the bootstrap.
  const bootstrap = flat(readSrc('protocol.md'));
  assert('the bootstrap places policies above rules', () =>
    /Down the chain policies → rules → effort rules → task constraints/.test(bootstrap));
  assert('the bootstrap forbids a rule softening a policy', () =>
    /may tighten a policy, never soften, contradict, or opt out of one/.test(bootstrap));
});

// A run that outlives its session needs its memory somewhere the session does
// not own. Every assertion here is one sentence whose absence leaves a runner
// that reads exactly the same and forgets everything on the first kill.
section('the run log', () => {
  const execution = flat(readSrc('policies', 'execution.md'));
  const parallel = flat(readSrc('policies', 'execution', 'parallel.md'));
  const reporting = readSrc('policies', 'reporting.md');
  const runner = flat(readSrc('skills', 'implement.md'));
  const correctness = readSrc('agents', 'reviewer-correctness.md');
  const cli = readSrc('scripts', 'aep.mjs');

  // 4.0: log.md is the run's memory in every mode; a tracker only mirrors it.
  assert('the policy states the run memory is on disk', () =>
    /## The run's memory is on disk/.test(readSrc('policies', 'execution.md')));
  for (const [what, pattern] of [
    ['commits and the ledger carry which tickets landed', /\| tickets landed \| commits on the effort branch; `log\.md` `## Ledger` \|/],
    ['the ticket carries which criteria are verified, and by what', /\| criteria verified, and by what \| ticks in the ticket \(quick: in `spec\.md`\) \|/],
    ['log.md carries the rounds, through aep record', /\| converge and review rounds \| `log\.md` `## Rounds`, via `aep record` \|/],
    ['log.md carries what was recorded and what waits on the human', /\| recorded, not acted on; waiting on the human \| `## Recorded`; `## Needs you` \|/],
  ]) {
    assert(what, () => pattern.test(execution));
  }
  assert('the log is written as the run goes: land and record write it', () =>
    /appendToLog\(effortDir, effort, 'Ledger'/.test(cli) && /function record\(root, args\)/.test(cli));
  assert('a failed write to log.md is reported rather than continued past', () =>
    /A failed `log\.md` write is reported, never continued past/.test(execution));
  assert('the pull request links log.md, and the tracker is never mirrored into .aep/', () =>
    /The tracker is read, never mirrored into `\.aep\/`\. `log\.md` is canonical; the pull request links it, never copies it/
      .test(flat(readSrc('policies', 'tracker.md'))));

  assert('no shipped file still counts review attempts in the run log', () => {
    const holding = [];
    for (const file of walk(SRC).filter((f) => f.endsWith('.md'))) {
      const text = fs.readFileSync(file, 'utf8').split(/\s+/).join(' ');
      if (/run log[^.]{0,140}review attempts|review attempts[^.]{0,140}run log/i.test(text)) {
        holding.push(toPosix(SRC, file));
      }
    }
    if (holding.length > 0) throw new Error(`the run log still counts review attempts in ${holding.join(', ')}`);
    return true;
  });

  // The tick: made at the moment of verifying, with its evidence inline, and
  // never by a dispatched child for its own work.
  assert('a criterion is ticked at the moment it is verified, with its evidence inline', () =>
    /tick it then, with what verified it inline/.test(execution));
  assert('a dispatched child never ticks its own criteria', () =>
    /\*\*A child never ticks its own criteria\.\*\*/.test(parallel));
  const exclusiveTick = [
    ['a tick belongs to the reviewer and to nobody else',
      /tick[^.]{0,60}and only (?:you|the reviewer|the correctness reviewer)\b/i],
    ['a tick is attributed to the correctness reviewer by name',
      /tick[^.]{0,40}by `?\[\[agents\/reviewer-correctness\]\]/i],
    ['only the correctness reviewer may tick',
      /only `?\[\[agents\/reviewer-correctness\]\]`?[^.]{0,60}tick/i],
    ['the orchestrator is written out of ticking',
      /the orchestrator (?:never|does not|cannot|may not|must not) ticks?\b/i],
    ['a tick is claimed never to come from its author',
      /tick[^.]{0,80}never by the agent that wrote the code/i],
    ['a ticked box is claimed to have been checked by a non-author',
      /ticked[^.]{0,80}(?:by somebody|by someone) who did not write the code/i],
    ['the removed rule is restated verbatim',
      /the agent that wrote the code never ticks/i],
  ];
  assert('no shipped file says only the correctness reviewer ticks, or that the orchestrator does not', () => {
    const holding = [];
    for (const file of walk(SRC).filter((f) => f.endsWith('.md'))) {
      const text = fs.readFileSync(file, 'utf8').split(/\s+/).join(' ');
      for (const [claim, pattern] of exclusiveTick) {
        if (pattern.test(text)) holding.push(`${toPosix(SRC, file)} (${claim})`);
      }
    }
    if (holding.length > 0) throw new Error(`the exclusive ticking rule survives in ${holding.join(', ')}`);
    return true;
  });
  assert('the correctness reviewer keeps its own tick discipline', () =>
    /## You tick what you verify/.test(correctness) &&
    /at the moment you\s+verify it\*\*, carrying inline what verified it/.test(correctness) &&
    /\*\*Never tick a criterion for code you wrote\.\*\*/.test(correctness));
  const flatCorrectness = correctness.split(/\s+/).join(' ');
  assert('the reviewer is not the only agent that ticks, and its file says so', () =>
    /\*\*You are not the only agent that ticks\.\*\*/.test(flatCorrectness) &&
    /The orchestrator ticks what it verified too/.test(flatCorrectness) &&
    /What is yours is what you verified/.test(flatCorrectness));
  assert('an unverifiable criterion stays unticked rather than being ticked with a caveat', () =>
    /\*\*A criterion you could not verify stays unticked\*\*/.test(correctness));
  assert('land refuses a ticket with an unticked criterion', () =>
    /criteria of \$\{stem\} are not ticked/.test(cli));

  // Resumption: both halves. A run that re-verifies ticks is slow, and a run
  // that trusts blanks is wrong.
  assert('a resumed run re-verifies nothing ticked and trusts nothing unticked', () =>
    /\*\*re-verify nothing ticked; trust nothing unticked\.\*\*/.test(execution) &&
    /Re-verify nothing ticked; trust nothing unticked/.test(runner));
  assert('the runner resumes by starting again, which re-enters the same surface', () =>
    /## Resume Run step 1 again\. It re-enters the same surface/.test(runner));

  assert('the ledger is emitted in the turn and kept in the run log', () =>
    /written by `aep land` into the effort's `log\.md`/.test(flat(reporting)) &&
    /The report shows the same lines, in the same\s+order/.test(reporting));

  // Compaction: the run does not stop for it, and nothing may wait on it.
  assert('the run never stops for auto-compaction, nor depends on triggering it', () =>
    /Never stop for auto-compaction, and never depend on triggering it/.test(execution));
  assert('no shipped artifact instructs an agent to compact', () => {
    const offenders = shippedArtifacts()
      .filter((file) => file.endsWith('.md'))
      .filter((file) => /\b(run|trigger|invoke|force|request)\s+(an?\s+)?(auto-?)?compaction\b/i
        .test(readArtifact(file).body))
      .map((file) => toPosix(SRC, file));
    if (offenders.length > 0) throw new Error(`instructing it: ${offenders.join(', ')}`);
    return true;
  });
});

// Converge is where the run decides it is finished. It is also the one stage
// with the whole diff in view and nobody reviewing it, so what it may not do is
// pinned as hard as what it does.
section('converge', () => {
  const execution = flat(readSrc('policies', 'execution.md'));
  const runner = flat(readSrc('skills', 'implement.md'));
  const cli = readSrc('scripts', 'aep.mjs');

  assert('the policy separates tickets running out from the spec being met', () =>
    /Tickets running out is not the spec met/.test(execution));
  assert('the runner converges once start says so, rather than ending', () =>
    /`next` is not `build`/.test(runner) && /## 3 \u2014 Converge/.test(runner));
  assert('the effort is done when a round finds no gap: start sends it to review', () =>
    /next = 'review'/.test(cli) && /clear: kind === 'converge' \? \/\\bno gap\\b\/i/.test(cli));

  // The two findings that look identical from inside one diff.
  assert('work nobody built appends tickets', () =>
    /\| work nobody built \| append tickets and build them/.test(execution));
  assert('an approach that cannot satisfy a requirement is trip-wire 1, never ticketed around', () =>
    /an approach that cannot satisfy a requirement \| trip-wire 1\. Never ticket around it/.test(execution));
  assert('the runner stops on an approach that cannot work', () =>
    /An approach that cannot work: stop \(trip-wire 1\)/.test(runner));

  // The prohibition, in both places a reader could arrive from.
  assert('the policy forbids converge editing spec.md or plan.md', () =>
    /\*\*Converge never edits `spec\.md` or `plan\.md`,\*\*/.test(execution));
  assert('the runner states the same prohibition where converge runs', () =>
    /\*\*Never edit `spec\.md` or `plan\.md` here\.\*\*/.test(runner));
  assert('the carve-out is one field by name', () =>
    /except `status: implemented` at the close/.test(execution));

  // The cap is the lane's, and the CLI refuses one past it.
  assert('the cap is per lane and fixed', () =>
    /The lane's cap on rounds is fixed/.test(execution)
    && LANE_RULES.quick.converge === 0 && LANE_RULES.standard.converge === 1 && LANE_RULES.full.converge === 2);
  assert('aep record refuses a round past the cap', () =>
    /at most \$\{cap\} \$\{kind\} round/.test(cli));
  assert('a review finding spends no converge round', () =>
    /A review finding's ticket\s+spends none/.test(execution));
  assert('reaching the cap names the gaps and ends not ready', () =>
    /At the cap with gaps left, name them; the effort ends\s+not ready/.test(execution));

  // The two judgements one ticket's diff cannot support.
  assert('converge asks whether every criterion is met, not whether every ticket closed', () =>
    /is every criterion met \u2014 not every\s+ticket closed/.test(execution));
  assert('converge corrects what the change falsified, in this effort', () =>
    /falsify a `\[\[contexts\]\]` or `\[\[references\]\]` entry\? Correct what it falsified here/.test(execution));

  // The stamp: written at the close, by the CLI, and guarded by validate.
  const artifacts = readSrc('policies', 'artifacts.md');
  assert('aep close stamps implemented', () =>
    /setField\(fs\.readFileSync\(spec\.file, 'utf8'\), 'status', 'implemented'\)/.test(cli));
  assert('the frontmatter contract says who writes implemented and when', () =>
    /`implemented` is written by the run that closed the effort \(`aep close`\), never by hand ahead of it/.test(artifacts));
  assert('aep close refuses while a ticket is unresolved', () =>
    /unresolved tickets remain/.test(cli));
  assert('the projection table names the spec reaching implemented', () =>
    /converge found no gap, and the spec is stamped `implemented`/.test(readSrc('policies', 'tracker.md')));

  // A stage, not a fourth thing to type, and not a route around deciding
  // architecture: the bootstrap's "humans decide" holds inside converge too.
  assert('converge is not invocable and ships no skill of its own', () =>
    !fs.existsSync(path.join(SRC, 'skills', 'converge.md')) && !SKILLS.includes('converge'));
  assert('the bootstrap forbids silently choosing an architecture', () =>
    /\*\*Never silently\s+choose between reasonable architectures/.test(flat(readSrc('protocol.md'))));
});

// --- §15.2 what a turn tells the human --------------------------------------

/** The two slots before the work, in the order the contract fixes, then the two after. */
const TURN_SLOTS = [
  'Doing', 'Lane', 'Position', 'Assuming', 'Done', 'Stopped on', 'Needs you', 'Outside writes', 'Next',
];


// Ticket 14. The opening step is the one place AEP publishes, and the one place
// it interrupts a human. Both halves are pinned: what it creates (exactly two
// objects, the same two for the smallest change and the largest), and what it
// does when told no. A refusal that quietly degrades to a local branch is the
// failure this section exists to catch.
section('the effort opens', () => {
  const specify = flat(readSrc('skills', 'specify.md'));
  const tracker = flat(readSrc('policies', 'tracker.md'));
  const execution = flat(readSrc('policies', 'execution.md'));
  const cli = readSrc('scripts', 'aep.mjs');

  // 4.0: the opening is one command. Branch and surface are made in one act,
  // the draft moves from scratch, and the main checkout is never written first.
  assert('specify opens the effort with aep open', () =>
    /node \.aep\/scripts\/aep\.mjs open <slug> --lane <lane>/.test(specify));
  assert('the draft is written in scratch, never in the main checkout', () =>
    /Write the draft\*\* at `\.aep\/scratch\/<slug>\/spec\.md`/.test(specify)
    && /Nothing is written in the main checkout/.test(specify));
  assert('aep open creates the branch and its surface in one act', () =>
    /worktree', 'add', '--quiet', '-b', effort, surface, base/.test(cli));
  assert('aep open moves the draft rather than copying it', () =>
    /fs\.rmSync\(draft, \{ recursive: true, force: true \}\)/.test(cli));

  // The lane replaces the sizing floor, and only goes up.
  assert('a bug fix is the quick lane, with no tasks', () =>
    specify.includes('docs, config, a bug fix, an isolated refactor | `quick` | nothing; no tasks either'));
  assert('specify raises a lane and never lowers it', () =>
    /Raise it \u2014 \*\*never lower it\*\*/.test(specify));
  assert('the human may override the lane, and the override stands', () =>
    /Report it; never ask it. The human may override either way, and the override stands/.test(specify));

  // Later revisions land as further commits on the effort branch.
  assert('later revisions are further docs commits on the effort branch', () =>
    /every revision to `spec\.md`, `plan\.md`, `evidence\/`, or `tickets\/` is a `docs` commit on the effort branch/.test(specify));

  // The single ask, only where a tracker is on: two things, one interruption,
  // and a refusal that stops rather than sliding to something quieter.
  assert('the ask happens once, before aep open, and only with a tracker', () =>
    /`\/specify` asks \*\*once\*\*, before `aep open`/.test(tracker)
    && /Where `tracker:` is on and the lane is not quick, first `\[\[policies\/tracker\]\]`'s one ask/.test(specify));
  assert('the ask covers both the push and the priority', () =>
    tracker.includes('permission to push and open a public pull request') && tracker.includes("the effort's `priority:`"));
  assert('the ask carries the exact strings it will write', () =>
    tracker.includes('the exact issue title and body, branch name, and pull request title'));
  assert('a refusal stops the opening', () =>
    /A refusal stops the opening: the draft stays in scratch and nothing is created/.test(tracker));
  assert('the issue and the pull request are each created from their template', () =>
    tracker.includes('create the issue from its template')
    && tracker.includes('open a draft pull request from its template'));
  assert('the issue is never rewritten to match the spec', () =>
    tracker.includes('the issue is never rewritten to match it'));
  assert('abandoning closes both objects, labelled', () =>
    tracker.includes('**Abandoning closes both objects**') && tracker.includes('`flag: wontfix`'));

  // The stages resolve uncertainty inside the invocation.
  assert('specify resolves material uncertainty in this turn', () =>
    /\*\*Resolve material uncertainty here\.\*\*/.test(specify)
    && /Stages hand nothing back for the human to type/.test(specify));
  assert('ambiguity is not offered as a next step', () => specify.includes('Ambiguity is never a next step'));
  for (const [kind, target] of [
    ['factual', 'skills/research'],
    ['product, or a tradeoff', 'skills/refine'],
    ['technical', 'skills/prototype'],
    ['an open visual question', 'skills/prototype/ui'],
  ]) {
    assert('specify routes ' + kind + ' uncertainty to ' + target, () => {
      const row = readSrc('skills', 'specify.md').split('\n').find((line) => line.startsWith('   | ' + kind));
      return Boolean(row) && row.includes(target);
    });
  }

  // The stages are not commands.
  for (const name of ['refine', 'research']) {
    const stage = readSrc('skills', name + '.md');
    assert('skills/' + name + ' declares itself a stage rather than a command', () =>
      stage.includes('**A stage, not a command.**'));
    assert('skills/' + name + ' is not headed as a slash command', () =>
      new RegExp('^# ' + name + ' ', 'm').test(stage) &&
      !new RegExp('^# /' + name, 'm').test(stage));
    assert('skills/' + name + ' opens no report of its own', () =>
      stage.includes('opens no report of its own'));
  }

  // Two tracker objects per effort, and a ticket is never one.
  assert('the tracker policy states exactly two objects per effort', () =>
    tracker.includes('**One issue and one pull request**, and no other tracker object'));
  assert('a ticket is never a tracker object, and the graph never leaves the repository', () =>
    tracker.includes('A ticket is never a tracker object, and the ticket graph never leaves the repository'));
  for (const [forge, unit] of [['github', 'pull request'], ['gitlab', 'merge request']]) {
    const seed = readSrc('seed', 'references', forge + '.md');
    assert('the ' + forge + ' seed heads its effort section with one issue and one ' + unit, () =>
      new RegExp('^## An effort here: one issue, one ' + unit + '$', 'm').test(seed));
    assert('the ' + forge + ' seed keeps the tickets in the repository', () =>
      seed.includes('.aep/efforts/<effort>/tickets/'));
    assert('the ' + forge + ' seed computes the frontier locally', () =>
      seed.includes('.aep/scripts/frontier.mjs'));
    assert('the ' + forge + ' seed does not send the dependency graph to the forge', () =>
      /never comes here|no longer applies/.test(seed));
  }

  // With no tracker -- the default -- nothing in the tracker policy runs, and
  // the repository is the whole record.
  assert('tracker none is the default, and then nothing tracker-shaped runs', () =>
    /With `tracker: none`, the default, nothing here runs: no issue, no pull request, no label, no forge call/.test(tracker));
  assert('the tracker-less effort is a branch the human merges, recorded in log.md', () =>
    /The effort is a branch a human merges, and `log\.md` is its whole record/.test(tracker));
  assert('the runner merges in neither shape', () => /\*\*The runner never merges\.\*\*/.test(execution));
  assert('a tracker run opens what is missing and says so', () =>
    tracker.includes('opens what is missing and says so'));
  assert('each tracker object links to the effort both ways', () =>
    tracker.includes('the effort is numbered for the issue, and both bodies name the effort\'s path'));
  assert('aep open and aep close make no forge call', () =>
    !/\b(gh|glab)\b['"]/.test(cli) && !/'push'|'fetch'/.test(cli));

  // Asked of every skill and agent at once: an instruction to read or write a
  // tracker names the case where there is none.
  const TRACKER_CALLS = [
    'create the issue',
    'open a draft pull request',
    'Offer the label vocabulary',
    'from the tracker rather than from',
    'Move the issue and the pull request',
    "A criterion's checkbox",
  ];
  assert('no skill or agent instructs a tracker call without naming the case where there is none', () => {
    const reaching = ['skills', 'agents'].flatMap((dir) => walk(path.join(SRC, dir)))
      .filter((file) => file.endsWith('.md'))
      .map((file) => [toPosix(SRC, file), fs.readFileSync(file, 'utf8')])
      .filter(([, text]) => TRACKER_CALLS.some((call) => text.includes(call)))
      .filter(([, text]) => !text.includes('no tracker') && !text.includes('tracker:'))
      .map(([rel]) => rel);
    if (reaching.length > 0) throw new Error(reaching.join(', '));
    return true;
  });

  const oneLine = (text) =>
    text.split(String.fromCharCode(13)).join('').split(/\s+/).join(' ');
  assert('install skips the label offer where there is no tracker', () => {
    const install = oneLine(readSrc('skills', 'install.md'));
    return /\*\*Tracker steps: only where `tracker:` is on\.\*\* With `tracker: none`, skip\s+both and say they were skipped\./
      .test(install);
  });
  assert('the 2.x reshape still runs its tree half without a tracker', () => {
    const twoX = oneLine(readSrc('skills', 'update', 'from-2.md'));
    return /Only where `tracker:` is on\. Otherwise say the section was skipped and why\./.test(twoX)
      && /The frontmatter and the specs halves run in full either way\./.test(twoX);
  });

  const github = readSrc('seed', 'references', 'github.md');
  assert('the github seed records why sub-issues are declined', () =>
    /^## Sub-issues, and why they are not used$/m.test(github) &&
    /\*\*This\s+repository does not use it\*\*/.test(github));
  assert('the github seed declines sub-issues on grounds other than capability', () =>
    github.includes('the reason is not that it is missing anything'));
});

/**
 * The stage names a skill declares, read from its own procedure.
 *
 * Two shapes, because both are in the corpus for good reasons: the long skills
 * carry prose under numbered headings, the compact ones a numbered list under
 * `## Procedure`. Returns `total` alongside so a caller can tell "no stages",
 * a shape this does not know, from "a step with no name", which is the defect
 * that would otherwise pass as a shorter list.
 */
section('reporting', () => {
  const policy = readSrc('policies', 'reporting.md');
  const prose = flat(policy);

  // The policy governs every text a human reads, and the turn report is one of
  // them rather than all of them. Each half below fails on its own, because the
  // version that keeps the shape and loses the scope reads identically to a
  // reader who only ever opens the second half.
  const trigger = readArtifact(path.join(SRC, 'policies', 'reporting.md')).fields['use-when'];
  assert('the policy triggers on more than the turn report', () =>
    /commit message/i.test(trigger) && /code comment/i.test(trigger));

  // 4.1: three registers, one table. Each worked case is looked for under its
  // register's rows only, so a case moved to the wrong register fails here, and
  // a case listed under two registers fails the check after the loop.
  assert('the policy states the reader test in one sentence', () =>
    /\*\*The reader picks the register\.\*\*/.test(prose));
  assert('the reader test says exempt means written for that reader', () =>
    /Exempt means written for that reader, never\s+carelessly/.test(prose));
  assert('the old two-column reader table is gone', () =>
    !/\|\s*Governed\s*\|\s*Exempt\s*\|/.test(policy) && !/\bgoverned\b/i.test(prose));
  const registerRows = policy.split('\n')
    .map((line) => /^\|([^|]+)\|\s*(public|controlled|exempt)\s*\|([^|]+)\|$/.exec(line))
    .filter(Boolean)
    .map((match) => ({
      register: match[2],
      cases: match[3].split(/;|,\s*(?:or\s+)?/).map((item) => item.trim()).filter(Boolean),
    }));
  assert('the policy has one Reader | Register | Worked cases table', () =>
    (policy.match(/\|\s*Reader\s*\|\s*Register\s*\|\s*Worked cases\s*\|/g) ?? []).length === 1);
  assert('the table names all three registers', () =>
    ['public', 'controlled', 'exempt'].every((name) => registerRows.some((row) => row.register === name)));
  const casesOf = (name) => registerRows
    .filter((row) => row.register === name)
    .flatMap((row) => row.cases)
    .join(' / ');
  for (const [register, label, pattern] of [
    ['public', 'a README', /a README/],
    ['public', 'a docs page', /a docs page/],
    ['public', 'an API reference', /an API reference/],
    ['public', 'user-interface text', /user-interface text/],
    ['public', 'a changelog', /a changelog/],
    ['public', 'a code comment', /a code comment/],
    ['public', 'a docstring', /a docstring/],
    ['controlled', 'session output', /session output/],
    ['controlled', 'the turn report', /the turn report/],
    ['controlled', 'an option set', /an option set/],
    ['controlled', 'a commit message', /a commit message/],
    ['controlled', 'a pull request title or body', /a pull request title or body/],
    ['controlled', 'a brief', /a brief/],
    ['controlled', "a child's return", /a child's return/],
    ['controlled', 'a relayed question', /a relayed question/],
    ['controlled', 'a new effort artifact', /a new spec/],
    ['controlled', 'a log.md cell', /`log\.md` cell/],
    ['exempt', 'shipped protocol text', /protocol text/],
    ['exempt', 'data a script writes for an agent', /data a script writes for an agent/],
  ]) {
    assert(`the policy puts ${label} under ${register}`, () => pattern.test(casesOf(register)));
  }
  assert('no public row names review or agent text, and no controlled row names public text', () => {
    const crossed = [
      ...(/commit|pull request|session|brief|return|turn report|option set/i.exec(casesOf('public')) ?? []),
      ...(/README|docs page|changelog|code comment|docstring|API reference|user-interface/i.exec(casesOf('controlled')) ?? []),
    ];
    if (crossed.length > 0) throw new Error(crossed.join(', '));
    return true;
  });
  assert('no worked case sits under two registers', () => {
    const seen = new Map();
    for (const row of registerRows) {
      for (const item of row.cases) {
        if (seen.has(item) && seen.get(item) !== row.register) throw new Error(item);
        seen.set(item, row.register);
      }
    }
    return true;
  });
  assert('the policy settles a case on no row by asking who reads it', () =>
    /A case on no row is settled by asking who reads it/.test(prose));

  // 4.0: the four checkable prohibitions are one line in the bootstrap, which
  // loads every session; the policy points at them rather than repeating them.
  const bootstrapText = flat(readSrc('protocol.md'));
  for (const [name, pattern] of [
    ['em dashes', /no em dashes/],
    ['curly quotes', /no curly\s+quotes/],
    ['decorative emoji', /no decorative emoji/],
    ['title-case headings', /no title-case headings/],
  ]) {
    assert(`the bootstrap prohibits ${name} by name`, () => pattern.test(bootstrapText));
  }
  assert('the policy points at the prohibitions rather than restating them', () =>
    /four prohibitions are in\s+the protocol/.test(prose) && !/No em dashes/i.test(prose));
  assert('the prohibitions hold in both registers a human reads', () =>
    /hold in both registers a human reads/.test(prose));

  // The split between law and craft, and when the craft loads.
  assert('the policy sends the craft to skills/prose', () =>
    /\[\[skills\/prose\]\]/.test(policy));
  // 4.1: prose narrows to public text. Its reach moves, and its catalogue does
  // not: the section is compared with the 4.0.0 release, read from git, so an
  // edit made while narrowing the reach cannot slip into the craft unseen.
  const proseSkill = readSrc('skills', 'prose.md');
  const proseTrigger = readArtifact(path.join(SRC, 'skills', 'prose.md')).fields['use-when'];
  assert('skills/prose triggers on public text only', () =>
    /^writing or editing public text: a README, a docs page, an API reference, user-interface text, a changelog, a code comment, or a docstring$/.test(proseTrigger) &&
    !/pull request/i.test(proseTrigger));
  assert('skills/prose opens by sending session and agent text to plain', () =>
    /Loaded for public text only \(`\[\[policies\/reporting\]\]`\), never for session or agent text, which take `\[\[skills\/plain\]\]`/.test(flat(proseSkill)));
  assert('skills/prose constrains itself away from session and agent text', () =>
    /\*\*Do not apply this to session or agent text\.\*\* It takes the controlled register \(`\[\[skills\/plain\]\]`\)/.test(flat(proseSkill)));
  const catalogueOf = (text) => /\n## The catalogue\n[\s\S]*?(?=\n## )/.exec(text.replace(/\r\n/g, '\n'))?.[0] ?? null;
  assert('the prose catalogue is byte-identical to the 4.0.0 release', () => {
    const released = catalogueOf(execFileSync('git', ['show', `${RELEASE_400_COMMIT}:src/skills/prose.md`], { encoding: 'utf8', cwd: REPO }));
    const current = catalogueOf(proseSkill);
    if (released === null || current === null) throw new Error('no catalogue section');
    return released === current;
  });

  assert('the policy sends public text, and only public text, to skills/prose', () =>
    /Public text takes the craft in `\[\[skills\/prose\]\]`/.test(prose) &&
    !/pull request body, a changelog, or docs/.test(prose));

  // The controlled register's law: the order, the 20% and its limit, and the
  // technical-name rule. The craft lives elsewhere; these are the MUSTs.
  const controlled = flat(/## How controlled text reads[\s\S]*?(?=\n## )/.exec(policy)?.[0] ?? '');
  assert('the policy states the order: principles, vocabulary, test', () => {
    const at = ['**The core principles.**', '**The vocabulary.**', '**The test.**']
      .map((label) => controlled.indexOf(label));
    if (at.some((index) => index < 0)) throw new Error(at.join(' '));
    return at[0] < at[1] && at[1] < at[2];
  });
  assert('the core principles name the topic, the voice, the length, and the meaning', () =>
    /One topic per sentence/.test(controlled) && /Active voice, the actor named/.test(controlled) &&
    /Twenty words for an instruction and 25 for a description, as a target/.test(controlled) &&
    /One meaning per word/.test(controlled));
  assert('the vocabulary tries an approved word first and allows a better outside word', () =>
    /An ASD-STE100 approved word first; an outside word where it carries the meaning better/.test(controlled));
  assert('the 20% never drops a core principle', () =>
    /This is 80% adherence/.test(controlled) && /\*\*never drops a core principle\*\*/.test(controlled));
  assert('a domain or AEP term is a technical name, never counted against adherence', () =>
    /\*\*A domain term is a technical name\*\*: a term this repository's domain or AEP defines is kept exactly and never counted against adherence/.test(controlled));

  // Sketches and option sets: one section, so every file that puts a choice to
  // the human links here and none restates it.
  const shown = flat(/## Sketches and option sets[\s\S]*?(?=\n## )/.exec(policy)?.[0] ?? '');
  assert('the policy says when a sketch is drawn', () =>
    /\*\*Structure shown to the developer is drawn\*\*: a flow, a hierarchy, a sequence of states, a before-and-after, or a comparison/.test(shown));
  assert('a sketch is characters in a fenced block, in Excalidraw style', () =>
    /characters in a fenced block, in Excalidraw style/.test(shown));
  assert('a large structure is split', () => /A larger structure is split/.test(shown));
  assert('an option set is explained, illustrated, and recommended', () =>
    /\*\*An option set is explained, illustrated, and recommended\*\*/.test(shown) &&
    /one marked recommended with its reason/.test(shown));
  assert('the picker is used where there is one, and the text fallback carries the same set', () =>
    /through the runtime's option picker where there is one, else as text/.test(shown) &&
    /The options, their words, and their order are the same either way/.test(shown));
  const fallbackHomes = payloadArtifacts()
    .filter((file) => /option picker where there is one|are the same either way/.test(flat(fs.readFileSync(file, 'utf8'))))
    .map((file) => toPosix(SRC, file));
  assert('the option-set rule and its fallback are stated in the policy and nowhere else', () => {
    if (JSON.stringify(fallbackHomes) !== JSON.stringify(['policies/reporting.md'])) throw new Error(fallbackHomes.join(', '));
    return true;
  });

  // 4.1: every file that puts a choice to the human links to the one section
  // that says what an option set holds. A link, not a copy: the copy is caught
  // by the one-home check above, and the missing link here.
  for (const rel of [
    'skills/refine.md', 'skills/plan.md', 'skills/plan/design-it-twice.md', 'skills/specify.md',
    'skills/install.md', 'skills/update.md', 'policies/tracker.md', 'protocol.md',
    'skills/prune.md', 'skills/prototype/ui.md', 'skills/survey.md', 'skills/update/from-2.md',
    'skills/update/migration.md',
  ]) {
    assert(`${rel} puts its choice as an option set, linked to the policy`, () =>
      /option set\s*\(`\[\[policies\/reporting\]\]`\)/.test(flat(readSrc(...rel.split('/')))));
  }
  // The list above is the files known to ask. This catches the next one: a
  // shipped file whose wording puts a choice to the human links to the rule.
  const asking = /\b(?:picks one|Then ask|Ask first|Confirm with the human)\b/i;
  const unlinked = payloadArtifacts()
    .filter((file) => asking.test(flat(fs.readFileSync(file, 'utf8'))))
    .filter((file) => !/option set\s*\(`\[\[policies\/reporting\]\]`\)/.test(flat(fs.readFileSync(file, 'utf8'))))
    .map((file) => toPosix(SRC, file));
  assert('every shipped file that puts a choice to the human links to the option-set rule', () => {
    if (unlinked.length > 0) throw new Error(unlinked.join(', '));
    return true;
  });
  const answerScripts = payloadArtifacts()
    .filter((file) => /can reply|reply "?yes"? or "?b"?/i.test(flat(fs.readFileSync(file, 'utf8'))))
    .map((file) => toPosix(SRC, file));
  assert('no shipped file tells the human how to answer', () => {
    if (answerScripts.length > 0) throw new Error(answerScripts.join(', '));
    return true;
  });
  assert('refine keeps five questions, one at a time, each with a recommended answer', () =>
    /\*\*Ask at most 5 questions per effort, one at a time\*\*/.test(flat(readSrc('skills', 'refine.md'))) &&
    /\*\*your recommended answer\*\*/.test(flat(readSrc('skills', 'refine.md'))));

  // The nine-line report, in order, each slot named at the start of its line.
  const reportBlock = /```\n(Doing[\s\S]*?)```/.exec(policy)?.[1] ?? '';
  const slotLines = reportBlock.split('\n').filter(Boolean).map((line) => line.split(/\s{2,}/)[0]);
  assert('the turn report is the nine slots, in order', () => {
    if (JSON.stringify(slotLines) !== JSON.stringify(TURN_SLOTS)) throw new Error(slotLines.join(' / '));
    return true;
  });
  assert('the turn report is at most nine lines', () => slotLines.length <= 9);
  assert('Outside writes says none or names each path', () =>
    /Outside writes\s+"none", or each path outside the project and why/.test(reportBlock));

  assert('the contract forbids omitting a slot that has nothing in it', () =>
    /A slot with nothing to say says so/.test(prose) && /never dropped/i.test(prose));
  assert('the contract makes the request the unit, not the skill entry', () =>
    /One request, one report/.test(prose));
  assert('the contract makes a nested skill a stage rather than a second report', () =>
    /stage of that run and reports nothing of its own/.test(prose));
  assert('the contract holds every slot to one line', () =>
    /\*\*One line each\.\*\*/.test(prose));
  assert('the contract keeps the work out of the slots rather than shortening it', () =>
    /the work goes\s+above/.test(prose) && /comes first, uncut/.test(prose));
  assert('the contract fills Position with what a skill already verifies', () =>
    /holds only what the skill already verifies\*\*, never a new check/.test(prose));
  assert('the contract puts what would clear a stop in Next', () =>
    /A stop names its remedy in `Next`/.test(prose));
  assert('Needs you is what aep status shows, recorded through aep record', () =>
    /`Needs you` is what `aep status` shows the human/.test(prose) &&
    /aep record <effort> --needs-you/.test(prose));

  // The ledger: written by the command line, read back on resume, and its
  // commit computed rather than stored, so the log never holds a SHA to go stale.
  assert('the contract keeps a ledger, one line per unit of work', () =>
    /## The ledger/.test(policy) && /One line per unit of work, written by `aep land`/.test(prose));
  assert('a ledger line shows its commit read from git and never stored', () =>
    /with the commit beside each, read from git and never stored/.test(prose));
  assert('the ledger is read back by a resumed run and stays parseable', () =>
    /A resumed run reads the log copy/.test(prose) &&
    /stable\s+enough to parse; inside a cell, it takes the controlled register/.test(prose));

  // One home. A second copy of the slot set is the drift this whole effort is
  // against, so the check is over every shipped artifact rather than the ones
  // that seemed likely.
  const carriers = payloadArtifacts().filter((file) => {
    const text = fs.readFileSync(file, 'utf8');
    return TURN_SLOTS.every((slot) => new RegExp(`^${slot}\\s{2,}`, 'm').test(text));
  }).map((file) => toPosix(SRC, file));
  assert('exactly one shipped artifact states the whole slot set', () => carriers.length === 1);
  if (carriers.length !== 1) {
    process.stdout.write(`        carriers: ${carriers.join(', ') || '(none)'}\n`);
  }
  assert('the one that does is the policy', () => carriers[0] === 'policies/reporting.md');

  // The bootstrap links rather than lists: it is loaded on every session, and a
  // copy of the slots there would be the second home the check above forbids.
  const bootstrap = readSrc('protocol.md');
  // The invariant itself, not the file: protocol.md also lists the policy in
  // its governance table, and a check satisfied by that link would pass with
  // the invariant's own pointer deleted.
  const invariant = /\*\*Every turn reports\*\*[\s\S]*?(?=\n\n)/.exec(bootstrap);
  assert('protocol.md carries the invariant', () => invariant !== null);
  assert('the invariant points at the contract rather than restating it', () =>
    invariant !== null && flat(invariant[0]).includes('[[policies/reporting]]'));
  assert('the bootstrap does not become a second home for the slots', () =>
    !TURN_SLOTS.every((slot) => new RegExp(`^${slot}\\s{2,}`, 'm').test(bootstrap)));

  // Rendering is the runtime's business. A contract that implies one puts every
  // non-terminal consumer out of conformance for reasons unrelated to what it
  // says, so the surfaces stating it may not name one.
  const rendering = /\b(terminal|colou?r|ANSI|pixels?|columns wide|Claude|Cursor|Codex|Gemini)\b/i;
  for (const [name, text] of [['policies/reporting.md', policy], ['protocol.md', bootstrap]]) {
    assert(`${name} states the contract without naming a rendering`, () => !rendering.test(text));
  }

  // One shape, so there is no second one to declare.
  assert('no shipped artifact declares a report form', () => {
    const declaring = payloadArtifacts()
      .filter((file) => readArtifact(file).fields.report !== undefined)
      .map((file) => toPosix(SRC, file));
    if (declaring.length > 0) throw new Error(declaring.join(', '));
    return true;
  });
  assert('the contract no longer offers two forms to choose between', () =>
    !/report: full/.test(policy) && !/\bshort form\b/i.test(prose));

  // The set is pinned by name, so a skill gaining or losing a position read is a
  // decision somebody made rather than a drift nobody noticed. Why each member
  // is in it:
  //
  //   install   writes the first marker a tree ever has.
  //   implement reads the marker through `aep start` and stamps on landing.
  //   prune     sweeps the whole tree in the surface it was invoked in, and
  //             stamps at its close.
  //   specify   reads the surface it was invoked in, before it opens the effort
  //             into another, and stamps neither.
  //   survey    reads a bounded part of the codebase and stamps at its close.
  //   tasks     enters the effort's surface through `aep start`, as implement does.
  const POSITION_SKILLS = ['implement', 'install', 'prune', 'specify', 'survey', 'tasks'];
  const readsPosition = SKILLS
    .filter((name) => /position\.mjs|aep\.mjs start/.test(readSrc('skills', `${name}.md`)))
    .sort();
  assert(`exactly ${POSITION_SKILLS.join(', ')} read or write position`, () =>
    JSON.stringify(readsPosition) === JSON.stringify([...POSITION_SKILLS].sort()));
  if (JSON.stringify(readsPosition) !== JSON.stringify([...POSITION_SKILLS].sort())) {
    process.stdout.write(`        on disk: ${readsPosition.join(', ')}\n`);
  }

  // Both sides computed: the invoker set from the skills, the rows from the
  // policy's table. A skill that gains a position read has to gain a row.
  const tabled = policy
    .split('\n')
    .filter((line) => line.trimStart().startsWith('|'))
    .flatMap((line) => [...(/^\s*\|([^|]*)\|/.exec(line)?.[1] ?? '').matchAll(/\[\[skills\/([a-z-]+)\]\]/g)]
      .map((match) => match[1]));
  assert('every skill that reads position has a row in the reporting table', () => {
    const missing = readsPosition.filter((name) => !tabled.includes(name));
    if (missing.length > 0) throw new Error(`no row for ${missing.join(', ')}`);
    return true;
  });
  assert('the table says no skill reads position just to fill the slot', () =>
    /no skill reads position just to fill it/.test(prose));
  assert('the table keeps its answer for a skill that reads no repository state', () =>
    /\| a skill that reads no repository state \|/.test(policy));

  // Both halves, by name. A skill that checks without stamping leaves its
  // surface's marker as unmaintained as it found it, which is the state this
  // pair exists to end, and the check alone reads as though the job were done.
  for (const name of ['prune', 'survey']) {
    const text = readSrc('skills', `${name}.md`);
    assert(`${name} checks the marker on entry and stamps it at its close`, () => {
      if (!/position\.mjs check/.test(text)) throw new Error('no entry check');
      if (!/position\.mjs stamp/.test(text)) throw new Error('no stamp at the close');
      return true;
    });
    assert(`${name} says the stamp is earned by reading rather than by committing`, () =>
      /the marker records the tree a run \*\*read\*\* and not the tree a run committed/.test(flat(text)));
  }

  assert("prune's stamp leaves a marker for the tree it read", () => {
    // Run rather than read: the two commands come out of the skill's own text,
    // so a skill that stops naming them fails here rather than this fixture
    // passing against a copy of them kept in the suite.
    const prune = readSrc('skills', 'prune.md');
    const named = ['check', 'stamp']
      .filter((command) => new RegExp(`position\\.mjs ${command}`).test(prune));
    if (named.length !== 2) throw new Error(`prune names ${named.join(' and ') || 'neither command'}`);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-prune-position-'));
    try {
      const aep = path.join(dir, '.aep');
      fs.mkdirSync(aep, { recursive: true });
      fs.copyFileSync(path.join(SRC, 'protocol.md'), path.join(aep, 'protocol.md'));
      // The marker the stamp writes is gitignored, exactly as an installed tree
      // ignores it. Without this the stamp is itself an untracked file, so the
      // tree fingerprint moves every time anything writes one and every check
      // after a stamp reports drift the stamp caused.
      fs.writeFileSync(path.join(aep, '.gitignore'), 'position/\nscratch/\nworktrees/\n', 'utf8');
      const git = (...args) =>
        execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      git('init', '--quiet', '-b', 'main');
      git('config', 'user.email', 'suite@example.invalid');
      git('config', 'user.name', 'suite');
      fs.writeFileSync(path.join(dir, 'README.md'), 'fixture\n', 'utf8');
      fs.writeFileSync(path.join(dir, 'stale.md'), 'nothing links here\n', 'utf8');
      git('add', '-A');
      git('commit', '--quiet', '-m', 'base');

      const call = (command) =>
        spawnSync(process.execPath, [path.join(SRC, 'scripts', 'position.mjs'), command, '--root', aep],
          { cwd: dir, encoding: 'utf8' });

      // Step 1. This surface has never been stamped, so the check reports
      // `unset` and exits 1, which is a report rather than a refusal. What
      // matters is the commit the sweep then reads the tree against.
      const entry = call('check');
      if (!/marker: unset/.test(entry.stdout)) throw new Error(`the entry check said: ${entry.stdout.trim()}`);
      const readAt = git('rev-parse', 'HEAD').trim();

      // Steps 2 to 6: an approved removal, applied and never committed. That is
      // what separates the tree prune read from any tree it might have committed.
      fs.rmSync(path.join(dir, 'stale.md'));

      // Step 7.
      const stamp = call('stamp');
      if (stamp.status !== 0) throw new Error(`the stamp exited ${stamp.status}: ${stamp.stderr.trim()}`);

      const marker = JSON.parse(fs.readFileSync(path.join(aep, 'position', 'marker.json'), 'utf8'));
      if (marker.head !== readAt) {
        throw new Error(`marker head ${marker.head} is not the tree prune read, ${readAt}`);
      }
      // And it describes this surface as it now stands, so the next run here
      // reads a match rather than drift nothing caused.
      const after = call('check');
      if (after.status !== 0) throw new Error(`a check after prune's own stamp reported: ${after.stdout.trim()}`);
      return true;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // The absorbed surfaces: each conforms, and the reasoning that justified the
  // shape it had before survives the absorption.
  const implement = readSrc('skills', 'implement.md');
  // 4.0: `aep start` reads the scope and the marker, in that order and in the
  // surface it enters, so the run quotes one summary rather than two scripts.
  assert('skills/implement fills Position from aep start', () =>
    /Quote `summary` in `Position`/.test(implement) && /aep\.mjs start/.test(implement));
  assert('skills/implement quotes the marker, a match licensing nothing more', () =>
    /quote the marker/.test(implement) && /skips the drift read and nothing else/.test(implement));
  assert('skills/implement makes review a stage of its own turn', () =>
    /as a stage of this turn/.test(implement));
  for (const name of ['tdd', 'domain']) {
    assert(`skills/${name} says a nested entry opens no report`, () =>
      /opening no report of its own/.test(readSrc('skills', `${name}.md`)));
  }
  const specify = readSrc('skills', 'specify.md');
  // Both directions, because either alone leaves the prose read reachable: the
  // script has to be invoked, and the marker file has to be named nowhere, or
  // a reader still has the option of comparing it by hand.
  assert('skills/specify reads position by script rather than by prose', () =>
    /position\.mjs check/.test(specify) && !/position\/marker\.json/.test(specify));
  // And it stops at the read. A stamp would land at the close, inside the
  // surface the effort was opened into, against a check taken in the one the
  // run was invoked in.
  assert('skills/specify stamps nothing, and says why', () =>
    !/position\.mjs stamp/.test(specify) && /This run stamps nothing/.test(specify));
  assert('skills/specify routes its unverified half to Assuming', () =>
    /fills `Assuming`/.test(specify));
  assert('skills/specify routes its sizing floor to Next', () =>
    /`Next` names/.test(specify));
});

// --- §12.1 where a context lives --------------------------------------------

section('contexts', () => {
  const template = readSrc('templates', 'context.template.md');
  const prose = flat(template);

  assert('the template gives the flat shape', () =>
    prose.includes('.aep/contexts/<area>.md'));
  assert('the template gives the namespaced shape', () =>
    prose.includes('.aep/contexts/<project>/<area>.md'));
  assert('the template bounds the depth', () =>
    /one project directory deep, no more/i.test(prose));
  assert('the template says when to nest rather than only that you may', () =>
    /fight over the same area name/.test(prose));
  assert('the template keeps naming and scoping apart', () =>
    /The directory names; `paths:` scopes/.test(prose));
  assert('the template says a nested context still declares paths', () =>
    /still\s*declares `paths:`/.test(prose));

  // The nested form works today only because nobody passed `flat: true` to the
  // Contexts section. Pinned on that row rather than on the file, so adding the
  // flag fails here instead of silently dropping every nested context from
  // discovery. The skills row is checked too: a guard that cannot tell the two
  // apart is not reading the flag at all.
  const index = readSrc('scripts', 'index.mjs');
  const row = (dir) => new RegExp(`\\{[^}]*dir: '${dir}'[^}]*\\}`).exec(index)?.[0] ?? '';
  assert('index.mjs walks contexts/ rather than flat-listing it', () =>
    row('contexts') !== '' && !/flat/.test(row('contexts')));
  assert('index.mjs does flat-list skills/, so the check reads the flag', () =>
    /flat/.test(row('skills')));

  const { dir, aep } = installFixture();
  const contextsDir = path.join(aep, 'contexts');
  const probe = (rel, extra = '') => {
    const file = path.join(contextsDir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '---\naep: 0.0.0\nowner: repository\n' +
      'date: 2026-01-01\nkind: context\nuse-when: "a fixture is being probed and validate must accept it"\n---\n\n# Probe\n' + extra);
    return file;
  };
  /** Runs the fixture's own validate.mjs. Returns null on success, stderr on failure. */
  const validateFixture = () => {
    try {
      execFileSync(process.execPath, [path.join(aep, 'scripts', 'validate.mjs'), '--root', aep],
        { stdio: 'pipe' });
      return null;
    } catch (error) {
      return String(error.stderr ?? '');
    }
  };

  // All three depths, not just the rejection: a guard proven only on the failing
  // case can still be rejecting what it should accept.
  for (const [depth, rel] of [['flat', 'probe.md'], ['namespaced', 'web/auth.md']]) {
    const file = probe(rel);
    const output = validateFixture();
    fs.rmSync(file);
    assert(`validate accepts a ${depth} context`, () => output === null, { });
    if (output !== null) process.stdout.write(`        ${output.trim().split('\n').pop()}\n`);
  }
  const tooDeep = probe('web/admin/auth.md');
  const rejection = validateFixture();
  fs.rmSync(tooDeep);
  fs.rmSync(path.join(contextsDir, 'web', 'admin'), { recursive: true, force: true });
  assert('validate rejects a context nested deeper than one project directory', () =>
    rejection !== null);
  assert('the rejection names the file and both legal forms', () =>
    rejection !== null &&
    /contexts\/web\/admin\/auth\.md/.test(rejection) &&
    /contexts\/<area>\.md/.test(rejection) &&
    /contexts\/<project>\/<area>\.md/.test(rejection));

  // Behavioural, not textual: if anything derived applicability from the
  // directory, a nested context declaring no `paths:` would acquire one, and the
  // index would print it. This is the only shape of this check that can fail.
  const bare = probe('web/auth.md');
  execFileSync(process.execPath, [path.join(aep, 'scripts', 'index.mjs'), '--root', aep],
    { stdio: 'ignore' });
  const indexed = fs.readFileSync(path.join(aep, 'index.md'), 'utf8');
  fs.rmSync(bare);
  fs.rmSync(path.join(contextsDir, 'web'), { recursive: true, force: true });
  const listed = indexed.split('\n').find((line) => line.includes('[[contexts/web/auth]]')) ?? '';
  assert('the index lists a nested context by its full wiki-link', () => listed !== '');
  assert('a nested context declaring no paths acquires none from its directory', () =>
    listed !== '' && /\|\s*\u2014\s*\|\s*repository\s*\|/.test(listed));

  // Leave the fixture as it was found: a file left behind changes what every
  // later section sees in this tree.
  execFileSync(process.execPath, [path.join(aep, 'scripts', 'index.mjs'), '--root', aep],
    { stdio: 'ignore' });
  assert('the fixture is left as it was found', () =>
    !fs.existsSync(path.join(contextsDir, 'web')) && fs.existsSync(path.join(dir, '.aep')));

  // Asking how to use the script must not run it: `--help` once fell through
  // to the write and rewrote the index during a review.
  assert('index.mjs refuses an unknown option and writes nothing', () => {
    const target = path.join(aep, 'index.md');
    fs.writeFileSync(target, 'sentinel\n', 'utf8');
    const run = spawnSync(process.execPath, [path.join(aep, 'scripts', 'index.mjs'), '--root', aep, '--help'],
      { encoding: 'utf8' });
    const untouched = fs.readFileSync(target, 'utf8') === 'sentinel\n';
    execFileSync(process.execPath, [path.join(aep, 'scripts', 'index.mjs'), '--root', aep], { stdio: 'ignore' });
    return run.status === 2 && /unknown option: --help/.test(run.stderr) && untouched;
  });
});

// --- a reader for the block YAML the automation seeds are written in --------
//
// There is no package manager here and no YAML parser, so "it parses as YAML"
// has to be answered by something in this file. This is that something, and it
// is worth being exact about what it is and is not.
//
// It reads the subset the two automation seeds use: block mappings, block
// sequences, plain and quoted scalars, `|` and `>` block scalars, and comments.
// It catches what actually breaks a workflow file. A tab in the indentation, a
// key indented under no parent, a duplicate key, a line that is neither a
// mapping entry nor a sequence item. Every structural assertion below reads the
// tree it returns rather than grepping the text, so a step that drifted out of
// its job fails instead of passing on a match found anywhere in the file.
//
// It does not catch what it does not implement. Anchors, aliases, flow
// collections, tags, multiple documents, and complex keys are all legal YAML and
// all rejected here, so a seed written with one fails this suite rather than the
// forge. That direction is deliberate: a checker stricter than the format is
// safe, and a checker looser than it is the one that ships a broken file. It
// also reads `on:` as the string `on` where YAML 1.1 reads the boolean true,
// which is why the assertions look that key up by name.
//
// What it therefore cannot tell you is whether a forge accepts the file. Only
// the forge can, and for GitLab nothing in this repository ever will.

/** A scalar with its surrounding quotes and any trailing comment removed. */
const scalarValue = (text) => {
  const value = text.trim();
  if (value.startsWith('"') || value.startsWith("'")) {
    const close = value.indexOf(value[0], 1);
    if (close === -1) throw new Error(`unterminated quote: ${value}`);
    return value.slice(1, close);
  }
  const comment = value.search(/\s#/);
  return (comment === -1 ? value : value.slice(0, comment)).trim();
};

function readBlockYaml(text) {
  const lines = text.split('\n');
  const KEY = /^("[^"]*"|'[^']*'|[^:#]+):(?:\s+(.*))?$/;
  const indentOf = (line) => line.length - line.trimStart().length;
  const ignorable = (line) => line.trim() === '' || line.trimStart().startsWith('#');
  let at = 0;

  for (const [n, line] of lines.entries()) {
    if (/^ *\t/.test(line)) throw new Error(`line ${n + 1}: a tab in the indentation`);
  }

  // Everything indented past the key that opened the block, with that block's
  // own indentation preserved relative to its first line.
  const blockScalar = (owner) => {
    const held = [];
    let base = null;
    while (at < lines.length && (lines[at].trim() === '' || indentOf(lines[at]) > owner)) {
      if (lines[at].trim() !== '' && base === null) base = indentOf(lines[at]);
      held.push(lines[at].trim() === '' ? '' : lines[at].slice(base ?? 0));
      at += 1;
    }
    return held.join('\n');
  };

  const node = (least) => {
    while (at < lines.length && ignorable(lines[at])) at += 1;
    if (at >= lines.length || indentOf(lines[at]) < least) return '';
    const opener = lines[at].trimStart();
    return opener === '-' || opener.startsWith('- ')
      ? sequence(indentOf(lines[at]))
      : mapping(indentOf(lines[at]));
  };

  const mapping = (indent) => {
    const built = {};
    while (at < lines.length) {
      if (ignorable(lines[at])) { at += 1; continue; }
      const here = indentOf(lines[at]);
      if (here < indent) break;
      if (here > indent) throw new Error(`line ${at + 1}: indented under no key`);
      const parts = KEY.exec(lines[at].trim());
      if (!parts) throw new Error(`line ${at + 1}: not a mapping entry: ${lines[at].trim()}`);
      const key = scalarValue(parts[1]);
      if (key in built) throw new Error(`line ${at + 1}: ${key} is declared twice`);
      const rest = (parts[2] ?? '').trim();
      at += 1;
      if (/^[|>][-+]?$/.test(rest)) built[key] = blockScalar(indent);
      else if (rest === '') built[key] = node(indent + 1);
      else built[key] = scalarValue(rest);
    }
    return built;
  };

  const sequence = (indent) => {
    const built = [];
    while (at < lines.length) {
      if (ignorable(lines[at])) { at += 1; continue; }
      const here = indentOf(lines[at]);
      if (here < indent) break;
      if (here > indent) throw new Error(`line ${at + 1}: indented under no item`);
      const line = lines[at].trimStart();
      if (line !== '-' && !line.startsWith('- ')) {
        throw new Error(`line ${at + 1}: not a sequence item: ${line}`);
      }
      const rest = line === '-' ? '' : line.slice(2).trim();
      if (rest === '') { at += 1; built.push(node(indent + 1)); continue; }
      if (/^[|>][-+]?$/.test(rest)) { at += 1; built.push(blockScalar(indent)); continue; }
      if (KEY.test(rest)) {
        // An inline `- key: value` opens a mapping two columns in, which is
        // where its siblings on the following lines already sit.
        lines[at] = ' '.repeat(indent + 2) + rest;
        built.push(mapping(indent + 2));
        continue;
      }
      at += 1;
      built.push(scalarValue(rest));
    }
    return built;
  };

  const document = node(0);
  while (at < lines.length && ignorable(lines[at])) at += 1;
  if (at < lines.length) throw new Error(`line ${at + 1}: trailing content`);
  return document;
}

/** The first value found under `key`, at any depth. */
const deepValue = (node, key) => {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = deepValue(item, key);
      if (found !== null) return found;
    }
    return null;
  }
  if (node && typeof node === 'object') {
    if (typeof node[key] === 'string') return node[key];
    for (const value of Object.values(node)) {
      const found = deepValue(value, key);
      if (found !== null) return found;
    }
  }
  return null;
};

/** The leading comment block of a file, up to the first line of content. */
const preamble = (text) => {
  const held = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '' && held.length === 0) continue;
    if (!line.startsWith('#')) break;
    held.push(line.replace(/^#\s?/, ''));
  }
  return held.join('\n');
};

// The section heading that makes a seeded reference a tracker reference. One
// constant, because it is both what the existing assertion looks for and the
// discriminator the automation requirement keys on, and two copies would let one
// move without the other.
const TRACKER_SECTION = '## AEP in this tracker';

// --- §7, §29 the seeds ------------------------------------------------------

section('seeds', () => {
  for (const seed of SEEDS) {
    const file = path.join(SRC, ...seed.source.split('/'));
    assert(`${seed.source} ships`, fs.existsSync(file));
    if (!fs.existsSync(file)) continue;

    const artifact = readArtifact(file);

    if (seed.root) {
      // A root seed lands outside `.aep/`, so it is not an AEP artifact and must
      // carry no frontmatter. Otherwise the repository's own entrypoint would
      // arrive claiming to be governed by a contract that does not reach it.
      assert(`${seed.source} carries no AEP frontmatter, it lands outside .aep/`,
        !artifact.hasFrontmatter);
      assert(`${seed.source} points at the protocol rather than restating it`, () =>
        artifact.body.includes('.aep/protocol.md'));
      assert(`${seed.source} says it belongs to the repository now`, () =>
        /It is yours/.test(artifact.body));
      continue;
    }

    assert(`${seed.source} declares use-when`, isNonEmptyString(artifact.fields['use-when']));
    assert(`${seed.source} says it is a starting point rather than a description`, () =>
      /This file is yours/.test(artifact.body));
    assert(`${seed.source} targets a repository-owned directory`, () =>
      /^(contexts|references|rules)\//.test(seed.target));
  }

  // The resolution has to land somewhere the next session reads, and for the two
  // forges that ship a reference, that section is seeded rather than left to be
  // invented per repository.
  for (const forge of ['github', 'gitlab']) {
    assert(`seed/references/${forge}.md carries the section a resolution is recorded in`, () =>
      readSrc('seed', 'references', `${forge}.md`).includes(TRACKER_SECTION));
  }

  // A seed file nothing declares ships in the distribution and installs
  // nowhere. Nothing else notices: the tree looks complete, the file reads as
  // authoritative, and no repository ever receives it. Across a catalogue this
  // size that is one forgotten line in the manifest.
  //
  // An automation file is declared the same way and by the same catalogue, so it
  // is reached by the same sweep: it is named by the `automation` field of the
  // seed it belongs to rather than by an entry of its own, and one nobody named
  // fails here exactly as an undeclared reference does.
  assert('every file under seed/ is declared in SEEDS', () => {
    const declared = new Set([...SEEDS.map((seed) => seed.source), LABEL_SEED]);
    for (const seed of SEEDS) if (seed.automation) declared.add(seed.automation);
    const orphans = walk(path.join(SRC, 'seed'))
      .map((file) => toPosix(SRC, file))
      .filter((source) => !declared.has(source));
    if (orphans.length > 0) throw new Error(`declared by nothing: ${orphans.join(', ')}`);
    return true;
  });

  // `detect: { paths: [] }` is truthy and matches nothing, so it reads as a
  // gated seed and behaves as a retired one. The runtime references are the one
  // exception, and only because the runtime is read from the session's
  // environment: no file in a repository says which runtime opens it.
  assert('every reference seed is gated on evidence that can actually match', () => {
    const dead = SEEDS.filter((seed) => seed.target.startsWith('references/'))
      .filter((seed) => !RUNTIME_REFERENCES.includes(seed.target)).filter(
      (seed) => !(seed.detect?.paths?.length > 0 || isNonEmptyString(seed.detect?.remote)));
    if (dead.length > 0) {
      throw new Error(`cannot ever install: ${dead.map((seed) => seed.target).join(', ')}`);
    }
    return true;
  });

  const targets = SEEDS.map((seed) => seed.target);
  assert('no seed target is declared twice', () => new Set(targets).size === targets.length);
  assert('exactly one seed targets the repository root, and it is the entrypoint', () => {
    const roots = SEEDS.filter((seed) => seed.root);
    return roots.length === 1 && roots[0].target === 'AGENTS.md';
  });
  // The seeded rule used to attribute the pull request body to a human, which
  // stopped being true when the runner started opening it. A rule saying a
  // human writes the body is not one a runner reads as an instruction to write
  // the keyword into it. The placement is asserted beside the claim, because
  // the cheapest way to satisfy the first assertion alone is to delete the row
  // that says where the keyword goes.
  const seedVersionControl = flat(readSrc('seed', 'rules', 'version-control.md'));
  assert('the seeded version-control rule no longer attributes the body to a human', () =>
    !/pull request\b[^|]*\ba human writes/.test(seedVersionControl));
  assert('the seeded rule still puts the closing keyword in the pull request body', () =>
    /The keyword belongs in the pull request body/.test(seedVersionControl));

  assert('the always-seeded set is the entrypoint, version control, a repository context, and the runtime references', () => {
    const always = SEEDS.filter((seed) => !seed.detect).map((seed) => seed.target).sort();
    return JSON.stringify(always) ===
      JSON.stringify(['AGENTS.md', 'contexts/repository.md', ...RUNTIME_REFERENCES, 'rules/version-control.md'].sort());
  });
  assert('every runtime aep.mjs detects has a seeded reference', () =>
    RUNTIME_REFERENCES.every((target) => SEEDS.some((seed) => seed.target === target)));

  // --- the merge-time half of a tracker reference ---------------------------
  //
  // The label ladder ends at a value no file can derive. Merged is a fact the
  // forge holds, and every AEP run has finished by the time it becomes true, so
  // a reference recording how an effort projects onto a tracker ships with a job
  // that fires at that forge's own merge event or the last row of the ladder has
  // no owner in that repository.
  //
  // Which references those are is read from the references themselves. A list of
  // forges kept here is the thing this check exists to remove: it would be
  // correct the day it was written and silent the day somebody added the third
  // one.
  const inSrcPath = (source) => path.join(SRC, ...source.split('/'));
  const trackerSeeds = SEEDS
    .filter((seed) => seed.source.startsWith('seed/references/'))
    .filter((seed) => fs.existsSync(inSrcPath(seed.source)))
    .filter((seed) => fs.readFileSync(inSrcPath(seed.source), 'utf8').includes(TRACKER_SECTION));

  // Without this the check below passes on an empty set the day the heading is
  // reworded, which is the failure that reads as a clean run.
  assert('the tracker section still discriminates, so the automation check has subjects', () => {
    if (trackerSeeds.length === 0) {
      throw new Error(`no seeded reference carries "${TRACKER_SECTION}"`);
    }
    return true;
  });

  assert('every tracker reference declares a merge-time automation that ships', () => {
    const bare = trackerSeeds.filter((seed) =>
      !isNonEmptyString(seed.automation) || !fs.existsSync(inSrcPath(seed.automation)));
    if (bare.length > 0) {
      throw new Error(
        `carries "${TRACKER_SECTION}" with no automation beside it, so it was declared with `
        + `reference() rather than forge(): ${bare.map((seed) => seed.source).join(', ')}`);
    }
    return true;
  });

  // Requirement 10, twice. An automation file has no `target`, and the installer
  // copies `source` to `target` for every entry in SEEDS while knowing nothing
  // about `automation`, so it cannot write one into anybody's repository. That is
  // also why the per-seed assertion above, that every seed target is a
  // repository-owned directory, needed no widening: a workflow file lands outside
  // `.aep/` and has no seed target to be checked against.
  assert('an automation file is declared beside a seed and never as one', () => {
    const declared = new Set([...SEEDS.map((seed) => seed.source), ...SEEDS.map((seed) => seed.target)]);
    const promoted = trackerSeeds.filter((seed) => declared.has(seed.automation));
    if (promoted.length > 0) {
      throw new Error(`the installer would write: ${promoted.map((seed) => seed.automation).join(', ')}`);
    }
    return true;
  });

  assert('installing writes no automation file', () => {
    const fixture = installFixture();
    const named = trackerSeeds
      .filter((seed) => isNonEmptyString(seed.automation))
      .map((seed) => path.basename(seed.automation));
    const written = walk(fixture.dir, { skip: ['.git'] })
      .filter((file) => named.includes(path.basename(file)))
      .map((file) => toPosix(fixture.dir, file));
    if (written.length > 0) throw new Error(`written on install: ${written.join(', ')}`);
    return true;
  });

  // The two names the jobs write, pinned here rather than read off the files
  // being checked, because a job asserted against its own declaration asserts
  // nothing. Membership in the seeded vocabulary is the other half: a job may
  // write only a `status:` value this distribution already ships, so the label a
  // tracker receives and the label a repository was offered cannot drift apart.
  const TERMINAL_STATUS = 'status: done';
  const IN_REVIEW_STATUS = 'status: in review';
  const statusVocabulary = JSON.parse(readSrc('seed', 'labels.json'))
    .families.status.labels.map((label) => label.name);

  const parsedAutomation = new Map();
  for (const seed of trackerSeeds) {
    const source = seed.automation;
    if (!isNonEmptyString(source) || !fs.existsSync(inSrcPath(source))) continue;
    const text = fs.readFileSync(inSrcPath(source), 'utf8');

    let doc = null;
    assert(`${source} parses as the block YAML this suite reads`, () => {
      doc = readBlockYaml(text);
      return true;
    });
    if (doc === null) continue;
    parsedAutomation.set(source, doc);

    const written = [deepValue(doc, 'TERMINAL_LABEL'), deepValue(doc, 'IN_REVIEW_LABEL')];

    assert(`${source} writes the terminal status value and the one it replaces`, () => {
      if (written[0] !== TERMINAL_STATUS || written[1] !== IN_REVIEW_STATUS) {
        throw new Error(`declares ${JSON.stringify(written)}`);
      }
      return true;
    });

    assert(`${source} writes only labels the seeded vocabulary declares`, () => {
      const strangers = written.filter((name) => !statusVocabulary.includes(name));
      if (strangers.length > 0) {
        throw new Error(`not in seed/labels.json: ${JSON.stringify(strangers)}`);
      }
      return true;
    });

    assert(`${source} names AEP in no label it writes`, () =>
      !written.some((name) => /aep/i.test(name ?? '')));
  }

  // GitHub. The half that needs nothing provisioned, which is why it is checked
  // for the absence of a stored secret rather than for a promise in its preamble.
  const githubDoc = parsedAutomation.get('seed/automation/github.yml') ?? {};
  const githubJob = githubDoc.jobs?.['effort-status'] ?? {};
  const githubSteps = Array.isArray(githubJob.steps) ? githubJob.steps : [];

  assert('seed/automation/github.yml fires when a change request closes', () => {
    const types = githubDoc.on?.pull_request?.types;
    if (!Array.isArray(types) || !types.includes('closed')) {
      throw new Error(`on.pull_request.types is ${JSON.stringify(types)}`);
    }
    return true;
  });

  assert('seed/automation/github.yml guards on the merge actually having happened', () => {
    const guards = githubSteps.map((step) => step.if).filter(isNonEmptyString);
    if (!guards.some((guard) => /github\.event\.pull_request\.merged\s*==\s*true/.test(guard))) {
      throw new Error('no step reads whether the merge happened');
    }
    if (!guards.some((guard) => /github\.event\.pull_request\.merged\s*!=\s*true/.test(guard))) {
      throw new Error('nothing separates a change request closed without merging');
    }
    return true;
  });

  // Criterion 3, read off the structure rather than out of the prose: the steps
  // that write the label carry no condition at all, so the merged branch and the
  // abandoned branch reach the same terminal value. A guard added to one of them
  // later is exactly what this catches.
  assert('seed/automation/github.yml moves the label whether or not the merge happened', () => {
    const writing = githubSteps.filter((step) => /--add-label/.test(step.run ?? ''));
    if (writing.length === 0) throw new Error('no step adds a label');
    const conditional = writing.filter((step) => 'if' in step).map((step) => step.name);
    if (conditional.length > 0) {
      throw new Error(`a labelling step is conditional on the merge: ${conditional.join(', ')}`);
    }
    return true;
  });

  assert('seed/automation/github.yml moves the change request and the issue it closes', () => {
    const run = githubSteps.map((step) => step.run ?? '').join('\n');
    for (const needed of ['gh pr edit', 'gh issue edit', 'closingIssuesReferences']) {
      if (!run.includes(needed)) throw new Error(`no step runs ${needed}`);
    }
    return true;
  });

  assert('seed/automation/github.yml asks for the two scopes that carry it', () => {
    const permissions = githubJob.permissions ?? {};
    if (permissions['pull-requests'] !== 'write' || permissions.issues !== 'write') {
      throw new Error(`declares ${JSON.stringify(permissions)}`);
    }
    return true;
  });

  assert('seed/automation/github.yml needs no secret created before it runs', () => {
    const text = readSrc('seed', 'automation', 'github.yml');
    if (/secrets\./.test(text)) throw new Error('reads a stored secret');
    if (!text.includes('github.token')) throw new Error('does not run on the built-in token');
    return true;
  });

  // GitLab. The half that cannot be self-contained: no pipeline fires at merge
  // and the job token is read-only against merge requests, so it needs a token a
  // person creates. Its position in the file is the criterion, not a preference.
  const gitlabDoc = parsedAutomation.get('seed/automation/gitlab.yml') ?? {};
  const gitlabText = readSrc('seed', 'automation', 'gitlab.yml');
  const gitlabJob = gitlabDoc['effort-status'] ?? {};
  const gitlabScript = Array.isArray(gitlabJob.script) ? gitlabJob.script.join('\n') : '';
  const gitlabRules = Array.isArray(gitlabJob.rules)
    ? gitlabJob.rules.map((rule) => rule.if ?? '') : [];

  assert('seed/automation/gitlab.yml names its api-scoped token before anything else', () => {
    const opening = (preamble(gitlabText).split('\n\n')[0] ?? '').trim();
    if (opening === '') throw new Error('the file opens with content rather than with what it needs');
    if (!/`api` scope/.test(opening)) throw new Error(`the opening does not name the scope: ${opening}`);
    if (!/token/.test(opening)) throw new Error('the opening does not say it is a token');
    if (!/AEP_STATUS_TOKEN/.test(opening)) throw new Error('the opening does not name the variable');
    return true;
  });

  assert('seed/automation/gitlab.yml reads its token from the variable its own text names', () =>
    gitlabScript.includes('$AEP_STATUS_TOKEN'));

  assert('seed/automation/gitlab.yml runs on the push a merge produced', () => {
    const push = gitlabRules.some((rule) =>
      /CI_PIPELINE_SOURCE\s*==\s*"push"/.test(rule)
      && /CI_COMMIT_BRANCH\s*==\s*\$CI_DEFAULT_BRANCH/.test(rule));
    if (!push) throw new Error(`rules are ${JSON.stringify(gitlabRules)}`);
    return true;
  });

  // Criterion 3 on the forge that has no event for it. A merge request closed
  // without merging produces no commit and therefore no pipeline, so the file
  // carries an entry point reached by hand, and the state test that decides what
  // to write accepts closed as well as merged.
  assert('seed/automation/gitlab.yml reaches the terminal value for a close without a merge', () => {
    if (!gitlabRules.some((rule) => /AEP_MERGE_REQUEST/.test(rule))) {
      throw new Error(`no rule reaches a merge request that produced no pipeline: ${JSON.stringify(gitlabRules)}`);
    }
    if (!/merged \| closed/.test(gitlabScript)) {
      throw new Error('the terminal-state test does not accept a merge request closed without merging');
    }
    return true;
  });

  assert('seed/automation/gitlab.yml guards on the merge request being in a terminal state', () => {
    if (!/jq -r '\.state'/.test(gitlabScript)) {
      throw new Error('nothing reads the merge request state, so the pipeline running is the guard');
    }
    if (!/exit 0/.test(gitlabScript)) {
      throw new Error('nothing stops on a merge request that is still open');
    }
    return true;
  });

  // Found by the correctness review of 2026-08-26. `set -e` does not see curl's
  // exit status through a pipe and `jq` exits 0 on empty input, so every
  // `curl -sf ... | jq` here turned a refused request into an empty string and
  // carried on. A token without `api` scope produced a green job that moved no
  // label and reported the merge request as being in state "". That is the exact
  // inverse of this file's own opening promise, and of the mitigation `spec.md`
  // records for shipping the GitLab half unverified: that a failure is legible.
  assert('seed/automation/gitlab.yml reads nothing through an unchecked pipe', () => {
    const piped = gitlabText.split('\n')
      .filter((line) => /curl\s+-/.test(line))
      .filter((line) => !/-X PUT/.test(line))
      .filter((line) => !/if ! body=\$\(curl/.test(line));
    if (piped.length > 0) throw new Error(`unchecked curl: ${piped.join(' | ').trim()}`);
    return true;
  });
  assert('seed/automation/gitlab.yml says which scope is missing when a read is refused', () =>
    /AEP_STATUS_TOKEN needs api scope/.test(gitlabText)
    && /exit 1/.test(gitlabText));
  assert('seed/automation/gitlab.yml refuses to guess at an empty state', () =>
    /returned no state\. Refusing to guess/.test(gitlabText));

  assert('seed/automation/gitlab.yml moves the merge request and the issues it closes', () => {
    for (const needed of ['merge_requests/$iid', 'closes_issues', 'add_labels', 'remove_labels']) {
      if (!gitlabScript.includes(needed)) throw new Error(`the script never reaches ${needed}`);
    }
    return true;
  });
});

// --- templates --------------------------------------------------------------

section('templates', () => {
  const templates = listMarkdown('templates').map((file) => path.basename(file, '.md'));
  for (const expected of ['protocol', 'agents', 'agent', 'rule', 'reference', 'context', 'skill',
    'spec', 'plan', 'ticket', 'research', 'prototype']) {
    assert(`templates/${expected}.template.md ships`, templates.includes(`${expected}.template`));
  }

  // The split. A template claiming the other does not exist is worse than a
  // missing template: it reads as governance and contradicts what ships.
  const specTemplate = readSrc('templates', 'spec.template.md');
  const planTemplate = readSrc('templates', 'plan.template.md');
  assert('the spec template does not deny the plan template', () =>
    !/no `plan\.md`|NEVER create `plan\.md`/i.test(specTemplate));
  assert('the spec template sends the approach to the plan template', () =>
    specTemplate.includes('templates/plan.template'));
  assert('the spec template still refuses an architecture section', () =>
    /Write no `# Architecture` section here/.test(specTemplate));
  assert('the plan template carries the approach and the alternatives that lost', () =>
    /# Architecture/.test(planTemplate) && /alternatives that lost/.test(planTemplate));
  assert('the plan template forbids restating the spec', () =>
    /Never restate the spec/i.test(planTemplate));

  // §8 makes `status` legal on an effort's spec and on a ticket, and nowhere
  // else -- so a plan template showing one hands every reader frontmatter that
  // `validate.mjs` then rejects, which is the worst kind of template: the file
  // it produces is wrong, and the tool that catches it blames the author.
  assert('the plan template shows a use-when and no status', () => {
    const block = (planTemplate.split('```markdown')[1] ?? '').split('---')[1] ?? '';
    const fields = [...block.matchAll(/^([a-z-]+):/gm)].map((m) => m[1]);
    if (JSON.stringify(fields) !== JSON.stringify(['use-when'])) {
      throw new Error(`shows: ${fields.join(', ') || 'nothing'}`);
    }
    return true;
  });
  assert("the plan template says why the effort's status is not its to declare", () =>
    /`status` is the spec's, and is illegal here/.test(planTemplate));

  // The frontmatter block a ticket copies, pinned as the exact pair, so a field
  // creeping back in fails rather than passing as a superset.
  assert('the ticket template shows status and blocked-by, and nothing else', () => {
    const block = readSrc('templates', 'ticket.template.md').split('```markdown')[1] ?? '';
    const fields = [...(block.split('---')[1] ?? '').matchAll(/^([a-z-]+):/gm)].map((m) => m[1]);
    if (JSON.stringify(fields) !== JSON.stringify(['status', 'blocked-by'])) {
      throw new Error(`shows: ${fields.join(', ')}`);
    }
    return true;
  });
  for (const file of listMarkdown('templates')) {
    const rel = toPosix(SRC, file);
    const artifact = readArtifact(file);
    assert(`${rel} declares use-when`, isNonEmptyString(artifact.fields['use-when']));
    assert(`${rel} shows its shape in a fenced block rather than as live frontmatter`, () =>
      /```/.test(artifact.body));
  }
});

// --- §9 links ---------------------------------------------------------------
// Resolved against the fixture install, because a distribution has no
// repository-owned directories: `[[contexts]]` and `[[index]]` exist only once a
// repository has been installed, and a checker that ignored them would be blind
// to exactly the links most likely to rot.

section('links', () => {
  // A bracketed literal in a criterion is data. Read as a link, a ticket whose
  // criterion says `toCsv([["a","b"]])` failed validation for a link to nothing.
  assert('a nested array literal is not read as a link, and a backticked link still is', () =>
    JSON.stringify(wikiLinks('`toCsv([["a","b"],["c","d"]])` per `[[policies/execution]]`'))
      === JSON.stringify(['policies/execution']));
  const fixture = installFixture();
  let count = 0;
  for (const file of walk(fixture.aep, { skip: ['position', 'worktrees'] })) {
    if (!file.endsWith('.md')) continue;
    for (const target of wikiLinks(readArtifact(file).body)) {
      count += 1;
      const base = path.join(fixture.aep, ...target.split('/'));
      const resolves =
        fs.existsSync(`${base}.md`) ||
        fs.statSync(base, { throwIfNoEntry: false })?.isDirectory();
      assert(`${toPosix(fixture.aep, file)} → [[${target}]] resolves`, Boolean(resolves));
    }
  }
  assert('the payload actually contains links to check', count > 0);
  process.stdout.write(`        ${count} links checked\n`);
});

// --- §5, §14.2, §16 structures that must not exist --------------------------

section('forbidden', () => {
  // Read from the contract, never from a second list here: two lists of the
  // same thing drift, and the one in the test file drifts silently.
  for (const dir of FORBIDDEN_DIRS) {
    assert(`no ${dir}/ in the distribution`, !inSrc(dir));
  }
  assert('modes/ is a retired directory rather than merely an unshipped one', () =>
    FORBIDDEN_DIRS.includes('modes'));
  assert('no plan.md ships', !inSrc('plan.md'));

  // Everything shipped, seeds and their automation included. A merge-time job is
  // read inside whatever repository accepted it, so a citation that resolves only
  // here is the same defect there as it is in a seeded reference.
  const shippedText = [
    ...payloadArtifacts(),
    ...SEEDS.map((s) => s.source),
    ...SEEDS.filter((s) => s.automation).map((s) => s.automation),
  ].map((entry) => (path.isAbsolute(entry) ? entry : path.join(SRC, ...entry.split('/'))));

  const all = shippedText
    .filter((file) => fs.existsSync(file))
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');

  // Both layers, because the newer one is the likelier place to slip: a policy
  // is rigid in authority, and the tempting mistake is to make it rigid in
  // loading too.
  assert('nothing instructs an agent to load every policy or rule', () =>
    !/load all (the )?(policies|rules)/i.test(all));
  assert('the payload never treats a runtime directory as canonical state', () =>
    !/canonical[^.\n]{0,40}\.(claude|cursor|codex)\//i.test(all));
  assert('shipped text cites no record that exists only in this repository', () =>
    !/\bADR \d{4}\b/.test(all) && !/\bspecs\.md\b/.test(all));

  // Criterion 47.09, and the reason it is a sweep rather than a line about one
  // file. `reconcile.mjs` exists so a repository that declined the merge-time
  // offer still converges, which makes it the one component that must not reach
  // for a tracker: a `gh` or `glab` call here would be the unconditional
  // tracker call ticket 45.26 forbids, on the single path meant to be free of
  // them. Asked of every installed script rather than of that one, so the next
  // payload script to reach for a forge fails this too.
  //
  // Read off the code and not the prose. Every shipped script's header explains
  // what it does and does not call, so a text scan for `gh` matches the
  // sentence saying it never runs one. What is swept is the process starts, and
  // a command assembled from a variable throws rather than passing, because a
  // call this cannot read is the same hole as not sweeping at all.
  assert('no installed script starts a forge CLI', () => {
    const starts = /(?<![.\w])(exec|execSync|execFile|execFileSync|spawn|spawnSync)\s*\(/g;
    const offending = [];
    let swept = 0;
    let setupRuns = 0;
    for (const name of PAYLOAD_SCRIPTS) {
      const file = path.join(SRC, 'scripts', name);
      if (!fs.existsSync(file)) throw new Error(`${name} is registered and not shipped`);
      const source = fs.readFileSync(file, 'utf8');
      swept += 1;
      // The one deliberate exception: aep.mjs runs the command the repository
      // wrote into its own `setup:` setting, and only inside `runSetup`. It is
      // the repository's command, not a forge call AEP chose to make.
      const setupAt = name === 'aep.mjs' ? source.indexOf('\nfunction runSetup(command, cwd) {') : -1;
      const setupEnd = setupAt === -1 ? -1 : source.indexOf('\n}\n', setupAt);
      for (const match of source.matchAll(starts)) {
        const after = source.slice(match.index + match[0].length).trimStart();
        const literal = /^(['"\`])([^'"\`]*)\1/.exec(after);
        if (!literal && match.index > setupAt && match.index < setupEnd && setupAt !== -1
          && /^command,\s*\{\s*cwd,\s*shell:\s*true\b/.test(after)) {
          setupRuns += 1;
          continue;
        }
        if (!literal) throw new Error(`${name} calls ${match[1]} with a command this cannot read`);
        const command = literal[2].trim().split(/\s+/)[0];
        if (command !== 'git') offending.push(`${name} starts ${command}`);
      }
    }
    if (swept !== PAYLOAD_SCRIPTS.length) throw new Error('the sweep read fewer scripts than ship');
    if (offending.length > 0) throw new Error(offending.join('; '));
    if (setupRuns !== 1) throw new Error(`expected exactly one setup run in aep.mjs, found ${setupRuns}`);
    return true;
  });
  // And the exception is reached only from the repository's own setting.
  assert('aep.mjs runs only the command the repository wrote into setup:', () => {
    const source = fs.readFileSync(path.join(SRC, 'scripts', 'aep.mjs'), 'utf8');
    const calls = [...source.matchAll(/(?<!function )runSetup\(([^,]+),/g)].map((m) => m[1].trim());
    return calls.length === 1 && calls[0] === 'settings.setup';
  });
  // The sweep above passes trivially on a list that does not contain the script
  // it was written for, which is how ticket 45.26's version once passed green
  // after an edit moved its subject out from under it.
  assert('the sweep covers reconcile.mjs by name', () =>
    PAYLOAD_SCRIPTS.includes('reconcile.mjs')
    && fs.existsSync(path.join(SRC, 'scripts', 'reconcile.mjs')));
});

// --- §15.2 the prohibitions a script can check ------------------------------
// The policy's four are one scan away from being checked, and the first of them
// is the one this repository had most of. Scoped to what the reader test calls
// governed: the shipped scripts, whose comments and messages a person reads, and
// this repository's own documentation. Everything the test calls exempt is
// asserted to be absent from the list, because an over-broad sweep is the
// failure that reads as thoroughness.

section('governed text', () => {
  const scripts = walk(SRC).filter((f) => f.endsWith('.mjs'));
  assert('there are shipped scripts to scan', () => scripts.length > 0);

  const holding = scripts
    .filter((f) => fs.readFileSync(f, 'utf8').includes(EM_DASH))
    .map((f) => toPosix(SRC, f));
  assert('no shipped script carries an em dash', () => holding.length === 0);
  if (holding.length > 0) process.stdout.write(`        holding one: ${holding.join(', ')}\n`);

  // Read inside the callback, so a file that has gone missing fails this
  // assertion rather than throwing and aborting the section, which would take
  // the scan above down with it and read as a smaller failure than it is.
  for (const name of GOVERNED_DOCS) {
    assert(`${name} carries no em dash`, () =>
      !fs.readFileSync(path.join(REPO, name), 'utf8').includes(EM_DASH));
  }

  // The exemption, proven two ways. That the exempt files are not in the swept
  // list is the claim; that each of them actually holds em dashes is what makes
  // the claim load-bearing. Without the second, a day when specs.md happens to
  // have none would leave this passing on nothing.
  for (const name of EXEMPT_FROM_PROSE_RULES) {
    assert(`${name} is exempt: it is not in the swept list`, () =>
      !GOVERNED_DOCS.includes(name));
    assert(`${name} exercises its exemption`, () =>
      fs.readFileSync(path.join(REPO, name), 'utf8').includes(EM_DASH));
  }
});

// --- §9.1 a path in shipped text says where it starts from ------------------

section('path convention', () => {
  // The fixtures come first, and the three that assert nothing is found are the
  // ones worth the lines. A guard reporting every path would fail the corpus
  // below exactly as loudly as a working one, and the failing run alone cannot
  // tell those apart.
  assert('a bare multi-segment path is a finding, named at the line it sits on', () => {
    const sites = barePathSites('one\ntwo\nCopy to `efforts/<effort>/spec.md`.\n');
    return sites.length === 1 && sites[0].line === 3 && sites[0].path === 'efforts/<effort>/spec.md';
  });
  assert('a path that already carries the root is not a finding', () =>
    barePathSites('Copy to `.aep/efforts/<effort>/spec.md`.').length === 0);
  assert('an area name is not a finding, bare or globbed', () =>
    barePathSites('A policy lives under `policies/`, and `scripts/*` served 1.x.').length === 0);
  // This arm reaches exactly what `outsideFences` reaches. An indented fence is
  // among that now, and it is the shape the corpus actually uses, so the arm
  // above pins it. A tilde fence and four backticks wrapping three are still
  // read as prose; the corpus holds neither, and this comment is the only place
  // that says so.
  // The corpus puts most of its examples inside numbered list items, so the
  // fence is indented to the item's content. Anchored at column zero the strip
  // skipped every one, and a path being shown read as one being written.
  assert('a path inside an indented fence is not a finding', () =>
    barePathSites('1. Like so:\n\n   ```md\n   Copy to `efforts/<effort>/spec.md`\n   ```\n')
      .length === 0);

  assert('a path being shown inside a fence is not a finding', () =>
    barePathSites('```md\nCopy to `efforts/<effort>/spec.md`\n```\n').length === 0);

  // Everything the release puts in somebody else's repository, plus this
  // repository's own entrypoint; the seeded one rides in with the seeds. The
  // adapters are here because they are generated from the payload, and left out
  // they would hold the old form until whoever regenerated them next looked.
  // `src/scripts/` is deliberately absent: its docstrings do write these paths,
  // but so does every JavaScript template literal building one, and there are
  // sixty-four of those.
  const arms = shippedSurfaces();

  // Each arm counted separately, because a clean run is what an arm scanning
  // nothing produces too. The adapters are the one that would go quiet: they
  // report nothing today, so an empty list there reads exactly like a pass.
  for (const [arm, files] of Object.entries(arms)) {
    assert(`the ${arm} arm has surfaces to scan`, () => files.length > 0);
  }

  const bare = [];
  for (const file of Object.values(arms).flat()) {
    for (const site of barePathSites(fs.readFileSync(file, 'utf8'))) {
      bare.push(`${toPosix(REPO, file)}:${site.line}  ${site.path}`);
    }
  }
  assert('no shipped or entrypoint surface writes a bare artifact path', () => bare.length === 0);
  if (bare.length > 0) {
    process.stdout.write(`        ${bare.length} bare paths:\n`);
    for (const site of bare) process.stdout.write(`          ${site}\n`);
  }
});

// --- §32 a retired field is never described as live -------------------------

section('retired fields', () => {
  // Both directions, because this check has to pass a sentence that names the
  // field in order to say it is gone. A guard that only ever fires and one
  // that never fires look the same from a single run, and this one has a
  // legitimate mention of every string it hunts.
  assert('a field named as live is a finding', () =>
    retiredFieldSites('Contexts are always `owner: repository`.').length === 1);
  assert('the same field named as retired is not', () =>
    retiredFieldSites('The `owner:` field was retired in 3.0.0.').length === 0);
  assert('a marker anywhere in the sentence licenses it', () =>
    retiredFieldSites('Nothing reads `owner:`, which 3.0.0 removed.').length === 0);

  // The narrowing, pinned. `no longer` and `stopped` are ordinary English about
  // degree, and while they were markers this sentence bought a licence to
  // describe the field as live.
  assert('a claim about degree is not a claim about retirement', () =>
    retiredFieldSites("A skill's `mode:` is no longer optional.").length === 1);

  // A sentence opening with a digit is its own sentence. Merged into the one
  // above it, and `1.x` being a marker, it licensed its neighbour.
  assert('a sentence opening with a digit does not license the one above it', () =>
    retiredFieldSites('Every artifact carries `owner: repository`.\n1.x had no such rule.')
      .length === 1);
  assert('a field shown inside a fence is not a finding', () =>
    retiredFieldSites('```md\n---\naep: 3.0.0\n---\n```\n').length === 0);
  assert('the English word is not a finding', () =>
    retiredFieldSites('The mode a skill takes, and the report it opens.').length === 0);

  // The shipped GitHub reference writes this to show a tracker label nobody
  // should create. It is the field's own name, in backticks, outside a fence,
  // and it is not the field, which is why the colon alone cannot decide.
  assert('a label namespace is not a finding', () =>
    retiredFieldSites('A tracker labelled `area/api` does not want `aep:effort/x` beside them.')
      .length === 0);

  // A sentence carries its marker across a line break as readily as within
  // one, so the unit has to survive the reflow that produced this corpus.
  assert('a sentence is read across the lines it wraps onto', () =>
    retiredFieldSites('The `aep:` frontmatter field this used to work\nthrough was retired.')
      .length === 0);

  // Driven over the whole list rather than over `aep:`. That is the field that
  // failed, so an assertion written around it would pass on it and generalise
  // to nothing. A release retiring an eighth field extends this by editing
  // `RETIRED_FIELDS`, which it already has to do.
  assert('the list holds more than the field that failed', () =>
    RETIRED_FIELDS.length > 1 && RETIRED_FIELDS.includes('aep'));
  for (const field of RETIRED_FIELDS) {
    assert(`a live ${field}: is a finding and a retired one is not`, () => {
      const written = retiredFieldSites(`Every artifact carries \`${field}: something\`.`);
      if (written.length !== 1 || written[0].field !== `${field}:`) {
        throw new Error(`live fixture reported ${JSON.stringify(written)}`);
      }
      return retiredFieldSites(`The \`${field}:\` field was retired in 3.0.0.`).length === 0;
    });
  }

  // Everything the release puts in somebody else's repository, plus this
  // repository's own entrypoint, which is the file that failed. `src/scripts/`
  // is absent: a script's object keys collide with field names, `scope.mjs`
  // alone holding five `kind:`, and `RETIRED_FIELDS` itself lives there, so
  // scanning scripts would check the list against its own definition.
  const arms = shippedSurfaces();
  for (const [arm, files] of Object.entries(arms)) {
    assert(`the ${arm} arm has surfaces to scan`, () => files.length > 0);
  }

  // The allowlist is pinned before it is applied, so a third entry is a
  // failure rather than a quietly wider hole, and each entry is proven to be
  // exercised: an allowlisted file with nothing to excuse is an exemption
  // nobody would notice had stopped meaning anything.
  assert('the allowlist is three files, each carrying its reason', () =>
    Object.keys(EXEMPT_FROM_RETIREMENT_SCAN).length === 3
    && Object.values(EXEMPT_FROM_RETIREMENT_SCAN).every(isNonEmptyString));
  assert('the entrypoint is not on the allowlist', () =>
    EXEMPT_FROM_RETIREMENT_SCAN[CANONICAL_ENTRYPOINT] === undefined);
  for (const name of Object.keys(EXEMPT_FROM_RETIREMENT_SCAN)) {
    assert(`${name} is on the allowlist and exists`, () => fs.existsSync(path.join(REPO, name)));
    assert(`${name} exercises its exemption`, () =>
      retiredFieldSites(fs.readFileSync(path.join(REPO, name), 'utf8')).length > 0);
  }

  const live = [];
  for (const file of Object.values(arms).flat()) {
    const name = toPosix(REPO, file);
    if (EXEMPT_FROM_RETIREMENT_SCAN[name] !== undefined) continue;
    for (const site of retiredFieldSites(fs.readFileSync(file, 'utf8'))) {
      live.push(`${name}  ${site.field}  ${site.sentence.slice(0, 90)}`);
    }
  }
  assert('no shipped or entrypoint surface describes a retired field as live', () =>
    live.length === 0);
  if (live.length > 0) {
    process.stdout.write(`        ${live.length} live claims:\n`);
    for (const site of live) process.stdout.write(`          ${site}\n`);
  }
});

// --- the entrypoint's claims are checked ------------------------------------

section('entrypoint claims', () => {
  // The split, asserted as the two facts it is. The entrypoint keeps its
  // exemption from the prose prohibitions and has lost its exemption from
  // everything else, and stating both here is what stops the second quietly
  // being reabsorbed into the first.
  assert('the entrypoint keeps only its prose exemption', () =>
    EXEMPT_FROM_PROSE_RULES.includes(CANONICAL_ENTRYPOINT));
  assert('the entrypoint is claim-checked', () =>
    ENTRYPOINTS[CANONICAL_ENTRYPOINT] !== undefined);
  assert('both entrypoints are covered and no third was assumed', () =>
    Object.keys(ENTRYPOINTS).length === 2);

  // The general net. Zero maintenance, and it is what catches the class the
  // named claims below cannot: a file that moved.
  for (const [name, file] of Object.entries(ENTRYPOINTS)) {
    const tokens = pathTokens(fs.readFileSync(file, 'utf8'));
    assert(`${name} names paths to check`, () => tokens.length > 0);
    const missing = tokens.filter((token) => !fs.existsSync(path.join(REPO, token)));
    assert(`every path ${name} names exists`, () => {
      if (missing.length > 0) throw new Error(`missing: ${missing.join(', ')}`);
      return true;
    });
  }

  // The seed is a consuming repository's file the moment it lands, so the only
  // paths it may name are ones every installed tree has. One naming `src/`
  // would be describing this repository to somebody who does not have it.
  assert('the seeded entrypoint names only paths an installed tree has', () => {
    const outside = pathTokens(fs.readFileSync(ENTRYPOINTS['src/seed/AGENTS.md'], 'utf8'))
      .filter((token) => !token.startsWith('.aep/'));
    if (outside.length > 0) throw new Error(`outside .aep/: ${outside.join(', ')}`);
    return true;
  });

  const entrypoint = fs.readFileSync(ENTRYPOINTS[CANONICAL_ENTRYPOINT], 'utf8');

  // Every command it shows, against the scripts on disk. Read inside the
  // fences, which is where a command is written.
  const invoked = fencedScripts(entrypoint);
  assert('the entrypoint shows commands to check', () => invoked.length > 0);
  assert('every script the entrypoint invokes exists', () => {
    const absent = invoked.filter((script) => !fs.existsSync(path.join(REPO, script)));
    if (absent.length > 0) throw new Error(`no such script: ${absent.join(', ')}`);
    return true;
  });

  // The claim that went stale, generalised. Naming one runtime was true when
  // the table held one and became false when it grew, so the assertion is
  // against the table rather than against the word `Claude`.
  const runtimes = Object.keys(TARGETS);
  assert('the release ships adapters for more than one runtime', () => runtimes.length > 1);
  assert('the entrypoint names no single runtime as the adapter', () => {
    const named = runtimes.filter((runtime) => {
      const proper = runtime.charAt(0).toUpperCase() + runtime.slice(1);
      return new RegExp(`the (?:${runtime}|${proper}) adapter`).test(entrypoint);
    });
    if (named.length > 0) throw new Error(`names ${named.join(', ')}`);
    return true;
  });

  // The baseline, against the constant the release script actually writes,
  // rather than against the string the entrypoint happens to carry.
  assert('the entrypoint names the baseline a release writes', () =>
    entrypoint.includes(`src/${STAMPS_SOURCE}`) && fs.existsSync(path.join(SRC, STAMPS_SOURCE)));
  assert('the baseline is not itself payload', () => !PAYLOAD_FILES.includes(STAMPS_SOURCE));

  // Every flag it documents, against the command it is documented under. The
  // pairing is what makes this honest rather than merely general: pooled
  // against every script the entrypoint invokes, a flag this suite happens to
  // mention would count as accepted, and the suite is one of those scripts.
  const flags = documentedFlags(entrypoint);
  // Three shapes this net got wrong once, each pinned so the correction is not
  // undone by the next reader who finds the test too narrow.
  assert('a pair of words joined by a slash is not a path', () =>
    pathTokens('Route `WHAT/WHY` and `and/or`, then read `x.md`.').join() === 'x.md');
  assert('a flag documented before any command is reported, not dropped', () =>
    documentedFlags('Pass `--root` first.\n\n```\nnode a.mjs\n```\n')
      .some(({ script, flag }) => script === null && flag === '--root'));
  assert('a heading ends the claim a command has on the flags below it', () =>
    documentedFlags('```\nnode a.mjs\n```\n\n## Elsewhere\n\nPass `--root`.\n')
      .every(({ script }) => script === null));

  assert('the entrypoint documents flags to check', () => flags.length > 0);
  assert('every flag the entrypoint documents is one that command accepts', () => {
    const invented = flags
      .filter(({ script, flag }) => script === null
        || !fs.readFileSync(path.join(REPO, script), 'utf8').includes(flag))
      .map(({ script, flag }) => `${script ?? 'no command above it'} ${flag}`);
    if (invented.length > 0) throw new Error(`not accepted: ${invented.join(', ')}`);
    return true;
  });
});

// --- §28 the adapter is a pointer, and it is current ------------------------

section('adapter', () => {
  // What a runtime should publish, which is every top-level skill except the
  // ones that are stages of another. Derived rather than written out, so a skill
  // added later is counted without this line being remembered.
  const shippedSkills = topLevel(path.join(SRC, 'skills'))
    .filter((file) => !STAGE_SKILLS.includes(path.basename(file, '.md')))
    .length;
  const shippedAgents = topLevel(path.join(SRC, 'agents')).length;

  // Stated here rather than read off the target, because a target asserted
  // against its own declaration asserts nothing. A new runtime has to be
  // written down twice, once as a target and once as what it is expected to
  // publish, and the two disagreeing is the whole point.
  const EXPECTED = {
    claude: {
      prefix: '',
      keys: { skill: ['name', 'description', 'metadata'], agent: ['name', 'description'] },
      // Resolved from the adapter's own root, because that is what
      // `CLAUDE_PLUGIN_ROOT` expands to once the marketplace publishes it.
      reaches: { plugin: 'adapter' },
      committed: 'plugin',
    },
    opencode: {
      prefix: 'aep-',
      keys: { skill: ['name', 'description', 'metadata'], agent: ['description', 'mode'] },
      // Resolved from the wrapper's own directory, which is the base OpenCode
      // announces to the agent when it loads a skill.
      reaches: { distribution: 'wrapper' },
      committed: 'distribution',
    },
    agents: {
      prefix: 'aep-',
      keys: { skill: ['name', 'description', 'metadata'] },
      reaches: {},
      committed: null,
    },
  };

  assert('every target is declared in the suite as well as in the generator', () => {
    const undeclared = Object.keys(TARGETS).filter((runtime) => !(runtime in EXPECTED));
    if (undeclared.length > 0) throw new Error(undeclared.join(', '));
    return true;
  });

  for (const [runtime, target] of Object.entries(TARGETS)) {
    const expected = EXPECTED[runtime];
    if (!expected) continue;

    assert(`${runtime} commits the shape the suite expects`, () =>
      target.committed === expected.committed);

    // Read from the suite rather than from the target: a guard that takes the
    // prefix off the row it is checking passes whatever that row says, so a
    // target that quietly dropped its prefix would publish `review` and be
    // told it published exactly what it declared.
    assert(`${runtime} publishes under the prefix the suite expects`, () => {
      if (target.prefix !== expected.prefix) {
        throw new Error(`declares "${target.prefix}", expected "${expected.prefix}"`);
      }
      return true;
    });

    for (const shape of target.shapes) {
      const rendered = renderAdapter(SRC, target, shape);
      const skills = rendered.filter((file) => file.kind === 'skill');
      const agents = rendered.filter((file) => file.kind === 'agent');
      const wrapsAgents = Boolean(target.path('agent', `${target.prefix}anything`, shape));

      // A target that renders nothing passes every per-file assertion below by
      // having no files to fail them. This is the one check that cannot.
      assert(`${runtime}/${shape} renders one wrapper per shipped skill`, () => {
        if (skills.length !== shippedSkills) {
          throw new Error(`${skills.length} skill wrappers for ${shippedSkills} skills`);
        }
        return true;
      });

      assert(`${runtime}/${shape} wraps every shipped agent, or none at all`, () => {
        const want = wrapsAgents ? shippedAgents : 0;
        if (agents.length !== want) throw new Error(`${agents.length} agent wrappers, expected ${want}`);
        return true;
      });

      assert(`${runtime}/${shape} publishes the names its prefix declares`, () => {
        const shape_ = target.prefix ? /^aep-[a-z0-9]+(-[a-z0-9]+)*$/ : /^[a-z0-9]+(-[a-z0-9]+)*$/;
        const wrong = rendered.filter((file) => !shape_.test(file.wrapped));
        if (wrong.length > 0) throw new Error(wrong.map((file) => file.wrapped).join(', '));
        return true;
      });

      assert(`${runtime}/${shape} names each skill wrapper for the directory holding it`, () => {
        const wrong = [];
        for (const file of skills) {
          const dir = file.relativePath.split('/').at(-2);
          const declared = /^name: (.+)$/m.exec(file.contents);
          if (!declared || declared[1] !== dir) wrong.push(file.relativePath);
        }
        if (wrong.length > 0) throw new Error(wrong.join(', '));
        return true;
      });

      for (const kind of ['skill', 'agent']) {
        const group = kind === 'skill' ? skills : agents;
        if (group.length === 0) continue;
        assert(`${runtime}/${shape} gives a ${kind} wrapper exactly the keys that runtime admits`, () => {
          const want = expected.keys[kind];
          if (!want) throw new Error(`the suite declares no ${kind} keys for ${runtime}`);
          const wrong = [];
          for (const file of group) {
            const block = /^---\n([\s\S]*?)\n---/.exec(file.contents);
            const keys = block
              ? block[1].split('\n').filter((line) => /^\S/.test(line)).map((line) => line.split(':')[0])
              : [];
            if (keys.join(',') !== want.join(',')) wrong.push(`${file.relativePath} [${keys.join(', ')}]`);
          }
          if (wrong.length > 0) throw new Error(wrong.join('; '));
          return true;
        });
      }

      assert(`${runtime}/${shape} points at the canonical artifact rather than restating it`, () => {
        const wrong = rendered.filter((file) => {
          const canonical = `.aep/${file.kind === 'skill' ? 'skills' : 'agents'}/${file.name}.md`;
          return !file.contents.includes(canonical) || file.contents.length >= 1200;
        });
        if (wrong.length > 0) throw new Error(wrong.map((file) => file.relativePath).join(', '));
        return true;
      });

      // A shape that ships outside a repository has to reach the payload it
      // travelled with, the only path that works before `.aep/` exists
      // anywhere. A shape that ships inside one must carry no reach at all: it
      // would resolve to a place nothing put a payload.
      const reach = /(?:\$\{CLAUDE_PLUGIN_ROOT\}\/|`)((?:\.\.\/)+[^`\s]+\.md)/;
      if (expected.reaches[shape]) {
        assert(`${runtime}/${shape} reaches the payload it ships beside`, () => {
          const wrong = [];
          for (const file of skills) {
            const found = reach.exec(file.contents);
            if (!found) {
              wrong.push(`${file.relativePath} declares none`);
              continue;
            }
            const adapterRoot = path.join(SRC, 'adapters', runtime);
            const root = expected.reaches[shape] === 'adapter'
              ? adapterRoot
              : path.join(adapterRoot, path.dirname(file.relativePath));
            if (!fs.existsSync(path.resolve(root, found[1]))) {
              wrong.push(`${file.relativePath} reaches ${found[1]}, which does not exist`);
            }
          }
          if (wrong.length > 0) throw new Error(wrong.join('; '));
          return true;
        });
      } else {
        assert(`${runtime}/${shape} carries no reach, having nowhere to reach`, () => {
          const wrong = rendered.filter((file) => reach.test(file.contents));
          if (wrong.length > 0) throw new Error(wrong.map((file) => file.relativePath).join(', '));
          return true;
        });
      }
    }

    const adapterDir = path.join(SRC, 'adapters', runtime);

    if (!expected.committed) {
      assert(`${runtime} commits no tree, because nothing would read one`, () =>
        !fs.existsSync(adapterDir));
      continue;
    }

    const committedRender = renderAdapter(SRC, target, expected.committed);
    for (const { relativePath, contents } of committedRender) {
      const committed = path.join(adapterDir, ...relativePath.split('/'));
      assert(`adapters/${runtime}/${relativePath} is committed`, fs.existsSync(committed));
      if (!fs.existsSync(committed)) continue;
      assert(`adapters/${runtime}/${relativePath} is current. Regenerate with scripts/adapters.mjs`,
        fs.readFileSync(committed, 'utf8') === contents);
    }

    // Only the generated subdirectories are swept. An adapter may also carry
    // hand-written runtime glue, a hook or its configuration or a manifest, which
    // the generator does not produce and must not be reported as stale.
    const generatedDirs = [...new Set(committedRender.map((file) => file.relativePath.split('/')[0]))];
    const committedFiles = generatedDirs
      .map((sub) => path.join(adapterDir, sub))
      .filter((dir) => fs.existsSync(dir))
      .flatMap((dir) => walk(dir).map((f) => toPosix(adapterDir, f)));
    assert(`the committed ${runtime} adapter has no generated file the generator does not produce`, () =>
      committedFiles.every((file) => committedRender.some((r) => r.relativePath === file)));
  }

  // Everything below is Claude's alone: how a plugin is packaged is one
  // runtime's business, and generalizing it into the loop above would assert a
  // manifest against runtimes that have none.
  const adapterDir = path.join(SRC, 'adapters', 'claude');

  // Every `.aep/…` path a wrapper names has to exist in an installed tree.
  // Nothing compared the two until now, and the cost was silent: the artifact
  // binding a sub-agent moved to `policies/execution` in 2.2.0 (`MOVES`), and
  // every agent wrapper went on naming `rules/sub-agents.md` for four releases,
  // sending each dispatched agent to read a file no release ships.
  const installedTree = installFixture().dir;
  for (const [runtime, target] of Object.entries(TARGETS)) {
    for (const shape of target.shapes) {
      assert(`every path a ${runtime}/${shape} wrapper names exists in an installed tree`, () => {
        const missing = new Set();
        for (const { relativePath, contents } of renderAdapter(SRC, target, shape)) {
          // Anchored on the extension rather than on backticks: a wrapper
          // names a path in its prose *and* in `metadata.canonical`, where
          // there are none, and a guard that saw only the quoted half would
          // pass while the field a runtime reads pointed nowhere.
          for (const [named] of contents.matchAll(/\.aep\/[\w./-]+\.md/g)) {
            if (!fs.existsSync(path.join(installedTree, ...named.split('/')))) {
              missing.add(`${relativePath} names ${named}`);
            }
          }
        }
        if (missing.size > 0) throw new Error([...missing].join('; '));
        return true;
      });
    }
  }

  // The manifest sits inside the adapter, not at the repository root, and that
  // placement is the whole mechanism: Claude Code reads a plugin's agents from
  // `<plugin root>/agents/` and a manifest `agents` path does not redirect that
  // scan. A directory there fails validation outright, and naming the files
  // loads none of them. Publishing the adapter as the plugin puts both kinds of
  // wrapper where the runtime already looks, which is why neither key is set.
  const pluginRoot = adapterDir;
  const manifest = JSON.parse(
    fs.readFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8'),
  );
  assert('plugin.json version matches specs.md', manifest.version === specVersion);
  assert('the plugin manifest sits in the adapter, which is the plugin root', () =>
    !fs.existsSync(path.join(REPO, '.claude-plugin', 'plugin.json')));

  // Every standard directory at the plugin root loads on its own, and naming
  // one in the manifest is never a no-op: `agents` and `skills` replace the
  // scan, and `hooks` registers the same file twice, which the runtime rejects
  // as a duplicate, taking the plugin's hooks down with it. Each key reads like
  // configuration and behaves like a deletion, so each absence is asserted.
  const standard = { skills: 'skills', agents: 'agents', hooks: path.join('hooks', 'hooks.json') };
  for (const [key, location] of Object.entries(standard)) {
    assert(`plugin.json declares no ${key} path. The standard location loads itself`, () =>
      !(key in manifest));
    assert(`the runtime's standard ${key} location exists to be found`, () =>
      fs.existsSync(path.join(pluginRoot, location)));
  }

  assert('every command the hooks file runs exists', () => {
    const hooks = JSON.parse(fs.readFileSync(path.join(pluginRoot, standard.hooks), 'utf8'));
    const args = JSON.stringify(hooks).match(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)/g) ?? [];
    if (args.length === 0) return false;
    return args.every((arg) =>
      fs.existsSync(path.join(pluginRoot, arg.replace('${CLAUDE_PLUGIN_ROOT}/', ''))));
  });

  assert('the marketplace advertises the plugin this repository builds', () => {
    const market = JSON.parse(
      fs.readFileSync(path.join(REPO, '.claude-plugin', 'marketplace.json'), 'utf8'),
    );
    return market.plugins?.some((entry) => entry.name === manifest.name);
  });
  assert('the marketplace publishes the adapter, so the plugin root is the adapter', () => {
    const market = JSON.parse(
      fs.readFileSync(path.join(REPO, '.claude-plugin', 'marketplace.json'), 'utf8'),
    );
    const entry = market.plugins?.find((plugin) => plugin.name === manifest.name);
    const source = typeof entry?.source === 'string' ? entry.source : '';
    const published = path.resolve(REPO, source.replace(/^\.\//, ''));
    if (published !== pluginRoot) throw new Error(`publishes ${source || '(nothing)'}`);
    return true;
  });
});

// --- release readiness ------------------------------------------------------

section('release', () => {
  const changelog = fs.readFileSync(path.join(REPO, 'CHANGELOG.md'), 'utf8');
  assert('the changelog records this version', () => changelog.includes(`## ${specVersion}`));

  // Cutting a release is one command, and this is what says so. The version
  // reaches four files, and `release.mjs` writes all four from one argument, so
  // a disagreement between them means somebody set one by hand: the newest entry
  // in the changelog is then a release nothing else has been stamped for.
  assert('every place the release is written agrees', () => {
    const bootstrap = readArtifact(path.join(SRC, 'protocol.md')).fields.version;
    const plugin = JSON.parse(fs.readFileSync(
      path.join(SRC, 'adapters', 'claude', '.claude-plugin', 'plugin.json'), 'utf8')).version;
    const newest = (changelog.match(/^## (\S+)/m) ?? [])[1];
    const seen = [specVersion, bootstrap, plugin, newest];
    if (new Set(seen).size !== 1) throw new Error(`specs, bootstrap, plugin, changelog: ${seen.join(', ')}`);
    return true;
  });

  // One release's entry, up to the next heading. Scoped, because every subject
  // below is discussed somewhere in the file's history and a search of the whole
  // document would pass on a release that said nothing.
  const entry = (version = specVersion) => {
    const from = changelog.indexOf(`## ${version}`);
    if (from < 0) return '';
    const rest = changelog.slice(from);
    const next = rest.slice(1).search(/^## \d/m);
    return next < 0 ? rest : rest.slice(0, next + 1);
  };

  // The release those removals belong to. `RETIRED_FIELDS` and `RETIRED_DIRS`
  // describe what 3.0 stopped accepting, so the entry that must name them is
  // 3.0.0's and not whichever release was cut most recently. Bound to the
  // newest entry, these four asked every later release to repeat a removal it
  // did not make, which is a suite that fails on the next release for being
  // correct.
  const REMOVALS = '3.0.0';

  // What an upgrading repository cannot find out by reading its own tree: every
  // field and directory that stopped being legal, every command that stopped
  // existing, and how this release decides which contract a tree was written
  // under. A release that removes something and does not say so is one every
  // repository discovers through a validation failure.
  assert('the changelog names every retired field', () =>
    RETIRED_FIELDS.every((field) => new RegExp(`\`${field}\``).test(entry(REMOVALS))));
  assert('the changelog names every directory this release stopped shipping', () =>
    RETIRED_DIRS.every(({ dir }) => entry(REMOVALS).includes(`\`${dir}/\``)));
  assert('the changelog names the commands this release removed', () =>
    /Two skills are gone/.test(entry(REMOVALS))
    && entry(REMOVALS).includes('`/commit`')
    && entry(REMOVALS).includes('skills/tasks/labels.md'));
  assert('the changelog names both ways a tree is classified', () =>
    /Two mechanisms classify a tree/.test(entry(REMOVALS))
    && /carrying `owner:`/.test(entry(REMOVALS))
    && /classified by the manifest/.test(entry(REMOVALS)));
  assert('the changelog states when the older classifier goes', () =>
    /no repository the maintainer knows of/.test(entry(REMOVALS)));

  assert('a licence ships', () => fs.existsSync(path.join(REPO, 'LICENSE')));

  // Two-directional, because both failures misstate a licence. Nothing shipped
  // is vendored today; if that changes, the notice must come back with it.
  const vendored = [...payloadArtifacts(), ...SEEDS.map((s) => path.join(SRC, ...s.source.split('/')))]
    .filter((file) => fs.existsSync(file))
    .filter((file) => /vendored from|Copyright \(c\)/i.test(fs.readFileSync(file, 'utf8')));
  const hasNotice = fs.existsSync(path.join(REPO, 'NOTICE'));
  assert('vendored text and a third-party NOTICE travel together, or neither ships', () =>
    (vendored.length > 0) === hasNotice);
  if (vendored.length > 0) {
    process.stdout.write(`        vendored: ${vendored.map((f) => toPosix(SRC, f)).join(', ')}\n`);
  }

  // Requirement 5, asked of the whole payload rather than file by file. Six
  // artifacts offered a tracker as a second home for tickets, and not one of
  // them was in the relevant areas of the ticket that made tickets local: each
  // was individually consistent with the release it was written for, which is
  // the shape of gap a per-ticket check cannot see.
  //
  // The phrases are the ones that offer the choice, not the word "tracker",
  // which every artifact here has a legitimate reason to use: the tracker still
  // carries the effort.
  const OFFERS_A_SECOND_HOME = [
    'external tracker',
    "or in this repository's tracker",
    'Local tickets are optional',
    'Local tickets only',
  ];
  assert('no shipped artifact offers a tracker as a place tickets may live', () => {
    const offering = payloadArtifacts()
      .filter((file) => fs.existsSync(file))
      .map((file) => [toPosix(SRC, file), fs.readFileSync(file, 'utf8')])
      // The notices are the exception, and have to be: a notice describes what a
      // past release asked for, and 2.3.0 asked for exactly this. Saying it is
      // over means naming it.
      .filter(([rel]) => rel !== 'scripts/payload.mjs')
      .filter(([, text]) => OFFERS_A_SECOND_HOME.some((phrase) => text.includes(phrase)))
      .map(([rel]) => rel);
    if (offering.length > 0) throw new Error(offering.join(', '));
    return true;
  });
  assert("the bootstrap names an effort's parts without a second home for its tasks", () => {
    const bootstrap = readSrc('protocol.md');
    return /tickets under `tickets\/`/.test(bootstrap)
      && /`plan\.md`/.test(bootstrap);
  });

  // The fold's own guard. A citation of a directory nothing ships resolves to
  // nothing, and the link checker would catch it in a shipped artifact, but not
  // in a comment, a script message, or a template placeholder. This covers the
  // whole payload at once.
  assert('nothing in the payload cites the retired modes directory', () => {
    const citing = payloadArtifacts()
      .filter((file) => fs.existsSync(file))
      .filter((file) => /\[\[modes\//.test(fs.readFileSync(file, 'utf8')))
      .map((file) => toPosix(SRC, file));
    if (citing.length > 0) throw new Error(citing.join(', '));
    return true;
  });

  assert('every template is reachable from the index the bootstrap points at', () =>
    listMarkdown('templates').length > 0);

  assert('the entrypoint at the repository root points at the bootstrap', () =>
    fs.readFileSync(path.join(REPO, 'AGENTS.md'), 'utf8').includes('.aep/protocol.md'));

  assert('this repository has installed the release it ships', () => {
    const installed = readArtifact(path.join(REPO, '.aep', 'protocol.md'));
    return installed.fields.version === specVersion;
  });

  // The dogfood, asked the way an upgrading repository asks it. This tree is the
  // first one every release meets, so a release that would ask its own tree for
  // a conversion is one that would ask everybody's, and the ask would be noise:
  // the release is what wrote the tree.
  //
  // A dry run, so the suite writes nothing into the repository it is verifying.
  assert('this repository needs nothing converted by the release it ships', () => {
    const out = execFileSync(
      process.execPath,
      [path.join(SRC, 'scripts', 'install.mjs'), '--into', REPO, '--update', '--dry-run'],
      { encoding: 'utf8' },
    );
    const asked = out.split(/\r?\n/)
      .filter((line) => /written under an older contract|no longer shipped/.test(line))
      .map((line) => line.trim());
    if (asked.length > 0) throw new Error(asked.join(' | '));
    return true;
  });

  assert("the building repository's own tree carries no stale 1.x layout", () =>
    !fs.existsSync(path.join(REPO, '.claude', 'protocol.md')) &&
    !fs.existsSync(path.join(REPO, 'scripts')));
});

// --- §29 the install writes the adapters it was asked for ------------------

section('install adapters', () => {
  /** Runs a real install into a throwaway repository. Never throws on exit. */
  const install = (args) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-adapters-'));
    execFileSync('git', ['init', '--quiet'], { cwd: dir, stdio: 'ignore' });
    const run = spawnSync(
      process.execPath,
      [path.join(SRC, 'scripts', 'install.mjs'), '--into', dir, ...args],
      { encoding: 'utf8' },
    );
    return { dir, status: run.status, out: `${run.stdout ?? ''}${run.stderr ?? ''}` };
  };

  const all = install(['--adapters', 'claude,opencode,agents']);
  assert('an install writes every adapter it was asked for', () => {
    const missing = Object.values(TARGETS)
      .map((target) => target.dir)
      .filter((dir) => !fs.existsSync(path.join(all.dir, dir)));
    if (missing.length > 0) throw new Error(`never written: ${missing.join(', ')}`);
    return true;
  });

  assert('the install report names each adapter rather than folding it into a total', () => {
    const unnamed = Object.values(TARGETS)
      .map((target) => `${target.dir}/`)
      .filter((dir) => !all.out.includes(dir));
    if (unnamed.length > 0) throw new Error(`not in the report: ${unnamed.join(', ')}`);
    return true;
  });

  // Each adapter lands in the shape written into a repository, which is the one
  // with nowhere further to fall back to.
  assert('an installed adapter is the repository shape, wrapper for wrapper', () => {
    const wrong = [];
    for (const [runtime, target] of Object.entries(TARGETS)) {
      for (const { relativePath, contents } of renderAdapter(SRC, target, 'repository')) {
        const written = path.join(all.dir, target.dir, ...relativePath.split('/'));
        if (!fs.existsSync(written)) wrong.push(`${runtime}: ${relativePath} missing`);
        else if (fs.readFileSync(written, 'utf8') !== contents) wrong.push(`${runtime}: ${relativePath} differs`);
      }
    }
    if (wrong.length > 0) throw new Error(wrong.join('; '));
    return true;
  });

  // A run that installs one adapter and then dies on a typo in the third has
  // left a repository in a state nobody asked for, so the name is resolved
  // before the first write rather than at it.
  const unknown = install(['--adapters', 'claude,nope']);
  assert('an unknown runtime stops the install', () => unknown.status !== 0);
  assert('the unknown runtime is named, along with the ones that exist', () =>
    unknown.out.includes('nope') && Object.keys(TARGETS).every((name) => unknown.out.includes(name)));
  assert('an unknown runtime is refused before anything is written', () =>
    !fs.existsSync(path.join(unknown.dir, '.aep')));

  // OpenCode reads both locations, so asking for both loads every skill twice
  // under one name. It is warned rather than refused, because a repository
  // driven through a harness with another provider can genuinely want both.
  const pair = install(['--adapters', 'opencode,agents']);
  assert('asking for both locations OpenCode reads warns, and says why', () =>
    /^warning:/m.test(pair.out) && /twice under one name/.test(pair.out));
  assert('the warning is not a refusal', () =>
    pair.status === 0 &&
    fs.existsSync(path.join(pair.dir, '.opencode')) &&
    fs.existsSync(path.join(pair.dir, '.agents')));

  const alone = install(['--adapters', 'opencode']);
  assert('one adapter alone warns about nothing', () => !/^warning:/m.test(alone.out));

  const none = install([]);
  assert('an install asked for no adapter writes none', () =>
    Object.values(TARGETS).every((target) => !fs.existsSync(path.join(none.dir, target.dir))));

  // A seed installs on the evidence a human wrote, never on a directory an
  // adapter creates: `.opencode/` is AEP's own output, and detecting on it would
  // make this installation the evidence that the repository uses OpenCode.
  const seeded = (files) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-detect-'));
    execFileSync('git', ['init', '--quiet'], { cwd: dir, stdio: 'ignore' });
    for (const [name, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      if (name.endsWith('/')) fs.mkdirSync(path.join(dir, name), { recursive: true });
      else fs.writeFileSync(path.join(dir, name), body, 'utf8');
    }
    execFileSync(process.execPath, [path.join(SRC, 'scripts', 'install.mjs'), '--into', dir], {
      stdio: 'ignore',
    });
    return (reference) => fs.existsSync(path.join(dir, '.aep', 'references', reference));
  };

  const withOpencode = seeded({ 'opencode.json': '{}' });
  assert('opencode.json seeds the OpenCode reference', () => withOpencode('opencode.md'));
  assert('opencode.json seeds both runtime references, which every repository gets', () =>
    withOpencode('t3code.md') && withOpencode('claude-code.md'));

  const withT3 = seeded({ 't3.json': '{}' });
  assert('t3.json seeds the T3 Code reference', () => withT3('t3code.md'));
  assert('t3.json does not seed the OpenCode reference', () => !withT3('opencode.md'));

  const withDirOnly = seeded({ '.opencode/opencode-is-not-config.txt': '' });
  assert('a .opencode directory is not evidence. An adapter writes one', () =>
    !withDirOnly('opencode.md'));

  const bare = seeded({});
  assert('a repository running neither gets neither reference', () =>
    !bare('opencode.md'));
  assert('a repository with no runtime config still gets both runtime playbooks', () =>
    bare('t3code.md') && bare('claude-code.md'));
});

// --- §31 the install fixture ------------------------------------------------

section('install fixture', () => {
  const { dir, aep } = installFixture();

  assert('installing creates .aep/protocol.md', fs.existsSync(path.join(aep, 'protocol.md')));
  assert('installing creates .aep/.gitignore', fs.existsSync(path.join(aep, '.gitignore')));
  for (const perClone of ['position', 'scratch', 'worktrees']) {
    assert(`.gitignore excludes ${perClone}/`, () =>
      fs.readFileSync(path.join(aep, '.gitignore'), 'utf8').includes(`${perClone}/`));
  }
  for (const owned of REPOSITORY_DIRS) {
    assert(`installing creates ${owned}/`, fs.existsSync(path.join(aep, owned)));
  }

  // `rules/` is the repository's half of the governance split, so a fresh
  // install must hand it over empty of anything the protocol owns.
  // `rules/` is the repository's, so nothing the manifest names may land there.
  // Asked of the manifest rather than of a declared field, which is the same
  // question one layer up: ownership is where a file is, not what it says.
  assert('installing puts nothing the protocol ships in rules/', () => {
    const intruders = walk(path.join(aep, 'rules'))
      .filter((file) => file.endsWith('.md'))
      .map((file) => toPosix(aep, file))
      .filter((rel) => isProtocolPath(rel));
    if (intruders.length > 0) throw new Error(intruders.join(', '));
    return true;
  });
  for (const script of PAYLOAD_SCRIPTS) {
    assert(`installing ships scripts/${script}`, fs.existsSync(path.join(aep, 'scripts', script)));
  }
  for (const script of BUILD_ONLY_SCRIPTS) {
    assert(`installing does not ship scripts/${script}`,
      !fs.existsSync(path.join(aep, 'scripts', script)));
  }

  // A bare `git init` directory has a .git and nothing else, so exactly the
  // always-seeds plus git should land. That the detected ones stay away is the
  // half worth asserting: a detector that fires on everything is no detector.
  assert('always-seeds install', () =>
    fs.existsSync(path.join(aep, 'rules', 'version-control.md')) &&
    fs.existsSync(path.join(aep, 'contexts', 'repository.md')));
  assert('git is detected in a git repository', () =>
    fs.existsSync(path.join(aep, 'references', 'git.md')));
  assert('no reference installs without its evidence', () => {
    const wrongly = SEEDS
      .filter((seed) => seed.target.startsWith('references/'))
      .filter((seed) => seed.target !== 'references/git.md')
      .filter((seed) => !RUNTIME_REFERENCES.includes(seed.target))
      .filter((seed) => fs.existsSync(path.join(aep, ...seed.target.split('/'))));
    if (wrongly.length > 0) {
      throw new Error(`installed into a bare repository: ${
        wrongly.map((seed) => seed.target).join(', ')}`);
    }
    return true;
  });

  assert('installing writes the entrypoint at the repository root', () =>
    fs.existsSync(path.join(dir, 'AGENTS.md')));
  assert('the entrypoint points at the bootstrap rather than restating it', () => {
    const text = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
    return text.includes('.aep/protocol.md') && !text.includes('## The primitives');
  });
  assert('the entrypoint carries no AEP frontmatter', () =>
    !fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8').startsWith('---'));

  // The index is generated by AEP on every run, so a retired field written here
  // is one AEP puts into every tree it touches -- and then reports back to the
  // repository as needing a conversion the repository cannot make.
  assert('the generated index carries no frontmatter at all', () =>
    !fs.readFileSync(path.join(aep, 'index.md'), 'utf8').startsWith('---'));

  assert('the tickets section is absent when a repository keeps no local tickets', () =>
    !fs.readFileSync(path.join(aep, 'index.md'), 'utf8').includes('## Tickets'));

  assert('the index lists every template, as protocol.md says it does', () => {
    const index = fs.readFileSync(path.join(aep, 'index.md'), 'utf8');
    if (!index.includes('## Templates')) return false;
    return listMarkdown('templates')
      .map((file) => path.basename(file, '.md'))
      .every((name) => index.includes(`[[templates/${name}]]`));
  });

  assert('installing carries the skill notes across', () => {
    const shipped = walk(path.join(SRC, 'skills'))
      .filter((f) => f.endsWith('.md') && path.dirname(f) !== path.join(SRC, 'skills'))
      .map((f) => toPosix(path.join(SRC, 'skills'), f));
    return shipped.every((rel) => fs.existsSync(path.join(aep, 'skills', ...rel.split('/'))));
  });

  // Installed and reachable, but not advertised: the index is the list of things
  // an agent can start, and a note is not one of them.
  assert('the index lists skills and no note among them', () => {
    const index = fs.readFileSync(path.join(aep, 'index.md'), 'utf8');
    for (const name of SKILLS) {
      if (!index.includes(`[[skills/${name}]]`)) throw new Error(`skills/${name} missing`);
    }
    const listed = [...index.matchAll(/\[\[skills\/([^\]]+)\]\]/g)].map((m) => m[1]);
    const notes = listed.filter((target) => target.includes('/'));
    if (notes.length > 0) throw new Error(`listed as skills: ${notes.join(', ')}`);
    return true;
  });

  // §30.1, the one failure that reports success. A 1.x repository has no
  // `.aep/`, so the "already installed?" check answers no and a fresh install
  // lands beside a live 1.x tree, orphaning everything in it.
  assert('a fresh install onto a 1.x layout is refused, and names the way forward', () => {
    const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-legacy-'));
    fs.mkdirSync(path.join(legacyDir, '.claude', 'policies'), { recursive: true });
    fs.writeFileSync(path.join(legacyDir, '.claude', 'protocol.md'), '---\nowner: framework\n---\n');
    try {
      execFileSync(process.execPath, [path.join(SRC, 'scripts', 'install.mjs'), '--into', legacyDir], {
        stdio: 'pipe',
      });
    } catch (error) {
      const message = String(error.stderr ?? '');
      if (!message.includes('1.x')) throw new Error(`refused without naming 1.x: ${message}`);
      if (!message.includes('/update')) throw new Error('refused without naming /update');
      if (fs.existsSync(path.join(legacyDir, '.aep'))) throw new Error('refused but still wrote .aep/');
      return true;
    }
    throw new Error('installed over a 1.x repository without refusing');
  });

  assert('--migrate is the deliberate way through that refusal', () => {
    const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-migrate-'));
    fs.mkdirSync(path.join(legacyDir, '.claude', 'decisions'), { recursive: true });
    execFileSync(
      process.execPath,
      [path.join(SRC, 'scripts', 'install.mjs'), '--into', legacyDir, '--migrate'],
      { stdio: 'pipe' },
    );
    return fs.existsSync(path.join(legacyDir, '.aep', 'protocol.md'));
  });

  assert('the installed tree passes validate.mjs', () => {
    execFileSync(process.execPath, [path.join(aep, 'scripts', 'validate.mjs'), '--root', aep], {
      stdio: 'pipe',
    });
    return true;
  });

  assert('regenerating the index is byte-identical', () => {
    const before = fs.readFileSync(path.join(aep, 'index.md'), 'utf8');
    execFileSync(process.execPath, [path.join(aep, 'scripts', 'index.mjs'), '--root', aep], {
      stdio: 'ignore',
    });
    return fs.readFileSync(path.join(aep, 'index.md'), 'utf8') === before;
  });

  assert('position stamps and then matches', () => {
    for (const command of ['stamp', 'check']) {
      execFileSync(
        process.execPath,
        [path.join(aep, 'scripts', 'position.mjs'), command, '--root', aep],
        { stdio: 'ignore' },
      );
    }
    return true;
  });

  // Returns what the installer printed, because two assertions below check that
  // a replacement was reported rather than only that it happened.
  const update = () =>
    String(execFileSync(
      process.execPath,
      [path.join(SRC, 'scripts', 'install.mjs'), '--into', dir, '--update'],
      { encoding: 'utf8' },
    ));

  // Ownership is a fact about location, so a file standing at a path the payload
  // ships is the protocol's whatever it declares. An upgrade replaces it, and
  // the protection the `owner:` field used to give is recovered from content:
  // the replacement is reported rather than made silently. Both halves are
  // asserted, because replacing without reporting is the silent loss the old
  // check existed to prevent.
  assert('an upgrade replaces a file standing at a shipped path, and says so', () => {
    const intruder = path.join(aep, 'policies', 'artifacts.md');
    fs.writeFileSync(intruder, '# Local\n', 'utf8');
    const output = update();
    const replaced = fs.readFileSync(intruder, 'utf8') === readSrc('policies', 'artifacts.md');
    if (!replaced) throw new Error('the shipped file was not restored');
    if (!/locally edited and replaced/.test(output)) {
      throw new Error('the replacement was not reported');
    }
    if (!/policies\/artifacts\.md/.test(output)) {
      throw new Error(`the report did not name the file: ${output}`);
    }
    return true;
  });

  // The case the field never could catch: a repository file under a name the
  // protocol does not ship. The installer preserves it, because the manifest
  // does not name it, and the validator says it is in the wrong directory.
  assert('an upgrade preserves a repository file at a name the protocol does not ship', () => {
    const intruder = path.join(aep, 'policies', 'local-invention.md');
    fs.writeFileSync(intruder, '# Local\n', 'utf8');
    update();
    return fs.existsSync(intruder) && fs.readFileSync(intruder, 'utf8') === '# Local\n';
  });

  assert('validate then rejects it, rather than the upgrade correcting it', () => {
    const intruder = path.join(aep, 'policies', 'local-invention.md');
    let failed = false;
    let output = '';
    try {
      execFileSync(process.execPath, [path.join(aep, 'scripts', 'validate.mjs'), '--root', aep],
        { stdio: 'pipe' });
    } catch (error) {
      failed = true;
      output = String(error.stderr ?? '');
    }
    // Restore the tree before anything downstream reads it.
    fs.rmSync(intruder);
    if (!failed) throw new Error('validate passed on a repository file inside policies/');
    if (!/policies\/ holds only what the protocol ships/.test(output)) {
      throw new Error(`failed for some other reason: ${output}`);
    }
    return true;
  });

  // The one file a repository may add inside a protocol directory. The
  // specification states the permission and argues it: a skill's own file is
  // paid for on every invocation, so what applies to one branch of a run lives
  // beside it, and that is what keeps a repository's own procedure out of a
  // file an upgrade replaces. The validator refused it from 3.0.0 until now,
  // which made the stated extension point unusable.
  const validateFixture = () => {
    try {
      execFileSync(process.execPath, [path.join(aep, 'scripts', 'validate.mjs'), '--root', aep],
        { stdio: 'pipe' });
      return { failed: false, output: '' };
    } catch (error) {
      return { failed: true, output: String(error.stderr ?? '') };
    }
  };
  const note = ['---', 'use-when: "the plan turns on where a boundary goes here"', '---', '',
    '# Plan: the house style for boundaries', '', 'What this covers.', ''].join('\n');
  const writeUnderSkills = (relative, body) => {
    const target = path.join(aep, 'skills', ...relative.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body, 'utf8');
    return target;
  };

  assert("a repository's own note beside a shipped skill validates", () => {
    const written = writeUnderSkills('plan/house-style.md', note);
    const { failed, output } = validateFixture();
    fs.rmSync(written);
    if (failed) throw new Error(`refused the extension point: ${output}`);
    return true;
  });

  // The set is exactly eighteen, so the permission reaches a note and stops
  // there. Asserted beside the one above because each is the other's boundary:
  // either alone would pass on a check that had lost the distinction.
  assert('a skill the release does not ship is still refused', () => {
    const written = writeUnderSkills('house-style.md', note);
    const { failed, output } = validateFixture();
    fs.rmSync(written);
    if (!failed) throw new Error('validate accepted a skill outside the manifest');
    if (!/skills\/ holds only what the protocol ships/.test(output)) {
      throw new Error(`failed for some other reason: ${output}`);
    }
    return true;
  });

  assert('a note answering to no shipped skill is refused', () => {
    const written = writeUnderSkills('house/style.md', note);
    const { failed, output } = validateFixture();
    fs.rmSync(written);
    fs.rmSync(path.join(aep, 'skills', 'house'), { recursive: true, force: true });
    if (!failed) throw new Error('validate accepted a note beside no skill');
    if (!/skills\/ holds only what the protocol ships/.test(output)) {
      throw new Error(`failed for some other reason: ${output}`);
    }
    return true;
  });

  assert('depth below a note is refused', () => {
    const written = writeUnderSkills('plan/house/style.md', note);
    const { failed, output } = validateFixture();
    fs.rmSync(written);
    fs.rmSync(path.join(aep, 'skills', 'plan', 'house'), { recursive: true, force: true });
    if (!failed) throw new Error('validate accepted a note nested two levels deep');
    if (!/skills\/ holds only what the protocol ships/.test(output)) {
      throw new Error(`failed for some other reason: ${output}`);
    }
    return true;
  });

  // The permission is `skills/` alone. `policies/` is asserted above; this is
  // the second directory, so a widening that reached every protocol directory
  // fails here rather than passing on the one that was checked.
  assert('another protocol directory gains no such permission', () => {
    const target = path.join(aep, 'templates', 'plan', 'house-style.md');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, note, 'utf8');
    const { failed, output } = validateFixture();
    fs.rmSync(path.join(aep, 'templates', 'plan'), { recursive: true, force: true });
    if (!failed) throw new Error('validate accepted a repository file inside templates/');
    if (!/templates\/ holds only what the protocol ships/.test(output)) {
      throw new Error(`failed for some other reason: ${output}`);
    }
    return true;
  });

  // The installer half. `validate.mjs` accepting the note and `install.mjs`
  // listing it as protocol residue is the two disagreeing about who owns one
  // path, and the human who follows the installer's own advice deletes the
  // extension point. Asserted through a real upgrade rather than by reading
  // the report, because the report is what the human acts on.
  assert('an upgrade does not offer a repository note for pruning', () => {
    const written = writeUnderSkills('plan/house-style.md', note);
    const printed = update();
    fs.rmSync(written);
    if (printed.includes('house-style.md')) {
      throw new Error(`named it to the human: ${printed.split('\n').filter(
        (line) => line.includes('house-style.md')).join(' / ')}`);
    }
    return true;
  });

  assert('an upgrade still offers a file no release ships', () => {
    const written = writeUnderSkills('house-style.md', note);
    const printed = update();
    fs.rmSync(written);
    if (!/no longer shipped[\s\S]*house-style\.md/.test(printed)) {
      throw new Error('a top-level file outside the manifest went unreported');
    }
    return true;
  });

  assert('an upgrade replaces a protocol-owned file that was edited locally', () => {
    const shipped = path.join(aep, 'policies', 'artifacts.md');
    fs.writeFileSync(shipped, 'tampered\n', 'utf8');
    update();
    return fs.readFileSync(shipped, 'utf8') === readSrc('policies', 'artifacts.md');
  });

  assert('an upgrade never re-seeds a corrected starting point', () => {
    const seeded = path.join(aep, 'references', 'git.md');
    fs.writeFileSync(seeded, `${fs.readFileSync(seeded, 'utf8')}\n<!-- corrected here -->\n`, 'utf8');
    update();
    return fs.readFileSync(seeded, 'utf8').includes('corrected here');
  });

  assert('an upgrade never overwrites an entrypoint the repository already has', () => {
    const entrypoint = path.join(dir, 'AGENTS.md');
    fs.writeFileSync(entrypoint, '# Ours\n\nRead `.aep/protocol.md`.\n', 'utf8');
    update();
    return fs.readFileSync(entrypoint, 'utf8').startsWith('# Ours');
  });

  // --- upgrading a tree that predates the moves ------------------------------
  //
  // Built from the nine real filenames rather than from a guess at what the
  // earlier layout looked like: a fixture that invents the shape it is testing
  // proves only that the invention is handled.
  //
  // One of the nine is deliberately repository-owned. It is the case the whole
  // design turns on, a repository that wrote its own rule under a name the
  // protocol has since vacated, and it is simultaneously the negative case for
  // the link rewriter, whose link must be left exactly as it is.

  const legacyTree = ({ dryRun = false } = {}) => {
    const old = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-premove-'));
    execFileSync('git', ['init', '--quiet'], { cwd: old, stdio: 'ignore' });
    execFileSync(process.execPath, [path.join(SRC, 'scripts', 'install.mjs'), '--into', old],
      { stdio: 'ignore' });
    const tree = path.join(old, '.aep');

    // Wind the tree back: governance lived in rules/, policies/ did not exist,
    // and, the part that decides whether the moves apply at all, the tree
    // declared the earlier release.
    fs.rmSync(path.join(tree, 'policies'), { recursive: true, force: true });
    const bootstrap = path.join(tree, 'protocol.md');
    fs.writeFileSync(
      bootstrap,
      // A 2.x tree named its release in `aep:`, and that is what this fixture
      // is: an old tree meeting a new installer, declaring it the old way.
      fs.readFileSync(bootstrap, 'utf8').replace(/^version: .*$/m, `aep: ${PRE_MOVE_RELEASE}`),
      'utf8',
    );
    const frontmatter = (owner, kind) =>
      ['---', `aep: ${PRE_MOVE_RELEASE}`, `owner: ${owner}`, 'date: 2026-08-16', `kind: ${kind}`,
        'use-when: "a trigger that predates the move"', '---', ''];

    // The protocol's own pre-move text, recovered from the commit that removed
    // it. Ownership of a move source is decided by content now, so a fixture
    // writing text it invented proves only that invented text is not the
    // protocol's, which is the branch that passes anyway. This is what makes the
    // removal branch mean anything.
    //
    // `evidence.md` stays invented text on purpose: it stands for the repository
    // that wrote its own file under a name the protocol vacated, and it must
    // survive the upgrade untouched.
    const preMove = (move) => execFileSync(
      'git', ['show', move.since === '4.0.0'
        ? `${RELEASE_350_COMMIT}:src/${move.from}`
        : `${PRE_MOVE_COMMIT}:src/rules/${path.basename(move.from)}`],
      { encoding: 'utf8', cwd: REPO },
    );

    for (const move of MOVES) {
      const name = path.basename(move.from);
      const body = name === 'evidence.md'
        ? [...frontmatter('repository', 'rule'), `# Rule \u2014 ${name.replace('.md', '')}`, ''].join('\n')
        : preMove(move);
      const at = path.join(tree, ...move.from.split('/'));
      fs.mkdirSync(path.dirname(at), { recursive: true });
      fs.writeFileSync(at, body, 'utf8');
    }

    fs.writeFileSync(
      path.join(tree, 'contexts', 'moved.md'),
      [...frontmatter('repository', 'context'), '# Context \u2014 links across the move', '',
        'Governed by `[[rules/engineering]]`, and by our own `[[rules/evidence]]`.', '',
        'The syntax, shown rather than used:', '',
        '```', '[[rules/change-control]]', '```', ''].join('\n'),
      'utf8',
    );

    const output = execFileSync(
      process.execPath,
      [path.join(SRC, 'scripts', 'install.mjs'), '--into', old, '--update',
        ...(dryRun ? ['--dry-run'] : [])],
      { encoding: 'utf8' },
    );
    return { old, tree, output };
  };

  const upgraded = legacyTree();

  assert('an upgrade removes every protocol-owned file the release moved', () => {
    const left = MOVES
      .map((move) => move.from)
      .filter((from) => path.basename(from) !== 'evidence.md')
      .filter((from) => fs.existsSync(path.join(upgraded.tree, ...from.split('/'))));
    if (left.length > 0) throw new Error(`still governing: ${left.join(', ')}`);
    return true;
  });

  assert('and reports each one it removed', () =>
    MOVES
      .filter((move) => path.basename(move.from) !== 'evidence.md')
      .every((move) => upgraded.output.includes(`${move.from} → ${move.to}`)));

  assert('the policies the moves point at are all present afterwards', () =>
    [...new Set(MOVES.map((move) => move.to))]
      .every((to) => fs.existsSync(path.join(upgraded.tree, ...to.split('/')))));

  // The distinction the `owner:` field used to make, made by content instead: a
  // file at a vacated path whose text is not the protocol's own is somebody's
  // work, and the move leaves it alone and says so.
  assert('a file at a vacated path that is not the protocol\'s text survives, and is reported', () => {
    const kept = path.join(upgraded.tree, 'rules', 'evidence.md');
    if (!fs.existsSync(kept)) throw new Error('the upgrade removed a file it could not identify');
    if (!fs.readFileSync(kept, 'utf8').includes('a trigger that predates the move')) {
      throw new Error('it was overwritten rather than left alone');
    }
    if (!upgraded.output.includes('rules/evidence.md is not the protocol\'s text')) {
      throw new Error('the collision was not reported');
    }
    return true;
  });

  assert('links into a vacated path are repaired, and the file is named', () => {
    const text = fs.readFileSync(path.join(upgraded.tree, 'contexts', 'moved.md'), 'utf8');
    if (!text.includes('[[protocol]]')) throw new Error('the moved link was not repaired');
    if (!upgraded.output.includes('links repaired')) throw new Error('no repair was reported');
    return true;
  });

  assert('a link to a path the repository still occupies is left alone', () => {
    const text = fs.readFileSync(path.join(upgraded.tree, 'contexts', 'moved.md'), 'utf8');
    if (!text.includes('[[rules/evidence]]')) {
      throw new Error('redirected a live link to a file the repository owns');
    }
    return true;
  });

  assert('the upgraded tree validates', () => {
    execFileSync(process.execPath,
      [path.join(upgraded.tree, 'scripts', 'index.mjs'), '--root', upgraded.tree],
      { stdio: 'ignore' });
    execFileSync(process.execPath,
      [path.join(upgraded.tree, 'scripts', 'validate.mjs'), '--root', upgraded.tree],
      { stdio: 'pipe' });
    return true;
  });

  // The rewriter and the link checker have to agree about what a link is. The
  // checker strips fences because a link inside one is syntax being shown; a
  // rewriter that does not strip them edits the example instead of repairing a
  // reference.
  assert('a link inside a fenced block is left as the example it is', () => {
    const text = fs.readFileSync(path.join(upgraded.tree, 'contexts', 'moved.md'), 'utf8');
    if (!text.includes('[[rules/change-control]]')) {
      throw new Error('rewrote a link inside a fence, where nothing was resolving it anyway');
    }
    return true;
  });

  // The date stamp this checked is retired, so the repair writes into the body
  // and nothing else. The file here belongs to a 2.x tree and still carries the
  // old fields on purpose: an upgrade does not strip what the repository owns,
  // and asserting that it had would be asserting a bug.
  assert('the repair rewrites the link and leaves the frontmatter alone', () => {
    const text = fs.readFileSync(path.join(upgraded.tree, 'contexts', 'moved.md'), 'utf8');
    const block = text.split('---')[1] ?? '';
    if (!block.includes('date: 2026-08-16')) {
      throw new Error('the repair edited the frontmatter, which is not its business');
    }
    if (!text.includes('[[protocol]]')) {
      throw new Error('the link was not repaired');
    }
    return true;
  });

  // The bound that keeps a vacated name usable. Without it, a repository that
  // later writes its own rule under one of these names is told it collides, on
  // every upgrade, forever.
  assert('the moves do not apply to a tree that already declares this release', () => {
    const current = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-postmove-'));
    execFileSync(process.execPath, [path.join(SRC, 'scripts', 'install.mjs'), '--into', current],
      { stdio: 'ignore' });
    const tree = path.join(current, '.aep');
    const mine = path.join(tree, 'rules', 'precedence.md');
    fs.writeFileSync(
      mine,
      ['---', `aep: ${specVersion}`, 'owner: repository', 'date: 2026-08-17', 'kind: rule',
        'use-when: "a name the protocol vacated, and this repository then took"',
        '---', '', '# Rule \u2014 ours', ''].join('\n'),
      'utf8',
    );
    const output = execFileSync(
      process.execPath,
      [path.join(SRC, 'scripts', 'install.mjs'), '--into', current, '--update'],
      { encoding: 'utf8' },
    );
    if (/name collisions/.test(output)) {
      throw new Error('reported a collision against a name this release already vacated');
    }
    return fs.existsSync(mine);
  });

  // §30, notices. The negative case is the one that matters: a filter matching
  // every tree reads exactly like a filter that works, and every reader of a
  // current tree would be told to go and check something already true.
  assert('an upgrade reports the notices for the releases it crosses', () => {
    if (!/\d+ things? to check/.test(upgraded.output)) throw new Error('no notices reported');
    for (const notice of NOTICES) {
      if (!precedesRelease(PRE_MOVE_RELEASE, notice.since)) continue;
      const opening = notice.check.split(/\s+/).slice(0, 4).join(' ');
      if (!upgraded.output.includes(opening)) throw new Error(`${notice.since} not reported`);
    }
    return true;
  });

  assert('a tree already at this release is shown no notices', () => {
    const current = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-nonotice-'));
    execFileSync(process.execPath, [path.join(SRC, 'scripts', 'install.mjs'), '--into', current],
      { stdio: 'ignore' });
    const output = execFileSync(
      process.execPath,
      [path.join(SRC, 'scripts', 'install.mjs'), '--into', current, '--update'],
      { encoding: 'utf8' },
    );
    if (/to check/.test(output)) throw new Error('told a current tree to go and check something');
    return true;
  });

  assert('every declared notice names a real release and says what to check', () =>
    NOTICES.every((notice) => release(notice.since) !== null && isNonEmptyString(notice.check)));

  // Pinned on the file it names and the reason it exists, not on the word
  // "tracker", which appears several times in this notice, so a looser test
  // passes on a notice that has lost its actual subject.
  //
  // Pinned to 2.3.0, the release that actually changed those references, not to
  // whichever release is being built. Tied to specVersion it demanded that every
  // future release re-declare a notice about a change it did not make.
  //
  // 3.0.0 reversed what 2.3.0 asked for, and the notice had to say so rather
  // than being deleted: a 2.x tree crossing into 3 is shown every notice between
  // the two, so a tree upgrading today would otherwise be told to record a query
  // that nothing reads, by this release, on its way past.
  assert('the release that changed the tracker references declares a notice for it', () =>
    NOTICES.some((notice) => notice.since === '2.3.0' &&
      /references\/github\.md/.test(notice.check)
      && /nothing reads that query any more/.test(notice.check)
      && /never edits a reference you own/.test(notice.check)));

  // The stray check makes a previously-passing tree fail, which is the one kind
  // of change a release cannot make silently. Pinned to the release that made
  // it rather than to whichever release is being built: tied to specVersion
  // this would demand every future release re-declare a notice about a change
  // it did not make. The literal moved once, from 3.1.0, when 3.3.0 shipped
  // from `main` while this work was still building and took the number this
  // effort had assumed.
  //
  // Pinned on what the reader has to do rather than on the word "stray", which
  // could survive a rewrite that dropped the instruction. A notice is an
  // instruction, and the two halves that matter are that the fix is a move and
  // that nothing here performs it.
  assert('the release that made an outside artifact visible declares a notice for it', () =>
    NOTICES.some((notice) => notice.since === '3.4.0' &&
      /looks one level outside the tree/.test(notice.check) &&
      /move the directory under \.aep\//.test(notice.check) &&
      /will not move it for you/.test(notice.check) &&
      /never by the name of the directory/.test(notice.check)));

  assert('skills/update acts on a notice rather than printing it', () => {
    const update = readSrc('skills', 'update.md');
    return /Act on every notice the upgrade printed\*\*, in this run/.test(update) &&
      /report it as outstanding/.test(update);
  });

  // A 3 tree names its release in `version:` and a 2.x one named it in `aep:`.
  // Both are read, because the alternative is not a smaller failure: a tree whose
  // release cannot be found is treated as predating everything, so every move
  // and every notice replays on every upgrade, forever and silently.
  assert('a bootstrap declaring version: is current, not a tree that declares nothing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-version-'));
    execFileSync(process.execPath,
      [path.join(SRC, 'scripts', 'install.mjs'), '--into', dir], { stdio: 'ignore' });

    const bootstrap = path.join(dir, '.aep', 'protocol.md');
    fs.writeFileSync(bootstrap,
      fs.readFileSync(bootstrap, 'utf8').replace(/^aep: (.*)$/m, 'version: $1'), 'utf8');

    const output = String(execFileSync(process.execPath,
      [path.join(SRC, 'scripts', 'install.mjs'), '--into', dir, '--update'], { encoding: 'utf8' }));
    fs.rmSync(dir, { recursive: true, force: true });

    // Keyed on the header the installer actually prints. An earlier version of
    // this assertion looked for the word "notice", which appears nowhere in the
    // output, so it passed whatever the code did.
    if (/things? to check, crossing these releases/.test(output)) {
      throw new Error(`a current tree was told to act on notices it has already crossed:\n${output}`);
    }
    return true;
  });

  assert('a dry run previews the notices as well as the repairs', () => {
    const preview = legacyTree({ dryRun: true });
    if (!/to check/.test(preview.output)) throw new Error('a dry run hid the notices');
    return true;
  });

  assert('a dry run previews the repairs a real run would make', () => {
    const preview = legacyTree({ dryRun: true });
    if (!/protocol files moved by this release/.test(preview.output)) {
      throw new Error('previewed no moves');
    }
    if (!/links repaired/.test(preview.output)) {
      throw new Error('previewed moves but no link repairs. The preview understates the upgrade');
    }
    return true;
  });

  assert('running the same upgrade again changes nothing', () => {
    const output = execFileSync(
      process.execPath,
      [path.join(SRC, 'scripts', 'install.mjs'), '--into', upgraded.old, '--update'],
      { encoding: 'utf8' },
    );
    if (/protocol files moved by this release/.test(output)) throw new Error('moved again');
    if (/links repaired/.test(output)) throw new Error('rewrote links again');
    return true;
  });

  // `.aep/policies/` is the current layout; `.claude/policies/` is 1.x. The word
  // is shared and the meanings are opposite, so the detector is asserted from
  // both sides rather than trusted to be path-scoped.
  assert('a tree with .aep/policies/ is not mistaken for 1.x', () => {
    const current = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-current-'));
    execFileSync(process.execPath, [path.join(SRC, 'scripts', 'install.mjs'), '--into', current],
      { stdio: 'ignore' });
    if (!fs.existsSync(path.join(current, '.aep', 'policies'))) {
      throw new Error('the install produced no policies/ to test with');
    }
    execFileSync(process.execPath,
      [path.join(SRC, 'scripts', 'install.mjs'), '--into', current, '--update'], { stdio: 'ignore' });
    return true;
  });

  // Local tickets earn a section in the index only by existing. Built here
  // rather than shipped as a fixture directory, so the assertion exercises the
  // same path a real /tasks run would.
  assert('a local ticket produces a Tickets section in the index', () => {
    const effort = path.join(aep, 'efforts', 'sample-effort');
    fs.mkdirSync(path.join(effort, 'tickets'), { recursive: true });
    // Numbered, and cited, because a ticket that traces to no requirement is now
    // a validation failure. A fixture that could not pass what `/tasks` requires
    // would not be modelling a real run.
    fs.writeFileSync(
      path.join(effort, 'spec.md'),
      ['---', 'status: accepted', '---', '', '# Problem', '', 'Something is missing.', '',
        '# Requirements', '', '1. The first thing exists.', '',
        '# Acceptance Criteria', '', '1. The first thing exists and is checkable.', ''].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(effort, 'tickets', '01-first.md'),
      ['---', 'status: open', 'blocked-by: [02]', '---', '',
        '# feat(sample): the first task', '', '## Acceptance Criteria', '',
        '- [ ] Requirement 1 holds, checked by reading it.', ''].join('\n'),
      'utf8',
    );
    execFileSync(process.execPath, [path.join(aep, 'scripts', 'index.mjs'), '--root', aep], {
      stdio: 'ignore',
    });
    const index = fs.readFileSync(path.join(aep, 'index.md'), 'utf8');
    return (
      index.includes('## Tickets') &&
      index.includes('[[efforts/sample-effort/tickets/01-first]]') &&
      index.includes('feat(sample): the first task') &&
      index.includes('sample-effort') &&
      index.includes('open') &&
      index.includes('02')
    );
  });

  assert('a tree carrying local tickets still validates, and its index is stable', () => {
    execFileSync(process.execPath, [path.join(aep, 'scripts', 'validate.mjs'), '--root', aep], {
      stdio: 'pipe',
    });
    const before = fs.readFileSync(path.join(aep, 'index.md'), 'utf8');
    execFileSync(process.execPath, [path.join(aep, 'scripts', 'index.mjs'), '--root', aep], {
      stdio: 'ignore',
    });
    return fs.readFileSync(path.join(aep, 'index.md'), 'utf8') === before;
  });

  assert('installing over an existing tree without --update refuses', () => {
    try {
      execFileSync(process.execPath, [path.join(SRC, 'scripts', 'install.mjs'), '--into', dir], {
        stdio: 'pipe',
      });
      return false;
    } catch {
      return true;
    }
  });

  assert('the Claude adapter installs as pointers into .aep/', () => {
    execFileSync(
      process.execPath,
      [path.join(SRC, 'scripts', 'install.mjs'), '--into', dir, '--update', '--adapters', 'claude'],
      { stdio: 'ignore' },
    );
    const wrapper = path.join(dir, '.claude', 'skills', 'specify', 'SKILL.md');
    if (!fs.existsSync(wrapper)) return false;
    const text = fs.readFileSync(wrapper, 'utf8');
    return text.includes('.aep/skills/specify.md') && !text.includes('# /specify');
  });
  // Ticket 16. The entrypoints are the only files AEP writes outside `.aep/`
  // that a repository loads before anything else, and one of them may predate
  // AEP by years. Every assertion below is about not destroying something.

  // A fresh install onto a repository with no entrypoint at all. The fixture
  // above has already run `--update --adapters claude`, so both files exist by
  // the time this runs.
  const canonical = path.join(dir, CANONICAL_ENTRYPOINT);
  assert('installing writes the canonical entrypoint', () => fs.existsSync(canonical));
  assert('the canonical entrypoint points at the bootstrap', () =>
    fs.readFileSync(canonical, 'utf8').includes('.aep/protocol.md'));

  // Asserted before anything derives a path from it. A target with no `entry`
  // would otherwise throw inside `path.join` and abort the section, which skips
  // every assertion below and reports as one failure rather than the right one.
  assert('every target declares which file its runtime loads', () =>
    Object.values(TARGETS).every((target) => isNonEmptyString(target.entry)));

  const claudeEntry = path.join(dir, TARGETS.claude.entry ?? 'no-entry-declared');
  assert('installing the claude adapter writes its runtime entrypoint', () =>
    fs.existsSync(claudeEntry));
  assert('a runtime entrypoint is a pointer and nothing else', () => {
    const text = fs.readFileSync(claudeEntry, 'utf8');
    return text.includes(CANONICAL_ENTRYPOINT) && text.length < 400;
  });

  // Criterion 37, the half that is easy to get wrong: a pointer that names the
  // bootstrap is a second thing to change the day the canonical entry moves,
  // and the runtime loads the stale one first.
  assert('a runtime entrypoint names nothing under the protocol directory', () =>
    !fs.readFileSync(claudeEntry, 'utf8').includes('.aep/'));

  // A runtime that already reads the canonical entry gets no file of its own.
  // A pointer from a file to itself is a loop, and the loop reads perfectly.
  assert('a runtime reading the canonical entry is pointed nowhere else', () => {
    const others = Object.entries(TARGETS)
      .filter(([, target]) => target.entry === CANONICAL_ENTRYPOINT)
      .map(([name]) => name);
    if (others.length === 0) throw new Error('no target reads the canonical entrypoint');
    return others.every((name) => TARGETS[name].entry === CANONICAL_ENTRYPOINT);
  });

  // Running again must not append a second copy. Idempotence is by content
  // rather than by a marker, so this is what proves the check actually looks.
  assert('a second run does not write the pointer twice', () => {
    const before = fs.readFileSync(claudeEntry, 'utf8');
    execFileSync(
      process.execPath,
      [path.join(SRC, 'scripts', 'install.mjs'), '--into', dir, '--update', '--adapters', 'claude'],
      { stdio: 'ignore' },
    );
    return fs.readFileSync(claudeEntry, 'utf8') === before;
  });

  // Criterion 36. The file the repository had before AEP existed, which may
  // carry instructions nobody asked an installer to touch.
  // Criterion 37, the other half: the name appears in the target table and
  // nowhere else that decides anything. The entrypoint seed takes its target
  // from the same constant, so a rename moves both.
  assert('the entrypoint seed targets the canonical name', () =>
    SEEDS.some((seed) => seed.root === true && seed.target === CANONICAL_ENTRYPOINT));

  // Criterion 11. The offer is the skill's, because a script cannot propose a
  // write and wait for an answer. Both branches are asserted: a repository with
  // its own labels is the one where a wrong install is silent, because the set
  // it creates looks reasonable beside what is already there.
  const installSkill = readSrc('skills', 'install.md');
  // 4.0: both tracker steps sit under one gate, read off `tracker:`, so a
  // repository with no tracker is never offered a vocabulary or a job.
  const trackerStep = flat(installSkill.slice(
    installSkill.indexOf('9. **Tracker steps'), installSkill.indexOf('10. **Validate**'),
  ));
  assert('install offers the label vocabulary only where the tracker is on', () =>
    /\*\*a\. The label vocabulary\.\*\*/.test(trackerStep)
    && /Tracker steps: only where `tracker:` is on\./.test(trackerStep));
  assert('install says accepting the seeded set removes the defaults', () =>
    /only its own defaults \| offer the seeded set, saying that accepting it \*\*removes the defaults\*\*/
      .test(installSkill));
  assert('install creates only what is missing where labels already exist', () =>
    /labels of its own \| create \*\*only what is missing\*\*/.test(installSkill));
  assert('install shows the exact strings before creating anything', () =>
    /\*\*Show the exact names and descriptions before creating anything\*\*/.test(trackerStep) &&
    /create nothing on a refusal/.test(trackerStep));
  assert('install requires a description that states its trigger', () =>
    /A description states the trigger that puts the\s+label on/.test(trackerStep));
  assert('install forbids a created label naming AEP', () =>
    /\*\*Nothing created names\s+AEP\.\*\*/.test(trackerStep));

  // --- the merge-time job, offered once --------------------------------------
  //
  // The offer is the skill's, for the reason the label vocabulary's is: a script
  // cannot propose a write and wait for an answer. What the installer owns is
  // the write behind the yes, the read of the decision behind a no, and the
  // judgement about where the job can go.

  const offerStep = flat(installSkill.slice(
    installSkill.indexOf('**b. The merge-time job**'), installSkill.indexOf('10. **Validate**'),
  ));
  const updateSkill = readSrc('skills', 'update.md');
  const noticeStep = flat(updateSkill.slice(
    updateSkill.indexOf('6. **Act on every notice'), updateSkill.indexOf('7. **Reconcile the rules'),
  ));
  const installerSource = readSrc('scripts', 'install.mjs');

  assert('install offers the merge-time job after the label vocabulary', () =>
    offerStep.length > 0 &&
    installSkill.indexOf('**b. The merge-time job**') > installSkill.indexOf('**a. The label vocabulary.**'));
  assert('the offer step gates on there being a tracker at all', () =>
    installSkill.indexOf('9. **Tracker steps') < installSkill.indexOf('**b. The merge-time job**'));
  assert('the offer step writes only on acceptance, opt-in at the installer', () =>
    /--automation <forge> --dry-run/.test(offerStep) &&
    /\*\*On acceptance\*\*/.test(offerStep));
  assert('the offer step records a refusal as a decision in the repository rule', () =>
    /\*\*On a refusal\*\*, write nothing, and record it in `\[\[rules\/version-control\]\]`/.test(offerStep));

  // A refusal is a path this step offers, so it is a recorded decision rather
  // than a declared deviation, which `[[skills/update]]` would report as an open
  // fork on every upgrade after it.
  assert('the offer step calls a refusal a decision and not a deviation', () =>
    /It is a recorded decision, not a deviation\./.test(offerStep));
  assert('the offer step claims no deviation status anywhere in it', () => {
    if (/declared deviation/.test(offerStep)) throw new Error('files the refusal as a deviation');
    return true;
  });

  // The one string the skill and the script must agree on.
  const declinedSentence = () => {
    const found = /const DECLINED = '([^']+)'/.exec(installerSource);
    if (!found) throw new Error('the installer declares no sentence to read');
    return found[1];
  };
  assert('the skill quotes the exact sentence the installer reads', () => {
    const sentence = declinedSentence();
    if (!installSkill.includes(`${sentence}.`)) {
      throw new Error(`the skill does not quote: ${sentence}`);
    }
    return true;
  });
  assert('the offer step says the record is read before offering again', () =>
    /\*\*Read `\[\[rules\/version-control\]\]` first\*\*/.test(offerStep) &&
    /\*\*do not offer again\*\*/.test(offerStep));
  assert('the offer step proposes an addition where a labeler is already there', () =>
    /the offer is \*\*an addition to that file\*\*, quoted exactly/.test(offerStep));
  assert('the offer step covers a file whose shape cannot take the addition', () =>
    /where that file's shape cannot take it, the installer names the obstacle and proposes nothing/.test(offerStep));
  assert('the offer step says the GitLab offer names its token before anything else', () =>
    /It prints what the forge needs provisioned first \(GitLab: a project access token with `api` scope/.test(offerStep));
  assert('the offer step changes nothing but adding the job', () =>
    /The offer adds a job and changes nothing else\./.test(offerStep));

  assert('update makes the same offer inside the step that acts on notices', () =>
    /Act on every notice the upgrade printed\*\*, in this run/.test(noticeStep) &&
    /the merge-time job\./.test(noticeStep) &&
    /`\[\[skills\/install\]\]`'s offer: the same text, the same two shapes, the same refusal path/.test(noticeStep));
  assert('update makes the offer only where the tracker is on', () =>
    /Standing, every run, where `tracker:` is on:\*\* the merge-time job/.test(noticeStep));
  assert('update reports an offer it cannot settle as outstanding, naming what is left', () =>
    /An offer that cannot be settled here \(GitLab's token is the human's to create\) is reported as outstanding, naming the forge and what is left/
      .test(noticeStep));
  assert('update does not re-offer where the record already stands', () =>
    /records it as declined, say so and \*\*do not offer again\*\*/.test(noticeStep));
  assert('update reads the tree for this and never a tracker', () =>
    /read from the tree, never from a tracker/.test(noticeStep));

  // Nothing in the offer reaches for a tracker, asked of the code rather than of
  // the prose above it. Every way a child process can be started is swept, and
  // the command has to be a literal: a command built from a variable is one this
  // check cannot read, which makes it the same hole as not checking at all.
  assert('the installer starts git and no other process', () => {
    // Not preceded by a dot: `regex.exec(` matches a string, it starts nothing.
    const starts = /(?<![.\w])(exec|execSync|execFile|execFileSync|spawn|spawnSync)\s*\(/g;
    const found = [];
    for (const match of installerSource.matchAll(starts)) {
      const after = installerSource.slice(match.index + match[0].length).trimStart();
      const literal = /^(['"`])([^'"`]*)\1/.exec(after);
      if (!literal) throw new Error(`${match[1]} is called with a command this cannot read`);
      found.push(literal[2].trim().split(/\s+/)[0]);
    }
    const other = [...new Set(found.filter((command) => command !== 'git'))];
    if (other.length > 0) throw new Error(`starts: ${other.join(', ')}`);
    return found.length > 0;
  });

  const forgeFixtures = [];
  const forgeFixture = (files = {}) => {
    const at = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-forge-'));
    forgeFixtures.push(at);
    execFileSync('git', ['init', '--quiet'], { cwd: at, stdio: 'ignore' });
    for (const [rel, body] of Object.entries(files)) {
      const target = path.join(at, ...rel.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body, 'utf8');
    }
    return at;
  };
  const installInto = (at, ...flags) => String(execFileSync(
    process.execPath,
    [path.join(SRC, 'scripts', 'install.mjs'), '--into', at, ...flags],
    // Piped rather than inherited, so the assertions that expect a refusal read
    // the message instead of printing it into a passing run's output.
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ));
  const workflowsIn = (at) => {
    const dir = path.join(at, '.github', 'workflows');
    return fs.existsSync(dir)
      ? walk(dir).map((file) => toPosix(dir, file)).sort()
      : [];
  };
  const GITHUB_JOB = readSrc('seed', 'automation', 'github.yml');
  const written = (at) => fs.readFileSync(
    path.join(at, '.github', 'workflows', 'effort-status.yml'), 'utf8',
  );

  // The refusal, which is the absence of the flag: a skill that asked and was
  // told no runs the installer exactly as it would have run it anyway, so what
  // this asserts is that there is no default write to leave behind.
  assert('a refusal leaves no workflow file behind', () => {
    const at = forgeFixture();
    installInto(at);
    if (fs.existsSync(path.join(at, '.github'))) throw new Error('wrote .github/ unasked');
    if (fs.existsSync(path.join(at, '.gitlab-ci.yml'))) {
      throw new Error('wrote .gitlab-ci.yml unasked');
    }
    return true;
  });

  // The other half of the same criterion, and the half nothing executable used
  // to cover: a refusal is written down, and the write is what stops the next
  // run asking. The sentence comes off the installer, so a fixture pasting its
  // own wording cannot pass while the two have drifted.
  assert('a recorded decision withholds the offer, and writes nothing', () => {
    const at = forgeFixture();
    installInto(at);
    const rule = path.join(at, '.aep', 'rules', 'version-control.md');
    fs.appendFileSync(
      rule,
      `\n## The merge-time job\n\n${declinedSentence()}. GitHub, on 2026-08-25, because this\n` +
      'repository assigns no labels from CI.\n',
      'utf8',
    );
    const output = installInto(at, '--update', '--automation', 'github');
    if (workflowsIn(at).length > 0) throw new Error('wrote the job over a recorded decision');
    if (!/Declined here already/.test(output)) {
      throw new Error(`the run did not say the decision was read:\n${output}`);
    }
    if (/Nothing to provision/.test(output)) throw new Error('made the offer anyway');
    return true;
  });

  assert('removing the record is what asks again', () => {
    const at = forgeFixture();
    installInto(at);
    const rule = path.join(at, '.aep', 'rules', 'version-control.md');
    const before = fs.readFileSync(rule, 'utf8');
    fs.appendFileSync(rule, `\n${declinedSentence()}. GitHub.\n`, 'utf8');
    installInto(at, '--update', '--automation', 'github');
    fs.writeFileSync(rule, before, 'utf8');
    installInto(at, '--update', '--automation', 'github');
    return workflowsIn(at).join(', ') === 'effort-status.yml';
  });

  assert('the exact text is shown before anything is written', () => {
    const at = forgeFixture();
    const output = installInto(at, '--automation', 'github', '--dry-run');
    if (!output.includes(GITHUB_JOB.trimEnd())) throw new Error('the offer did not quote the job');
    if (workflowsIn(at).length > 0) throw new Error('a dry run wrote the workflow');
    return true;
  });

  assert('accepting writes the job, byte for byte what ships', () => {
    const at = forgeFixture();
    installInto(at, '--automation', 'github');
    return written(at) === GITHUB_JOB;
  });

  // The command the step actually documents, run as documented rather than as
  // this file would have called it. Step 1 has already installed by the time
  // step 9 runs, so a command that works on an empty directory and not on that
  // tree is a command no real install can use, and a guard matching the prose
  // rather than the behaviour is what let that through.
  assert('the command the offer step documents runs on a tree step 1 installed', () => {
    const at = forgeFixture();
    installInto(at);
    const fenced = /```\n\s*(node [^\n]+)\n\s*```/.exec(
      installSkill.slice(
        installSkill.indexOf('**b. The merge-time job**'),
        installSkill.indexOf('10. **Validate**'),
      ),
    );
    if (!fenced) throw new Error('the step documents no command');
    const argv = fenced[1].split(/\s+/).slice(1).map((token) => token
      .replace('<distribution>/scripts/install.mjs', path.join(SRC, 'scripts', 'install.mjs'))
      .replace('<repository>', at)
      .replace('<forge>', 'github'));
    const output = String(execFileSync(process.execPath, argv, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }));
    if (!/merge-time job/.test(output)) throw new Error(`the documented command made no offer:\n${output}`);
    if (workflowsIn(at).length > 0) throw new Error('the documented preview wrote a file');
    return true;
  });

  // Criterion 6's update half. A repository that reached 3.x before any of this
  // existed is a tree with no workflow and every other thing an install writes,
  // which is exactly what a plain install leaves behind.
  assert('a tree that predates the job gets the same offer on update', () => {
    const at = forgeFixture();
    installInto(at);
    if (workflowsIn(at).length > 0) throw new Error('the install wrote one after all');
    installInto(at, '--update', '--automation', 'github');
    return written(at) === GITHUB_JOB;
  });

  assert('a second run reads what is already there and proposes nothing again', () => {
    const at = forgeFixture();
    installInto(at, '--automation', 'github');
    const output = installInto(at, '--update', '--automation', 'github');
    if (!/Already carried by/.test(output)) throw new Error(`offered twice:\n${output}`);
    if (workflowsIn(at).length !== 1) throw new Error(`wrote ${workflowsIn(at).join(', ')}`);
    return true;
  });

  // The one edit the shipped file asks for. Both automation files tell the
  // reader to change the two label values so the job matches the vocabulary the
  // tracker already uses, so a repository that complied must not then be offered
  // the job it is already running.
  assert('the edit the shipped file invites does not make it a different job', () => {
    const at = forgeFixture();
    installInto(at, '--automation', 'github');
    const file = path.join(at, '.github', 'workflows', 'effort-status.yml');
    const customised = fs.readFileSync(file, 'utf8')
      .replace('"status: done"', '"\u2705 status :: done"')
      .replace('"status: in review"', '"\u{1F440} status :: in review"');
    if (customised === fs.readFileSync(file, 'utf8')) {
      throw new Error('the fixture changed nothing, so it proves nothing');
    }
    fs.writeFileSync(file, customised, 'utf8');
    const output = installInto(at, '--update', '--automation', 'github');
    if (!/Already carried by/.test(output)) {
      throw new Error(`proposed the job into the file already running it:\n${output}`);
    }
    return workflowsIn(at).length === 1;
  });

  // A workflow in a subdirectory. `.github/workflows/` is read recursively, and
  // a path rebuilt from the filename names a file that is not there: the read
  // throws, the run dies with `.aep/` already written, and nothing at all is
  // reported.
  assert('a workflow in a subdirectory is read where it actually is', () => {
    const at = forgeFixture({
      '.github/workflows/sub/helper.yml': 'name: helper\non:\n  push:\njobs:\n  h:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n',
    });
    const output = installInto(at, '--automation', 'github');
    if (!/merge-time job/.test(output)) throw new Error('the run reported nothing');
    return written(at) === GITHUB_JOB;
  });

  // The shape the research found on ten repositories, cut down to the two things
  // that decide this branch: it assigns labels, and its trigger is a block map
  // with no `pull_request` key of its own.
  const LABELER = [
    'name: labeler', 'on:', '  pull_request_target:', "    branches: ['*']", '',
    'jobs:', '  labeler:', '    runs-on: ubuntu-latest', '    steps:',
    '      - uses: actions/labeler@v7', '        with:', '          sync-labels: true', '',
  ].join('\n');

  assert('a repository already running a labeler gets a proposal, not a second file', () => {
    const at = forgeFixture({ '.github/workflows/labeler.yml': LABELER });
    const output = installInto(at, '--automation', 'github');
    const workflows = workflowsIn(at);
    if (workflows.join(', ') !== 'labeler.yml') throw new Error(`wrote ${workflows.join(', ')}`);
    const after = fs.readFileSync(path.join(at, '.github', 'workflows', 'labeler.yml'), 'utf8');
    if (after !== LABELER) throw new Error('edited a file the repository owns');
    if (!output.includes('labeler.yml')) throw new Error('the proposal named no file');
    return true;
  });

  // With the exact text, and the exact text is the addition rather than the
  // file: a workflow has one `on:` map and one `jobs:` map, so quoting the
  // shipped file whole would be quoting something nobody can paste. Derived from
  // the shipped file, so a job that grows a step is covered without this being
  // remembered.
  assert('the proposal quotes every line of the job, and no key the file already has', () => {
    const at = forgeFixture({ '.github/workflows/labeler.yml': LABELER });
    const output = installInto(at, '--automation', 'github');
    const proposal = output.slice(output.indexOf('merge-time job'));
    const substance = GITHUB_JOB.split('\n')
      .filter((line) => line.startsWith('  ') && line.trim() !== '');
    const missing = substance.filter((line) => !proposal.includes(line));
    if (missing.length > 0) throw new Error(`left out: ${missing[0].trim()}`);
    for (const key of ['name: effort status', 'on:', 'jobs:']) {
      if (proposal.split('\n').includes(key)) {
        throw new Error(`proposed a duplicate top-level key: ${key}`);
      }
    }
    return true;
  });

  // The worst thing a proposal can do. `on:` is the workflow's and not the
  // job's, so a job pasted into a file that triggers on `pull_request_target`
  // runs on every push to every open change request unless the job guards
  // itself. The guard therefore lives on the job, and the proposal carries it
  // because the proposal is cut from the file that has it.
  const jobGuard = () => {
    const jobs = GITHUB_JOB.slice(GITHUB_JOB.indexOf('\njobs:\n') + '\njobs:\n'.length);
    const line = jobs.split('\n').find((entry) => /^ {4}if:/.test(entry));
    if (!line) throw new Error('the shipped job carries no guard of its own');
    return line;
  };
  assert('the shipped job guards itself rather than relying on the file it sits in', () => {
    const guard = jobGuard();
    if (!/github\.event_name/.test(guard)) {
      throw new Error(`the guard does not read which event fired: ${guard.trim()}`);
    }
    if (!/closed/.test(guard)) throw new Error(`the guard does not read closed: ${guard.trim()}`);
    return true;
  });
  assert('the proposal carries that guard into the file it joins', () => {
    const at = forgeFixture({ '.github/workflows/labeler.yml': LABELER });
    const output = installInto(at, '--automation', 'github');
    if (!output.includes(jobGuard())) {
      throw new Error('the job would be pasted into another trigger without its guard');
    }
    return true;
  });

  // Where the host's own shape cannot take the addition, nothing is proposed.
  // Handing somebody a paste that does not parse breaks a workflow this
  // repository owns, which is worse than making no offer at all.
  for (const [shape, host, obstacle] of [
    ['a trigger written inline', 'name: labeler\non: [pull_request_target]\njobs:\n  labeler:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/labeler@v7\n', /written inline/],
    ['a trigger that already names pull_request', 'name: labeler\non:\n  pull_request:\n    types: [opened]\njobs:\n  labeler:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/labeler@v7\n', /declare that key twice/],
  ]) {
    assert(`${shape} gets the obstacle named and no paste`, () => {
      const at = forgeFixture({ '.github/workflows/labeler.yml': host });
      const output = installInto(at, '--automation', 'github');
      if (workflowsIn(at).join(', ') !== 'labeler.yml') {
        throw new Error(`wrote ${workflowsIn(at).join(', ')}`);
      }
      if (!obstacle.test(output)) throw new Error(`the obstacle was not named:\n${output}`);
      if (/Into its `jobs:` map/.test(output)) throw new Error('proposed a paste anyway');
      return true;
    });
  }

  assert('several workflows assigning labels are all named, and the one read is said', () => {
    const at = forgeFixture({
      '.github/workflows/labeler.yml': LABELER,
      '.github/workflows/assign.yml': LABELER.replace('actions/labeler@v7', 'mauroalderete/action-assign-labels@v1'),
    });
    const output = installInto(at, '--automation', 'github');
    for (const named of ['assign.yml', 'labeler.yml']) {
      if (!output.includes(named)) throw new Error(`did not name ${named}`);
    }
    if (!/files here assign labels/.test(output)) throw new Error('did not say there were several');
    return true;
  });

  // Requirement 4. Not that the text mentions the token somewhere, but that the
  // token is the first thing the offer says: a repository declining has to know
  // what it declined, and GitLab is the one that costs something to accept.
  assert('the GitLab offer states its api-scoped token before anything else', () => {
    const at = forgeFixture({ '.gitlab-ci.yml': 'stages:\n  - test\n' });
    const output = installInto(at, '--automation', 'gitlab');
    const offer = flat(output.slice(output.indexOf('merge-time job')));
    if (!/gitlab Provision this first: a project access token with `api` scope/.test(offer)) {
      throw new Error(`the offer said something before its token: ${offer.slice(0, 160)}`);
    }
    if (offer.indexOf('`api` scope') > offer.indexOf('.gitlab-ci.yml')) {
      throw new Error('the token came after where the job would land');
    }
    if (fs.readFileSync(path.join(at, '.gitlab-ci.yml'), 'utf8') !== 'stages:\n  - test\n') {
      throw new Error('wrote into the pipeline file the repository owns');
    }
    return true;
  });

  // And that the two are not the same offer twice. GitHub's whole first
  // paragraph is that there is nothing to provision, which is the sentence a
  // reader needs to tell one decision from the other.
  assert('the GitHub offer is the other offer, needing nothing provisioned', () => {
    const at = forgeFixture();
    const output = installInto(at, '--automation', 'github', '--dry-run');
    const offer = flat(output.slice(output.indexOf('merge-time job')));
    if (!/github Nothing to provision\./.test(offer)) {
      throw new Error(`the offer did not lead with what it needs: ${offer.slice(0, 160)}`);
    }
    if (/access token/.test(offer)) throw new Error('asked GitHub for a credential');
    return true;
  });

  assert('a forge with no shipped job is refused rather than guessed at', () => {
    const at = forgeFixture();
    try {
      installInto(at, '--automation', 'bitbucket');
    } catch (error) {
      const message = String(error.stderr ?? '');
      if (!/no merge-time job ships for: bitbucket/.test(message)) {
        throw new Error(`refused for some other reason: ${message}`);
      }
      return true;
    }
    throw new Error('accepted a forge nothing ships a job for');
  });

  for (const at of forgeFixtures) fs.rmSync(at, { recursive: true, force: true });

  // The entrypoint step, now describing what the installer does rather than
  // what a human is asked to do by hand.
  assert('install states which entrypoints the installer writes', () =>
    installSkill.includes('**Check the entrypoints.**'));
  assert('install says which file a runtime reads comes from the target table', () =>
    /\*\*Which file a runtime reads is the installer's to know\*\*/.test(installSkill));
  assert('install says a pointer names the canonical entry and nothing else', () =>
    /\*\*A pointer\s+names `AGENTS\.md` and nothing under `\.aep\/`; never restate `protocol\.md` in\s+any entrypoint\.\*\*/.test(installSkill));
  assert('update calls a recorded refusal a decision too', () =>
    /A recorded refusal is a decision,\s+not a deviation, so step 8 does not report it/.test(readSrc('skills', 'update.md')));
  // P0-6 item 7: the Claude adapter backs the write boundary up where the
  // runtime can, and never claims more than it does.
  assert('the claude adapter writes guardrails, merged and never replaced', () =>
    /`\.claude\/settings\.json` guardrails/.test(installSkill)
    && /A `\.claude\/settings\.json`\s+that exists is merged into, never replaced\./.test(installSkill));
  assert('installing the claude adapter merges the guardrails into existing settings', () => {
    const at = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-guard-'));
    try {
      execFileSync('git', ['init', '--quiet'], { cwd: at, stdio: 'ignore' });
      fs.mkdirSync(path.join(at, '.claude'), { recursive: true });
      const own = { permissions: { deny: ['Read(./secrets/**)'] }, sandbox: { enabled: false } };
      fs.writeFileSync(path.join(at, '.claude', 'settings.json'), JSON.stringify(own), 'utf8');
      execFileSync(process.execPath, [path.join(SRC, 'scripts', 'install.mjs'), '--into', at, '--adapters', 'claude'],
        { stdio: 'ignore' });
      const merged = JSON.parse(fs.readFileSync(path.join(at, '.claude', 'settings.json'), 'utf8'));
      if (!merged.permissions.deny.includes('Read(./secrets/**)')) throw new Error('dropped a rule the repository had');
      if (merged.sandbox.enabled !== false) throw new Error('overrode the repository\'s own sandbox choice');
      if (!merged.permissions.deny.includes('Edit(~/.gitconfig)')) throw new Error('added no edit-deny rule');
      if (merged.permissions.deny.some((rule) => /^Edit\(~\/\*\*\)$|^Edit\(\/\/\*\*\)$/.test(rule))) {
        throw new Error('a deny rule covers the whole home folder or drive, and so the project');
      }
      const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-guard-'));
      try {
        execFileSync('git', ['init', '--quiet'], { cwd: fresh, stdio: 'ignore' });
        execFileSync(process.execPath, [path.join(SRC, 'scripts', 'install.mjs'), '--into', fresh, '--adapters', 'claude'],
          { stdio: 'ignore' });
        const written = JSON.parse(fs.readFileSync(path.join(fresh, '.claude', 'settings.json'), 'utf8'));
        return written.sandbox.enabled === true && !('failIfUnavailable' in written.sandbox);
      } finally {
        fs.rmSync(fresh, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(at, { recursive: true, force: true });
    }
  });

  assert('a runtime entrypoint that predates AEP keeps its content', () => {
    const older = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-entry-'));
    execFileSync('git', ['init', '--quiet'], { cwd: older, stdio: 'ignore' });
    const house = '# House rules\n\nAlways run the linter before committing.\n';
    fs.writeFileSync(path.join(older, TARGETS.claude.entry), house);
    execFileSync(
      process.execPath,
      [path.join(SRC, 'scripts', 'install.mjs'), '--into', older, '--adapters', 'claude'],
      { stdio: 'ignore' },
    );
    const after = fs.readFileSync(path.join(older, TARGETS.claude.entry), 'utf8');
    fs.rmSync(older, { recursive: true, force: true });
    return after.startsWith(house.trimEnd())
      && after.includes(CANONICAL_ENTRYPOINT)
      && after.includes('Always run the linter before committing.');
  });

  // Ticket 17. A tree written under 2.x, built here rather than borrowed:
  // migrating this repository consumes the only real one, and it can be done
  // once. What every assertion below is really asking is whether an upgrade can
  // be run on somebody's live repository without losing their work.

  const twoX = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-2x-'));
  execFileSync('git', ['init', '--quiet'], { cwd: twoX, stdio: 'ignore' });
  const twoXAep = path.join(twoX, '.aep');

  const write2x = (rel, body) => {
    const at = path.join(twoXAep, ...rel.split('/'));
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.writeFileSync(at, body);
    return at;
  };

  // The 2.x shape, in the details that matter to a classifier: `owner:` on
  // every artifact, a bootstrap declaring its release, an effort spec holding
  // the architecture 3 keeps in `plan.md`, and a directory 3 stopped shipping.
  write2x('protocol.md', ['---', 'aep: 2.4.0', 'owner: framework', 'kind: protocol', '---',
    '', '# AEP', '', 'The bootstrap 2.x installed.', ''].join('\n'));
  write2x('modes/implement.md', ['---', 'owner: framework', '---', '', '# Implement', ''].join('\n'));

  // Repository-owned, and the whole question. `legacy-rule.md` declares
  // `owner: framework` on purpose: under 3 that field decides nothing, the
  // directory does, and a classifier still reading the field would delete it.
  const owned = {
    'rules/house-style.md': ['---', 'owner: repository', 'use-when: "writing prose here"',
      '---', '', '# House style', '', 'Oxford commas, always.', ''].join('\n'),
    'rules/legacy-rule.md': ['---', 'owner: framework', 'use-when: "reviewing a migration"',
      '---', '', '# Legacy', '', 'Written by a human despite what it declares.', ''].join('\n'),
    'contexts/repository.md': ['---', 'owner: repository', '---', '', '# This repository',
      '', 'A fixture.', ''].join('\n'),
    'efforts/landed/spec.md': ['---', 'owner: repository', 'status: implemented', '---',
      '', '# Landed', '', '## Requirements', '', '1. It shipped.', '',
      '# Architecture', '', 'It was built this way.', ''].join('\n'),
    'efforts/in-flight/spec.md': ['---', 'owner: repository', 'status: accepted', '---',
      '', '# In flight', '', '## Requirements', '', '1. It has not shipped.', '',
      '# Architecture', '', 'It will be built this way.', ''].join('\n'),
    'efforts/in-flight/tickets/01-first.md': ['---', 'owner: repository', 'status: open',
      'part-of: in-flight', '---', '', '# feat: the first thing', ''].join('\n'),
  };
  for (const [rel, body] of Object.entries(owned)) write2x(rel, body);

  // Protocol-owned, edited locally, and declaring itself the repository's --
  // which under 3 it is not, whatever it says.
  write2x('policies/artifacts.md', ['---', 'owner: repository', '---', '',
    '# Artifacts', '', 'Somebody rewrote AEP law in their own tree.', ''].join('\n'));

  const upgrade = execFileSync(
    process.execPath,
    [path.join(SRC, 'scripts', 'install.mjs'), '--into', twoX, '--update'],
    { encoding: 'utf8' },
  );

  // Criterion 32, the half that must hold before anything else is worth
  // checking. Byte-identical, not merely present: an upgrade that reformats a
  // repository's own file has edited it, whatever it meant to do.
  assert('a 2.x upgrade leaves every repository-owned artifact byte-identical', () => {
    const changed = Object.entries(owned)
      .filter(([rel, body]) =>
        fs.readFileSync(path.join(twoXAep, ...rel.split('/')), 'utf8') !== body)
      .map(([rel]) => rel);
    if (changed.length > 0) throw new Error(changed.join(', '));
    return true;
  });

  // The classifier reads the directory, not the field -- so a 2.x artifact
  // declaring `owner: repository` at a path the manifest names is replaced
  // anyway, and told about. Sparing it is the mistake worth guarding: the tree
  // would go on being governed by one repository's edit of AEP's own law.
  assert('a path the manifest names is replaced whatever it declares it owns', () => {
    const at = path.join(twoXAep, 'policies', 'artifacts.md');
    return fs.readFileSync(at, 'utf8')
      === fs.readFileSync(path.join(SRC, 'policies', 'artifacts.md'), 'utf8');
  });
  assert('replacing a locally edited protocol file is reported rather than silent', () =>
    /locally edited and replaced/.test(upgrade)
    && upgrade.includes('.aep/policies/artifacts.md'));

  // And the other direction, which is what `rules/` exists for: a file under a
  // repository directory is the repository's however its frontmatter reads.
  assert('a repository file declaring the retired owner field survives', () =>
    fs.readFileSync(path.join(twoXAep, 'rules', 'legacy-rule.md'), 'utf8')
      .includes('Written by a human despite what it declares.'));

  assert('a 2.x upgrade writes the 3 bootstrap over the 2.x one', () => {
    const { fields } = readArtifact(path.join(twoXAep, 'protocol.md'));
    return fields.version === specVersion && fields.owner === undefined;
  });

  // Criterion 32's other half. The installer names what it must not convert;
  // `[[skills/update]]` converts it with a human. A list nobody prints is a
  // conversion nobody knows is outstanding.
  //
  // Read out of the one list rather than out of the whole report: several of
  // these paths are printed by other lists for other reasons, so a search of the
  // output passes on a report that never mentioned the conversion at all.
  const reported = (heading) => {
    const lines = upgrade.split('\n').map((line) => line.replace(/\s+$/, ''));
    const at = lines.findIndex((line) => line.includes(heading));
    if (at < 0) return [];
    const listed = [];
    for (const line of lines.slice(at + 1)) {
      if (!line.startsWith('      ')) break;
      listed.push(line.trim());
    }
    return listed;
  };

  assert('the upgrade names every artifact still carrying retired frontmatter', () => {
    const listed = reported('written under an older contract');
    const missing = Object.keys(owned)
      .filter((rel) => !listed.includes(`${rel} (frontmatter written under an older contract)`));
    if (missing.length > 0) throw new Error(`unreported: ${missing.join(', ')}`);
    return true;
  });
  assert('the upgrade names an in-flight spec still holding an architecture section', () => {
    const listed = reported('written under an older contract');
    return listed.includes(
      'efforts/in-flight/spec.md (holds # Architecture, which 3 keeps in plan.md)');
  });

  // Criterion 33. The landed effort's spec holds the same section and is not
  // asked to split: it is the record of what was built, and an upgrade that
  // asked would go on asking on every upgrade the repository ever runs.
  //
  // Its retired frontmatter is still named, and that is the difference. Dropping
  // a field the contract no longer has changes nothing the record says; moving
  // half a document into another file does.
  assert('the upgrade asks no landed effort to split its spec', () => {
    const listed = reported('written under an older contract');
    const named = listed.filter((entry) =>
      entry.startsWith('efforts/landed/') && entry.includes('# Architecture'));
    if (named.length > 0) throw new Error(named.join(', '));
    return listed.includes(
      'efforts/landed/spec.md (frontmatter written under an older contract)');
  });

  // Criterion 32 again, from the other direction: naming is the whole of what
  // it does. Splitting a spec decides what is WHAT and what is HOW, and a
  // script that guessed would have edited a repository-owned file to do it.
  assert('the upgrade splits no spec by itself', () =>
    !fs.existsSync(path.join(twoXAep, 'efforts', 'landed', 'plan.md'))
    && !fs.existsSync(path.join(twoXAep, 'efforts', 'in-flight', 'plan.md')));

  // A directory a release stopped shipping is reported and left. It sits in no
  // ownership list, so nothing else in the upgrade would ever mention it, and
  // an upgraded tree would carry `modes/` forever with nothing saying why not.
  assert('a directory this release stopped shipping is reported', () =>
    RETIRED_DIRS.every(({ dir }) => upgrade.includes(`.aep/${dir}/ (stopped being shipped`)));
  assert('a directory this release stopped shipping is not deleted', () =>
    RETIRED_DIRS.every(({ dir }) => fs.existsSync(path.join(twoXAep, dir))));
  // Named rather than derived from the list, because every assertion above is
  // `RETIRED_DIRS.every(...)` and an empty list satisfies all of them. This is
  // the one that fires if the declaration is dropped, and it goes when the 2.x
  // branch does -- the same condition, for the same reason.
  assert('the directory 3 stopped shipping is declared retired', () =>
    RETIRED_DIRS.some(({ dir }) => dir === 'modes'));
  assert('every retired directory declares when it stopped and what it held', () =>
    RETIRED_DIRS.every(({ dir, since, was }) =>
      isNonEmptyString(dir) && release(since) !== null && isNonEmptyString(was)));


  // --- ticket 47.07: the no-tracker posture survives all of this -------------
  //
  // A repository with no forge is not a degraded case of one that has a forge.
  // It is a posture with its own procedure, and this effort added three paths
  // that could each have quietly broken it: the offer at install, the offer at
  // update, and the drift script. One fixture, all three, and each assertion
  // proves the path ran rather than only that nothing happened. A guard passing
  // because the code never executed reads exactly like one passing because the
  // code behaved, and this whole block is guards.
  //
  // `forgeFixture()` is a `git init` with no remote, which is the whole of what
  // makes it tracker-less: seed detection asks the remote, finds none, and
  // installs neither forge reference. Nothing here goes near a network.
  const NO_FORGE = ['references/github.md', 'references/gitlab.md'];

  assert('the fixture genuinely has no tracker, and the absence is stated', () => {
    const at = forgeFixture();
    const output = installInto(at);
    for (const seed of NO_FORGE) {
      if (!output.includes(`${seed} (not detected)`)) {
        throw new Error(`${seed} was skipped silently, or not skipped`);
      }
      if (fs.existsSync(path.join(at, '.aep', ...seed.split('/')))) {
        throw new Error(`${seed} was installed into a repository with no forge`);
      }
    }
    return true;
  });

  assert('install on a no-tracker fixture offers no automation and writes none', () => {
    const at = forgeFixture();
    const output = installInto(at);
    // The path ran. Without this the three checks below pass on an install that
    // never happened.
    //
    // What this proves is that nothing is written by default, and that is all it
    // proves. It is not a tracker gate in the installer: `--automation <forge>`
    // writes the job on a tree with no forge detected, because the flag is a
    // human saying do it and the installer does not second-guess that. Criterion
    // 10 for install therefore rests on `skills/install` step 9 skipping where
    // step 8 skipped, which is asserted separately as prose and is not the same
    // guarantee. Named here because the earlier wording of this comment claimed
    // the gate existed.
    if (!/protocol files written/.test(output)) throw new Error(`install did not run:\n${output}`);
    if (workflowsIn(at).length > 0) throw new Error(`wrote ${workflowsIn(at).join(', ')}`);
    if (fs.existsSync(path.join(at, '.gitlab-ci.yml'))) throw new Error('wrote .gitlab-ci.yml');
    if (/merge-time job/i.test(output)) throw new Error('offered a job with no tracker to offer it against');
    return true;
  });

    assert('--observed without a file is refused rather than answered', () => {
    const result = spawnSync(
      process.execPath,
      [path.join(SRC, 'scripts', 'reconcile.mjs'), '--root', path.join(REPO, '.aep'), '--observed'],
      { encoding: 'utf8' },
    );
    if (result.status !== 2) throw new Error(`exited ${result.status}: ${result.stdout}`);
    if (result.stdout.trim().length > 0) throw new Error(`answered anyway: ${result.stdout}`);
    return true;
  });

  assert('update on a no-tracker fixture gains nothing it can never settle', () => {
    const at = forgeFixture();
    installInto(at);
    const output = installInto(at, '--update');
    if (!/seeds skipped/.test(output)) throw new Error(`update did not run:\n${output}`);
    if (workflowsIn(at).length > 0) throw new Error(`wrote ${workflowsIn(at).join(', ')}`);
    // An outstanding item with no path to being closed is the failure mode: an
    // upgrade that hands a tracker-less repository a job it can never accept
    // would report the same thing on every run for ever.
    if (/outstanding/i.test(output)) throw new Error(`left something outstanding:\n${output}`);
    if (/merge-time job/i.test(output)) throw new Error('offered a job with no tracker to offer it against');
    return true;
  });

  assert('reconcile runs in that fixture and is exit 0 with every effort unobserved', () => {
    const at = forgeFixture();
    installInto(at);
    const effort = path.join(at, '.aep', 'efforts', '01-probe');
    fs.mkdirSync(effort, { recursive: true });
    fs.writeFileSync(
      path.join(effort, 'spec.md'),
      ['---', 'status: accepted', '---', '', '# Problem', '', 'p', ''].join('\n'),
      'utf8',
    );
    const result = spawnSync(
      process.execPath,
      [path.join(SRC, 'scripts', 'reconcile.mjs'), '--root', path.join(at, '.aep')],
      { encoding: 'utf8' },
    );
    const lines = result.stdout.split('\n').filter(Boolean);
    // Printed something, so the comparison ran rather than the tree being empty.
    if (lines.length === 0) throw new Error('printed nothing, so nothing was compared');
    const other = lines.filter((line) => !line.startsWith('unobserved'));
    if (other.length > 0) throw new Error(other.join(' / '));
    if (result.status !== 0) throw new Error(`exited ${result.status}; learning nothing is not a fault`);
    return true;
  });

  // Requirement 10, asked of the shipped code rather than of the fixture. The
  // fixture shows these paths did not reach a tracker on one run; this shows
  // there is no branch on which they could. `install.mjs` is the only executable
  // in the three, and the sweep over its process starts already stands above;
  // what is added here is that neither offer nor the drift script names a forge
  // CLI in a position to be run.
  assert('no path this effort added can reach a forge CLI', () => {
    const starts = /(?<![.\w])(exec|execSync|execFile|execFileSync|spawn|spawnSync)\s*\(\s*(['"`])([^'"`]*)\2/g;
    const offending = [];
    for (const name of ['install.mjs', 'reconcile.mjs']) {
      const source = fs.readFileSync(path.join(SRC, 'scripts', name), 'utf8');
      for (const match of source.matchAll(starts)) {
        const command = match[3].trim().split(/\s+/)[0];
        if (command !== 'git') offending.push(`${name} starts ${command}`);
      }
    }
    if (offending.length > 0) throw new Error(offending.join('; '));
    return true;
  });

  fs.rmSync(twoX, { recursive: true, force: true });
});

// --- the guard fires --------------------------------------------------------
// A verification suite is worth what its failure mode is worth, and a check that
// cannot fail reads exactly like a check that passed. This proves the harness
// distinguishes the two before any result above is trusted.

// --- the frontier is computed, not judged --------------------------------------
// Scheduling is a graph the tickets already declare. An orchestrator that reads
// them and decides independence for itself is inferring what was written down,
// so the answer is computed here and its shape is pinned.

section('frontier', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-frontier-'));
  const aep = path.join(dir, '.aep');
  const tickets = path.join(aep, 'efforts', 'probe', 'tickets');
  fs.mkdirSync(tickets, { recursive: true });
  fs.copyFileSync(path.join(SRC, 'protocol.md'), path.join(aep, 'protocol.md'));

  const ticket = (name, status, blockedBy) => fs.writeFileSync(
    path.join(tickets, name),
    ['---', `status: ${status}`, ...(blockedBy ? [`blocked-by: [${blockedBy}]`] : []), '---', '', '# t', '']
      .join('\n'),
    'utf8',
  );

  const run = (...extra) => {
    const result = spawnSync(
      process.execPath,
      [path.join(SRC, 'scripts', 'frontier.mjs'), 'probe', '--root', aep, ...extra],
      { encoding: 'utf8' },
    );
    return { out: result.stdout, err: result.stderr, code: result.status };
  };

  ticket('01-first.md', 'resolved');
  ticket('02-second.md', 'open');
  ticket('03-third.md', 'open', '02');
  ticket('04-fourth.md', 'open', '02, 03');

  assert('an unblocked ticket is ready, and its blockers are named', () => {
    const { out, code } = run();
    if (code !== 0) throw new Error(`exit ${code}, expected 0 while work remains`);
    if (!/^ready {4}02 second$/m.test(out)) throw new Error(`no ready line for 02: ${out}`);
    if (!/^blocked {2}03 third by 02$/m.test(out)) throw new Error(`no blocked line for 03: ${out}`);
    if (!/^blocked {2}04 fourth by 02,03$/m.test(out)) throw new Error(`04 names the wrong gates: ${out}`);
    return true;
  });

  assert('a resolved ticket gates nothing and appears nowhere', () => !/01 first/.test(run().out));

  assert('parking belongs to the caller, echoed rather than decided', () => {
    const { out } = run('--parked', '02');
    if (!/^parked {3}02 second$/m.test(out)) throw new Error(`02 was not echoed as parked: ${out}`);
    if (/^ready/m.test(out)) throw new Error('parking 02 left something ready');
    return true;
  });

  assert('an obsolete ticket satisfies an edge, since nobody will do it', () => {
    ticket('02-second.md', 'obsolete');
    const ready = /^ready {4}03 third$/m.test(run().out);
    ticket('02-second.md', 'open');
    return ready;
  });

  assert('nothing unresolved exits 1, which is how a loop knows to stop', () => {
    for (const name of ['02-second.md', '03-third.md', '04-fourth.md']) ticket(name, 'resolved');
    const { out, code } = run();
    if (code !== 1) throw new Error(`exit ${code}, expected 1`);
    if (out.trim() !== '') throw new Error(`printed something: ${out}`);
    for (const name of ['02-second.md', '03-third.md', '04-fourth.md']) ticket(name, 'open');
    ticket('03-third.md', 'open', '02');
    ticket('04-fourth.md', 'open', '02, 03');
    return true;
  });

  assert('an edge naming no ticket is an error, never a satisfied gate', () => {
    ticket('05-dangling.md', 'open', '99');
    const { err, code } = run();
    fs.rmSync(path.join(tickets, '05-dangling.md'));
    if (code !== 2) throw new Error(`exit ${code}, expected 2`);
    if (!/no ticket has that id/.test(err)) throw new Error(`wrong diagnosis: ${err}`);
    return true;
  });

  assert('an unreadable effort exits 2 rather than reporting an empty frontier', () => {
    const result = spawnSync(
      process.execPath,
      [path.join(SRC, 'scripts', 'frontier.mjs'), 'nosuch', '--root', aep],
      { encoding: 'utf8' },
    );
    return result.status === 2 && /no tickets directory/.test(result.stderr);
  });

  fs.rmSync(dir, { recursive: true, force: true });
});

// The reconciliation, which is the terminal row's slow owner. It is checked
// against this repository's own tree rather than a fixture, because the tree is
// the case the criterion names and because a fixture built to agree with a
// script proves only that both were written by the same hand. The observation is
// recorded here and never fetched: the first fixture that reaches for `gh` is
// the one that makes the suite fail offline.
section('reconcile', () => {
  const RECONCILE = path.join(SRC, 'scripts', 'reconcile.mjs');
  const AEP = path.join(REPO, '.aep');

  const run = (observation, ...extra) => {
    const args = [RECONCILE, '--root', AEP, ...extra];
    if (observation !== null) args.push('--observed', '-');
    const result = spawnSync(process.execPath, args, {
      encoding: 'utf8',
      input: observation === null ? '' : JSON.stringify(observation),
    });
    return { out: result.stdout, err: result.stderr, code: result.status };
  };
  const lineFor = (out, effort) => out.split('\n').filter((line) => line.includes(` ${effort}  `));

  // GitHub's own shapes, as `gh issue list --json number,state,labels` and
  // `gh pr list --json number,state,labels,closingIssuesReferences` emit them.
  // The emoji prefix is this repository's, and it is here deliberately: a
  // comparison blind to it reports every effort in this repository as drift.
  const issue = (number, state, status) =>
    ({ number, state, labels: status === null ? [] : [{ name: `✔️ ${status}` }] });
  const pull = (number, state, status, closes) => ({
    number,
    state,
    labels: status === null ? [] : [{ name: `✔️ ${status}` }],
    closingIssuesReferences: closes.map((n) => ({ number: n })),
  });

  // Criterion 8. Effort 45 merged, and its objects and its spec agree.
  const AGREES = {
    issues: [issue(45, 'CLOSED', 'status: done')],
    changeRequests: [pull(46, 'MERGED', 'status: done', [45])],
  };
  assert('effort 45 agrees against a recorded observation of its own objects', () => {
    const { out, code } = run(AGREES);
    const lines = lineFor(out, '45-aep-3');
    if (lines.length !== 1) throw new Error(`45-aep-3 got ${lines.length} lines: ${lines.join(' / ')}`);
    if (!lines[0].startsWith('agree')) throw new Error(lines[0]);
    if (code !== 0) throw new Error(`agreement exited ${code}`);
    return true;
  });

  // The same criterion's other half, and the one that makes the first mean
  // something: move a label in the observation and the drift is printed. Only
  // the label moves, so nothing else can account for the change in verdict.
  assert('moving a label in the observation prints the drift', () => {
    const moved = {
      issues: [issue(45, 'CLOSED', 'status: in review')],
      changeRequests: [pull(46, 'MERGED', 'status: done', [45])],
    };
    const { out, code } = run(moved);
    const lines = lineFor(out, '45-aep-3');
    if (!lines.some((line) => /^drift .*issue 45 status: in review want status: done/.test(line))) {
      throw new Error(lines.join(' / '));
    }
    if (code !== 1) throw new Error(`drift exited ${code}, and disagreement is exit 1`);
    return true;
  });

  // Criterion 3. A change request closed without merging reaches the same
  // terminal value, so `in review` does not survive an abandoned effort either.
  assert('a change request closed without merging expects the terminal value', () => {
    const { out } = run({
      issues: [issue(45, 'CLOSED', 'status: in review')],
      changeRequests: [pull(46, 'CLOSED', 'status: in review', [45])],
    });
    const lines = lineFor(out, '45-aep-3');
    const wanted = lines.filter((line) => /want status: done$/.test(line));
    if (wanted.length !== 2) throw new Error(lines.join(' / '));
    if (lines.some((line) => /^agree/.test(line))) throw new Error('in review survived a close');
    return true;
  });

  // Requirement 8. `accepted` reaches two rows, because taking the first ticket
  // moves the label without moving the field, so both labels are legitimate and
  // neither is drift. A consumer taking the first matching row would report every
  // run in flight as drift.
  //
  // Against a tree built for it, not against this repository's. These two ran on
  // effort 47 while effort 47 was the mid-run case, and then effort 47 closed:
  // the spec moved to `implemented`, the projection moved with it, and both
  // assertions failed on a tree that was entirely correct. An assertion keyed on
  // a live effort's status has a shelf life measured in one close.
  const midRun = (() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-midrun-'));
    const aep = path.join(dir, '.aep');
    fs.mkdirSync(path.join(aep, 'efforts', '77-mid-run'), { recursive: true });
    fs.copyFileSync(path.join(SRC, 'protocol.md'), path.join(aep, 'protocol.md'));
    fs.writeFileSync(
      path.join(aep, 'efforts', '77-mid-run', 'spec.md'),
      ['---', 'status: accepted', '---', '', '# Problem', '', 'p', ''].join('\n'),
      'utf8',
    );
    return aep;
  })();

  for (const status of ['status: ready', 'status: in progress']) {
    assert(`an effort mid-run showing ${status} is not drift`, () => {
      const result = spawnSync(
        process.execPath,
        [RECONCILE, '--root', midRun, '--observed', '-'],
        {
          encoding: 'utf8',
          input: JSON.stringify({
            issues: [issue(77, 'OPEN', status)],
            changeRequests: [pull(78, 'OPEN', status, [77])],
          }),
        },
      );
      const lines = result.stdout.split('\n').filter((line) => line.includes(' 77-mid-run  '));
      if (lines.length !== 1 || !lines[0].startsWith('agree')) {
        throw new Error(lines.join(' / ') || result.stdout || result.stderr);
      }
      if (result.status !== 0) throw new Error(`exited ${result.status}`);
      return true;
    });
  }
  assert('the two labels accepted reaches are the two the ladder gives it', () => {
    const reached = expectedFor('accepted', null, 'issue');
    return reached.join(' or ') === 'status: ready or status: in progress';
  });

  // Criterion 11. Recorded as #51 and #52 stood on 2026-08-24, after the merge
  // and before a person closed the issue by hand. The commit carried the
  // referencing form of the keyword rather than the closing one, which is
  // exactly how an issue survives its own merge, and it is the case requirement
  // 11 exists to remove going forward and this line exists to catch meanwhile.
  assert('an issue still open after its change request merged is its own finding', () => {
    const { out, code } = run({
      issues: [issue(51, 'OPEN', 'status: done')],
      changeRequests: [pull(52, 'MERGED', 'status: done', [51])],
    });
    const lines = lineFor(out, '51-branch-scope');
    if (!lines.some((line) => line.includes('issue 51 open after change-request 52 merged'))) {
      throw new Error(lines.join(' / '));
    }
    if (code !== 1) throw new Error(`exited ${code}`);
    return true;
  });
  assert('an issue closed behind its merged change request is not that finding', () => {
    const { out } = run({
      issues: [issue(51, 'CLOSED', 'status: done')],
      changeRequests: [pull(52, 'MERGED', 'status: done', [51])],
    });
    return !out.includes('open after change-request');
  });

  // Requirement 10 and criterion 10. A repository with no tracker runs this and
  // learns nothing, which is the answer rather than a fault, so it is exit 0.
  assert('no observation is exit 0 with every effort unobserved', () => {
    const { out, code } = run(null);
    const lines = out.split('\n').filter(Boolean);
    if (lines.length === 0) throw new Error('printed nothing at all');
    const other = lines.filter((line) => !line.startsWith('unobserved'));
    if (other.length > 0) throw new Error(other.join(' / '));
    if (code !== 0) throw new Error(`exited ${code}, and learning nothing is not a fault`);
    return true;
  });
  assert('an effort with no observed object is unobserved rather than agreeing', () => {
    const { out } = run(AGREES);
    return lineFor(out, '47-post-merge-labels')[0]?.startsWith('unobserved') === true;
  });

  // Requirement 8, the interface. Matching `frontier.mjs`: `--root`, one line
  // per finding, and an exit code that means something. Exit 2 is the one worth
  // pinning, because a tree that could not be read must not look like a tree
  // that agreed.
  // Two ways a tree fails to be readable, pinned apart, because they leave from
  // different lines and a check written for one passes while the other returns
  // exit 0. A root that resolves to nothing is refused before any tree is read;
  // a root that resolves to an AEP tree with no efforts in it is refused after.
  assert('a root that resolves to no tree is exit 2 and not exit 0', () => {
    const result = spawnSync(
      process.execPath,
      [RECONCILE, '--root', path.join(os.tmpdir(), 'aep-no-such-tree')],
      { encoding: 'utf8' },
    );
    return result.status === 2 && /no \.aep\/ found/.test(result.stderr);
  });
  assert('a tree with no efforts directory is exit 2 and not exit 0', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-bare-'));
    fs.copyFileSync(path.join(SRC, 'protocol.md'), path.join(bare, 'protocol.md'));
    const result = spawnSync(process.execPath, [RECONCILE, '--root', bare], { encoding: 'utf8' });
    fs.rmSync(bare, { recursive: true, force: true });
    if (result.status !== 2) throw new Error(`exited ${result.status} on a tree it cannot read`);
    if (!/no efforts directory/.test(result.stderr)) throw new Error(result.stderr);
    if (result.stdout.trim().length > 0) throw new Error(`answered anyway: ${result.stdout}`);
    return true;
  });
  assert('an observation that is not JSON is exit 2', () => {
    const result = spawnSync(process.execPath, [RECONCILE, '--root', AEP, '--observed', '-'], {
      encoding: 'utf8', input: 'not json at all',
    });
    return result.status === 2 && /not JSON/.test(result.stderr);
  });

  // Requirement 8, the parser. It says which shape it read, and a shape it does
  // not recognise is an error rather than a confident empty answer: a caller
  // reading no drift cannot otherwise tell it from nothing understood.
  assert('the parser says it read GitHub, and counts what it read', () => {
    const { out } = run(AGREES);
    return out.startsWith('read       github  1 issues, 1 change requests\n');
  });
  assert('the parser reads GitLab shapes and says so', () => {
    const { out } = run({
      issues: [{ iid: 45, state: 'closed', labels: ['status: done'] }],
      changeRequests: [{
        iid: 46, state: 'merged', labels: ['status: done'], closesIssues: [{ iid: 45 }],
      }],
    });
    if (!out.startsWith('read       gitlab')) throw new Error(out.split('\n')[0]);
    const lines = lineFor(out, '45-aep-3');
    if (lines.length !== 1 || !lines[0].startsWith('agree')) throw new Error(lines.join(' / '));
    return true;
  });
  assert('a shape matching neither forge reports that it recognised nothing', () => {
    const result = spawnSync(process.execPath, [RECONCILE, '--root', AEP, '--observed', '-'], {
      encoding: 'utf8',
      input: JSON.stringify({ issues: [{ id: 45, state: 'open' }], changeRequests: [] }),
    });
    if (result.status !== 2) throw new Error(`exited ${result.status} on a shape it cannot read`);
    if (!/matches neither forge/.test(result.stderr)) throw new Error(result.stderr);
    if (result.stdout.trim().length > 0) throw new Error(`answered anyway: ${result.stdout}`);
    return true;
  });

  // The derived families only. `priority:` was set by a person when the effort
  // opened, and a reconciliation that reported on it would be proposing to
  // overwrite them, which is the failure the derived and initial split exists to
  // prevent.
  assert('a priority label is not compared and not reported', () => {
    const { out, code } = run({
      issues: [{
        number: 45,
        state: 'CLOSED',
        labels: [{ name: '\u{1F3D4}️ priority: high' }, { name: '✔️ status: done' }],
      }],
      changeRequests: [pull(46, 'MERGED', 'status: done', [45])],
    });
    if (code !== 0) throw new Error(out);
    return lineFor(out, '45-aep-3')[0].startsWith('agree');
  });

  // Ticket 47.04, corrected after review. Two defects, both found by running the
  // script rather than reading it, and neither visible to any assertion above.
  //
  // The first: the open-after-merge finding tested `state === 'OPEN'`, and
  // GitLab says `opened`. Upper-casing gave `OPENED`, which is not open to that
  // test, so on GitLab the finding could never fire. It failed silently, which is
  // why the only GitLab fixture here did not catch it: that one used a closed
  // issue, where the right answer and the wrong answer agree.
  assert('the open-after-merge finding fires on GitLab too, where the word differs', () => {
    const { out, code } = run({
      issues: [{ iid: 51, state: 'opened', labels: ['status: done'] }],
      changeRequests: [{
        iid: 52, state: 'merged', labels: ['status: done'], closesIssues: [{ iid: 51 }],
      }],
    });
    const lines = lineFor(out, '51-branch-scope');
    if (!lines.some((line) => line.includes('issue 51 open after change-request 52 merged'))) {
      throw new Error(lines.join(' / ') || 'no line for the effort at all');
    }
    if (code !== 1) throw new Error(`exited ${code}`);
    return true;
  });
  assert('an issue state neither forge uses is not quietly read as open', () => {
    const { out } = run({
      issues: [{ number: 51, state: 'ARCHIVED', labels: [{ name: 'status: done' }] }],
      changeRequests: [pull(52, 'MERGED', 'status: done', [51])],
    });
    return !out.includes('open after change-request');
  });

  // The second: a field the caller never fetched was defaulted to empty, and
  // empty is the opposite answer. Without `closingIssuesReferences` the change
  // request stops selecting a terminal row, the expectation falls back to
  // projecting `spec.md`, and the script instructs its caller to move a correct
  // `status: done` back to `status: in review`. The file wins, so a run acts on
  // that. It has to be an error, and the file's own doc comment already said so.
  for (const [what, observation] of [
    ['closing links', {
      issues: [issue(45, 'CLOSED', 'status: done')],
      changeRequests: [{ number: 46, state: 'MERGED', labels: [{ name: 'status: done' }] }],
    }],
    ['labels', {
      issues: [{ number: 45, state: 'CLOSED' }],
      changeRequests: [pull(46, 'MERGED', 'status: done', [45])],
    }],
  ]) {
    assert(`an observation fetched without ${what} is exit 2, not an answer`, () => {
      const { out, err, code } = run(observation);
      if (code !== 2) throw new Error(`exited ${code} and said: ${out.trim()}`);
      if (!/absent is not the same as empty|is not an array/.test(err)) throw new Error(err);
      if (out.trim().length > 0) throw new Error(`answered anyway: ${out}`);
      return true;
    });
  }

  // The registration, which is what makes the rest of this reach a repository.
  assert('reconcile.mjs is a payload script and not a build-only one', () =>
    PAYLOAD_SCRIPTS.includes('reconcile.mjs') && !BUILD_ONLY_SCRIPTS.includes('reconcile.mjs'));
  assert('reconcile.mjs is in the shipped manifest', () =>
    PROTOCOL_FILES.includes('scripts/reconcile.mjs'));

  fs.rmSync(path.dirname(midRun), { recursive: true, force: true });
});

// A ticket that traces to no requirement is an error. This is what the split of
// spec.md from plan.md traded the one-file rule for, so it is exercised against
// a real tree rather than asserted as prose in the skill.
section('traceability', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-trace-'));
  const aep = path.join(dir, '.aep');
  const effort = path.join(aep, 'efforts', 'probe');
  const tickets = path.join(effort, 'tickets');
  fs.mkdirSync(tickets, { recursive: true });
  // A stub rather than the real bootstrap: the real one links to every primitive
  // directory, so a fixture carrying it would be testing the tree rather than
  // this check.
  fs.writeFileSync(
    path.join(aep, 'protocol.md'),
    ['---', 'version: 0.0.0', '---', '', '# AEP', 'A stub for the traceability fixture.', ''].join('\n'),
    'utf8',
  );
  fs.writeFileSync(path.join(aep, 'index.md'), '# Index\n', 'utf8');
  fs.writeFileSync(path.join(aep, '.gitignore'), 'position/\nscratch/\nworktrees/\n', 'utf8');

  const spec = (status) => fs.writeFileSync(
    path.join(effort, 'spec.md'),
    [`---`, `status: ${status}`, '---', '', '# Problem', 'x', '', '# Requirements',
      '', '1. The first thing.', '2. The second thing.', '', '# Acceptance Criteria',
      '', '1. The first thing is true.', '2. The second thing is true.', ''].join('\n'),
    'utf8',
  );

  const ticket = (name, criteria, status = 'open') => fs.writeFileSync(
    path.join(tickets, name),
    ['---', `status: ${status}`, '---', '', '# t', '', '## Acceptance Criteria', '',
      ...criteria.map((line) => `- [ ] ${line}`), '', '## Relevant areas', 'somewhere', ''].join('\n'),
    'utf8',
  );

  const run = () => {
    const result = spawnSync(
      process.execPath,
      [path.join(SRC, 'scripts', 'validate.mjs'), '--root', aep],
      { encoding: 'utf8' },
    );
    return { out: result.stdout, err: result.stderr, code: result.status };
  };

  spec('accepted');
  ticket('01-cites.md', ['Requirement 2 holds, checked by reading it.']);

  assert('a fixture whose tickets all cite passes, so the arms below mean something', () => {
    const { out, code } = run();
    if (code !== 0) throw new Error(`exit ${code}: ${run().err}`);
    if (!/no failures/.test(out)) throw new Error(`unexpected summary: ${out}`);
    return true;
  });

  assert('a ticket citing nothing fails, and the failure names that ticket', () => {
    ticket('02-silent.md', ['Something is true, and it comes from nowhere.']);
    const { err, code } = run();
    fs.rmSync(path.join(tickets, '02-silent.md'));
    if (code === 0) throw new Error('a ticket tracing to nothing passed');
    if (!/02-silent\.md: its acceptance criteria cite no requirement/.test(err)) {
      throw new Error(`wrong diagnosis: ${err}`);
    }
    return true;
  });

  // Present is not the same as resolving. A renumbered spec leaves citations
  // that still look like citations, which is the drift this check exists for.
  assert('a citation the spec does not number fails, and the number is quoted back', () => {
    ticket('03-dangling.md', ['Criterion 99 holds.']);
    const { err, code } = run();
    fs.rmSync(path.join(tickets, '03-dangling.md'));
    if (code === 0) throw new Error('a citation to criterion 99 passed against a two-criterion spec');
    if (!/03-dangling\.md: cites criterion 99, and the spec numbers none of them/.test(err)) {
      throw new Error(`wrong diagnosis: ${err}`);
    }
    return true;
  });

  assert('a citation outside the acceptance criteria section does not count', () => {
    fs.writeFileSync(
      path.join(tickets, '04-elsewhere.md'),
      ['---', 'status: open', '---', '', '# t', '', '## Acceptance Criteria', '',
        '- [ ] Something is true.', '', '## Notes', 'Requirement 1 explains why.', ''].join('\n'),
      'utf8',
    );
    const { err, code } = run();
    fs.rmSync(path.join(tickets, '04-elsewhere.md'));
    if (code === 0) throw new Error('a citation in Notes satisfied the check');
    return /04-elsewhere\.md: its acceptance criteria cite no requirement/.test(err);
  });

  assert('an obsolete ticket is skipped, since the point of that status is the spec moved on', () => {
    ticket('05-dropped.md', ['Something nobody asked for.'], 'obsolete');
    const { code } = run();
    fs.rmSync(path.join(tickets, '05-dropped.md'));
    return code === 0;
  });

  // A landed effort is the record of what was reviewed. Skipping it silently
  // would read exactly like checking it and passing, so the summary says so.
  assert('an implemented effort is skipped, and the summary names what did not fire', () => {
    // Every ticket resolved, because an implemented effort with open work under
    // it is its own failure now and would mask the skip this asserts. Their
    // criteria stay unticked on purpose: a landed effort is exempt from the tick
    // check too, and this is where that exemption is exercised.
    ticket('01-cites.md', ['Requirement 2 holds, checked by reading it.'], 'resolved');
    ticket('06-silent.md', ['Something is true, and it comes from nowhere.'], 'resolved');
    spec('implemented');
    const { out, code } = run();
    spec('accepted');
    ticket('01-cites.md', ['Requirement 2 holds, checked by reading it.']);
    fs.rmSync(path.join(tickets, '06-silent.md'));
    if (code !== 0) throw new Error('an implemented effort was still checked');
    if (!/Traceability not checked for 1 implemented effort\(s\): probe/.test(out)) {
      throw new Error(`the skip was silent: ${out}`);
    }
    return true;
  });

  // Ticket 23. The status is the claim and the ticks are the evidence, so the
  // three arms are: resolved with an open box fails, obsolete is exempt because
  // the spec moved on, and a landed effort is exempt because its tickets are
  // the record of what was reviewed rather than a claim being made now.
  assert('a resolved ticket with an unticked criterion fails, and the count is named', () => {
    ticket('07-claimed.md', ['Requirement 1 holds.', 'Requirement 2 holds.'], 'resolved');
    const { err, code } = run();
    fs.rmSync(path.join(tickets, '07-claimed.md'));
    if (code === 0) throw new Error('a resolved ticket passed with two boxes open');
    if (!/07-claimed\.md: is "resolved" with 2 acceptance criterion\/criteria unticked/.test(err)) {
      throw new Error(`wrong diagnosis: ${err}`);
    }
    return true;
  });

  assert('a resolved ticket whose criteria are ticked passes', () => {
    fs.writeFileSync(
      path.join(tickets, '08-ticked.md'),
      ['---', 'status: resolved', '---', '', '# t', '', '## Acceptance Criteria', '',
        '- [x] Requirement 1 holds, checked by reading it.', '', '## Relevant areas', 'somewhere', ''].join('\n'),
      'utf8',
    );
    const { code } = run();
    fs.rmSync(path.join(tickets, '08-ticked.md'));
    return code === 0;
  });

  assert('an obsolete ticket with an open criterion is exempt, since the spec moved on', () => {
    ticket('09-dropped.md', ['Something nobody asked for.'], 'obsolete');
    const { code } = run();
    fs.rmSync(path.join(tickets, '09-dropped.md'));
    return code === 0;
  });

  // Ticket 22, the other direction. Every ticket resolved does not mean the
  // effort is done, because converge may still append, so only this direction
  // is checkable: implemented with open work under it is a stamp made early.
  assert('an implemented spec with an open ticket fails, naming the ticket', () => {
    spec('implemented');
    const { err, code } = run();
    spec('accepted');
    if (code === 0) throw new Error('an implemented spec passed with an open ticket under it');
    if (!/probe\/spec\.md: is "implemented" while efforts\/probe\/tickets\/01-cites\.md is still open/.test(err)) {
      throw new Error(`wrong diagnosis: ${err}`);
    }
    return true;
  });

  assert('a spec numbering nothing fails against the spec rather than each ticket', () => {
    fs.writeFileSync(
      path.join(effort, 'spec.md'),
      ['---', 'status: accepted', '---', '', '# Problem', 'x', ''].join('\n'),
      'utf8',
    );
    const { err, code } = run();
    spec('accepted');
    if (code === 0) throw new Error('a spec numbering nothing passed while carrying tickets');
    if (!/probe\/spec\.md: numbers no requirements and no acceptance criteria/.test(err)) {
      throw new Error(`the ticket was blamed instead of the spec: ${err}`);
    }
    return true;
  });

  fs.rmSync(dir, { recursive: true, force: true });
});

// An artifact written outside `.aep/` used to be invisible rather than wrong:
// every walk starts at the root, so a whole effort at the repository root was
// absent, and absent reads exactly like never having existed.
//
// The arms that decide whether this ships are the negative ones. A check firing
// on a consuming repository's own `templates/` is worse than the defect it
// catches, because it teaches people the validator is noise and after that it
// catches nothing at all. So every positive arm below is paired with the same
// directory holding ordinary files, and the true-positive arms remove the stray
// and confirm the tree goes green again: a check that fires on everything looks
// identical to a working one from the failing run alone.
section('strays', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-stray-'));
  const aep = path.join(dir, '.aep');
  fs.mkdirSync(aep, { recursive: true });
  // A stub bootstrap, as in `traceability`: the real one links to every
  // primitive directory, so a fixture carrying it would be testing the tree.
  fs.writeFileSync(
    path.join(aep, 'protocol.md'),
    ['---', 'version: 0.0.0', '---', '', '# AEP', 'A stub for the stray fixture.', ''].join('\n'),
    'utf8',
  );
  fs.writeFileSync(path.join(aep, 'index.md'), '# Index\n', 'utf8');
  fs.writeFileSync(path.join(aep, '.gitignore'), 'position/\nscratch/\nworktrees/\n', 'utf8');
  // The scripts arm compares bytes against the installed tree, so the fixture
  // needs a script installed for it to compare against. It is the real one
  // rather than a stand-in: what the arm claims to recognise is the script this
  // release ships, and a stand-in would only prove that a comparison compares.
  const SHIPPED_SCRIPT = path.join(SRC, 'scripts', 'index.mjs');
  fs.mkdirSync(path.join(aep, 'scripts'), { recursive: true });
  fs.copyFileSync(SHIPPED_SCRIPT, path.join(aep, 'scripts', 'index.mjs'));

  /** Writes a file at the fixture's repository root, outside `.aep/`. */
  const place = (relative, lines) => {
    const target = path.join(dir, ...relative.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${lines.join('\n')}\n`, 'utf8');
  };
  const drop = (relative) =>
    fs.rmSync(path.join(dir, ...relative.split('/')), { recursive: true, force: true });

  const stray = (status) => [`---`, `status: ${status}`, '---', '', '# Problem', 'x', ''];
  const governed = ['---', 'use-when: "a fixture is probed and the gate must recognise it"',
    '---', '', '# Ours', 'x', ''];

  const run = () => {
    const result = spawnSync(
      process.execPath,
      [path.join(SRC, 'scripts', 'validate.mjs'), '--root', aep],
      { encoding: 'utf8' },
    );
    return { out: result.stdout, err: result.stderr, code: result.status };
  };

  assert('a repository root with nothing on it passes, so the arms below mean something', () => {
    const { out, code, err } = run();
    if (code !== 0) throw new Error(`exit ${code}: ${err}`);
    return /no failures/.test(out);
  });

  // Criterion 3. The failure has to name three things, because two of them are
  // useless alone: knowing an effort is misplaced without knowing where it
  // belongs leaves the reader guessing, and this check will not move it.
  assert('an effort at the repository root fails, naming what, where, and where it belongs', () => {
    place('efforts/47-stray/spec.md', stray('accepted'));
    const { err, code } = run();
    if (code === 0) throw new Error('a whole effort at the repository root passed');
    if (!/^\s*efforts\/: sits at the repository root rather than under \.aep\//m.test(err)) {
      throw new Error(`the location was not reported from the repository root: ${err}`);
    }
    if (!/efforts\/47-stray\/spec\.md declares status: accepted/.test(err)) {
      throw new Error(`the failure did not name what it found: ${err}`);
    }
    if (!/belongs at \.aep\/efforts\//.test(err)) {
      throw new Error(`the failure did not name where it belongs: ${err}`);
    }
    return true;
  });

  // It reports and it never moves. Asserted on the run that just failed, since
  // this is the moment a helpful implementation would have tidied up.
  assert('the stray is still where it was found, because the check moves nothing', () =>
    fs.existsSync(path.join(dir, 'efforts', '47-stray', 'spec.md')) &&
    !fs.existsSync(path.join(aep, 'efforts', '47-stray', 'spec.md')));

  // The other half of criterion 3, and the one that carries the evidence. A
  // stray check that fired on every tree would produce the failure above too.
  assert('the same fixture with the stray removed passes', () => {
    drop('efforts');
    const { out, code, err } = run();
    if (code !== 0) throw new Error(`the check fires on a clean tree: ${err}`);
    return /no failures/.test(out);
  });

  // Criterion 4, and the case that decides whether any of this ships.
  assert('a root templates/ of ordinary project files is not a finding', () => {
    place('templates/card.hbs', ['<div>{{title}}</div>']);
    place('templates/README.md', ['# Templates', '', 'Handlebars partials for the site.']);
    place('templates/email/welcome.html', ['<p>Hello.</p>']);
    const { code, err } = run();
    drop('templates');
    if (code !== 0) throw new Error(`fired on a repository's own templates/: ${err}`);
    return true;
  });

  assert('a root references/ of citations is not a finding', () => {
    place('references/bibliography.md', ['# Sources', '', '1. Someone, 2019.']);
    place('references/rfc-7231.md', ['# HTTP semantics']);
    const { code, err } = run();
    drop('references');
    if (code !== 0) throw new Error(`fired on a repository's own references/: ${err}`);
    return true;
  });

  // Recognition is by the contract. The directory name is identical in both
  // arms, so the name cannot be what either of them turned on.
  assert('a root rules/ carrying a use-when fails, and one of plain files does not', () => {
    place('rules/linting.md', ['# Linting', '', 'Two spaces.']);
    const plain = run();
    place('rules/security.md', governed);
    const governedRun = run();
    drop('rules');
    if (plain.code !== 0) throw new Error(`fired on a repository's own rules/: ${plain.err}`);
    if (governedRun.code === 0) throw new Error('a rules/ of AEP artifacts passed');
    return /rules\/: sits at the repository root/.test(governedRun.err) &&
      /rules\/security\.md carries a use-when/.test(governedRun.err);
  });

  // The four protocol directories that ship Markdown answer the same question
  // `rules/` above does, and the name is deliberately pulled apart from the
  // finding in both arms: `skills/plan.md` is a path this release ships and is
  // silent without a `use-when`, while `skills/onboarding.md` is a name it has
  // never shipped and is the finding, because it carries one.
  assert('a root skills/ turns on the use-when, not on the name this release ships', () => {
    place('skills/plan.md', ['# Plan', '', 'How we plan a sprint here.']);
    const shippedName = run();
    place('skills/onboarding.md', governed);
    const governedRun = run();
    drop('skills');
    if (shippedName.code !== 0) {
      throw new Error(`fired on a repository's own skills/plan.md: ${shippedName.err}`);
    }
    if (governedRun.code === 0) throw new Error('a skills/ of AEP artifacts passed');
    return /skills\/onboarding\.md carries a use-when/.test(governedRun.err);
  });

  assert("a root agents/ turns on the use-when, so somebody else's researcher.md is quiet", () => {
    place('agents/researcher.md', ['# Researcher', '', 'The analyst rota, not a prompt.']);
    const ours = run();
    place('agents/reviewer.md', governed);
    const governedRun = run();
    drop('agents');
    if (ours.code !== 0) throw new Error(`fired on a repository's own agents/: ${ours.err}`);
    if (governedRun.code === 0) throw new Error('an agents/ of AEP artifacts passed');
    return /agents\/reviewer\.md carries a use-when/.test(governedRun.err);
  });

  // A script has no frontmatter to declare anything, so this arm reads the only
  // content there is: the bytes. Every name below is one this release ships, and
  // reporting any of them would send its author to a protocol-owned path that
  // the next upgrade overwrites, which is what the check did until it read them.
  assert("a repository's own root scripts/ is not a finding, empty or ordinary", () => {
    const entrypoint = path.join(dir, 'scripts', 'index.mjs');
    fs.mkdirSync(path.dirname(entrypoint), { recursive: true });
    fs.writeFileSync(entrypoint, '', 'utf8');
    const empty = run();
    place('scripts/index.mjs', ['console.log("our build entrypoint");']);
    place('scripts/contract.mjs', ['export const ROUTES = [];']);
    const ordinary = run();
    drop('scripts');
    if (empty.code !== 0) throw new Error(`fired on a zero-byte scripts/index.mjs: ${empty.err}`);
    if (ordinary.code !== 0) throw new Error(`fired on a repository's own build scripts: ${ordinary.err}`);
    return true;
  });

  // The arm that carries the evidence, because one that has stopped firing on
  // anything is indistinguishable from a correct one on the passing runs above.
  // One appended byte is the whole difference between AEP's file and somebody's.
  assert('a root scripts/ holding a byte-identical copy of a shipped script fails', () => {
    const copy = path.join(dir, 'scripts', 'index.mjs');
    fs.mkdirSync(path.dirname(copy), { recursive: true });
    fs.copyFileSync(SHIPPED_SCRIPT, copy);
    const identical = run();
    fs.appendFileSync(copy, '\n');
    const altered = run();
    drop('scripts');
    if (identical.code === 0) throw new Error('a copy of a shipped script at the root passed');
    if (altered.code !== 0) throw new Error(`fired on a script that is not the shipped one: ${altered.err}`);
    return /scripts\/: sits at the repository root/.test(identical.err) &&
      /scripts\/index\.mjs is byte-identical to the script this release ships/.test(identical.err);
  });

  // The shape gate is tight in both directions, and this is the direction it
  // gives something up in: a malformed effort outside the tree is missed. That
  // is the trade requirement 4 asks for, so it is asserted rather than left to
  // be discovered as a surprise.
  assert('an efforts/ whose spec declares no legal status is not recognised', () => {
    place('efforts/48-wip/spec.md', stray('wip'));
    const withStatus = run();
    place('efforts/48-wip/spec.md', ['# Problem', 'No frontmatter at all.']);
    const without = run();
    drop('efforts');
    return withStatus.code === 0 && without.code === 0;
  });

  // Depth is half of the gate for the kinds that have no manifest to answer for
  // them. A context is one project directory in at most, so anything deeper is
  // somebody's own tree of notes rather than an AEP artifact.
  assert('a context is recognised at the depth the policy allows and no deeper', () => {
    place('contexts/team/auth.md', governed);
    const allowed = run();
    drop('contexts');
    place('contexts/team/web/auth.md', governed);
    const deeper = run();
    drop('contexts');
    if (allowed.code === 0) throw new Error('a contexts/<project>/<area>.md at the root passed');
    if (deeper.code !== 0) throw new Error('fired on a tree nested deeper than a context may sit');
    return /contexts\/team\/auth\.md carries a use-when/.test(allowed.err);
  });

  // `skills` is the one entry in USE_WHEN_DEPTHS whose value is observable at
  // all: shallowFiles pushes a top-level file before it consults maxDepth, so
  // every value at or below 1 behaves identically on a flat directory, and
  // perturbing policies, agents, or templates proves nothing. Narrowed to 1,
  // a strayed skill note goes unread and validate reports no failures with a
  // whole artifact at the repository root, which is the original defect back
  // for one kind. Widened, a repository's own skills/a/b/c.md is a finding.
  assert('a skill note is recognised at the depth the layout allows and no deeper', () => {
    place('skills/plan/depth.md', governed);
    const allowed = run();
    drop('skills');
    place('skills/plan/note/depth.md', governed);
    const deeper = run();
    drop('skills');
    if (allowed.code === 0) throw new Error('a skills/<skill>/<note>.md at the root passed');
    if (deeper.code !== 0) throw new Error('fired on a tree nested deeper than a skill note may sit');
    return /skills\/plan\/depth\.md carries a use-when/.test(allowed.err);
  });

  // The scan stops at the root's immediate children. A deeper walk was rejected
  // because it would flag this repository's own `src/skills/`, so the bound is
  // asserted rather than left as an implementation detail nobody could see.
  assert('a stray nested below the repository root is out of reach, and stays quiet', () => {
    place('docs/efforts/49-buried/spec.md', stray('accepted'));
    const { code } = run();
    drop('docs');
    return code === 0;
  });

  fs.rmSync(dir, { recursive: true, force: true });
});

// Ticket 08. The specification is what every other section in this file checks
// against, so a claim in it that no longer describes the payload turns the whole
// suite into a check of one stale document against another. These assertions run
// the comparison in the other direction: the specification's own counts and lists
// against the payload that is supposed to satisfy them.
// Ticket 15. A label is the one AEP artifact that lives where other people can
// edit it, so the whole section turns on one distinction: which labels an agent
// re-derives and which it must never touch. Getting that backwards overwrites a
// human, silently, on a run they did not ask for.
section('labels', () => {
  const CR = String.fromCharCode(13);
  const lf = (text) => text.split(CR).join('');
  // 4.0: labels are a tracker concern, and live in the tracker policy, which
  // loads only where `tracker:` is on.
  const trackerPolicy = lf(readSrc('policies', 'tracker.md'));
  const github = lf(readSrc('seed', 'references', 'github.md'));
  const policy = headingBlock(trackerPolicy, 'Labels are projections');
  const flatPolicy = flat(policy);

  assert('the tracker policy states the label rule', () => policy.length > 0);
  assert('the file wins when a label disagrees with it', () =>
    /\*\*The file wins\.\*\* Where a label and `spec\.md` disagree, correct the label, never the file/.test(flatPolicy));
  assert('the policy separates derived from initial', () =>
    /\| \*\*derived\*\* \u2014 `status:`, `type:`, `size:`, every flag a fact establishes \| from a file or the diff \| re-synced on every write \|/.test(policy)
    && /\| \*\*initial\*\* \u2014 `priority:`, any flag inviting a person to act \| once, at opening \| never changed by an agent \|/.test(policy));
  const derivedLine = policy.split('\n').find((line) => line.startsWith('| **derived**')) ?? '';
  const initialLine = policy.split('\n').find((line) => line.startsWith('| **initial**')) ?? '';
  for (const family of ['`status:`', '`type:`', '`size:`']) {
    assert(`${family} is derived`, () => derivedLine.includes(family) && !initialLine.includes(family));
  }
  assert('`priority:` is initial and not derived', () =>
    initialLine.includes('`priority:`') && !derivedLine.includes('`priority:`'));

  const LADDER_HEADER = '| The effort | Issue | Pull request | What moves it |';
  const policyLines = policy.split('\n');
  const ladderHead = policyLines.indexOf(LADDER_HEADER);
  assert('the ladder stands under its own header', () => {
    if (ladderHead === -1) throw new Error(`no line reads: ${LADDER_HEADER}`);
    return true;
  });
  assert('the policy states the ladder once', () => {
    const heads = policyLines.filter((line) => line === LADDER_HEADER).length;
    if (heads !== 1) throw new Error(`${heads} tables stand under the ladder's header`);
    return true;
  });
  assert('the ladder header is followed by its separator', () =>
    /^\|( -+ \|)+$/.test(policyLines[ladderHead + 1] ?? ''));
  const rows = [];
  for (let i = ladderHead + 2; ladderHead !== -1 && i < policyLines.length; i += 1) {
    if (!policyLines[i].startsWith('| ')) break;
    rows.push(policyLines[i]);
  }
  assert('the status projection covers every effort state', () => rows.length === 6);
  if (rows.length !== 6) process.stdout.write(`        projection rows: ${rows.length}\n`);
  for (const state of ['backlog', 'ready', 'in progress', 'in review', 'done']) {
    assert(`the projection reaches status: ${state}`, () => policy.includes(`status: ${state}`));
  }

  const cells = (row) => row.split('|').slice(1, -1).map((cell) => cell.trim());
  assert('every ladder row carries an owner column', () => rows.every((row) => cells(row).length === 4));
  const unowned = rows.filter((row) => (cells(row)[3] ?? '') === '');
  assert('every ladder row names what moves it', () => unowned.length === 0);

  const terminal = rows.filter((row) => cells(row)[2] === '`status: done`');
  assert('two rows reach the terminal value', () => terminal.length === 2);
  assert('the ladder reaches the terminal value on a merge', () =>
    terminal.some((row) => cells(row)[0] === 'merged'));
  assert('the ladder reaches the terminal value closed without merging', () =>
    terminal.some((row) => cells(row)[0] === 'closed without merging' && cells(row)[1] === '`status: done`'));
  assert('the merged row still says the pull request closes the issue', () =>
    terminal.some((row) => cells(row)[0] === 'merged' && /closes it/.test(cells(row)[1])));
  for (const row of terminal) {
    const owner = cells(row)[3] ?? '';
    assert(`the ${cells(row)[0]} row names the job that fires at merge`, () => /merge-time job/.test(owner));
    assert(`the ${cells(row)[0]} row names the reconciliation that corrects it late`, () => /`reconcile\.mjs`/.test(owner));
  }
  assert('an abandoned effort is labelled wontfix and closed', () =>
    /\*\*Abandoning closes both objects\*\*, labelled `flag: wontfix`/.test(flat(trackerPolicy)));

  const labelIn = (cell) => (/`(status: [^`]+)`/.exec(cell) ?? [])[1]
    ?? `no backticked label in "${cell}"`;
  const asRow = ({ effort, issue, pullRequest }) => `${effort} | ${issue} | ${pullRequest}`;
  const fromPolicy = rows.map((row) => {
    const cell = cells(row);
    return asRow({ effort: cell[0], issue: labelIn(cell[1]), pullRequest: labelIn(cell[2]) });
  });
  const fromContract = STATUS_LADDER.map(asRow);
  const absent = fromPolicy.filter((row) => !fromContract.includes(row));
  const invented = fromContract.filter((row) => !fromPolicy.includes(row));
  assert('contract.mjs carries the ladder row for row', () => {
    if (absent.length > 0 || invented.length > 0) {
      throw new Error([
        ...absent.map((row) => `in the policy, missing from STATUS_LADDER: ${row}`),
        ...invented.map((row) => `in STATUS_LADDER, missing from the policy: ${row}`),
      ].join('; '));
    }
    return true;
  });
  // Gated on the comparison above rather than merely written after it, which is
  // what makes the next sentence true: its reader already knows every row is
  // present and needs the one thing a bare false withholds, which row moved.
  // Ungated it ran on a ladder missing a row and reported four rows moved,
  // beside the check that had just named the real cause.
  if (absent.length === 0 && invented.length === 0) {
    assert('the policy and STATUS_LADDER state the rows in the same order', () => {
      const moved = Array.from({ length: Math.max(fromPolicy.length, fromContract.length) })
        .map((_, i) => (fromPolicy[i] === fromContract[i]
          ? null
          : `row ${i + 1}: the policy has "${fromPolicy[i] ?? 'nothing'}", `
            + `STATUS_LADDER has "${fromContract[i] ?? 'nothing'}"`))
        .filter(Boolean);
      if (moved.length > 0) throw new Error(moved.join('; '));
      return true;
    });
  }

  // The two columns the value holds and the policy's table does not. Checking
  // them for membership and cardinality is what a swapped pair survives: two
  // rows can trade their `spec` values, or the terminal rows their
  // `changeRequest`, and a check asking only which values appear sees an
  // unchanged set. So each value is tied to the row carrying it.
  //
  // `spec` is read back out of the policy rather than restated here, which is
  // what keeps the policy the single source: three of the four projecting rows
  // name their status in their own wording, and `effort` is that wording, held
  // equal to the policy's by the comparison above. The fourth, `the runner is
  // working`, names none, because taking the first ticket moves the label
  // without moving the field, so it is pinned in NAMES_NO_STATUS below.
  //
  // That pin is a stated gap rather than a hole, and one property is why: a row
  // naming exactly one status takes the one it names, so the pin is reached only
  // for a row naming none. A wrong pin for a row that states its own status is
  // inert, and so is a key for a row that no longer exists, which is what stops
  // this map from being widened to silence a failure.
  //
  // `changeRequest` is not derived, and cannot be: the state that selects a
  // terminal row is exactly what the ladder has no column for. So
  // SELECTS_A_TERMINAL_ROW is a pin, a flat second copy of that column, and it
  // is written to fail closed. A terminal row it does not know throws rather
  // than passing, so rewording a terminal row in the policy takes the pin down
  // with it instead of quietly excusing the row.
  const projecting = STATUS_LADDER.filter((row) => row.changeRequest === null);
  const terminalRows = STATUS_LADDER.filter((row) => row.changeRequest !== null);
  const NAMES_NO_STATUS = { 'the runner is working': 'accepted' };
  const SELECTS_A_TERMINAL_ROW = { merged: 'merged', 'closed without merging': 'closed' };

  assert('every projecting row names a spec status', () =>
    projecting.length > 0 && projecting.every((row) => SPEC_STATUSES.includes(row.spec)));
  assert('every spec status reaches a row', () =>
    SPEC_STATUSES.every((status) => STATUS_LADDER.some((row) => row.spec === status)));

  // The one claim the value's doc comment makes that its own rows could stop
  // supporting. Rewording the policy's third row so it names a status, moving
  // the value's `effort` to match and its `spec` with it, satisfies every check
  // above: the rows still agree, every status still reaches a row, and the
  // ladder now says `status: in progress` projects from something other than
  // `accepted`. That is the association the value warns a consumer to respect,
  // so it is pinned here rather than left to the coverage check, which notices a
  // misread only when it strands a status with no row at all.
  assert('accepted reaches ready and in progress, and no other row', () => {
    const reached = STATUS_LADDER.filter((row) => row.spec === 'accepted').map((row) => row.issue);
    const want = ['status: ready', 'status: in progress'];
    if (JSON.stringify(reached) !== JSON.stringify(want)) {
      throw new Error(`accepted reaches ${JSON.stringify(reached)}, and the ladder says ${JSON.stringify(want)}`);
    }
    return true;
  });
  for (const row of projecting) {
    assert(`the ladder row "${row.effort}" projects the spec status it states`, () => {
      const named = SPEC_STATUSES.filter((status) => row.effort.includes(status));
      if (named.length > 1) throw new Error(`"${row.effort}" names ${named.join(' and ')}`);
      const want = named.length === 1 ? named[0] : NAMES_NO_STATUS[row.effort];
      if (want === undefined) {
        throw new Error(`"${row.effort}" names no spec status and is pinned nowhere`);
      }
      if (row.spec !== want) {
        throw new Error(`carries ${JSON.stringify(row.spec)}, and its row says ${want}`);
      }
      return true;
    });
  }

  assert('the terminal rows turn on the change request and not on a file', () =>
    terminalRows.length === Object.keys(SELECTS_A_TERMINAL_ROW).length
    && terminalRows.every((row) => row.spec === null));
  for (const row of terminalRows) {
    assert(`the ladder row "${row.effort}" names the state that selects it`, () => {
      const want = SELECTS_A_TERMINAL_ROW[row.effort];
      if (want === undefined) {
        throw new Error(`"${row.effort}" is a terminal row this check does not know`);
      }
      if (row.changeRequest !== want) {
        throw new Error(`carries ${JSON.stringify(row.changeRequest)}, and it is the ${want} row`);
      }
      return true;
    });
  }
  assert('nothing but a terminal row reaches the terminal value', () =>
    STATUS_LADDER.filter((row) => row.issue === 'status: done').length === terminalRows.length
    && terminalRows.every((row) => row.issue === 'status: done'
      && row.pullRequest === 'status: done'));

  // size:, and where its thresholds live. A size label whose thresholds are
  // stated somewhere else is one nobody reading the tracker can check.
  assert('size is computed from the diff at ready', () =>
    /\*\*`size:` is computed from the diff\*\* at ready-for-review/.test(flatPolicy));
  assert('the thresholds live in the label descriptions', () =>
    flatPolicy.includes("against the thresholds the repository's own label descriptions state"));
  assert('a flag with no fact behind it is not set', () => flatPolicy.includes('**Flags need a fact:**'));
  for (const [flag, fact] of [
    ['breaking changes', 'public-contract trip-wire'],
    ['dependencies', 'manifest or lockfile moved'],
    ['discussion', 'open questions'],
  ]) {
    assert(`the policy says what establishes flag: ${flag}`, () => flatPolicy.includes(flag) && flatPolicy.includes(fact));
  }
  assert('AEP uses labels that already exist here', () => flatPolicy.includes('**Use labels that already exist here.**'));
  assert('creating a label is reported with its reason', () =>
    flatPolicy.includes('creating it is reported with the reason'));
  assert('no label AEP sets names AEP', () => flatPolicy.includes('No label names AEP.'));
  assert('the tracker re-syncs derived labels on every write, and never touches an initial one', () =>
    /re-synced on every write/.test(policy) && /never changed by an agent/.test(policy));
  assert('the close computes size and moves both objects to in review', () =>
    /set `size:`, move both objects to `status: in review`/.test(flat(trackerPolicy)));

  const labels = JSON.parse(fs.readFileSync(path.join(SRC, LABEL_SEED), 'utf8'));
  const families = Object.keys(labels.families ?? {});
  assert('the label seed carries five families', () =>
    JSON.stringify(families.sort()) ===
    JSON.stringify(['flag', 'priority', 'size', 'status', 'type']));
  assert('every family says how it is maintained', () =>
    families.every((f) => /derived|initial|Derived|Initial/.test(labels.families[f].why ?? '')));

  const all = families.flatMap((f) => labels.families[f].labels ?? []);
  assert('the seed carries labels at all', () => all.length >= 20);
  assert('every seeded label carries a name, a colour, and a description', () =>
    all.every((l) => l.name && /^[0-9a-f]{6}$/.test(l.color ?? '') && l.description));
  assert('every seeded label is prefixed by its own family', () =>
    families.every((f) => (labels.families[f].labels ?? []).every((l) => l.name.startsWith(`${f}: `))));
  assert('no seeded label names AEP', () =>
    all.every((l) => !/\baep\b/i.test(l.name)) &&
    all.every((l) => !/\baep\b/i.test(l.description)));

  // The one description that is unusable without its numbers. A size label
  // saying "a medium change" is a label a reviewer cannot check or recompute.
  const sizes = labels.families.size.labels;
  assert('every size description states a line threshold', () =>
    sizes.every((l) => /\d/.test(l.description)));
  assert('the size thresholds do not overlap or leave a gap', () => {
    const bounds = sizes.map((l) => (l.description.match(/\d+/g) ?? []).map(Number));
    return bounds.length === 5
      && bounds[0].length === 1
      && bounds[4].length === 1
      && bounds.slice(1, 4).every((b) => b.length === 2 && b[1] > b[0])
      && bounds[1][0] === bounds[0][0]
      && bounds[2][0] === bounds[1][1] + 1
      && bounds[3][0] === bounds[2][1] + 1
      && bounds[4][0] === bounds[3][1] + 1;
  });

  // The forge seed, which is what an installed repository actually reads.
  assert('the github seed records the five families and how each is maintained', () =>
    github.includes('### The five families, and which of them re-sync'));
  assert('the github seed routes the decision to the tracker policy', () =>
    /\[\[policies\/tracker\]\]` decides this/.test(github));
  assert('the github seed says the file wins', () =>
    github.includes('**The file wins when a label disagrees with it.**'));
});

section('the specification', () => {
  const bootstrap = readSrc('protocol.md');

  // The renumbering hazard, and the cheapest check here. A section renumbered by
  // an edit elsewhere leaves every citation of it pointing at different text
  // while still reading correctly, so nothing about the document looks wrong.
  const sections = new Set([...specText.matchAll(/^## (\d+)\./gm)].map((m) => m[1]));
  const subsections = new Set(
    [...specText.matchAll(/^### (\d+)\.(\d+)/gm)].map((m) => `${m[1]}.${m[2]}`),
  );
  const dangling = [];
  for (const match of specText.matchAll(/§(\d+)(\.\d+)?/g)) {
    const key = match[1] + (match[2] ?? '');
    const known = match[2] ? subsections.has(key) : sections.has(match[1]);
    if (!known) dangling.push(key);
  }
  assert('specs.md carries sections to cite at all', () => sections.size > 0);
  assert('every section reference in specs.md resolves', () => dangling.length === 0);
  if (dangling.length > 0) {
    process.stdout.write(`        dangling: ${[...new Set(dangling)].sort().join(', ')}\n`);
  }
  assert('specs.md declares the section it says it removed', () =>
    !/^## \d+\. Modes\s*$/m.test(specText));

  // The primitive set, counted off both tables rather than matched as prose. A
  // regex for seven names passes while an eighth row sits beside them, and the
  // bootstrap and the specification growing apart is the drift nobody sees:
  // each reads correctly on its own.
  const rowsOf = (text, heading) =>
    [...headingBlock(text, heading).matchAll(/^\|\s*\*\*(\w+)\*\*\s*\|/gm)].map((m) => m[1]);
  const specPrimitives = rowsOf(specText, '3. Primitives and terminology');
  const bootPrimitives = rowsOf(bootstrap, 'The primitives');
  assert('specs.md names seven primitives', () => specPrimitives.length === 7);
  assert('the specification and the bootstrap name the same primitives', () =>
    JSON.stringify(specPrimitives) === JSON.stringify(bootPrimitives));
  assert('specs.md states the count it lists', () =>
    specText.includes('AEP defines seven primitives'));
  assert('the retired primitives are not listed as primitives', () =>
    ['Modes', 'Evidence', 'Tasks', 'Worktrees', 'Position']
      .every((name) => !specPrimitives.includes(name)));

  // The skill set, read out of the specification's own list. The `skills`
  // section already compares disk against contract.mjs; both move together in
  // one commit, so a specification left behind would never fail there.
  const skillList = headingBlock(specText, '15. Skills');
  const named = [...skillList.matchAll(/^\*\*(?:Spine|Adaptive|Lifecycle|Sub-skills) \(\d+\)\*\*(.+)$/gm)]
    .flatMap((line) => [...line[1].matchAll(/`([a-z]+)`/g)].map((m) => m[1]));
  assert('specs.md lists its skills in named groups', () => named.length > 0);
  assert('the specification and the payload name the same skills', () =>
    JSON.stringify([...named].sort()) === JSON.stringify([...SKILLS].sort()));
  if (JSON.stringify([...named].sort()) !== JSON.stringify([...SKILLS].sort())) {
    process.stdout.write(`        specs.md: ${[...named].sort().join(', ')}\n`);
    process.stdout.write(`        payload:  ${[...SKILLS].sort().join(', ')}\n`);
  }
  assert('specs.md states the skill count it lists', () =>
    specText.includes(`exactly eighteen`) && named.length === 18);
  assert('specs.md no longer carries commit as a skill', () => !named.includes('commit'));

  // 4.1: §15.2 states three registers and §35.12 says why a brief stopped being
  // exempt. Absence is asserted over the whole document, since the sentence it
  // replaces could reappear in any section and read as current.
  const registers = specText.slice(specText.indexOf('### 15.2 '), specText.indexOf('\n## 16. '));
  assert('specs.md makes no sub-agent brief exempt', () => {
    const rationaleAt = specText.indexOf('## 35.12 Rationale from policies/reporting');
    const outside = flat(specText.slice(0, rationaleAt) + specText.slice(specText.indexOf('## 35.13 ')));
    const sentences = outside.split(/(?<=[.!?])\s+/).filter((line) => /\bbriefs?\b/i.test(line) && /\bexempt\b/i.test(line));
    if (sentences.length > 0) throw new Error(sentences[0].slice(0, 120));
    return !/a protocol agent reads it, it is exempt/.test(flat(specText));
  });
  assert('specs.md §15.2 states three registers, chosen by who reads it', () =>
    /\*\*who reads a text decides its register\*\*\. There are three\./.test(flat(registers)) &&
    ['**Public**', '**Controlled**', '**Exempt**'].every((label) => registers.includes(label)));
  assert('specs.md §15.2 puts the brief, the return, and the relayed question under controlled', () =>
    /\*\*Controlled\*\*[^\n]*a brief, a child's return, and a question relayed between agents/.test(registers));
  assert('specs.md §15.2 says the contract assumes no runtime for sketches and the picker', () =>
    /\*\*The contract assumes no runtime here either:\*\* a sketch is plain text/.test(flat(registers)) &&
    /through an interactive picker only where the runtime has one/.test(flat(registers)));
  const rationale = headingBlock(specText, '35.12 Rationale from policies/reporting');
  assert('specs.md §35.12 records the supersession of the exempt brief', () =>
    /^#### A brief and a return are controlled, not exempt \(policies\/reporting, superseding readable-output\)$/m.test(rationale) &&
    /The `readable-output` effort, in 4\.0/.test(rationale));
  assert('specs.md §35.12 replaces the old exemption rationale rather than keeping it beside the new', () =>
    !/This is the one narrowing of the exemption for text a protocol agent reads/.test(rationale) &&
    !/The governed and exempt lists are worked examples/.test(rationale));

  // The four typed commands, in both documents. A specification that still
  // names seven stages and a bootstrap that names four is the disagreement a
  // reader resolves by picking whichever they happened to load.
  for (const [where, text] of [['specs.md', specText], ['protocol.md', bootstrap]]) {
    assert(`${where} states four commands and no more`, () =>
      /\*\*Four commands/.test(text));
    assert(`${where} spells the spine as the four`, () =>
      text.includes('/specify → /plan? → /tasks → /implement'));
  }
  assert('specs.md names refine, research, and review as stages rather than commands', () => {
    const block = headingBlock(specText, '15. Skills');
    return /`refine`, `research`, and `review` are \*\*stages\*\*/.test(block);
  });

  // Review's unit, in the section that defines the spine. Three sites move
  // together and each is asserted separately, because the failure this guards
  // against is a document that changes one of them: a table row still reading
  // "per ticket" beside a paragraph reading "the effort" is two answers to the
  // question a conforming implementation came here to settle.
  const spine = headingBlock(specText, '21. The workflow spine');
  const reviewRow = /^\| `review` \| ([^|]+) \| [^|]+ \| ([^|]+) \|$/m.exec(spine);
  assert('the stage table gives review the effort as its subject', () =>
    reviewRow !== null && /effort/.test(reviewRow[1]) && !/ticket/.test(reviewRow[1]));
  assert('the stage table gives review the close as when it runs', () =>
    reviewRow !== null && /close/.test(reviewRow[2]) && !/ticket/.test(reviewRow[2]));
  assert('specs.md gives review the effort as its unit and the effort branch as its subject', () =>
    /\*\*`review`\*\* is a stage of `implement`, and \*\*its unit is the effort\*\*/.test(spine)
    && /subject is the effort branch/.test(spine));
  assert('the spine no longer runs review per ticket, anywhere in the section', () =>
    !/per ticket/.test(spine));
  assert('the runner paragraph reviews the effort once rather than each ticket as it goes', () =>
    !/reviews and commits each/.test(spine) && /reviews the effort once/.test(spine));

  // The commit rule, restated rather than deleted. Both halves are required.
  // Dropping the sentence satisfies the first alone and reads as a
  // simplification, and what it would remove is the guarantee that no unjudged
  // work reaches a human, which is the whole of what the old rule protected.
  assert('specs.md states the commit rule in a form review-after-the-commit can satisfy', () =>
    !/MUST NOT commit work that has failed review/.test(spine)
    && /\*\*An agent MUST NOT hand work to a human while a review finding against it is open\.\*\*/.test(spine)
    && /pull request MUST NOT be marked ready while/.test(spine));
  assert('the restated rule still carries what the commit rule protected', () =>
    /unjudged work never reaches a human/.test(spine));

  // Two axes, and still two. Moving review's unit is the moment a third axis or
  // a collapsed pair would travel in unnoticed, since the paragraph naming them
  // is the paragraph being rewritten.
  assert('the spine keeps review at two independent axes, reviewers set by lane', () =>
    /\*\*two independent axes\*\* \(in the standard lane one reviewer runs them as separate passes; in the full lane two reviewers run them in parallel/.test(spine)
    && /one on correctness and behaviour, one on style, standards, and governance/.test(spine));

  // The frontmatter contract, and the fields it lost. The migration and the
  // removals record still name them, and must: a retired field nobody documents
  // is one a 2.x tree carries with nothing to say what became of it. Everything
  // before the upgrade section is the live contract, and a retired field there
  // reads as current.
  const live = specText.slice(0, specText.indexOf('## 30. Upgrade'));
  for (const field of ['owner:', '`owner`', 'mode:', '`mode`', 'kind:', '`kind`',
    'report:', '`report`', 'part-of', '`aep`', '`date`']) {
    assert(`the live contract does not describe ${field}`, () => !live.includes(field));
  }
  for (const field of ['use-when', 'paths', 'status', 'blocked-by', 'builds-on']) {
    assert(`the frontmatter contract still states ${field}`, () =>
      headingBlock(specText, '8. Frontmatter contract').includes(`\`${field}\``));
  }
  assert('the removals record says where each retired field went', () => {
    const block = headingBlock(specText, '32. What each release removes');
    return ['owner:', 'mode:', 'kind:', 'report:', 'part-of'].every((f) => block.includes(f));
  });

  // The four use-when checks, stated in the specification and implemented in
  // the validator. Pinned as a count because a fifth check added to one side
  // only is exactly the shape this misses.
  const checks = headingBlock(specText, '8. Frontmatter contract');
  assert('specs.md states four use-when checks', () =>
    /\*\*Four checks, each a hard failure naming the file:\*\*/.test(checks) &&
    [...checks.matchAll(/^\d\. \*\*/gm)].length === 4);

  // The upgrade's two classifiers, and the condition that ends the older one. A
  // compatibility branch with no stated end is one nobody removes.
  const upgrade = headingBlock(specText, '30. Upgrade');
  assert('specs.md states both layout classifiers', () =>
    /an `owner:` field on its artifacts \| \*\*that field\*\*/.test(upgrade) &&
    /no `owner:` field \| \*\*the manifest\*\*/.test(upgrade));
  assert('specs.md states when the older classifier is removed', () =>
    /\*\*The removal condition is stated rather than left to judgement/.test(upgrade));

  // plan.md, reinstated. The specification forbade it in 2.0 and the forbidden
  // list still ran on that sentence, so both halves are checked: it is an
  // artifact now, and nothing still calls it forbidden.
  assert('specs.md states plan.md as the effort artifact holding HOW', () =>
    specText.includes('The technical approach lives beside it in **`plan.md`**'));
  assert('specs.md does not also forbid plan.md', () =>
    !specText.includes('**There is no `plan.md`.**') &&
    !specText.includes('No `plan.md` exists.'));
  assert('the forbidden structures no longer include plan.md', () => {
    const line = specText.split('\n').find((l) => l.includes('the forbidden structures are absent'));
    return Boolean(line) && !line.includes('plan.md') && line.includes('`modes/`');
  });

  // Tickets, local without qualification. The 2.x wording made them optional and
  // permitted an external tracker, and every scheduling claim in the payload now
  // depends on the opposite.
  const ticketing = headingBlock(specText, '14. Efforts, specs, and tasks');
  assert('specs.md places an effort\'s tickets in the repository', () =>
    ticketing.includes('**An effort\'s tasks are files in this repository**'));
  assert('specs.md says a ticket is never a tracker object', () =>
    ticketing.includes('**A ticket is never an object in a tracker**'));
  assert('specs.md states exactly two tracker objects per effort', () =>
    ticketing.includes('**Exactly two tracker objects exist per effort**'));

  // Requirements 62 and 63, in the normative document rather than only in the
  // payload that implements them. The two have to move together: a payload
  // stating a posture the specification does not is a fork inside one release.
  assert('specs.md requires both tracker objects where a tracker exists', () =>
    ticketing.includes('**Where the repository has a tracker, both objects are REQUIRED**')
    && ticketing.includes('MUST open what is missing and report it'));
  assert('specs.md gives the tracker-less effort a procedure and a merger', () =>
    ticketing.includes(
      "**Where the repository has no tracker, the effort is a branch and merging it is the human's.**",
    )
    && /MUST NOT merge\*\*, with a tracker or without/.test(ticketing));

  // Ticket 47.02. Read literally, the prohibition on labelling a natively
  // modelled fact and the ladder's terminal value contradicted each other: every
  // forge models merged, and `status: done` is the value the ladder ends on. The
  // clause is narrowed rather than dropped, so both halves are asserted here.
  // Without the first, an amendment that read as general permission to add
  // labels would pass this section unremarked.
  assert('specs.md still forbids a label for a fact the tracker models natively', () =>
    ticketing.includes(
      '**A conforming implementation MUST NOT create a label for a fact the tracker already models.**',
    ));
  assert('specs.md exempts the terminal value of a status family AEP maintains', () =>
    ticketing.includes(
      '**The one exception is the terminal value of a `status:` family AEP maintains.**',
    ));
  assert('the exception states that a family with a hole cannot be filtered on', () =>
    /a family with a hole in it cannot be filtered on/.test(ticketing));
  assert('the exception states the value projects the effort rather than the forge', () =>
    /a projection of the effort's own state rather than a second copy of the forge's/
      .test(ticketing));
  assert('the exception narrows the prohibition rather than lifting it', () =>
    /This narrows the prohibition rather than lifting it/.test(ticketing)
    && /outside a family AEP maintains, a label for a natively modelled fact stays forbidden/
      .test(ticketing));
  assert('the conformance list carries the narrowed clause too', () =>
    /already models, save the terminal value of a `status:` family AEP maintains/.test(specText));

  // The ladder asserted against the amended clause rather than against the old
  // one: what the exception preserves is the value the policy's ladder actually
  // ends on, so neither document can move without the other going red.
  const ladder = readSrc('policies', 'tracker.md').split(String.fromCharCode(13)).join('');
  const ladderRows = ladder.split('\n').filter((line) =>
    line.startsWith('| ') && line.endsWith('|') && line.includes('status: '));
  const endsOn = ladderRows.length > 0
    ? ladderRows.at(-1).split('|').slice(1, -1).map((cell) => cell.trim())[2]
    : '';
  assert('the ladder ends on exactly the value the amended clause preserves', () =>
    endsOn === '`status: done`'
    && ticketing.includes('the terminal value of a `status:` family AEP maintains'));

  // Requirement 61. The upgrade grew a numbered duty, so the list has to carry
  // it: a procedure described in prose below a list that does not name it is a
  // step an implementer reads past.
  assert('specs.md lists the rule reconciliation among the upgrade duties', () =>
    /\*\*reconciles rules against the policies the crossed releases changed\*\*/.test(upgrade));
  assert('specs.md says a rule is legal against the release it was written under', () =>
    upgrade.includes(
      '**A rule is legal against the release it was written under, and an upgrade is where that is rechecked.**',
    )
    && /compute the candidates rather than judge them/.test(upgrade)
    && /write nothing at all on a refusal/.test(upgrade)
    && /\*\*never delete a rule\.\*\*/.test(upgrade));
  assert('the rule hierarchy names where its judgement is rechecked', () => {
    const hierarchy = headingBlock(specText, '10. Policies and rules');
    return /an upgrade rechecks it against the release being installed/.test(hierarchy);
  });
});

// --- 19.3 scope is computed from the branch ---------------------------------
// The pair that carries this section is a branch a runtime named. `t3code/<hex>`
// resolves to its effort by what its commits touched, and the same branch
// renamed to another effort's exact directory name still resolves to the first.
// A resolution that read the name would satisfy every other assertion here and
// fail those two, which is why they are written as a pair rather than as one
// happy path.

section('scope', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-scope-'));
  const aep = path.join(dir, '.aep');

  const git = (...args) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const write = (file, body) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body, 'utf8');
  };
  const effortFile = (effort, ...parts) => path.join(aep, 'efforts', effort, ...parts);
  const stub = (heading) => `---\nstatus: open\n---\n\n# ${heading}\n`;

  const run = (command, options = {}) => {
    const result = spawnSync(
      process.execPath,
      [path.join(SRC, 'scripts', 'scope.mjs'), command, '--root', options.root ?? aep, ...(options.args ?? [])],
      { cwd: options.cwd ?? dir, encoding: 'utf8' },
    );
    return { out: result.stdout, err: result.stderr, code: result.status };
  };
  const fieldOf = (out, label) => new RegExp(`^${label}\\s+(.*)$`, 'm').exec(out)?.[1]?.trim() ?? null;
  // A surface reads about itself: standing in it, and rooted at its own `.aep/`,
  // which every worktree of this fixture carries because the base commit did.
  const at = (tree) => ({ cwd: tree, root: path.join(tree, '.aep') });

  git('init', '--quiet', '-b', 'main');
  git('config', 'user.email', 'suite@example.invalid');
  git('config', 'user.name', 'suite');
  // `resolveAepRoot` accepts a candidate only where it holds `protocol.md`, and
  // an explicit `--root` that fails that test falls through to wherever the
  // script itself sits. Without this copy every assertion below would answer
  // about this repository while looking as though it had read the fixture.
  fs.mkdirSync(aep, { recursive: true });
  fs.copyFileSync(path.join(SRC, 'protocol.md'), path.join(aep, 'protocol.md'));
  write(path.join(dir, 'README.md'), 'fixture\n');
  write(effortFile('40-alpha', 'spec.md'), stub('alpha'));
  write(effortFile('41-beta', 'spec.md'), stub('beta'));
  // A ticket id two efforts both hold, and one only a single effort holds. The
  // first must resolve to neither and the second to its own.
  write(effortFile('40-alpha', 'tickets', '03-shared-id.md'), stub('shared'));
  write(effortFile('41-beta', 'tickets', '03-shared-id.md'), stub('shared'));
  write(effortFile('41-beta', 'tickets', '07-only-beta.md'), stub('only beta'));
  git('add', '-A');
  git('commit', '--quiet', '-m', 'base');

  const touch = (effort, name, body) => {
    write(effortFile(effort, name), body);
    git('add', '-A');
    git('commit', '--quiet', '-m', `${effort} ${name}`);
  };

  assert('the default branch holds no claim, which is unscoped and exit 1', () => {
    const { out, code } = run('read');
    if (fieldOf(out, 'claim') !== 'unscoped') throw new Error(`claim on the base branch: ${out}`);
    if (code !== 1) throw new Error(`exit ${code}, expected 1 for unscoped`);
    if (fieldOf(out, 'base') === null) throw new Error(`no base reported: ${out}`);
    return true;
  });

  git('checkout', '--quiet', '-b', 't3code/deadbeef');

  assert('a runtime-named branch with no commit of its own is unscoped', () => {
    const { out, code } = run('read');
    return fieldOf(out, 'claim') === 'unscoped' && code === 1;
  });

  touch('40-alpha', 'plan.md', '---\nuse-when: "building"\n---\n\n# Architecture\n');

  assert('the same branch resolves to the effort its commit touched', () => {
    const { out, code } = run('read');
    if (fieldOf(out, 'claim') !== '40-alpha') throw new Error(`claim: ${out}`);
    if (code !== 0) throw new Error(`exit ${code}, expected 0 for a claim`);
    return true;
  });

  assert('renaming the branch to another effort does not move the claim', () => {
    // The perturbation for the content path. Named `41-beta`, which is the exact
    // directory name of the other effort, so a name match would answer `41-beta`
    // and a content match answers `40-alpha`.
    git('branch', '-m', '41-beta');
    const named = git('rev-parse', '--abbrev-ref', 'HEAD').trim();
    if (named !== '41-beta') throw new Error(`the rename did not take: ${named}`);
    const claim = fieldOf(run('read').out, 'claim');
    git('branch', '-m', 't3code/deadbeef');
    if (claim !== '40-alpha') throw new Error(`the name answered instead of the commits: ${claim}`);
    return true;
  });

  assert('a branch touching two efforts claims both, and check still passes', () => {
    git('checkout', '--quiet', '-b', 'two-efforts');
    write(effortFile('40-alpha', 'spec.md'), stub('alpha moved'));
    write(effortFile('41-beta', 'spec.md'), stub('beta moved'));
    git('add', '-A');
    git('commit', '--quiet', '-m', 'both');
    const { out, code } = run('read');
    if (fieldOf(out, 'claim') !== '40-alpha, 41-beta') throw new Error(`claim: ${out}`);
    if (code !== 0) throw new Error(`exit ${code}`);
    const checked = run('check');
    if (checked.code !== 0) throw new Error(`check on a two-effort claim: ${checked.out}`);
    return true;
  });

  assert('the working set outside the claim is listed, and check exits 1', () => {
    git('checkout', '--quiet', 't3code/deadbeef');
    // Three shapes at once: modified, staged, and untracked. The untracked one
    // carries a space and a non-ASCII character, which `git status --porcelain`
    // quotes without `-z` and which then matches no prefix and vanishes.
    write(effortFile('41-beta', 'spec.md'), stub('edited outside the claim'));
    write(effortFile('41-beta', 'tickets', '09-staged.md'), stub('staged'));
    git('add', path.join(aep, 'efforts', '41-beta', 'tickets', '09-staged.md'));
    write(effortFile('41-beta', 'a note éà spaces.md'), 'untracked\n');
    write(effortFile('40-alpha', 'spec.md'), stub('edited inside the claim'));
    write(path.join(dir, 'README.md'), 'edited source, which the rule does not cover\n');

    const { out, code } = run('check');
    if (code !== 1) throw new Error(`exit ${code}, expected 1 with work outside the claim`);
    for (const wanted of ['41-beta/spec.md', '41-beta/tickets/09-staged.md', 'a note éà spaces.md']) {
      if (!out.includes(wanted)) throw new Error(`not listed: ${wanted}\n${out}`);
    }
    // The listed paths only. The header names the claim, so searching the whole
    // output for the claimed effort finds the header and proves nothing.
    const listed = out.split('\n').filter((line) => line.startsWith('  ')).map((line) => line.trim());
    const wrong = listed.filter((file) => file.includes('40-alpha') || file.includes('README.md'));
    if (wrong.length > 0) throw new Error(`listed what the rule does not cover: ${wrong.join(', ')}`);
    return true;
  });

  assert('an empty claim takes any effort, so check passes on it', () => {
    git('stash', '--quiet', '--include-untracked');
    git('checkout', '--quiet', 'main');
    const { out, code } = run('check');
    if (code !== 0) throw new Error(`exit ${code} on an empty claim: ${out}`);
    return /unscoped/.test(out);
  });

  assert('a branch named for a ticket only one effort holds resolves to it', () => {
    git('checkout', '--quiet', '-b', '07-only-beta');
    return fieldOf(run('read').out, 'claim') === '41-beta';
  });

  assert('a ticket id two efforts hold names neither of them', () => {
    git('checkout', '--quiet', 'main');
    git('checkout', '--quiet', '-b', '03-shared-id');
    return fieldOf(run('read').out, 'claim') === 'unscoped';
  });

  // A worktree AEP did not create, standing outside `.aep/worktrees/`. It is the
  // isolation assertion's subject below and the runtime surface's after that, so
  // it is built once and removed once both have read it.
  const linked = path.join(dir, 'linked');

  assert('a linked worktree is enforced and names the sibling holding a branch', () => {
    git('checkout', '--quiet', 'main');
    git('worktree', 'add', '--quiet', linked, 't3code/deadbeef');

    const inside = run('read', { cwd: linked, root: path.join(linked, '.aep') });
    const isolation = fieldOf(inside.out, 'isolation') ?? '';
    if (!/^worktree, enforced/.test(isolation)) throw new Error(`inside a worktree: ${inside.out}`);
    if (!inside.out.includes(`main at `)) throw new Error(`the sibling branch is not named: ${inside.out}`);

    const outside = fieldOf(run('read').out, 'isolation') ?? '';
    if (!/^checkout, /.test(outside)) throw new Error(`in the main checkout: ${outside}`);

    // The word `enforced` rests on this refusal, so the refusal is asserted
    // rather than assumed.
    let refused = false;
    try {
      git('worktree', 'add', '--quiet', path.join(dir, 'second'), 't3code/deadbeef');
    } catch {
      refused = true;
    }
    if (!refused) throw new Error('git allowed two worktrees on one branch');
    return true;
  });

  // --- the surface a run stands in, and the role it carries ------------------
  //
  // Four shapes, four real worktrees, read from inside each. The branch names
  // are deliberately crossed: the run surface holds a ticket-shaped name and the
  // ticket surface holds the name of an effort directory, so a derivation
  // reading the branch rather than the path answers these two backwards.
  const runSurface = path.join(aep, 'worktrees', '40-alpha', '_run');
  const ticketSurface = path.join(aep, 'worktrees', '40-alpha', '03-thing');
  // Underscored and not `_run`: the shape a prototype takes. It must resolve to
  // `unknown` rather than to `ticket`, or a prototype computes `implementer` and
  // the rule forbidding a child to dispatch fires at a run that is allowed to.
  const reservedSurface = path.join(aep, 'worktrees', '40-alpha', '_prototype-spike');
  // The pair the exit-code assertion below builds, named here so the cleanup at
  // the end of the block can reach them.
  const resolves = path.join(aep, 'worktrees', '41-beta', '_run');
  const unresolved = path.join(aep, 'worktrees', '42-gamma');
  git('worktree', 'add', '--quiet', runSurface, '-b', '41-beta/07-only-beta');
  git('worktree', 'add', '--quiet', ticketSurface, '-b', '40-alpha');
  git('worktree', 'add', '--quiet', reservedSurface, '-b', 'proto-spike');

  assert('each of the four surfaces reports its own kind and its own role', () => {
    const branchOf = (tree) => git('-C', tree, 'branch', '--show-current').trim();
    if (branchOf(runSurface) !== '41-beta/07-only-beta' || branchOf(ticketSurface) !== '40-alpha') {
      throw new Error('the crossed branch names are gone, so the path is no longer what is being tested');
    }
    const shapes = [
      ['the main checkout', { cwd: dir, root: aep }, 'main', 'none'],
      ['the run surface', at(runSurface), 'run at .aep/worktrees/40-alpha/_run', 'orchestrator of 40-alpha'],
      ['a ticket surface', at(ticketSurface), 'ticket at .aep/worktrees/40-alpha/03-thing',
        'implementer on 03-thing for 40-alpha'],
      // Matched rather than compared: the path is git's own spelling of it, and
      // Node's spelling of the same place can differ on Windows.
      ['a runtime worktree', at(linked), /^runtime at .+\/linked$/, 'orchestrator'],
    ];
    for (const [what, where, surface, role] of shapes) {
      const { out } = run('read', where);
      const found = fieldOf(out, 'surface');
      const held = fieldOf(out, 'role');
      const matched = surface instanceof RegExp ? surface.test(found ?? '') : found === surface;
      if (!matched) throw new Error(`${what}: surface "${found}", expected ${surface}`);
      if (held !== role) throw new Error(`${what}: role "${held}", expected "${role}"`);
    }
    return true;
  });

  assert('an underscored surface other than the run is no ticket', () => {
    const { out } = run('read', at(reservedSurface));
    const surface = fieldOf(out, 'surface');
    const role = fieldOf(out, 'role');
    if (!/^unknown/.test(surface ?? '')) throw new Error(`surface "${surface}", expected unknown`);
    if (role !== 'unknown') throw new Error(`role "${role}", expected unknown`);
    return true;
  });

  assert('--json carries the surface and the role as fields, in every shape', () => {
    const shapes = [
      [{ cwd: dir, root: aep }, { kind: 'main', effort: null, ticket: null }, 'none'],
      [at(runSurface), { kind: 'run', effort: '40-alpha', ticket: null }, 'orchestrator'],
      [at(ticketSurface), { kind: 'ticket', effort: '40-alpha', ticket: '03-thing' }, 'implementer'],
      [at(linked), { kind: 'runtime', effort: null, ticket: null }, 'orchestrator'],
    ];
    for (const [where, surface, role] of shapes) {
      const parsed = JSON.parse(run('read', { ...where, args: ['--json'] }).out);
      for (const [key, value] of Object.entries(surface)) {
        if (parsed.surface?.[key] !== value) {
          throw new Error(`${surface.kind}: surface.${key} is ${JSON.stringify(parsed.surface?.[key])}, expected ${JSON.stringify(value)}`);
        }
      }
      if (parsed.role !== role) throw new Error(`${surface.kind}: role ${JSON.stringify(parsed.role)}, expected ${role}`);
      if (!parsed.surface.path) throw new Error(`${surface.kind}: the surface carries no path`);
    }
    return true;
  });

  assert('the orchestrator and a child of one effort stop reading alike', () => {
    // The observation this whole change came from: two agents bound by opposite
    // rules, standing in two surfaces of one effort, returning the same answer.
    const orchestrator = run('read', at(runSurface)).out;
    const child = run('read', at(ticketSurface)).out;
    for (const label of ['surface', 'role']) {
      const held = fieldOf(orchestrator, label);
      const theirs = fieldOf(child, label);
      if (held === theirs) throw new Error(`both surfaces report ${label} "${held}"`);
      if (held === 'unknown' || theirs === 'unknown') throw new Error(`${label} unresolved: "${held}" and "${theirs}"`);
    }
    return true;
  });

  assert('a nested .aep finds its own worktrees directory, not the root', () => {
    // A hardcoded `.aep/worktrees` resolves every surface of an installation
    // that sits below the repository root to `runtime`, which is a role that
    // refuses nothing in a tree that plainly has one.
    const nested = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-scope-nested-'));
    const inside = (...args) =>
      execFileSync('git', args, { cwd: nested, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    inside('init', '--quiet', '-b', 'main');
    inside('config', 'user.email', 'suite@example.invalid');
    inside('config', 'user.name', 'suite');
    const under = path.join(nested, 'sub', '.aep');
    fs.mkdirSync(under, { recursive: true });
    fs.copyFileSync(path.join(SRC, 'protocol.md'), path.join(under, 'protocol.md'));
    inside('add', '-A');
    inside('commit', '--quiet', '-m', 'base');
    const surface = path.join(under, 'worktrees', '40-alpha', '_run');
    inside('worktree', 'add', '--quiet', surface, '-b', 'runtime/generated');

    const { out } = run('read', { cwd: surface, root: path.join(surface, 'sub', '.aep') });
    const found = fieldOf(out, 'surface');
    fs.rmSync(nested, { recursive: true, force: true });
    if (found !== 'run at sub/.aep/worktrees/40-alpha/_run') throw new Error(`nested surface: ${found}`);
    return true;
  });

  assert('the role moves no exit code, whether it resolves or not', () => {
    // One fixture read twice over: a surface whose role resolves, and one whose
    // path is a shape AEP never creates, so its role is `unknown`. Both are read
    // unscoped and then claiming, and the four codes are the two the claim gives.
    git('worktree', 'add', '--quiet', resolves, '-b', 't3code/aaaaaa');
    git('worktree', 'add', '--quiet', unresolved, '-b', 't3code/bbbbbb');

    const roleAt = (tree) => fieldOf(run('read', at(tree)).out, 'role');
    if (roleAt(resolves) !== 'orchestrator of 41-beta') throw new Error(`the role did not resolve: ${roleAt(resolves)}`);
    if (roleAt(unresolved) !== 'unknown') throw new Error(`the role resolved where it should not: ${roleAt(unresolved)}`);

    const unscoped = [run('read', at(resolves)).code, run('read', at(unresolved)).code];
    git('-C', resolves, 'checkout', '--quiet', '07-only-beta');
    git('-C', unresolved, 'checkout', '--quiet', 'two-efforts');
    const claimed = [run('read', at(resolves)).code, run('read', at(unresolved)).code];

    if (unscoped.join() !== '1,1') throw new Error(`unscoped exits ${unscoped.join(' and ')}, expected 1 from both`);
    if (claimed.join() !== '0,0') throw new Error(`a claim exits ${claimed.join(' and ')}, expected 0 from both`);
    return true;
  });

  // The surfaces go, so the assertions below read the fixture they were written
  // against. Tolerated rather than asserted: a failure above can leave one of
  // these unbuilt, and a cleanup that aborts the section would bury the failure
  // that caused it.
  for (const surface of [runSurface, ticketSurface, resolves, unresolved, linked]) {
    try {
      git('worktree', 'remove', '--force', surface);
    } catch { /* already gone */ }
  }

  assert('a tree git cannot read is exit 2 rather than an answer', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-scope-nogit-'));
    fs.mkdirSync(path.join(bare, '.aep', 'efforts'), { recursive: true });
    fs.copyFileSync(path.join(SRC, 'protocol.md'), path.join(bare, '.aep', 'protocol.md'));
    const { code, out } = run('read', { cwd: bare, root: path.join(bare, '.aep') });
    fs.rmSync(bare, { recursive: true, force: true });
    if (code !== 2) throw new Error(`exit ${code} with no git, expected 2. stdout: ${out}`);
    return true;
  });

  assert('a root that is not an AEP tree is refused rather than answered about', () => {
    // The trap this closes: an explicit root that failed to resolve used to fall
    // through to wherever the script sat, so a scope read pointed at the wrong
    // place answered `unscoped` about a different tree. `unscoped` means take
    // anything, so the fail-open direction was the dangerous one.
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-scope-notaep-'));
    const { code, out, err } = run('read', { cwd: dir, root: bare });
    fs.rmSync(bare, { recursive: true, force: true });
    if (code !== 2) throw new Error(`exit ${code} for a root holding no protocol.md. stdout: ${out}`);
    if (!err.includes(bare)) throw new Error(`the refusal does not name the root given: ${err}`);
    return true;
  });

  assert('the script ships, and reaches an installed tree', () => {
    if (!PAYLOAD_SCRIPTS.includes('scope.mjs')) throw new Error('not in PAYLOAD_SCRIPTS');
    return fs.existsSync(path.join(installFixture().aep, 'scripts', 'scope.mjs'));
  });

  fs.rmSync(dir, { recursive: true, force: true });
});

// --- 18.2 the working surface, asserted against git rather than described ----

section('working surface', () => {
  // Every refusal below is git's own, and the design rests on them entirely, so
  // they are exercised against real worktrees rather than quoted from the prose
  // that describes them.
  //
  // Each assertion takes its own branch and its own surface, and gives both
  // back. That is not tidiness: an earlier draft shared one branch across the
  // section, and perturbing the setup re-held it as a side effect, so three
  // assertions stayed green for a reason that had nothing to do with what they
  // claimed. A guard whose fire-check passes for the wrong reason is a guard
  // nobody can trust the green of.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-surface-'));
  const git = (...args) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const inSurface = (cwd, ...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  /** True where the command failed. Git refuses by exit status; the wording is a git version's to change. */
  const refuses = (fn) => {
    try {
      fn();
      return false;
    } catch {
      return true;
    }
  };

  git('init', '--quiet', '-b', 'main');
  git('config', 'user.email', 'suite@example.invalid');
  git('config', 'user.name', 'suite');
  fs.writeFileSync(path.join(dir, 'README.md'), 'fixture\n', 'utf8');
  git('add', '-A');
  git('commit', '--quiet', '-m', 'base');
  const worktreePaths = () =>
    git('worktree', 'list', '--porcelain')
      .split('\n')
      .filter((line) => line.startsWith('worktree '))
      .map((line) => line.slice('worktree '.length).trim());

  const reset = () => {
    if (git('rev-parse', '--abbrev-ref', 'HEAD').trim() !== 'main') git('switch', '--quiet', 'main');
    // The main checkout is the entry git lists first. Comparing paths instead
    // is unreliable here: `os.tmpdir()` can hand back an 8.3 short name while
    // git prints the long one, so the two never compare equal and the cleanup
    // tries to remove the checkout it is standing in. `scope.mjs` carries the
    // same warning about the same platform.
    const [, ...linked] = worktreePaths();
    for (const tree of linked) git('worktree', 'remove', '--force', tree);
    git('worktree', 'prune');
    for (const branch of git('branch', '--format=%(refname:short)').split('\n')) {
      const name = branch.trim();
      if (name && name !== 'main') git('branch', '-D', '--quiet', name);
    }
  };

  /** Runs `fn` against `name`, held by a worktree of its own, and gives both back afterwards. */
  const held = (name, fn) => {
    const surface = path.join(dir, `surface-${name}`);
    git('worktree', 'add', '--quiet', '-b', name, surface, 'main');
    try {
      return fn(surface);
    } finally {
      reset();
    }
  };

  assert('an effort branch is created into a worktree in one act, and the worktree holds it', () =>
    held('effort-one-act', () =>
      git('worktree', 'list', '--porcelain').includes('branch refs/heads/effort-one-act')));

  assert('a second worktree on the held branch is refused', () =>
    held('effort-second-tree', () =>
      refuses(() => git('worktree', 'add', '--quiet', path.join(dir, 'second'), 'effort-second-tree'))));

  assert('another checkout switching to the held branch is refused', () =>
    held('effort-switch', () => refuses(() => git('switch', '--quiet', 'effort-switch'))));

  assert('force-moving the held branch by name is refused', () =>
    held('effort-force', () => refuses(() => git('branch', '-f', 'effort-force', 'main'))));

  assert('the 2026-08-24 incident cannot replay from a shared checkout', () =>
    held('effort-replay', () => {
      // Both damaging steps needed the shared checkout to resolve the other
      // effort's branch: the cherry-pick landed on whatever HEAD then was, and
      // the reset moved whatever the name pointed at. Held, neither is reachable.
      const before = git('rev-parse', 'effort-replay').trim();
      const reached = !refuses(() => git('switch', '--quiet', 'effort-replay'));
      const moved = !refuses(() => git('branch', '-f', 'effort-replay', 'main'));
      const after = git('rev-parse', 'effort-replay').trim();
      if (reached) throw new Error('the shared checkout reached the held branch');
      if (moved || after !== before) throw new Error(`the held branch moved: ${before} -> ${after}`);
      return git('rev-parse', '--abbrev-ref', 'HEAD').trim() === 'main';
    }));

  assert('detaching the holder releases the branch and leaves the directory in place', () =>
    held('effort-detach', (surface) => {
      inSurface(surface, 'switch', '--detach', '--quiet');
      const taken = !refuses(() => git('switch', '--quiet', 'effort-detach'));
      if (!taken) throw new Error('detaching did not release the branch');
      return fs.existsSync(surface);
    }));

  assert('a clean close releases the branch, then removes the surface', () =>
    held('effort-clean', (surface) => {
      // The close in its required order. Detach first: it succeeds even where
      // removal fails, and a run that reversed them has nothing left to detach.
      inSurface(surface, 'switch', '--detach', '--quiet');
      // Reachable *before* the directory goes, which is the whole point of the
      // order. Removing a worktree frees its branch too, so an assertion that
      // only looked afterwards would pass with no detach in it at all. That is
      // exactly what an earlier draft of this did.
      if (refuses(() => git('switch', '--quiet', 'effort-clean'))) {
        throw new Error('detaching did not free the branch before the surface was removed');
      }
      git('switch', '--quiet', 'main');
      git('worktree', 'remove', '--force', surface);
      if (fs.existsSync(surface)) throw new Error('the surface survived a clean close');
      return true;
    }));

  assert('a stop keeps the surface and releases the branch anyway', () =>
    held('effort-stop', (surface) => {
      // A trip-wire ends the turn without reaching the close. The tree is what
      // is worth keeping; the branch inside it is not, because whoever acts on
      // the stop is the one most likely to want it.
      inSurface(surface, 'switch', '--detach', '--quiet');
      const reachable = !refuses(() => git('switch', '--quiet', 'effort-stop'));
      if (!fs.existsSync(surface)) throw new Error('a stop removed the surface');
      return reachable;
    }));

  assert('a surface a dead run left still holds its branch, and is re-entered rather than duplicated', () =>
    held('effort-dead', (surface) => {
      // Nothing runs on a crash, so this worktree still holds its branch. What
      // makes that safe is re-entry, never the branch being free, and a second
      // surface for the same effort is refused.
      const duplicate = refuses(() =>
        git('worktree', 'add', '--quiet', path.join(dir, 'duplicate'), 'effort-dead'));
      if (!duplicate) throw new Error('git allowed a second surface for one effort');
      // Re-entry is opening the directory that already exists, which asks git
      // for no permission at all.
      return /^effort-dead$/m.test(inSurface(surface, 'rev-parse', '--abbrev-ref', 'HEAD'));
    }));

  assert('update-ref is NOT refused, which is why the caveat is stated rather than glossed', () =>
    held('effort-plumbing', (surface) => {
      // Asserted in the direction it actually behaves. A suite claiming this
      // hole was closed would be the reason somebody later believed it was.
      fs.writeFileSync(path.join(surface, 'moved.txt'), 'ahead\n', 'utf8');
      inSurface(surface, 'add', '-A');
      inSurface(surface, 'commit', '--quiet', '-m', 'ahead of main');
      const before = git('rev-parse', 'effort-plumbing').trim();
      if (before === git('rev-parse', 'main').trim()) throw new Error('the fixture did not diverge');
      git('update-ref', 'refs/heads/effort-plumbing', git('rev-parse', 'main').trim());
      const after = git('rev-parse', 'effort-plumbing').trim();
      if (before === after) throw new Error('update-ref did not move a held branch; the caveat may be stale');
      return true;
    }));

  assert('the suite leaves no worktree and no branch of its own behind', () => {
    reset();
    const remaining = worktreePaths();
    if (remaining.length !== 1) throw new Error(`${remaining.length} worktrees left: ${remaining.join(', ')}`);
    return git('branch', '--format=%(refname:short)').trim() === 'main';
  });

  fs.rmSync(dir, { recursive: true, force: true });
});

// --- 18.2 the surfaces that state the working-surface rule ------------------

section('working surface surfaces', () => {
  // Prose matchers run over a flattened copy: a shipped file wraps at eighty
  // columns, so a phrase straddling a break would fail on the wrap rather than
  // on the claim.
  const flatten = (text) => text.split(/\s+/).join(' ');
  const execution = flatten(readSrc('policies', 'execution.md'));
  const runner = flatten(readSrc('skills', 'implement.md'));
  const opener = flatten(readSrc('skills', 'specify.md'));
  const marker = readSrc('scripts', 'position.mjs');
  const spec = flatten(specText);

  // 4.0: the command line takes and releases surfaces, so the ordering rules
  // are asserted on aep.mjs, and the law on what a role may do on the policy.
  const cli = readSrc('scripts', 'aep.mjs');
  const parallel = flatten(readSrc('policies', 'execution', 'parallel.md'));
  const body = (name, next) => cli.slice(cli.indexOf(`function ${name}(`), cli.indexOf(`function ${next}(`));

  assert('the execution policy names the surface as part of the claim', () =>
    /The claim is a branch and its surface \(a worktree\)/.test(execution));
  assert('aep open takes a surface unless the runtime supplied one', () =>
    /const runtime = scope\?\.surface\.kind === 'runtime'/.test(body('open', 'laneRules'))
    && /worktree', 'add', '--quiet', '-b', effort, surface, base/.test(body('open', 'laneRules')));
  assert('the surface decision keys on the kind and never on the enforcement', () =>
    /scope\.isolation\.kind === 'worktree'/.test(body('enterSurface', 'nextNumber'))
    && !/enforcement/.test(body('enterSurface', 'nextNumber')) && !/enforcement/.test(body('open', 'laneRules')));
  assert('aep close releases the branch before it removes the surface', () => {
    const close = body('close', 'raise');
    const detach = close.indexOf("['switch', '--quiet', '--detach']");
    const remove = close.indexOf("['worktree', 'remove', surface]");
    return detach > 0 && remove > detach;
  });
  assert('the orchestrator integrates in the surface it holds', () =>
    /\*\*The orchestrator is the only integrator, in the surface it holds\.\*\*/.test(parallel));

  const executionRaw = readSrc('policies', 'execution.md');
  const brief = flatten(readSrc('agents', 'implementer.md'));
  const keyedOn = (where, text, named, subject, role) => {
    const lead = new RegExp(`\\*\\*[^*]*${subject}[^*]*\\*\\*`).exec(text);
    if (!lead) throw new Error(`${where} states no constraint that it ${named}`);
    if (!lead[0].includes(`\`role: ${role}\``)) {
      throw new Error(`${where} states "${lead[0]}" without naming the role it is keyed on`);
    }
    return true;
  };
  assert("the implementer's brief keys its refusals on the role it computes", () =>
    keyedOn('the brief', brief, 'does not integrate', '\\bdo(?:es)? not integrate\\b', 'implementer')
    && keyedOn('the brief', brief, 'does not dispatch', '\\bdo(?:es)? not dispatch\\b', 'implementer'));
  assert('the brief tells a cleared context how to compute that role', () =>
    /keyed on the role you compute/.test(brief) && /scope\.mjs read/.test(brief));

  // Counted off the policy's own table: every role has a row, with something it
  // may do and something it may never do -- the half that does the work.
  const roleRows = (() => {
    const table = /^\| `role` \|[^\n]*\n\|[-| ]+\|\n((?:\|[^\n]*\n)+)/m.exec(executionRaw);
    if (!table) return new Map();
    return new Map([...table[1].matchAll(/^\| `(\w+)`[^|\n]*\|([^|\n]*)\|([^|\n]*)\|\s*$/gm)]
      .map((row) => [row[1], { may: row[2].trim(), never: row[3].trim() }]));
  })();
  assert('the policy says what each role may and may never do', () => {
    for (const role of ['orchestrator', 'implementer', 'none', 'unknown']) {
      const said = roleRows.get(role);
      if (!said) throw new Error(`the policy gives \`${role}\` no row`);
      if (!said.may) throw new Error(`\`${role}\` is told nothing it may do`);
      if (!said.never) throw new Error(`\`${role}\` is told nothing it may never do`);
    }
    return true;
  });
  assert('an implementer neither integrates nor dispatches', () =>
    /integrate, dispatch/.test(roleRows.get('implementer')?.never ?? ''));
  assert('an orchestrator integrates only in the surface it holds', () =>
    /integrate in the surface it holds/.test(roleRows.get('orchestrator')?.may ?? '')
    && /integrate anywhere else/.test(roleRows.get('orchestrator')?.never ?? ''));
  assert('`role: none` is the main checkout, which takes a surface before writing', () =>
    /take a surface/.test(roleRows.get('none')?.may ?? '') && /write before holding one/.test(roleRows.get('none')?.never ?? ''));
  assert('`role: unknown` fires nothing: it does what it could already do', () =>
    /what it could already do/.test(roleRows.get('unknown')?.may ?? ''));


  assert('the specification carries the rule as well as the policy', () =>
    /A run whose checkout is \*\*not\*\* isolated MUST take a worktree of AEP's own/.test(spec)
    && /fixed by the isolation's kind, and never by its enforcement/.test(spec));

  assert('the specification still forbids effort identity in the marker', () =>
    /Position therefore MUST NOT carry which effort a run is inside/.test(spec));

  assert('the specification bounds the marker to three keys', () =>
    /Nothing AEP writes adds a key beyond `tree`, `head`, and `sessions`/.test(spec));

  assert('the specification says sessions is a diagnostic nothing acts on', () =>
    /MUST NOT read it to decide whether to proceed/.test(spec));

  assert('the specification names both holes rather than implying the surface is inviolable', () =>
    /It does not refuse `git update-ref`, and it reaches no further than the clone/.test(spec));

  // The surface table, counted off its own rows rather than matched as prose.
  // A regex naming four kinds passes while a fifth row sits beside them, and a
  // row whose role was dropped still reads correctly on the line above it, so
  // the kinds and the roles are checked as pairs and the count is checked too.
  assert('the specification names every surface kind and the role each carries', () => {
    const block = /\n### 18\.3 [^\n]*\n([\s\S]*?)(?=\n#{2,3} )/.exec(specText);
    if (!block) throw new Error('the specification defines no surface at all');
    const rows = [...block[1].matchAll(/^\|[^|\n]+\|\s*`(\w+)`\s*\|\s*`(\w+)`\s*\|\s*$/gm)]
      .map((row) => [row[1], row[2]]);
    const carried = new Map(rows);
    const expected = [
      ['main', 'none'],
      ['run', 'orchestrator'],
      ['ticket', 'implementer'],
      ['runtime', 'orchestrator'],
      ['unknown', 'unknown'],
    ];
    for (const [kind, role] of expected) {
      if (!carried.has(kind)) throw new Error(`no surface kind \`${kind}\``);
      if (carried.get(kind) !== role) {
        throw new Error(`\`${kind}\` carries \`${carried.get(kind)}\`, not \`${role}\``);
      }
    }
    if (rows.length !== expected.length) {
      throw new Error(`${rows.length} surface kinds, not ${expected.length}`);
    }
    return true;
  });

  assert('the specification requires the surface and the role to be computed', () =>
    /MUST compute, from Git and the path of the tree it is standing in, which surface that is and what role the surface carries/
      .test(spec));

  assert('the specification says an unresolved surface refuses nothing', () =>
    /both the surface and the role are `unknown`, every rule keyed on the role declines to fire/.test(spec));

  // One marker per surface, and the prohibition that follows from it. The
  // second is the one worth pinning by itself: the first can survive as a
  // description while a skill goes on checking in one tree and stamping in
  // another, which is the state this rule was written against.
  assert('the specification binds a marker to the surface it sits in', () =>
    /A marker belongs to the surface it sits in, and describes that surface alone/.test(spec));

  assert("the specification forbids checking one surface's marker while stamping another's", () =>
    /MUST NOT check one surface's marker while stamping another's/.test(spec)
    && /the check follows the entry rather than preceding it/.test(spec));

  // What keeps the rule above compatible with the three-key bound asserted
  // higher up: the surface and the role are derived on every read, so naming
  // them adds nothing to the marker and contradicts nothing that forbids it.
  assert('the specification keeps the surface and the role out of the marker', () =>
    /Which surface that is, and what role it carries, are computed and never recorded here/.test(spec)
    && /The three keys above stay the whole of what AEP writes/.test(spec));

  assert('the opener opens through aep open, which makes branch and surface in one act', () =>
    /aep\.mjs open <slug> --lane <lane>/.test(opener)
    && /creates the branch and its surface in one act/.test(opener));
  assert('the opener takes no second surface where the runtime gave one', () =>
    /git\(surface, \['switch', '--quiet', '-c', effort, base\]\)/.test(body('open', 'laneRules')));
  const cliTests = fs.existsSync(path.join(REPO, 'tests', 'aep.test.mjs'))
    ? fs.readFileSync(path.join(REPO, 'tests', 'aep.test.mjs'), 'utf8') : '';
  assert('a test pins open in a runtime surface taking no second one', () =>
    cliTests.includes("test('open in a surface the runtime supplied takes no second one'"));

  assert('the runner re-enters an existing surface rather than duplicating it', () =>
    /enters or re-enters the effort's surface \(never a second one\)/.test(runner)
    && cliTests.includes("test('start re-enters the surface an effort already has, and never makes a second'"));
  assert('the runner stops on a dirty surface rather than guessing whose edits those are', () =>
    /a dirty surface names its paths/.test(runner)
    && cliTests.includes("test('start stops on a dirty surface and names the paths'"));
  assert('removal is best-effort and releasing the branch is not', () =>
    /git\(where\.main, \['worktree', 'remove', surface\], \{ allowFail: true \}\)/.test(body('close', 'raise'))
    && /remove_by_hand/.test(body('close', 'raise')));
  assert('aep close keeps the surface on a stop and removes it on a clean close', () =>
    /outcome\.kept = surface/.test(body('close', 'raise'))
    && cliTests.includes("test('close on a clean finish stamps implemented, releases the branch, and removes the surface'"));

  assert('the marker script takes a session identifier and never invents one', () =>
    /--session <id>/.test(marker) && /function recordSession/.test(marker));

  assert('nothing shipped branches on what sessions contains', () => {
    // The field is a diagnostic. A shipped surface reading it to decide would
    // reproduce the stale-lock failure the effort's research recorded.
    // Asserted behaviourally rather than by pattern. A regex draft of this
    // missed `if (readMarker(root)?.sessions?.length > 1)`, because its
    // character class could not cross the parenthesis in `readMarker(root)`, so
    // the guard read green while the thing it forbade sat two lines away.
    const readers = PAYLOAD_SCRIPTS
      .filter((name) => name !== 'position.mjs')
      .filter((name) => /\bsessions\b/.test(readSrc('scripts', name)));
    if (readers.length > 0) throw new Error(`scripts reading sessions: ${readers.join(', ')}`);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-sessions-'));
    try {
      const aep = path.join(dir, '.aep');
      fs.mkdirSync(aep, { recursive: true });
      fs.copyFileSync(path.join(SRC, 'protocol.md'), path.join(aep, 'protocol.md'));
      const git = (...args) =>
        execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      git('init', '--quiet', '-b', 'main');
      git('config', 'user.email', 'suite@example.invalid');
      git('config', 'user.name', 'suite');
      fs.writeFileSync(path.join(dir, 'README.md'), 'fixture\n', 'utf8');
      git('add', '-A');
      git('commit', '--quiet', '-m', 'base');

      const call = (command) =>
        spawnSync(process.execPath, [path.join(SRC, 'scripts', 'position.mjs'), command, '--root', aep],
          { cwd: dir, encoding: 'utf8' });
      const markerFile = path.join(aep, 'position', 'marker.json');
      const withSessions = (sessions) => {
        const written = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
        fs.writeFileSync(markerFile, `${JSON.stringify({ ...written, sessions }, null, 2)}\n`, 'utf8');
      };

      call('stamp');
      withSessions([]);
      const alone = call('check');
      // Two identifiers against one marker is the shared-checkout state. If any
      // shipped behaviour keys on the field, this is where it diverges.
      withSessions([{ id: 'a', at: '2026-01-01T00:00:00.000Z' }, { id: 'b', at: '2026-01-02T00:00:00.000Z' }]);
      const shared = call('check');
      if (alone.status !== shared.status) {
        throw new Error(`check exit changed with sessions present: ${alone.status} -> ${shared.status}`);
      }
      if (alone.stdout !== shared.stdout) {
        throw new Error(`check output changed with sessions present:\n${alone.stdout}\n---\n${shared.stdout}`);
      }
      return true;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  assert('no shipped surface describes the marker as clone-wide', () => {
    // The token appears in this suite, naming what it forbids, which is why the
    // suite excludes itself rather than the guard tripping on its own text.
    const offenders = [];
    for (const file of walk(SRC)) {
      if (path.basename(file) === 'verify.mjs') continue;
      if (!/\.(md|mjs|json)$/.test(file) && path.basename(file) !== 'gitignore') continue;
      if (/per-clone/.test(fs.readFileSync(file, 'utf8'))) offenders.push(path.relative(SRC, file));
    }
    if (offenders.length > 0) throw new Error(`still call state per-clone: ${offenders.join(', ')}`);
    return true;
  });

  assert('the marker written by the shipped script carries exactly three keys', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-marker-'));
    try {
      const aep = path.join(dir, '.aep');
      fs.mkdirSync(aep, { recursive: true });
      fs.copyFileSync(path.join(SRC, 'protocol.md'), path.join(aep, 'protocol.md'));
      const git = (...args) =>
        execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      git('init', '--quiet', '-b', 'main');
      git('config', 'user.email', 'suite@example.invalid');
      git('config', 'user.name', 'suite');
      fs.writeFileSync(path.join(dir, 'README.md'), 'fixture\n', 'utf8');
      git('add', '-A');
      git('commit', '--quiet', '-m', 'base');

      const stamp = (...extra) =>
        spawnSync(process.execPath, [path.join(SRC, 'scripts', 'position.mjs'), 'stamp', '--root', aep, ...extra],
          { cwd: dir, encoding: 'utf8' });

      stamp('--session', 'sess-one');
      let written = JSON.parse(fs.readFileSync(path.join(aep, 'position', 'marker.json'), 'utf8'));
      const keys = Object.keys(written).sort().join(',');
      if (keys !== 'head,sessions,tree') throw new Error(`marker keys: ${keys}`);
      if (written.sessions[0]?.id !== 'sess-one') throw new Error('the session identifier was not recorded');

      // A second identifier against one marker is the state that says a
      // checkout is being shared, and it is the only thing the field buys.
      stamp('--session', 'sess-two');
      written = JSON.parse(fs.readFileSync(path.join(aep, 'position', 'marker.json'), 'utf8'));
      if (written.sessions.length !== 2) throw new Error(`two sessions expected, got ${written.sessions.length}`);

      // Re-stamping as one of them updates rather than appends: a run stamps
      // once per ticket, and an appending list reports one agent as a dozen.
      stamp('--session', 'sess-one');
      written = JSON.parse(fs.readFileSync(path.join(aep, 'position', 'marker.json'), 'utf8'));
      if (written.sessions.length !== 2) throw new Error(`dedupe failed: ${written.sessions.length} entries`);

      // No identifier leaves the field exactly as it was, so a runtime that
      // supplies none stamps as it always did.
      stamp();
      written = JSON.parse(fs.readFileSync(path.join(aep, 'position', 'marker.json'), 'utf8'));
      if (written.sessions.length !== 2) throw new Error('a bare stamp disturbed the sessions field');
      return true;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  assert('aep land releases a ticket branch only once its work is on the effort branch', () => {
    const land = body('land', 'close');
    const commit = land.lastIndexOf('const sha = commitAll(here, message)');
    const release = land.lastIndexOf('const released = release()');
    return commit > 0 && release > commit;
  });
  assert('a parked or failed child keeps its branch and surface', () =>
    /A parked or failed child keeps both/.test(parallel));
  // 4.0: why a ticket branch is a build claim rather than a reviewable level is
  // rationale, and lives in specs.md beside the requirement asserted below.

  assert('the specification carries the ticket-branch lifecycle as a requirement', () =>
    /A ticket branch is a build claim and MUST be released once its work reaches the effort branch/.test(spec));

  assert('the shipped seed carries the working-surface invocations', () => {
    // The seed is what a repository installs. Updating only this repository's
    // own copy ships a reference that contradicts the protocol beside it.
    const seed = flatten(readSrc('seed', 'references', 'git.md'));
    if (/worktrees\/<task-id>/.test(seed)) throw new Error('the seed still uses the bare ticket form');
    for (const wanted of [
      /git worktree add -b <effort> .aep\/worktrees\/<effort>\/_run <base>/,
      /switch --detach/,
      /from the root, not from inside/,
      /cannot force update the branch/,
      /update-ref refs\/heads\/<held> <commit>/,
    ]) {
      if (!wanted.test(seed)) throw new Error(`the seed is missing ${wanted}`);
    }
    return true;
  });

  assert('the runner passes the session identifier when it lands, and never invents one', () =>
    /--session <id>/.test(runner)
    && /Pass the session id your runtime gives you, or none; never invent one/.test(runner));

  assert('aep close removes the surface from the main checkout, not from inside it', () =>
    /git\(where\.main, \['worktree', 'remove', surface\]/.test(body('close', 'raise')));

  assert('aep land releases the ticket worktree with its branch', () => {
    const land = body('land', 'close');
    return /\['worktree', 'remove', childTree\.path\]/.test(land) && /\['branch', '-D', branch\]/.test(land);
  });

  assert("nothing reaps another run's surface", () =>
    /A run removes only its own surface/.test(spec)
    && /const surface = runSurface\(where, effort\)/.test(body('close', 'raise')));

  assert('a surface is removable from the repository root while the process stands elsewhere', () => {
    // What makes the close achievable at all. A run cannot remove the directory
    // it is standing in, so the suite proves removal works from outside it.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-remove-'));
    try {
      const git = (...args) =>
        execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      git('init', '--quiet', '-b', 'main');
      git('config', 'user.email', 'suite@example.invalid');
      git('config', 'user.name', 'suite');
      fs.writeFileSync(path.join(dir, 'README.md'), 'fixture\n', 'utf8');
      git('add', '-A');
      git('commit', '--quiet', '-m', 'base');

      const surface = path.join(dir, 'surface');
      git('worktree', 'add', '--quiet', '-b', 'effort-remove', surface, 'main');
      execFileSync('git', ['switch', '--detach', '--quiet'],
        { cwd: surface, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      git('worktree', 'remove', '--force', surface);
      if (fs.existsSync(surface)) throw new Error('the surface survived removal from the root');
      // And the branch it held is reachable, which is the point of detaching first.
      git('switch', '--quiet', 'effort-remove');
      git('switch', '--quiet', 'main');
      return true;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  assert('the marker script is text, so a guard that greps it actually reads it', () => {
    // It carried a raw NUL as the fingerprint separator, which made grep treat
    // the whole file as binary and skip it. Every sweep over the shipped tree
    // was passing here by not looking, including the one above.
    const bytes = fs.readFileSync(path.join(SRC, 'scripts', 'position.mjs'));
    return !bytes.includes(0);
  });
});

// --- 19.3 the surfaces that state the rule ----------------------------------

section('scope surfaces', () => {
  // Every prose matcher here runs over `flat`, because a shipped file wraps at
  // eighty columns and a phrase that happens to straddle a line break would
  // fail an assertion the text actually satisfies.
  const policy = flat(readSrc('policies', 'execution.md'));
  const cli = readSrc('scripts', 'aep.mjs');

  // 4.0: the claim is read by `aep start` (and `scope.mjs` beneath it), so the
  // policy states what the claim permits and the CLI computes it.
  assert('the claim is computed from git and the path, never inferred from a name', () =>
    /`scope\.mjs` computes claim and role from git and the tree's path; \*\*never infer either from a branch name\*\*/.test(policy)
    && /const scope = resolveScope\(root\)/.test(cli));
  assert('the policy forbids writing another effort and leaves reading alone', () =>
    /\*\*A scoped run never writes a file or takes a ticket of an effort outside its claim\.\*\* Reading is free/.test(policy));
  assert('confinement has no exemptions, tree-wide subjects included', () =>
    /No skill is exempt: one that reaches another effort's artifact stops and names it/.test(policy));
  assert('given another effort while the surface is dirty, the run stops and names the paths', () =>
    /Given another effort while this surface is dirty: stop, naming claim, effort, and paths/.test(policy));
  assert('the policy says to enter the surface rather than check the branch out', () =>
    /never `git switch` to an effort branch/.test(policy));
  assert('the policy states the ambiguity stop and what an empty claim permits', () =>
    /An empty claim takes any effort; a claim of several, given none, ends the turn listing them/.test(policy)
    && /claims more than one effort/.test(cli));
  assert('aep dispatch makes a ticket branch unique across efforts', () =>
    /return `\$\{effort\}--\$\{stem\}`;/.test(cli));

  // Pinned by name: a skill acquiring a scope read is a decision, and one that
  // arrives as a drift is one nobody made. implement and tasks read it through
  // `aep start`, which quotes the claim and the isolation in its summary.
  const EFFORT_SKILLS = ['plan', 'prune', 'refine', 'review', 'specify', 'survey'];
  const readsScope = SKILLS
    .filter((name) => /scope\.mjs read/.test(readSrc('skills', `${name}.md`)))
    .sort();
  assert('exactly the effort skills not on the command line invoke scope.mjs', () =>
    JSON.stringify(readsScope) === JSON.stringify([...EFFORT_SKILLS].sort()));
  if (JSON.stringify(readsScope) !== JSON.stringify([...EFFORT_SKILLS].sort())) {
    process.stdout.write(`        on disk: ${readsScope.join(', ')}\n`);
  }
  assert('aep start reports the claim and the isolation in its summary', () =>
    /`claim \$\{claim\}`, `isolation \$\{isolation\}`/.test(cli));
  assert('implement and tasks quote the start summary in Position', () =>
    /Quote `summary` in `Position`/.test(flat(readSrc('skills', 'implement.md')))
    && /aep\.mjs start <effort>`, quoting its `summary`/.test(flat(readSrc('skills', 'tasks.md'))));
  assert('each other effort skill puts the claim and the isolation in Position', () => {
    const missing = EFFORT_SKILLS.filter((name) => {
      const text = flat(readSrc('skills', `${name}.md`));
      return !(/[Cc]laim(?:,| and the) isolation/.test(text) && /`Position`/.test(text));
    });
    if (missing.length > 0) throw new Error(missing.join(', '));
    return true;
  });

  const implement = flat(readSrc('skills', 'implement.md'));
  assert('the runner with nothing named and no claim ends the turn saying so', () =>
    /Nothing named and no claim: end the turn saying so/.test(implement));
  assert('a claim held elsewhere is not taken', () =>
    /a claim held elsewhere is not taken/.test(implement) && /A claim held elsewhere is not taken/.test(cli));
  // Both counters, and that each names the other: a review finding becomes a
  // ticket, and a ticket that spent a converge round would make the second
  // review unreachable.
  assert('the converge cap says a review finding does not spend a round', () =>
    /A review finding's ticket spends none/.test(policy));
  // The narrowed marker rule, and that the one skill it was narrowed for is
  // named as conforming rather than merely invoking the script. `/specify` at
  // the moment it orients has neither an effort nor a surface to check, so a
  // rule requiring the check to follow the entry could never bind it.
  assert('the specification narrows the marker rule for a run that stamps nothing', () => {
    const spec = fs.readFileSync(path.join(path.dirname(SRC), 'specs.md'), 'utf8');
    return /An invocation that \*\*stamps nothing\*\* cannot violate that/.test(spec)
      && /`\/specify` is the worked example/.test(spec)
      && /MUST NOT check one surface's marker while stamping another's/.test(spec);
  });

  // The reserved prefix has one producer in the shipped tree, and the fixture
  // that asserts it builds its own path. Without this, reverting the skill to a
  // bare name leaves the suite green while every prototype computes
  // `implementer` again and is refused a dispatch by a rule written for children.
  assert('the prototype skill names a reserved surface, anchored', () => {
    const proto = readSrc('skills', 'prototype.md');
    if (!/_prototype-<slug>/.test(proto)) throw new Error('the prototype surface is no longer reserved');
    if (!/main checkout's/.test(proto)) throw new Error('the prototype surface is not anchored');
    return true;
  });

  assert('aep dispatch anchors a child surface on the main checkout', () =>
    /function ticketSurface\(where, effort, stem\) \{\s*return path\.join\(aepIn\(where\.main, where\), 'worktrees', effort, stem\);/.test(cli)
    && /never relative to the surface you stand in/.test(flat(readSrc('policies', 'execution', 'parallel.md'))));

  assert('aep start checks the marker only once it is in the surface', () => {
    const start = cli.slice(cli.indexOf('function start('), cli.indexOf('function dispatch('));
    const scope = start.indexOf('resolveScope(root)');
    const enter = start.indexOf('enterSurface(where, effort, branch, scope)');
    const check = start.indexOf('checkMarker(aepIn(surface, where))');
    if (scope < 0 || enter < 0 || check < 0) throw new Error('start no longer reads scope, enters, and checks');
    if (scope > enter) throw new Error('the scope read no longer precedes the surface it decides');
    if (check < enter) throw new Error('the marker is checked before the surface it stamps is entered');
    return true;
  });

  const specify = flat(readSrc('skills', 'specify.md'));
  assert('specify takes a new branch base from the repository rule', () =>
    /from the base `\[\[rules\/version-control\]\]` names/.test(specify)
    && /settings\.stack\s*\?\s*git\(where\.repo, \['rev-parse', '--abbrev-ref', 'HEAD'\]\)\s*:\s*resolveBase\(where\.repo\)/.test(cli));

  for (const name of ['prune', 'survey']) {
    const text = flat(readSrc('skills', name + '.md'));
    assert(`${name} is confined like everything else`, () =>
      /buys no exemption/.test(text) && /unscoped checkout/.test(text));
  }

  const seedRule = flat(readSrc('seed', 'rules', 'version-control.md'));
  assert('the seeded rule prefixes a ticket branch with its effort', () =>
    /`<effort>--<ticket-id>-<slug>`/.test(seedRule));
  // `/` is what 3.x shipped, and git refuses `<effort>/<ticket>` while a branch
  // named `<effort>` exists, so a run following it could never cut a child.
  // A worktree path is `<effort>/<ticket>` and stays so; only a branch moves.
  const nestedBranch = /(?:-b\s+|`|branch\s+)<effort>\/<ticket-id>/;
  assert('no shipped text names a ticket branch nested under its effort', () =>
    !nestedBranch.test(seedRule) && !nestedBranch.test(implement)
    && !nestedBranch.test(flat(readSrc('seed', 'references', 'git.md'))));
  assert('the seeded rule says why the namespace exists', () =>
    /restart at `01`/.test(seedRule) && /\[\[policies\/execution\]\]/.test(seedRule));
  assert('no shipped rule still names a bare ticket branch', () =>
    !/named\s+`<task-id>-<slug>`/.test(seedRule));
  // The runner shows the branch names a run creates, so a bare example there
  // contradicts the rule shipped beside it, and a repository following both
  // gets two answers for one name.
  assert('the command line builds a ticket branch prefixed with its effort', () =>
    /function ticketBranch\(effort, stem\)/.test(cli));
  assert('the seeded rule says where a new effort branch is based, both shapes', () =>
    /A new effort's branch is based on/.test(seedRule)
    && /the default branch's tip/.test(seedRule)
    && /the current branch, which is what stacking means/.test(seedRule));

  // The T3 Code reference is a seed a repository owns, so what it states has to
  // be checkable against T3 Code by its reader: it names where it was read
  // from and how to re-read each fact, rather than freezing one release's paths.
  const t3 = flat(readSrc('seed', 'references', 't3code.md'));
  assert('the T3 Code reference places no thread worktree inside the project by default', () =>
    !/\.t3-worktrees/.test(t3));
  assert('the T3 Code reference requires a worktree path inside the project to be ignored', () =>
    /gitignored/.test(t3) && /ls-files/.test(t3));
  assert('the T3 Code reference names the T3 Code source it was read from', () =>
    /Read from T3 Code/.test(t3));
  assert('the T3 Code reference says how to re-check what it states', () =>
    /git worktree list --porcelain/.test(t3) && /scope\.mjs read/.test(t3));
  assert('the T3 Code reference keeps delegate_task to read-only work', () =>
    /delegate_task/.test(t3) && /read-only/.test(t3));
  assert('the T3 Code reference covers a thread launched in the ticket surface', () =>
    /existing_worktree/.test(t3) && /role: implementer/.test(t3));
  assert('the T3 Code reference names the sandbox check for dispatch', () =>
    /sandbox/.test(t3) && /additionalDirectories/.test(t3));

  // 4.2: a surface the runtime supplied, on a branch the runtime named.
  const parallelText = flat(readSrc('policies', 'execution', 'parallel.md'));
  assert('the parallel policy runs an implementer only where aep dispatch put it', () =>
    /\*\*An implementer runs only in a surface `aep dispatch` created\*\*/.test(parallelText)
    && /It stops unless `scope\.mjs read` prints `role: implementer`/.test(parallelText));
  assert('the parallel policy keeps a runtime\'s own delegation to read-only work', () =>
    /\*\*A runtime's own delegation that shares your checkout or makes its own worktree carries read-only work:\*\*/.test(parallelText)
    && /never dispatches, integrates, or delegates/.test(parallelText));
  assert('the dispatch note sends a child only to the surface aep dispatch created', () =>
    /the surface `aep dispatch` created for this task, by its absolute path, and nowhere else \(`\[\[policies\/execution\/parallel\]\]`\)/
      .test(flat(readSrc('skills', 'implement', 'dispatch.md'))));
  assert('the implementer stops where its surface reports another role', () =>
    /\*\*Any other role means you were started somewhere else: write nothing, and return `stopped`\*\*/
      .test(flat(readSrc('agents', 'implementer.md'))));
  assert('the protocol\'s write zones name the runtime\'s worktree', () =>
    /\| `\.aep\/worktrees\/<effort>\/…`, or the runtime's worktree you stand in \| effort and child surfaces \|/.test(readSrc('protocol.md')));
  assert('the seeded rule declares runtime-setup, defaulting to auto', () =>
    /^runtime-setup: auto$/m.test(readSrc('seed', 'rules', 'version-control.md')));
  assert('aep.mjs names a runtime only in its data tables', () => {
    const setupTable = /export const RUNTIME_SETUP = \[[\s\S]*?\n\];/.exec(cli);
    const runtimeTable = /export const RUNTIMES = \[[\s\S]*?\n\];/.exec(cli);
    if (!setupTable || !runtimeTable) throw new Error('RUNTIME_SETUP or RUNTIMES is gone');
    const elsewhere = cli.replace(setupTable[0], '').replace(runtimeTable[0], '')
      .replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (/t3\.json|T3 Code|runOnWorktreeCreate|T3CODE_|Claude Code|CLAUDECODE|CLAUDE_CODE_/.test(elsewhere)) {
      throw new Error('a runtime is named outside the tables');
    }
    return true;
  });
  assert('the implement skill resumes from any runtime, and the agent makes the move', () =>
    /It re-enters the same surface, from any runtime, and hands back another runtime's worktree to move into\./.test(flat(readSrc('skills', 'implement.md')))
    && readSrc('skills', 'implement.md').includes('| `move: true` | move into `surface` yourself, the way `runtime.reference` says, and `start` again there, which takes the lease; never hand the move to the developer |'));
  assert('the handoff skill says how work crosses to another runtime, with no command for the developer', () => {
    const handoff = flat(readSrc('skills', 'handoff.md'));
    return /\*\*Continuing in another runtime\?\*\* Commit or land the work first; nothing uncommitted crosses\./.test(handoff)
      && /node \.aep\/scripts\/aep\.mjs yield/.test(handoff) && /aep release <effort>/.test(handoff)
      && /\*\*The developer runs none of this\.\*\*/.test(handoff);
  });
  assert('the T3 Code reference says how to continue in another runtime', () =>
    /### Continuing an effort/.test(readSrc('seed', 'references', 't3code.md'))
    && /`existing_worktree` on that surface's path/.test(t3) && /`move: true`/.test(t3) && /\.aep\/scratch\/lease\.json/.test(t3));
  assert('aep.mjs ships release, and names continue_in where a runtime holds the branch', () =>
    /const COMMANDS = \{[^}]*\brelease\b[^}]*\}/.test(cli) && /continue_in:/.test(cli)
    // Defined once, and thrown by both start and release.
    && (cli.match(/heldElsewhere\(/g) ?? []).length >= 3);

  // 4.4: the agent moves an effort between runtimes, guarded by a lease.
  assert('aep.mjs ships yield, and a lease that goes stale after an hour', () =>
    /const COMMANDS = \{[^}]*\byield: yieldSurface\b[^}]*\}/.test(cli) && /export const LEASE_STALE_MINUTES = 60;/.test(cli));
  assert('the Claude adapter registers the session hooks for start, every turn, and the end', () => {
    const hooks = JSON.parse(readSrc('adapters', 'claude', 'hooks', 'hooks.json')).hooks;
    const runs = (event, arg) => (hooks[event] ?? []).some((group) => group.hooks.some((entry) =>
      (entry.args ?? []).some((value) => value.endsWith('/hooks/session.mjs')) && (entry.args ?? []).includes(arg)));
    return runs('SessionStart', 'start') && runs('Stop', 'stop') && runs('SessionEnd', 'end');
  });
  const runtimeSpec = flat(specText);
  assert('specs.md §21.1 continues an effort in any runtime, and release refuses uncommitted work', () =>
    /\*\*An effort continues in any runtime\.\*\*/.test(runtimeSpec)
    && /it MUST refuse a surface with uncommitted changes/.test(runtimeSpec)
    && /`close`, `release`, `yield`, and `check`/.test(runtimeSpec)
    && runtimeSpec.includes("**A lease** in the surface's `.aep/scratch/lease.json` names the session working there")
    && /`start` MUST return that worktree as the surface, with `move: true`/.test(runtimeSpec));
  assert('specs.md §18.2 has a run in a runtime worktree commit on the runtime\'s branch', () =>
    /\*\*Nor does it take a second branch:\*\* where that worktree stands on a named branch other than the default, the run MUST commit its effort on that branch/.test(runtimeSpec));
  assert('specs.md §18.3 runs an implementer only in a surface the orchestrator created', () =>
    /\*\*An implementer MUST run only in a ticket surface the orchestrator created\.\*\*/.test(runtimeSpec)
    && /Such delegation MUST carry only read-only work/.test(runtimeSpec));
  assert('specs.md §19.3 has the command line find an effort by content', () =>
    /\*\*The command line finds an effort's branch the same way\.\*\*/.test(runtimeSpec)
    && /a tie MUST stop the command, naming every branch/.test(runtimeSpec));
  assert('specs.md §21.1 sets up a runtime worktree once, and names it a write zone', () =>
    /\*\*A runtime that sets up its own worktrees is not set up twice\.\*\*/.test(runtimeSpec)
    && /the worktree the runtime supplied when the run stands in one/.test(runtimeSpec));

  assert('start, release, and close share one lease guard', () =>
    (cli.match(/guardLease\(/g) ?? []).length >= 4);

  // 4.5: each runtime has a playbook, and start points at the one it runs under.
  const claudeCode = flat(readSrc('seed', 'references', 'claude-code.md'));
  const playbook = (text) => ['Building tickets', 'Reviewing', 'Researching', 'Continuing an effort']
    .every((heading) => text.includes(`### ${heading}`));
  // 4.5.1: one T3 thread is one effort, so a ticket runs inside it.
  assert('the T3 Code playbook builds tickets as sub-agents of the effort\'s thread and reviews through delegate_task', () =>
    playbook(readSrc('seed', 'references', 't3code.md'))
    && /\*\*One thread is one effort\*\*, and so one pull request\./.test(t3)
    && /Start each ticket as a sub-agent of your provider, in the background/.test(t3)
    && /\*\*Never `t3_thread_launch` a ticket\.\*\*/.test(t3)
    && /`delegate_task` with `isolation: "shared"`/.test(t3) && /Set `target` to a second provider/.test(t3)
    && /at commit `9e85538535c8`/.test(t3));
  assert('specs.md §21.1 keeps one T3 thread per effort', () =>
    /\*\*Under T3 Code, one thread is one effort\*\*, and so one pull request: a ticket MUST NOT be given a thread of its own/.test(runtimeSpec));
  assert('the Claude Code playbook builds tickets as background implementers and continues with EnterWorktree', () =>
    playbook(readSrc('seed', 'references', 'claude-code.md'))
    && /`subagent_type: "aep:implementer"`/.test(claudeCode) && /`run_in_background: true`/.test(claudeCode)
    && /Never pass `isolation: "worktree"`/.test(claudeCode)
    && /the `EnterWorktree` tool with `path` set to the `surface` it returned/.test(claudeCode)
    && /`CLAUDE_CODE_SESSION_ID`/.test(claudeCode));
  assert('both runtime references are seeded with no detect, in the order RUNTIMES lists them', () => {
    const runtimeSeeds = SEEDS.filter((seed) => /^references\/(t3code|claude-code)\.md$/.test(seed.target));
    const order = [...cli.matchAll(/reference: '([a-z0-9-]+)'/g)].map((match) => match[1]);
    return runtimeSeeds.length === 2 && runtimeSeeds.every((seed) => !seed.detect)
      && order.join(' ') === 't3code claude-code';
  });
  assert('the implement skill runs children the way the runtime playbook says, and briefs name absolute paths', () =>
    /run the way the playbook in `runtime\.reference` says/.test(flat(readSrc('skills', 'implement.md')))
    && /by its absolute path, and nowhere else/.test(flat(readSrc('skills', 'implement', 'dispatch.md'))));
  assert('specs.md §21.1 has start name the runtime and its playbook', () =>
    /\*\*Each runtime has a playbook\.\*\*/.test(runtimeSpec)
    && /`start` MUST report the detected runtime and its reference/.test(runtimeSpec));

  // 4.3: an effort declares what it builds on, and the tracker sees the edge.
  const trackerText = flat(readSrc('policies', 'tracker.md'));
  assert('the tracker policy sets each builds-on edge as an issue dependency and names it in the pull request', () =>
    /\*\*Each `builds-on:` edge is a tracker dependency:\*\*/.test(trackerText)
    && /--add-blocked-by/.test(trackerText) && /`Builds on #<its issue>`/.test(trackerText)
    && /the spec stays canonical/.test(trackerText));
  assert('the specify skill writes builds-on for a request that needs another effort', () =>
    /names it in `builds-on:`; `aep open` then stacks on it or waits for it/.test(flat(readSrc('skills', 'specify.md'))));
  assert('the artifacts policy and the spec template carry builds-on, for efforts only', () =>
    /\| `builds-on` \| efforts only \|/.test(readSrc('policies', 'artifacts.md'))
    && /^builds-on: \[<effort>\]/m.test(readSrc('templates', 'spec.template.md')));
  assert('validate.mjs refuses builds-on anywhere but a spec', () =>
    /builds-on is legal only on an effort spec\.md/.test(readSrc('scripts', 'validate.mjs')));
  assert('specs.md §19.2 has efforts declare what they build on, stacking or waiting', () =>
    /\*\*Efforts declare what they build on, the same way\.\*\*/.test(runtimeSpec)
    && /the new branch MUST start at that effort's branch/.test(runtimeSpec)
    && /`open` MUST stop naming what it waits on/.test(runtimeSpec));

  const plan = flat(readSrc('skills', 'plan.md'));
  assert('the plan skill writes plan.md rather than extending the spec', () =>
    /Writes the effort's `plan\.md`/.test(plan)
    && /efforts\/<effort>\/plan\.md/.test(plan)
    && !/into `spec\.md`/.test(plan));

  assert('specs.md defines the claim against the working set', () =>
    specText.includes('**own commits**') && specText.includes('Confinement is the working set measured against the claim.'));
  assert('specs.md keeps isolation detected rather than required', () =>
    specText.includes('MUST NOT require worktrees'));
  assert('specs.md requires a ticket branch unique across efforts', () =>
    /ticket branch name MUST be unique across efforts/i.test(specText));
  assert('specs.md no longer calls gitignored state per-clone', () =>
    !specText.includes('per-clone'));
});

// --- §2 a run writes only inside the project ---------------------------------

section('filesystem boundary', () => {
  const protocol = flat(readSrc('protocol.md'));
  assert('the bootstrap carries the boundary as an invariant', () =>
    protocol.includes('**Write only inside the project.**') &&
    /Anything else is a stop/.test(protocol));
  for (const zone of ['`.aep/worktrees/<effort>/…`', '`.aep/scratch/`', 'the language\'s temp API']) {
    assert(`the boundary names ${zone} as a zone`, () => protocol.includes(zone));
  }
  assert('the bootstrap lists scratch/ in its layout, per working tree', () =>
    /scratch\/\s+worktrees\/\s+per working tree, gitignored/.test(readSrc('protocol.md')));
  assert('src/gitignore excludes scratch/', () =>
    readSrc('gitignore').split(/\r?\n/).some((line) => line.trim() === 'scratch/'));

  // The handoff once said "a scratch location outside the repository" and named
  // none, so a run invented one, and on Windows that was the drive root.
  const handoff = flat(readSrc('skills', 'handoff.md'));
  assert('a handoff is written to .aep/scratch/', () =>
    handoff.includes('`.aep/scratch/handoff-<effort>.md`'));
  assert('the handoff no longer sends its file outside the repository', () =>
    !/outside the repository/.test(handoff));
  assert("a brief gives the child its own scratch inside its worktree", () =>
    /\*\*Scratch:\*\* `\.aep\/scratch\/` inside that worktree/.test(readSrc('skills', 'implement', 'dispatch.md')));

  const spec = flat(fs.readFileSync(path.join(REPO, 'specs.md'), 'utf8'));
  assert('specs.md names scratch/ in the layout and the gitignore', () =>
    spec.includes('MUST exclude `position/`, `scratch/`, and `worktrees/`'));
  assert('specs.md states the boundary as an invariant', () =>
    /^\d+\. A run writes only inside the project/m.test(fs.readFileSync(path.join(REPO, 'specs.md'), 'utf8')));

  // Both halves on an installed tree: scratch is not an artifact, and a
  // .gitignore that would let it be committed fails.
  const { aep } = installFixture();
  const validateTree = () => {
    try {
      execFileSync(process.execPath, [path.join(aep, 'scripts', 'validate.mjs'), '--root', aep],
        { stdio: 'pipe' });
      return { failed: false, output: '' };
    } catch (error) {
      return { failed: true, output: String(error.stderr ?? '') };
    }
  };
  assert('installing creates scratch/', () => fs.existsSync(path.join(aep, 'scratch')));
  assert('a handoff in scratch/ is not read as an artifact', () => {
    const handoffFile = path.join(aep, 'scratch', 'handoff-40-alpha.md');
    fs.mkdirSync(path.dirname(handoffFile), { recursive: true });
    fs.writeFileSync(handoffFile, '# Handoff: 40-alpha\n\n## Resume with\n', 'utf8');
    const { failed, output } = validateTree();
    fs.rmSync(handoffFile);
    if (failed) throw new Error(`validate read scratch/: ${output}`);
    return true;
  });
  assert('a .gitignore that does not exclude scratch/ fails validate', () => {
    const ignoreFile = path.join(aep, '.gitignore');
    const before = fs.readFileSync(ignoreFile, 'utf8');
    fs.writeFileSync(ignoreFile, before.replace(/^scratch\/\r?\n/m, ''), 'utf8');
    const { failed, output } = validateTree();
    fs.writeFileSync(ignoreFile, before, 'utf8');
    if (!failed) throw new Error('validate passed without scratch/ in .gitignore');
    if (!/does not exclude scratch\//.test(output)) throw new Error(`failed for another reason: ${output}`);
    return true;
  });
});

// --- the agent-facing text stays cheap and inside the project ----------------

section('check', () => {
  const result = runChecks(SRC);
  assert('the checker budgets the bootstrap, every policy, and every skill', () => {
    const budgeted = result.budgets.files.map((entry) => entry.file);
    const missing = ['protocol.md', 'policies/execution.md', 'skills/implement.md', 'skills/implement/dispatch.md']
      .filter((rel) => !budgeted.includes(rel));
    if (missing.length > 0) throw new Error(`not budgeted: ${missing.join(', ')}`);
    return true;
  });
  assert('a skill note is held to the note budget, a skill to the skill budget', () =>
    budgetOf('skills/implement/dispatch.md').limit === BUDGETS['skill note']
    && budgetOf('skills/implement.md').limit === BUDGETS.skill
    && budgetOf('policies/execution.md').limit === BUDGETS.policy
    && budgetOf('protocol.md').limit === BUDGETS.protocol);
  assert('the standard-lane hot path names files that ship', () =>
    HOT_PATH.files.every((rel) => inSrc(...rel.split('/'))));
  assert('a word is a token holding a letter or a digit', () =>
    countWords('| --- | two words |  -> 3') === 3);

  assert('every budgeted file is within its budget', () => {
    if (result.budgets.over.length > 0) {
      throw new Error(result.budgets.over.map((entry) => `${entry.file} ${entry.words}/${entry.limit}`).join('; '));
    }
    return true;
  });
  // 4,200 since 4.1: the reporting policy carries the controlled register's
  // core, and the craft loads on demand from a skill. A further raise is a
  // decision somebody makes, so the number is pinned rather than read back.
  assert('the standard-lane /implement load is within 4,200 words', () => {
    if (HOT_PATH.budget !== 4200) throw new Error(`the hot-path budget moved to ${HOT_PATH.budget}`);
    if (result.budgets.hotPath.over) throw new Error(`${result.budgets.hotPath.words}/${result.budgets.hotPath.limit}`);
    return true;
  });
  assert('no agent-facing text carries a *Why rationale sentence', () => {
    if (result.why.length > 0) throw new Error(result.why.map((hit) => `${hit.file}:${hit.line}`).join('; '));
    return true;
  });
  assert('the whole tree passes the check', () => result.ok);
  assert('no agent-facing text sends a write outside the project', () => {
    if (result.outside.length > 0) {
      throw new Error(result.outside.map((hit) => `${hit.file}:${hit.line} ${hit.wording}`).join('; '));
    }
    return true;
  });

  // Each check fires on a tree seeded with exactly the thing it exists to catch.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-check-'));
  try {
    fs.mkdirSync(path.join(dir, 'skills'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'protocol.md'), '---\nuse-when: "x"\n---\n\n# P\n', 'utf8');
    const long = Array.from({ length: BUDGETS.skill + 1 }, () => 'word').join(' ');
    fs.writeFileSync(path.join(dir, 'skills', 'seeded.md'), [
      '---', 'use-when: "seeded"', '---', '', '# Seeded', '',
      'Write the handoff to a scratch location outside the repository.', '',
      '*Why: because.*', '', long, '',
    ].join('\n'), 'utf8');
    const seeded = runChecks(dir);
    assert('the budget check fires on an over-budget skill', () =>
      seeded.budgets.over.some((entry) => entry.file === 'skills/seeded.md'));
    assert('the rationale check fires on a *Why sentence', () =>
      seeded.why.some((hit) => hit.file === 'skills/seeded.md'));
    assert('the wording check fires on "outside the repository"', () =>
      seeded.outside.some((hit) => hit.file === 'skills/seeded.md' && hit.wording === 'outside the repository'));
    assert('a seeded tree is not clean', () => !seeded.ok);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The command line's own tests drive git and worktrees through real
// repositories, so they live in `tests/` and run under `node --test`. This
// section is the hook that keeps verify from going green without them.
section('command line', () => {
  const lanes = LANES.join(' ');
  assert('the lanes are quick, standard, and full, lowest first', () => lanes === 'quick standard full');
  assert('a lane only adds work: tickets, children, and rounds never fall going up', () =>
    LANES.every((lane, i) => i === 0 || ['converge', 'review', 'reviewers'].every((key) =>
      LANE_RULES[lane][key] >= LANE_RULES[LANES[i - 1]][key])));
  assert('aep.mjs ships', () => PAYLOAD_SCRIPTS.includes('aep.mjs'));
  const testFile = path.join(path.dirname(SRC), 'tests', 'aep.test.mjs');
  assert('the command line has tests', () => fs.existsSync(testFile));
  if (fs.existsSync(testFile)) {
    const run = spawnSync(process.execPath, ['--test', testFile], { encoding: 'utf8', cwd: path.dirname(SRC) });
    const summary = /ℹ pass (\d+)[\s\S]*?ℹ fail (\d+)/.exec(run.stdout ?? '');
    assert('node --test tests/aep.test.mjs passes', () => {
      if (run.status !== 0) throw new Error((run.stdout ?? '').split(/\r?\n/).filter((l) => /^✖|Error/.test(l)).slice(0, 6).join(' | '));
      return summary !== null && Number(summary[1]) >= 42 && summary[2] === '0';
    });
  }
});

section('review and bodies', () => {
  const review = flat(readSrc('skills', 'review.md'));
  const findings = flat(readSrc('skills', 'review', 'findings.md'));
  const correctness = flat(readSrc('agents', 'reviewer-correctness.md'));
  const standards = flat(readSrc('agents', 'reviewer-standards.md'));
  const execution = flat(readSrc('policies', 'execution.md'));

  // 4.6: a finding is Important, Nit, or Pre-existing, and only Important blocks.
  assert('the findings note defines the three tags, and only Important blocks', () =>
    ['Important', 'Nit', 'Pre-existing'].every((tag) => findings.includes(`| **${tag}** |`))
    && /\*\*Only Important blocks\.\*\*/.test(findings)
    && /\*\*A Pre-existing finding is never fixed in this effort\.\*\*/.test(findings)
    && /--note "pre-existing: <path:line> <what>"/.test(findings));
  assert('the review skill and both reviewer agents report through the findings note', () =>
    /each finding reported as `\[\[skills\/review\/findings\]\]` says: only Important blocks/.test(review)
    && [correctness, standards].every((text) =>
      /its tag: \*\*Important\*\*, \*\*Nit\*\*, or \*\*Pre-existing\*\*, as `\[\[skills\/review\/findings\]\]` defines them/.test(text)
      && /Important first, then Nit, then Pre-existing/.test(text)));
  assert('the execution policy blocks on Important findings only', () =>
    /An Important finding is fixed, ticketed, or left in `## Needs you`/.test(execution));
  assert('specs.md §21 defines the three tags', () =>
    /\*\*A review finding carries one tag \(4\.6\)\.\*\*/.test(specText)
    && /A Pre-existing finding MUST NOT be fixed in the effort that found it/.test(specText));
  // 4.7: at most 3 Nits per axis, and a Nit starts no round.
  assert('the findings note and both reviewer agents cap Nits at 3, and a Nit starts no round', () =>
    /\*\*At most 3 Nits per axis\.\*\*/.test(findings) && /A Nit never starts a round\./.test(findings)
    && [correctness, standards].every((text) => /with at most 3 Nits/.test(text) && /A Nit never starts a round\./.test(text)));
  assert('specs.md §21 caps Nits', () =>
    /\*\*A reviewer reports at most 3 Nits per axis \(4\.7\)\.\*\* A Nit MUST NOT start a review round/.test(specText));
  // 4.8: every finding cites a line the reviewer opened.
  assert('the findings note and both reviewer agents require an opened path:line, and count what was dropped', () =>
    /\*\*Every finding cites `path:line`, and you open that line before you report it\.\*\*/.test(findings)
    && /A finding whose line you did not open is dropped, and the return says how many were dropped/.test(findings)
    && [correctness, standards].every((text) =>
      /the file and line, as `path:line`, \*\*opened before you report it\*\*/.test(text)
      && /Say how many findings you dropped for want of a citation/.test(text)));
  assert('specs.md §21 requires the opened citation', () =>
    /the reviewer MUST open that line before it reports the finding \(4\.8\)/.test(specText));
  // 4.9: the report leads with the count per tag, and a clean axis says Nothing to fix.
  assert('the review skill and the findings note lead with the count per tag, and a clean review says Nothing to fix', () =>
    /Lead each axis with its count per tag\. One with none says "Nothing to fix" and nothing more\./.test(review)
    && /A review with no findings says \*\*"Nothing to fix"\*\* and adds nothing more/.test(findings));
  assert('specs.md §21 has a clean review say Nothing to fix', () =>
    /an axis with no findings says "Nothing to fix" and nothing more \(4\.9\)/.test(specText));
  // 4.10: a round records the commit it judged, and later rounds read only what changed.
  const cliText = readSrc('scripts', 'aep.mjs');
  assert('aep record writes the reviewed commit, and readRounds reads it back', () =>
    cliText.includes('line += ` (reviewed ${sha.slice(0, 12)})`;')
    && cliText.includes('reviewed: reviewed ? reviewed[1] : null')
    && cliText.includes(String.raw`|\bnothing to fix\b/i;`));
  assert('the findings note has later rounds diff from the reviewed commit, and the skills point at it', () =>
    /\*\*Round 2 and later read only what changed\*\*: the diff from that commit/.test(findings)
    && /Never raise again a finding already fixed or accepted\./.test(findings)
    && /A later round's subject is `\[\[skills\/review\/findings\]\]`'s\./.test(review)
    && /--review "2 Important, 2 fixed" --at <reviewed>/.test(readSrc('skills', 'implement.md')));
  assert('specs.md §21 has later rounds read only what changed', () =>
    /round 2 and later read only the diff from that commit plus the findings still open \(4\.10\)/.test(specText));
  // 4.11: an optional rules/review.md, loaded first, with a template for its shape.
  const reviewTemplate = flat(readSrc('templates', 'review.template.md'));
  assert('the review skill loads rules/review.md first, and a template gives its shape', () =>
    /`\.aep\/rules\/review\.md` first, where it exists, then `\[\[policies\]\]` and `\[\[rules\]\]`/.test(review)
    && /Copy to `\.aep\/rules\/review\.md`/.test(reviewTemplate)
    && /## What failure looks like here/.test(reviewTemplate) && /## Skip/.test(reviewTemplate)
    && /\*\*Keep it under 30 lines\.\*\*/.test(reviewTemplate));
  assert('specs.md §21 lets a repository keep a rules/review.md', () =>
    /A repository MAY keep a `rules\/review\.md`, and `review` loads it first/.test(specText));
  // 4.12: with no spec, the pull request and linked issue bodies are the intent; never threads.
  assert('the review skill reads the pull request and issue bodies after spec.md and before asking, never threads', () => {
    const step = flat(/^## 2 [\s\S]*?(?=^## )/m.exec(readSrc('skills', 'review.md'))[0]);
    const order = ["the effort's `spec.md`", 'the pull request and linked issue bodies, never threads', 'If none answers, ask']
      .map((text) => step.indexOf(text));
    return order.every((at) => at >= 0) && order[0] < order[1] && order[1] < order[2];
  });
  assert('specs.md §21 has review read the bodies, never threads', () =>
    /`review` reads the pull request body and its linked issue's body as the stated intent, before it asks \(4\.12\)\.\*\* It MUST NOT read comment or review threads/.test(specText));
  // 4.13: two templates are the one home of each body: a human part, then a folded AEP block.
  const prTemplate = readSrc('templates', 'pull-request.template.md');
  const issueTemplate = readSrc('templates', 'issue.template.md');
  const trackerPolicy = flat(readSrc('policies', 'tracker.md'));
  assert('both body templates have a human part and a folded AEP block of key: value lines', () =>
    ['## Why', '## What changed', '## Done when', '## How it was tested', '## Risk'].every((h) => prTemplate.includes(h))
    && ['## Done when', '## Notes'].every((h) => issueTemplate.includes(h))
    && [prTemplate, issueTemplate].every((t) => t.includes('<details><summary>AEP</summary>') && /^effort: \.aep\/efforts\/<effort>\/$/m.test(t))
    && /^log: \.aep\/efforts\/<effort>\/log\.md$/m.test(prTemplate));
  assert('the templates state when each part is written, where ticks go, and that log.md is linked', () =>
    /Between them a run edits only the\s+`AEP` block/.test(prTemplate)
    && /\*\*Criteria are ticked here, and only here\.\*\*/.test(prTemplate)
    && /\*\*`log\.md` is linked, never copied in\.\*\*/.test(prTemplate)
    && /\*\*Written once\.\*\*/.test(issueTemplate) && /\*\*Bullets, never checkboxes\.\*\*/.test(issueTemplate));
  assert('the tracker policy names both templates and states no body shape of its own', () =>
    trackerPolicy.includes('shaped by `[[templates/issue.template]]`')
    && trackerPolicy.includes('shaped by `[[templates/pull-request.template]]`')
    && /\*\*Each body is a human part on top and one folded `AEP` block at the bottom\.\*\*/.test(trackerPolicy)
    && /Criteria are ticked in the pull request only; the issue is written once/.test(trackerPolicy)
    && !/smallest visual|merge danger|whose body is `spec\.md`/.test(trackerPolicy));
  assert('the version-control seed points at the templates for pull request descriptions', () =>
    /An effort's pull request takes the shape `\[\[templates\/pull-request\.template\]\]`/.test(flat(readSrc('seed', 'rules', 'version-control.md'))));
  assert('no shipped or installed text tells an agent to prepare a body and not submit it', () => {
    const hits = [...walk(SRC), ...walk(path.join(REPO, '.aep'))]
      .filter((file) => /\.(md|mjs)$/.test(file) && !file.endsWith('verify.mjs'))
      // An effort quotes the phrase it removed; it is a record, not an instruction.
      .filter((file) => !/^\.aep[\\/](efforts|worktrees|scratch)[\\/]/.test(path.relative(REPO, file)))
      .filter((file) => fs.readFileSync(file, 'utf8').includes('Prepare the body; do not submit it'));
    if (hits.length > 0) throw new Error(hits.join(', '));
    return true;
  });
  assert('specs.md §14.4 defines the two-part bodies', () =>
    /\*\*Each tracker body is a human part on top and one folded `AEP` block at the bottom \(4\.13\)\.\*\*/.test(specText)
    && /The pull request links `log\.md` and MUST NOT copy it\./.test(specText));
  // 4.14: the risk section says how to revert.
  assert('the pull request template has a revert line in its risk section, never left out', () => {
    const risk = /## Risk\n([\s\S]*?)<details>/.exec(readSrc('templates', 'pull-request.template.md'));
    return Boolean(risk) && /^To revert: <how to undo it/m.test(risk[1])
      && /\*\*The revert line is never left out\.\*\*/.test(readSrc('templates', 'pull-request.template.md'));
  });
  assert('specs.md §14.4 requires the revert line', () =>
    /risk section states how to revert the change, or that it cannot be undone and why \(4\.14\)/.test(specText));
  // @@next
});

section('the guard fires', () => {
  const before = failures.length;
  assert('a deliberately false assertion is recorded as a failure', false, { silent: true });
  if (failures.length === before + 1) {
    failures.pop();
    passes += 1;
    process.stdout.write('  PASS  the failure path works. Seeded failure discarded\n');
  } else {
    failures.push('[the guard fires] the harness did not record a seeded failure');
    process.stdout.write('  FAIL  the harness did not record a seeded failure\n');
  }
});

// --- summary ----------------------------------------------------------------

if (fixtureCache) fs.rmSync(fixtureCache.dir, { recursive: true, force: true });

process.stdout.write(`\n${passes} passed, ${failures.length} failed\n`);

if (failures.length > 0) {
  process.stdout.write('\nfailures:\n');
  for (const failure of failures) process.stdout.write(`  ${failure}\n`);
  process.exit(1);
}

process.stdout.write('\nnot checked mechanically, and deliberately so:\n');
process.stdout.write('  - whether a use-when shaped like a trigger names the right occasion\n');
process.stdout.write('  - whether a posture genuinely gives up what its skill says it does\n');
process.stdout.write("  - whether a skill's procedure produces what it claims\n");
