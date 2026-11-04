// Validates a `.aep/` tree against the artifact contract.
//
// Everything checked here is mechanically checkable by construction; the one
// thing that is not, whether a `use-when` states a trigger rather than a topic,
// is called out in the summary rather than silently passed, because a check
// that cannot fire reads exactly like a check that passed.
//
// One check looks outside the tree. An artifact written to the repository root
// instead of into `.aep/` is not wrong to a walk that starts at the root, it is
// absent, so `checkStrays` reads the root's immediate children and reports what
// it finds there. It reports; it never moves anything.
//
//   node validate.mjs [--root <path-to-.aep>] [--quiet]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PROTOCOL_DIRS,
  REPOSITORY_DIRS,
  PER_CLONE_DIRS,
  FORBIDDEN_DIRS,
  LANES,
  SPEC_STATUSES,
  TICKET_STATUSES,
  USE_WHEN_REQUIRED_DIRS,
  isNonEmptyString,
  readArtifact,
  resolveAepRoot,
  toPosix,
  walk,
  wikiLinks,
  isProtocolPath,
  isRepositoryNote,
  RETIRED_FIELDS,
  useWhenProblems,
} from './contract.mjs';

const PROTOCOL_BUDGET_BYTES = 10240;

const failures = [];
const skippedEfforts = [];
let checked = 0;

function fail(where, message) {
  failures.push(`${where}: ${message}`);
}

/** Resolves a `[[link]]` against the tree: a `.md` file, or a directory. */
function linkResolves(root, target) {
  const base = path.join(root, ...target.split('/'));
  return fs.existsSync(`${base}.md`) || fs.statSync(base, { throwIfNoEntry: false })?.isDirectory();
}

