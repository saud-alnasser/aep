// Answers where a run is, from git alone: which efforts the branch claims,
// which efforts the tree is touching now, which surface the run stands in and
// what role that surface makes it, and what isolation is in force.
//
// AEP says the branch is the claim and nothing ever read it. Which effort an
// invocation was inside came from the human, in the conversation, on every
// invocation. That holds while one session runs at a time, and it stops holding
// the moment a runtime puts one thread per branch in one repository, because
// threads share no conversation and the branch is the only thing telling them
// apart.
//
// The claim is what the branch's own commits changed, measured against the
// merge base with the default branch, rather than what the branch is called.
// Naming belongs to the repository and sometimes to the runtime, which
// generates its own, so a resolution that reads the name answers nothing on the
// runtime this was written for. The name survives as the fallback, because a
// branch with no commits of its own has no other signal.
//
// The claim and the working set are deliberately different questions. Scope
// computed from the working tree can never fire a guard: the first illegal
// write enlarges the scope that would have caught it. Measured from commits,
// the claim is a fact the run cannot edit by misbehaving.
//
// The surface and the role are computed the same way and for the same reason.
// Two agents standing in two surfaces of one effort are bound by opposite rules,
// and neither rule was derivable from anything either agent could read: it lived
// in a brief the run outlives. So the surface is a function of two paths git
// prints, and the role is a function of the surface. Nothing is stored, because
// git already holds the fact and a second copy is a fact that can disagree.
//
// Reported, never enforced. A run that must not integrate is refused by the
// policy keyed on the role, exactly as the isolation is reported here and acted
// on there, so there is one place a reader looks for what a run does about what
// this script found.
//
// This reads git and nothing else. The position marker is a different question,
// whether the tree moved since some earlier run looked at it, and it carries no
// effort identity by design.
//
//   node scope.mjs read  [--root <path-to-.aep>] [--json]
//   node scope.mjs check [--root <path-to-.aep>]
//
//   exit 0   read: the claim is non-empty    check: nothing outside the claim
//   exit 1   read: unscoped                  check: something outside it, listed
//   exit 2   git or the working tree could not be read

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveAepRoot } from './contract.mjs';