function checkArtifact(root, file) {
  const rel = toPosix(root, file);
  const segments = rel.split('/');
  const topDir = segments.length > 1 ? segments[0] : '';
  const artifact = readArtifact(file);
  checked += 1;

  // Ownership is a fact about location, so a protocol directory holds exactly
  // what the protocol ships. A file here the manifest does not name is either
  // something a release retired and nobody pruned, or something the repository
  // wrote where it may not, and both are defects that hide until an upgrade
  // walks past them.
  //
  // This is what the `owner:` field used to say per artifact. It says it once,
  // for every directory, and it catches the case the field never could: a file
  // that simply omits the declaration.
  if (PROTOCOL_DIRS.includes(topDir) && !isProtocolPath(rel) && !isRepositoryNote(rel)) {
    fail(rel, `${topDir}/ holds only what the protocol ships, and this release ships ` +
      'no such file. Repository-owned governance belongs under rules/, orientation ' +
      'under contexts/, and tool operation under references/');
  }

  if (!artifact.hasFrontmatter) {
    fail(rel, 'no frontmatter. Every Markdown artifact under .aep/ declares at least a use-when');
    return;
  }
  for (const error of artifact.errors) fail(rel, `frontmatter ${error}`);

  const { fields } = artifact;

  // The retired fields. Ownership is a fact about location, the release is named
  // once in the bootstrap, and the rest were read by nothing.
  //
  // Rejected on a path the protocol ships, and tolerated everywhere else. A
  // repository's own rules and contexts were written under the old contract and
  // an upgrade never edits them, so failing them would fail a tree for carrying
  // exactly what AEP handed it and then refused to touch.
  const retired = RETIRED_FIELDS.filter((field) => fields[field] !== undefined);
  if (retired.length > 0 && isProtocolPath(rel)) {
    fail(rel, `carries retired frontmatter: ${retired.join(', ')}. ` +
      'Ownership is decided by location, the release is named once in protocol.md, ' +
      'and the rest are read by nothing');
  }

  // Situational fields, when present.
  if (fields.paths !== undefined && !Array.isArray(fields.paths)) {
    fail(rel, 'paths must be a YAML array');
  }

  // A context sits at `contexts/<area>.md` or `contexts/<project>/<area>.md`,
  // where the project directory exists so that two projects of a monorepo can
  // both call an area `auth`. One level, because a monorepo of monorepos is a
  // shape AEP declines to model.
  //
  // Contexts alone: `rules/` and `references/` are repository-wide, so neither
  // has a namespace two projects can collide in. A limit keyed by directory
  // would advertise a nesting nothing wants.
  if (topDir === 'contexts' && segments.length > 3) {
    fail(rel, 'a context sits at contexts/<area>.md or contexts/<project>/<area>.md, ' +
      'one project directory deep, no more');
  }

  // `use-when` is required where discovery depends on it.
  if (USE_WHEN_REQUIRED_DIRS.includes(topDir) && !isNonEmptyString(fields['use-when'])) {
    fail(rel, `${topDir}/ requires use-when. Without it this artifact can never be selected`);
  }

  // And wherever one is present it must be a trigger. This is the whole of
  // applicability-first loading resting on one field, so the field is checked
  // rather than trusted.
  if (fields['use-when'] !== undefined) {
    const heading = (artifact.body.match(/^#\s+(.+)$/m) ?? [])[1] ?? '';
    const problems = useWhenProblems(fields['use-when'], {
      heading,
      name: path.basename(rel, '.md'),
      directory: topDir,
    });
    for (const problem of problems) fail(rel, `use-when ${problem}`);
  }

  // `status`, `blocked-by`, `part-of` are legal only where they mean something.
  const isSpec = /^efforts\/[^/]+\/spec\.md$/.test(rel);
  const isTicket = /^efforts\/[^/]+\/tickets\//.test(rel);
  if (fields.status !== undefined) {
    if (isSpec && !SPEC_STATUSES.includes(fields.status)) {
      fail(rel, `spec status is "${fields.status}", must be one of: ${SPEC_STATUSES.join(', ')}`);
    } else if (isTicket && !TICKET_STATUSES.includes(fields.status)) {
      fail(rel, `ticket status is "${fields.status}", must be one of: ${TICKET_STATUSES.join(', ')}`);
    } else if (!isSpec && !isTicket) {
      fail(rel, 'status is legal only on an effort spec.md or a local ticket');
    }
  } else if (isSpec) {
    fail(rel, 'an effort spec.md must declare status');
  }
  if (fields.lane !== undefined) {
    if (!isSpec) fail(rel, 'lane is legal only on an effort spec.md');
    else if (!LANES.includes(fields.lane)) fail(rel, `lane is "${fields.lane}", must be one of: ${LANES.join(', ')}`);
  }
  if (fields['blocked-by'] !== undefined && !isTicket) {
    fail(rel, 'blocked-by is legal only on a local ticket');
  }
  if (fields['builds-on'] !== undefined) {
    if (!isSpec) fail(rel, 'builds-on is legal only on an effort spec.md');
    else if (!Array.isArray(fields['builds-on'])) fail(rel, 'builds-on must be a YAML array of efforts, by directory or number');
  }

  // Links.
  for (const target of wikiLinks(artifact.body)) {
    if (!linkResolves(root, target)) {
      fail(rel, `[[${target}]] resolves to nothing. Repair it or report it, never invent the target`);
    }
  }
}

/**
 * The numbers a spec actually defines, under one of its numbered headings.
 *
 * Requirements and acceptance criteria are top-level ordered lists whose
 * numbering runs on across subheadings, so the section is read from its heading
 * to the next one at the same level. Reading them is what makes a citation
 * checkable rather than merely present.
 */
function numbersUnder(specBody, heading) {
  const start = specBody.search(new RegExp(String.raw`^#\s+${heading}\s*$`, 'm'));
  if (start < 0) return new Set();
  const rest = specBody.slice(start);
  const end = rest.slice(1).search(/^#\s+/m);
  const section = end < 0 ? rest : rest.slice(0, end + 1);
  const numbers = new Set();
  for (const match of section.matchAll(/^(\d+)\.\s/gm)) numbers.add(Number(match[1]));
  return numbers;
}

/** Every `Requirement N` / `Criterion N` a ticket cites, in order of appearance. */
function citations(ticketBody) {
  const start = ticketBody.search(/^##\s+Acceptance Criteria\s*$/m);
  if (start < 0) return [];
  const rest = ticketBody.slice(start);
  const end = rest.slice(1).search(/^##\s+/m);
  const section = end < 0 ? rest : rest.slice(0, end + 1);
  return [...section.matchAll(/\b(requirement|criterion|criteria)\s+(\d+)/gi)].map((match) => ({
    kind: match[1].toLowerCase() === 'requirement' ? 'requirement' : 'criterion',
    number: Number(match[2]),
  }));
}

/**
 * A ticket whose criteria trace to no requirement in the spec is an error.
 *
 * This is what replaces the rule that kept the change and its architecture in
 * one file. Two files can drift apart; a citation that has to resolve cannot
 * drift quietly.
 *
 * A citation is checked against what the spec numbers rather than merely for
 * being present, because a renumbered spec leaves behind references that still
 * look like references. `obsolete` is skipped: the whole point of that status is
 * that the spec moved on without the ticket.
 */
function checkTraceability(root) {
  const effortsDir = path.join(root, 'efforts');
  if (!fs.existsSync(effortsDir)) return;

  for (const entry of fs.readdirSync(effortsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const ticketsDir = path.join(effortsDir, entry.name, 'tickets');
    const specFile = path.join(effortsDir, entry.name, 'spec.md');
    if (!fs.existsSync(ticketsDir) || !fs.existsSync(specFile)) continue;

    const spec = readArtifact(specFile);

    // A landed effort is left exactly as it is. Its spec and its tickets are the
    // record of what was reviewed, and this check exists to stop a live effort's
    // two files from drifting apart, which is a risk only while it is being
    // built. Requirement 48 of aep-3 states the same principle for migration.
    if (spec.fields.status === 'implemented') {
      // The stamp is the close's, and the close comes after a converge round
      // found no gap, so unresolved work under an implemented spec is a stamp
      // made ahead of the work. Only this direction is checkable: every ticket
      // being resolved does not mean the effort is done, because converge may
      // still append.
      const early = walk(ticketsDir)
        .filter((file) => file.endsWith('.md'))
        .filter((file) => readArtifact(file).fields.status === 'open')
        .map((file) => toPosix(root, file));
      if (early.length > 0) {
        fail(`efforts/${entry.name}/spec.md`,
          `is "implemented" while ${early.join(', ')} is still open. The stamp is ` +
          'written when a converge round finds no gap, never ahead of the work');
      }
      skippedEfforts.push(entry.name);
      continue;
    }

    const requirements = numbersUnder(spec.body, 'Requirements');
    const criteria = numbersUnder(spec.body, 'Acceptance Criteria');
    const tickets = walk(ticketsDir).filter((file) => file.endsWith('.md'));

    if (requirements.size === 0 && criteria.size === 0) {
      if (tickets.length > 0) {
        fail(`efforts/${entry.name}/spec.md`,
          `numbers no requirements and no acceptance criteria, so none of its ` +
          `${tickets.length} ticket(s) can trace to one. Number them, or the tickets ` +
          'are the only definition of the change');
      }
      continue;
    }

    for (const file of tickets) {
      const rel = toPosix(root, file);
      const ticket = readArtifact(file);
      if (ticket.fields.status === 'obsolete') continue;

      // The status is the claim the work is done and the ticks are its evidence,
      // so an open box under a resolved ticket is the claim with the evidence
      // removed. Exempt above: an obsolete ticket, and every ticket under an
      // implemented effort, which is the record of what was reviewed.
      if (ticket.fields.status === 'resolved') {
        const open = (ticket.body.match(/^\s*- \[ \]/gm) ?? []).length;
        if (open > 0) {
          fail(rel, `is "resolved" with ${open} acceptance criterion/criteria unticked. ` +
            'A criterion is ticked when it is verified; one that cannot be met parks the ' +
            'ticket unresolved or marks it obsolete');
        }
      }

      const cited = citations(ticket.body);
      if (cited.length === 0) {
        fail(rel, 'its acceptance criteria cite no requirement or criterion of ' +
          `efforts/${entry.name}/spec.md. A ticket that traces to nothing is either ` +
          'scope nobody asked for, or a requirement the spec is missing');
        continue;
      }

      const defined = (kind) => (kind === 'requirement' ? requirements : criteria);
      if (!cited.some(({ kind, number }) => defined(kind).has(number))) {
        const dangling = cited.map(({ kind, number }) => `${kind} ${number}`).join(', ');
        fail(rel, `cites ${dangling}, and the spec numbers none of them. Either the ` +
          'spec was renumbered under the ticket, or the ticket was written against a ' +
          'spec that no longer says this');
      }
    }
  }
}

function checkStructure(root) {
  for (const forbidden of FORBIDDEN_DIRS) {
    if (fs.existsSync(path.join(root, forbidden))) {
      fail(`${forbidden}/`, 'this directory was retired and must not exist. What it ' +
        'held has moved or was dropped, and the notices for the release that retired ' +
        'it say which. Move anything of yours out of it, then delete it');
    }
  }

  const protocolFile = path.join(root, 'protocol.md');
  if (!fs.existsSync(protocolFile)) {
    fail('protocol.md', 'missing. It is the bootstrap and everything starts there');
  } else {
    // Counted with LF endings, so a checkout that converts them to CRLF does
    // not fail a budget the committed file meets.
    const size = Buffer.byteLength(fs.readFileSync(protocolFile, 'utf8').replace(/\r\n/g, '\n'), 'utf8');
    if (size > PROTOCOL_BUDGET_BYTES) {
      fail('protocol.md', `${size} bytes exceeds the ${PROTOCOL_BUDGET_BYTES}-byte bootstrap budget`);
    }
  }

  const ignoreFile = path.join(root, '.gitignore');
  if (!fs.existsSync(ignoreFile)) {
    fail('.gitignore', `missing. ${PER_CLONE_DIRS.map((dir) => `${dir}/`).join(', ')} must never be committed`);
  } else {
    const ignored = fs.readFileSync(ignoreFile, 'utf8');
    for (const entry of PER_CLONE_DIRS.map((dir) => `${dir}/`)) {
      if (!ignored.split(/\r?\n/).some((line) => line.trim() === entry)) {
        fail('.gitignore', `does not exclude ${entry}`);
      }
    }
  }

  const effortsDir = path.join(root, 'efforts');
  if (fs.existsSync(effortsDir)) {
    for (const entry of fs.readdirSync(effortsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const effort = path.join(effortsDir, entry.name);
      if (!fs.existsSync(path.join(effort, 'spec.md'))) {
        fail(`efforts/${entry.name}/`, 'an effort must have a spec.md');
      }
      for (const sub of [path.join('evidence', 'research'), path.join('evidence', 'prototypes'), 'tickets']) {
        const target = path.join(effort, sub);
        if (fs.existsSync(target) && walk(target).length === 0) {
          fail(`efforts/${entry.name}/${sub.split(path.sep).join('/')}/`, 'exists but is empty. Create it when something goes in it');
        }
      }
    }
  }
}

/**
 * How deep an artifact of each kind that declares a `use-when` may sit inside
 * its own directory, counted in segments below it.
 *
 * `rules/` and `references/` are repository-wide, so neither has a namespace to
 * nest in and both sit flat. A context takes one project directory, so that two
 * projects of a monorepo can each call an area `auth`. A skill takes one for its
 * notes, so a note is reached from the skill owning it. A policy takes one for
 * the part of it that loads only sometimes, as `execution/parallel` loads only
 * for a wave of children. `agents/` and `templates/` are flat because neither
 * namespaces anything. The gate asks for these depths rather
 * than for a file that merely ends in `.md`, because depth is half of what makes
 * a directory AEP's rather than somebody's own folder of notes.
 *
 * The four protocol directories are here rather than in an arm of their own
 * because every Markdown artifact this release ships under them carries a
 * `use-when`, so the test they need is this one and not one resembling it.
 * That guarantee is weaker for `agents/` and `templates/` than for the rest: a
 * `use-when` is required of a policy, a rule, a reference, and a context, and on
 * those two it is held by the suite instead. Either way the gate stays sound and
 * would fall quiet, never loud, for a kind that stopped carrying one.
 */
const USE_WHEN_DEPTHS = {
  policies: 2,
  skills: 2,
  agents: 1,
  templates: 1,
  rules: 1,
  references: 1,
  contexts: 2,
};

/**
 * Paths under `dir`, relative to it, POSIX, no deeper than `maxDepth` segments.
 *
 * Depth-capped rather than a full walk because nothing the gate below recognises
 * sits deeper than two: the protocol ships no file under `<dir>/<x>/<y>`, and a
 * context is one project directory in at most. The cap is also what keeps this
 * affordable against a consuming repository whose own `scripts/` is enormous.
 *
 * Deliberately not `walk` from `contract.mjs`, which it otherwise resembles.
 * That one enumerates the protocol tree, which this release owns and can trust;
 * this one reads a directory belonging to somebody else, where the depth cap is
 * a bound on a stranger rather than a shortcut. One traversal serving both would
 * have the tree and the suspect sharing a definition of how far to look.
 */
function shallowFiles(dir, maxDepth) {
  const found = [];
  const visit = (current, prefix, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isFile()) found.push(rel);
      else if (entry.isDirectory() && depth < maxDepth) {
        visit(path.join(current, entry.name), rel, depth + 1);
      }
    }
  };
  visit(dir, '', 1);
  return found;
}

/**
 * What makes a directory outside the tree AEP's, or null where nothing does.
 *
 * **Recognition is by the contract and never by the name.** A consuming
 * repository may perfectly well keep its own `templates/`, `references/`, or
 * `contexts/` at its root, and a check firing on those would teach people the
 * validator is noise, after which it catches nothing at all. So each arm asks a
 * question only an AEP artifact answers yes to, and returns the file that
 * answered it, so the failure can say what it found rather than only that it
 * found something.
 *
 * The gate is deliberately tight in the other direction too: an effort with no
 * frontmatter, or a `status` outside the contract, is not recognised and not
 * reported. A false positive lands on somebody else's install, where it is least
 * recoverable, and a malformed spec inside the tree already fails for its own
 * reasons.
 *
 * **Every arm reads content.** An arm that matched a path against the manifest
 * would be reading a name, and it reported a repository's own `scripts/index.mjs`,
 * an empty one included, while telling its author to move it to a protocol-owned
 * path the next upgrade overwrites.
 */
function strayEvidence(root, name, dir) {
  if (name === 'efforts') {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (!entry.isDirectory()) continue;
      const spec = path.join(dir, entry.name, 'spec.md');
      if (!fs.existsSync(spec)) continue;
      const { fields } = readArtifact(spec);
      if (SPEC_STATUSES.includes(fields.status)) {
        return `efforts/${entry.name}/spec.md declares status: ${fields.status}`;
      }
    }
    return null;
  }

  // A script carries no frontmatter, so identity is the only content this arm
  // has to read, and the installed tree holds the only bytes to read it against:
  // nothing here carries a content baseline, and the manifest answers paths.
  //
  // So the oracle is part of the subject. That is sound only because a
  // protocol-owned file differing from its release is already a defect to
  // reinstall, an invariant this script does not itself check, and the arm
  // inherits it: against a drifted `.aep/scripts/`, a real copy stops matching
  // and goes unreported. Silence is the failure this accepts, having rejected
  // the loud one; it lifts when a content baseline reaches a consuming tree.
  //
  // `isProtocolPath` stays as the prefilter and is load-bearing rather than
  // decorative. Without it a repository keeping its own `.aep/scripts/mine.mjs`
  // would see its root `scripts/mine.mjs` reported for matching itself.
  if (name === 'scripts') {
    for (const rel of shallowFiles(dir, 1)) {
      if (!isProtocolPath(`scripts/${rel}`)) continue;
      let found;
      let shipped;
      try {
        found = fs.readFileSync(path.join(dir, rel));
        shipped = fs.readFileSync(path.join(root, 'scripts', rel));
      } catch {
        continue;
      }
      if (found.equals(shipped)) {
        return `scripts/${rel} is byte-identical to the script this release ships`;
      }
    }
    return null;
  }

  for (const rel of shallowFiles(dir, USE_WHEN_DEPTHS[name])) {
    if (!rel.endsWith('.md')) continue;
    const artifact = readArtifact(path.join(dir, ...rel.split('/')));
    if (artifact.hasFrontmatter && isNonEmptyString(artifact.fields['use-when'])) {
      return `${name}/${rel} carries a use-when`;
    }
  }
  return null;
}

/**
 * A protocol artifact written outside the tree.
 *
 * Every other check here starts at the root, so *outside the root* was not a
 * state this script could represent: an artifact written outside was not wrong
 * to it, it was absent, and absent reads exactly like never having existed. A
 * whole effort sat at a repository root with a complete spec under it and the
 * command reported no failures.
 *
 * The scan reaches the repository root's immediate children and no deeper. A
 * walk of the whole repository would catch a stray at any depth and would flag
 * the source tree of the repository that wrote this, so its first act would be
 * to need an exception for itself.
 *
 * **It reports and it never moves anything.** Relocating somebody's files is a
 * write nobody requested, and the correct destination is not always inferable.
 */
function checkStrays(root) {
  const repository = path.dirname(root);
  if (repository === root) return;

  let entries;
  try {
    entries = fs.readdirSync(repository, { withFileTypes: true });
  } catch {
    return;
  }

  const areas = new Set([...PROTOCOL_DIRS, ...REPOSITORY_DIRS]);
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!entry.isDirectory() || !areas.has(entry.name)) continue;
    const evidence = strayEvidence(root, entry.name, path.join(repository, entry.name));
    if (!evidence) continue;

    // The location is the one as found, relative to the repository root. Every
    // other failure in this file is tree-relative, and a stray's whole problem
    // is that it is not in the tree, so the message says which root it is
    // counted from rather than leaving two readings of the same string.
    fail(`${entry.name}/`, 'sits at the repository root rather than under .aep/, and ' +
      `${evidence}. It belongs at .aep/${entry.name}/, and moving it is yours: a stray is ` +
      'reported and never relocated, because the destination is not always the obvious one');
  }
}

/**
 * Validates the tree at `root` (a `.aep/` directory). Returns what failed, how
 * many artifacts were checked, and which implemented efforts traceability
 * skipped. Safe to call more than once in a process.
 */
export function validateTree(root) {
  failures.length = 0;
  skippedEfforts.length = 0;
  checked = 0;

  checkStructure(root);
  checkStrays(root);
  checkTraceability(root);

  const artifacts = walk(root, { skip: PER_CLONE_DIRS })
    .filter((file) => file.endsWith('.md') && path.basename(file) !== 'index.md');
  for (const file of artifacts) checkArtifact(root, file);

  // The index is derived, so staleness is a defect in the tree, not a warning.
  const indexFile = path.join(root, 'index.md');
  if (!fs.existsSync(indexFile)) {
    fail('index.md', 'missing. Run: node .aep/scripts/index.mjs');
  }
  return { failures: [...failures], checked, skippedEfforts: [...skippedEfforts] };
}

function main() {
  const args = process.argv.slice(2);
  const rootArg = args.includes('--root') ? args[args.indexOf('--root') + 1] : null;
  const quiet = args.includes('--quiet');

  const root = resolveAepRoot(rootArg, import.meta.url);
  if (!root) {
    process.stderr.write('no .aep/ found. Pass --root, or run from a repository that has one\n');
    process.exit(2);
  }

  validateTree(root);

  if (failures.length === 0) {
    if (!quiet) {
      process.stdout.write(`${checked} artifacts checked, no failures\n`);
      if (skippedEfforts.length > 0) {
        process.stdout.write(
          `Traceability not checked for ${skippedEfforts.length} implemented effort(s): ` +
          `${skippedEfforts.join(', ')}. A landed effort is the record of what was reviewed.
`,
        );
      }
      process.stdout.write(
        'Not checked mechanically: whether a use-when shaped like a trigger names the right\n' +
        'occasion. The checks reject a topic; they cannot tell a correct trigger from a\n' +
        'plausible wrong one.\n',
      );
    }
    return;
  }

  process.stderr.write(`${checked} artifacts checked, ${failures.length} failure(s):\n\n`);
  for (const failure of failures) process.stderr.write(`  ${failure}\n`);
  process.stderr.write('\n');
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