/** Runs git, returning null rather than throwing. Every caller treats absence as "unknown". */
function git(cwd, args) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/** Unique, sorted, misses dropped. Every effort list here is built this way. */
function efforts(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

/**
 * The effort directory a repository-relative path sits in, or null.
 *
 * The prefix arrives normalised to forward slashes, because git prints POSIX
 * separators and `path.join` produces backslashes on Windows, and a comparison
 * between the two matches nothing while looking like it works.
 *
 * A remainder carrying no separator is a file standing directly in `efforts/`
 * rather than anything inside an effort, so it belongs to none. Untracked
 * directories, which git collapses and prints with a trailing slash, still
 * resolve.
 */
export function effortOf(relative, prefix) {
  if (!relative.startsWith(prefix)) return null;
  const rest = relative.slice(prefix.length);
  const cut = rest.indexOf('/');
  if (cut <= 0) return null;
  return rest.slice(0, cut);
}

/**
 * The default branch the claim is measured against, or null where none
 * resolves.
 *
 * Wrong or stale, it widens the diff and so widens the claim, which fails open:
 * a wider claim permits more, so a run is never stopped from doing something
 * legitimate. That is the right direction for a guard whose worst outcome would
 * otherwise be blocking correct work.
 */
export function resolveBase(repo) {
  const originHead = git(repo, ['rev-parse', '--abbrev-ref', 'origin/HEAD']);
  const named = originHead === null ? '' : originHead.trim();
  // Some git versions echo the symref back rather than failing when it is unset.
  if (named && named !== 'origin/HEAD') return named;

  const configured = git(repo, ['config', 'init.defaultBranch']);
  const candidates = [configured === null ? '' : configured.trim(), 'main', 'master'];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (git(repo, ['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`]) !== null) {
      return candidate;
    }
  }
  return null;
}

/**
 * The efforts a branch's own commits touch, from the merge base with the base
 * branch. `ref` is `HEAD` for the run's own claim, and any local branch where
 * the command line asks which branch holds an effort, whatever it is called.
 *
 * Empty where there is no base to measure against, and where the ref is the
 * base itself, which is the ordinary state of the default branch. An effort
 * that has merged empties too, since its old branch then diffs to nothing, and
 * that is correct rather than a defect.
 */
export function claimOfRef(repo, base, prefix, ref = 'HEAD') {
  if (!base) return [];

  const revs = git(repo, ['rev-parse', `${ref}^{commit}`, `${base}^{commit}`]);
  if (revs === null) return [];
  const [head, baseCommit] = revs.trim().split(/\r?\n/);
  if (head && head === baseCommit) return [];

  const diff = git(repo, ['diff', '--name-only', `${base}...${ref}`, '--', prefix]);
  if (diff === null) return [];
  return efforts(diff.split(/\r?\n/).map((file) => effortOf(file.trim(), prefix)));
}

/**
 * What the tree holds for a branch name to be matched against: the effort
 * directories, and which efforts hold each ticket filename.
 */
function treeIndex(root) {
  const dir = path.join(root, 'efforts');
  const tickets = new Map();
  const names = [];

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { names, tickets };
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    names.push(entry.name);

    let files;
    try {
      files = fs.readdirSync(path.join(dir, entry.name, 'tickets'));
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const id = file.slice(0, -3);
      tickets.set(id, [...(tickets.get(id) ?? []), entry.name]);
    }
  }
  return { names, tickets };
}

/**
 * The effort a branch name names, for a branch with no commits of its own.
 *
 * Three forms, in order: the effort directory itself, an `<effort>--...` prefix
 * (or the 3.x `<effort>/...`, which git cannot create beside an `<effort>` branch),
 * and a ticket filename exactly one effort holds. Ticket ids restart per
 * effort, so a filename two efforts both carry names neither of them.
 *
 * A name matching none of these leaves the claim empty, which is unscoped, and
 * a runtime-generated name is expected to land there.
 */
export function claimFromName(branch, index) {
  if (!branch) return [];
  if (index.names.includes(branch)) return [branch];

  const [first] = branch.split(/\/|--/);
  if (first !== branch && index.names.includes(first)) return [first];

  const holders = index.tickets.get(branch);
  return holders && holders.length === 1 ? [holders[0]] : [];
}

/**
 * The efforts the tree is touching now, staged, unstaged, or untracked, as a
 * map from effort to the paths under it.
 *
 * `-z` because without it a path carrying a space or a non-ASCII character
 * comes back quoted, and a quoted path matches no prefix and is dropped with
 * nothing saying so. Returns null where git could not read the tree, which is
 * the condition that exits 2.
 */
export function workingSet(repo, prefix) {
  const status = git(repo, ['status', '--porcelain', '-z']);
  if (status === null) return null;

  const records = status.split('\0');
  const found = new Map();
  const add = (file) => {
    const effort = effortOf(file, prefix);
    if (!effort) return;
    const paths = found.get(effort) ?? [];
    if (!paths.includes(file)) paths.push(file);
    found.set(effort, paths);
  };

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (record.length < 4) continue;
    add(record.slice(3));
    // A rename or a copy carries its source in the next field, and a rename out
    // of an effort touches that effort as much as the destination does.
    const code = record.slice(0, 2);
    if (code.includes('R') || code.includes('C')) {
      i += 1;
      if (records[i]) add(records[i]);
    }
  }
  return found;
}

/** One `git worktree list --porcelain` block per worktree, as a path and a branch. */
export function parseWorktrees(output) {
  const worktrees = [];
  let current = null;
  for (const line of String(output).split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length).trim(), branch: 'detached' };
      worktrees.push(current);
    } else if (current && line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
    }
  }
  return worktrees;
}

/**
 * The isolation the runtime gave this checkout, read rather than configured.
 *
 * A linked worktree is the enforced case: git refuses a second worktree on a
 * branch one already holds, and the refusal names the holder, so a claim inside
 * a clone cannot be taken twice. Across clones there is no such refusal, and
 * the run reports the claim as advisory rather than pretending otherwise.
 *
 * AEP creates, names, and removes nothing here. It reads what the runtime did.
 */
function isolationOf(repo) {
  const dirs = git(repo, ['rev-parse', '--git-dir', '--git-common-dir']);
  let kind = 'checkout';
  if (dirs !== null) {
    const [gitDir, commonDir] = dirs.trim().split(/\r?\n/);
    if (gitDir && commonDir && path.resolve(repo, gitDir) !== path.resolve(repo, commonDir)) {
      kind = 'worktree';
    }
  }

  const listed = git(repo, ['worktree', 'list', '--porcelain']);
  const worktrees = listed === null ? [] : parseWorktrees(listed);
  const siblings = worktrees.filter((worktree) => path.resolve(worktree.path) !== path.resolve(repo));

  return {
    kind,
    // Enforcement is git's refusal, so it exists only where there is a second
    // worktree for git to refuse.
    enforcement: worktrees.length > 1 ? 'enforced' : 'advisory',
    path: repo,
    count: worktrees.length,
    siblings,
    // Carried for the surface below, which needs the main checkout and would
    // otherwise ask git for the same list a second time. The renderers name the
    // fields they print, so this one stays internal.
    worktrees,
  };
}

// The one directory name reserved under an effort. The skill that opens an
// effort creates exactly this path and the runner re-enters it, so every other
// directory beside it belongs to a ticket.
const RUN = '_run';
// Every surface AEP creates under an effort is either the run's or a ticket's,
// and the underscore is what tells them apart. `_run` is the orchestrator; any
// other underscored name is a surface AEP made for something else, a prototype
// among them, and resolves to `unknown` so no rule keyed on the role fires at
// it. Without this a prototype worktree reads as a ticket and its occupant is
// told it may not dispatch, by a rule written for children.
const RESERVED = '_';

/** The role a surface makes its occupant. Total over the kinds below. */
const ROLES = {
  main: 'none',
  run: 'orchestrator',
  ticket: 'implementer',
  // A worktree the runtime supplied rather than AEP: a run given one takes no
  // second, so its occupant is the one that integrates.
  runtime: 'orchestrator',
  unknown: 'unknown',
};

/** Forward slashes, no trailing separator, so two paths git printed compare as strings. */
function normalise(value) {
  return String(value).replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * The surface this checkout is, decided by where it stands relative to the main
 * checkout and by nothing else.
 *
 * Both sides come from git: the current tree from `--show-toplevel`, the main
 * checkout from the first entry of `git worktree list --porcelain`, which git
 * lists first whichever worktree the question is asked from. That is the same
 * care `resolveScope` takes over its prefix, and for the same reason. On
 * Windows one spelling of a path can arrive as an 8.3 short name, and a
 * comparison against anything resolved from the process directory then matches
 * nothing while reading as though it worked.
 *
 * `aepRelative` locates AEP's own worktrees directory, because `.aep/` is not
 * always at the repository root and a hardcoded `.aep/worktrees` would resolve
 * every surface of a nested installation to `runtime`.
 *
 * Total by construction: a path matching no shape is `unknown`, whose role fires
 * no rule, which is the direction `resolveBase` above already fails in.
 */
export function surfaceOf(repo, mainPath, aepRelative) {
  const here = repo ? normalise(repo) : '';
  const main = mainPath ? normalise(mainPath) : '';
  const unknown = { kind: 'unknown', effort: null, ticket: null, path: here || null };
  if (!here || !main) return unknown;
  if (here === main) return { kind: 'main', effort: null, ticket: null, path: here };

  const inner = `${normalise(aepRelative)}/worktrees`;
  if (!here.startsWith(`${main}/${inner}/`)) {
    return { kind: 'runtime', effort: null, ticket: null, path: here };
  }

  // Two segments and no more: `<effort>/<occupant>` is the only shape AEP
  // creates under here, and anything deeper is something this cannot name.
  const parts = here.slice(`${main}/${inner}/`.length).split('/');
  const relative = `${inner}/${parts.join('/')}`;
  if (parts.length !== 2) return { ...unknown, path: relative };

  const [effort, occupant] = parts;
  if (occupant !== RUN && occupant.startsWith(RESERVED)) {
    return { ...unknown, path: relative };
  }
  return occupant === RUN
    ? { kind: 'run', effort, ticket: null, path: relative }
    : { kind: 'ticket', effort, ticket: occupant, path: relative };
}

/**
 * The whole answer: the base, the claim, the working set, the surface this run
 * stands in with the role it carries, and the isolation.
 *
 * Returns null where git could not be read, which every caller reports as
 * exit 2. A failure to answer is never an exception escaping the script.
 */
export function resolveScope(root) {
  // The prefix is built entirely from git, because everything it will be
  // compared against comes from git too. Subtracting the top level from
  // `--root` instead looks equivalent and is not: the two are spellings of one
  // place, and on Windows one of them can arrive as an 8.3 short name, which
  // `path.relative` cannot reconcile. What it returns then matches nothing and
  // reads as though it worked.
  const located = git(path.dirname(root), ['rev-parse', '--show-toplevel', '--show-prefix']);
  if (located === null) return null;
  const [toplevel = '', inner = ''] = located.split(/\r?\n/);

  const repo = toplevel.trim();
  if (!repo) return null;
  // Where `.aep/` sits inside the repository, which is where both the efforts
  // directory and the worktrees directory are found from.
  const aepRelative = `${inner.trim()}${path.basename(root)}`;
  const prefix = `${aepRelative}/efforts/`;

  const named = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = named === null || named.trim() === 'HEAD' ? null : named.trim();

  const base = resolveBase(repo);
  const content = claimOfRef(repo, base, prefix);
  const claim = content.length > 0 ? content : claimFromName(branch, treeIndex(root));

  const working = workingSet(repo, prefix);
  if (working === null) return null;

  const isolation = isolationOf(repo);
  // Git lists the main worktree first. Absent it, the surface cannot be placed
  // and resolves to `unknown`, which refuses nothing.
  const surface = surfaceOf(repo, isolation.worktrees[0]?.path ?? null, aepRelative);

  return { base, branch, claim, working, surface, role: ROLES[surface.kind], isolation };
}

/** Everything in the working set the claim does not cover, sorted. */
function outsideTheClaim(scope) {
  if (scope.claim.length === 0) return [];
  const outside = [];
  for (const [effort, paths] of scope.working) {
    if (!scope.claim.includes(effort)) outside.push(...paths);
  }
  return outside.sort();
}

const COLUMN = 11;

function field(label, value) {
  return `${label.padEnd(COLUMN - 1)} ${value}\n`;
}

/**
 * The surface, and where it is unless the kind has already said.
 *
 * The main checkout needs no path: it is the one surface a reader can identify
 * without being told where it is.
 */
function surfaceLine(surface) {
  if (surface.kind === 'main' || !surface.path) return surface.kind;
  return `${surface.kind} at ${surface.path}`;
}

/**
 * The role, carrying what it is a role over.
 *
 * Two lines rather than a clause on `isolation`, which already carries a kind,
 * an enforcement, a sibling count and a path. A fifth clause makes it unreadable
 * at exactly the moment a human is scanning for where they are.
 */
function roleLine(role, surface) {
  if (surface.ticket) return `${role} on ${surface.ticket} for ${surface.effort}`;
  return surface.effort ? `${role} of ${surface.effort}` : role;
}

function renderRead(scope) {
  const { kind, enforcement, count, siblings } = scope.isolation;
  const touched = [...scope.working.keys()].sort();

  let out = '';
  out += field('claim', scope.claim.length > 0 ? scope.claim.join(', ') : 'unscoped');
  out += field('working', touched.length > 0 ? touched.join(', ') : '-');
  // Above the isolation, because these are what a reader acts on and the
  // isolation is what they were derived from.
  out += field('surface', surfaceLine(scope.surface));
  out += field('role', roleLine(scope.role, scope.surface));
  out += field('isolation', siblings.length > 0
    ? `${kind}, ${enforcement}, sibling of ${count} at ${scope.isolation.path}`
    : `${kind}, ${enforcement}`);
  // Each sibling and what it holds, because a claim held by another thread is
  // actionable only with the place it is held.
  for (const sibling of siblings) {
    out += `${' '.repeat(COLUMN)}${sibling.branch} at ${sibling.path}\n`;
  }
  out += field('base', scope.base ?? 'unknown');
  return out;
}

function renderJson(scope) {
  const { kind, enforcement, path: self, count, siblings } = scope.isolation;
  return `${JSON.stringify({
    claim: scope.claim,
    working: [...scope.working.keys()].sort(),
    // `path` is relative to the main checkout for a surface AEP created under
    // it, which is how a reader recognises one, and absolute otherwise, because
    // a surface outside the main checkout has no relative spelling.
    surface: scope.surface,
    role: scope.role,
    isolation: { kind, enforcement, path: self, count, siblings },
    base: scope.base,
  }, null, 2)}\n`;
}

function main() {
  const args = process.argv.slice(2);
  const command = args.find((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--root') ?? 'read';
  const rootArg = args.includes('--root') ? args[args.indexOf('--root') + 1] : null;

  if (command !== 'read' && command !== 'check') {
    process.stderr.write(`unknown command "${command}". Expected read or check\n`);
    process.exit(2);
  }

  const root = resolveAepRoot(rootArg, import.meta.url);
  if (!root) {
    // Naming the root that was given rather than repeating the generic advice.
    // A `--root` that does not resolve is refused rather than fallen back from,
    // so the useful thing to say is which one was refused.
    process.stderr.write(rootArg
      ? `not an AEP tree, so there is nothing to scope: ${rootArg}\n`
      : 'no .aep/ found. Pass --root, or run from a repository that has one\n');
    process.exit(2);
  }

  let scope = null;
  try {
    scope = resolveScope(root);
  } catch {
    scope = null;
  }
  if (!scope) {
    process.stderr.write('git could not read this tree, and scope is derived from git alone\n');
    process.exit(2);
  }

  if (command === 'read') {
    process.stdout.write(args.includes('--json') ? renderJson(scope) : renderRead(scope));
    process.exit(scope.claim.length > 0 ? 0 : 1);
  }

  if (scope.claim.length === 0) {
    process.stdout.write('unscoped. An empty claim takes any effort, so nothing is outside it\n');
    return;
  }

  const outside = outsideTheClaim(scope);
  if (outside.length === 0) {
    process.stdout.write(`nothing outside the claim ${scope.claim.join(', ')}\n`);
    return;
  }

  process.stdout.write(`outside the claim ${scope.claim.join(', ')}:\n`);
  for (const file of outside) process.stdout.write(`  ${file}\n`);
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
