#!/usr/bin/env node
// The AEP command line. Every git and worktree step a run takes goes through
// here, so the ordering rules live in one place: commit before release,
// detach before remove, every surface under the main checkout's worktrees.
//
//   node .aep/scripts/aep.mjs status [--repos <dir>] [--json]
//   node .aep/scripts/aep.mjs open <slug> --lane <quick|standard|full> [--number <n>]
//   node .aep/scripts/aep.mjs start [<effort>|<effort>/<ticket>]
//   node .aep/scripts/aep.mjs dispatch <effort> <ticket>...
//   node .aep/scripts/aep.mjs land <effort> [<ticket>] --message <text> [--session <id>]
//   node .aep/scripts/aep.mjs close <effort> [--stop <reason>] [--friction <line>]... [--session <id>]
//   node .aep/scripts/aep.mjs release <effort>
//   node .aep/scripts/aep.mjs yield [<effort>] [--session <id>]
//   node .aep/scripts/aep.mjs raise <effort> <lane> --reason <text>
//   node .aep/scripts/aep.mjs record <effort> --converge|--review|--note|--needs-you <line> [--at <commit>]
//   node .aep/scripts/aep.mjs check [--root <tree>]
//
// Every command but status and check prints one JSON object carrying a
// `summary`; status prints a board, or JSON with --json. Every command is safe
// to run twice: a step already taken is reported, not taken again.
//
// git is the only program it starts, apart from the repository's own `setup:`
// command, which it runs in a new surface because the repository asked for it.
// It never calls a forge. Where the tracker is on, it lists the forge steps for
// the run to take.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  LANES,
  LANE_RULES,
  parseFrontmatterBlock,
  readArtifact,
  resolveAepRoot,
  toPosix,
} from './contract.mjs';
import { frontier, readTickets } from './frontier.mjs';
import { writeIndex } from './index.mjs';
import { checkMarker, stampMarker } from './position.mjs';
import { resolveBase, resolveScope } from './scope.mjs';
import { runChecks } from './check.mjs';
import { validateTree } from './validate.mjs';

// --- git ----------------------------------------------------------------------

class Stop extends Error {
  constructor(reason, extra = {}) {
    super(reason);
    this.extra = extra;
  }
}

function git(cwd, args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    }).replace(/\s+$/, '');
  } catch (error) {
    if (allowFail) return null;
    const detail = String(error.stderr ?? error.message).trim().split(/\r?\n/).slice(-3).join(' ');
    throw new Stop(`git ${args.join(' ')} failed: ${detail}`);
  }
}

function same(a, b) {
  const norm = (value) => path.resolve(value).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

function worktreeList(repo) {
  const out = git(repo, ['worktree', 'list', '--porcelain'], { allowFail: true }) ?? '';
  const list = [];
  let current = null;
  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      current = { path: path.resolve(line.slice(9).trim()), branch: null, detached: false };
      list.push(current);
    } else if (current && line.startsWith('branch ')) {
      current.branch = line.slice(7).trim().replace(/^refs\/heads\//, '');
    } else if (current && line === 'detached') {
      current.detached = true;
    }
  }
  return list;
}

function branchExists(repo, branch) {
  return git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { allowFail: true }) !== null;
}

function dirtyPaths(surface) {
  const out = git(surface, ['status', '--porcelain', '-z', '--untracked-files=all']) ?? '';
  const records = out.split('\0').filter(Boolean);
  const paths = [];
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    paths.push(record.slice(3));
    if (/[RC]/.test(record.slice(0, 2))) i += 1;
  }
  return paths.sort();
}

// --- where things are -----------------------------------------------------------

/** The repository this run stands in, its main checkout, and where `.aep/` sits in both. */
function locate(root) {
  const repo = git(path.dirname(root), ['rev-parse', '--show-toplevel']);
  const inner = git(path.dirname(root), ['rev-parse', '--show-prefix']);
  const aepRel = `${inner}${path.basename(root)}`.replace(/\/+$/, '');
  const main = worktreeList(repo)[0]?.path ?? repo;
  return { repo: path.resolve(repo), main, aepRel, root };
}

function aepIn(tree, where) {
  return path.join(tree, ...where.aepRel.split('/'));
}

function runSurface(where, effort) {
  return path.join(aepIn(where.main, where), 'worktrees', effort, '_run');
}

function ticketSurface(where, effort, stem) {
  return path.join(aepIn(where.main, where), 'worktrees', effort, stem);
}

/**
 * A ticket's branch. `--`, not `/`: git cannot create `<effort>/<ticket>`
 * while the effort branch `<effort>` exists.
 */
function ticketBranch(effort, stem) {
  return `${effort}--${stem}`;
}

function rel(where, absolute) {
  return path.relative(where.main, absolute).replace(/\\/g, '/');
}

// --- settings ---------------------------------------------------------------------

/** Who sets up a surface the runtime supplied. `auto` asks `RUNTIME_SETUP`. */
export const RUNTIME_SETUP_MODES = ['auto', 'aep', 'runtime'];

/**
 * `tracker`, `setup`, `stack`, and `runtimeSetup`, read from the repository's
 * version-control rule.
 */
export function readSettings(root) {
  const file = path.join(root, 'rules', 'version-control.md');
  const fields = fs.existsSync(file) ? readArtifact(file).fields : {};
  const tracker = ['github', 'gitlab'].includes(fields.tracker) ? fields.tracker : 'none';
  const setup = typeof fields.setup === 'string' ? fields.setup.trim() : '';
  const stack = fields.stack === true || fields.stack === 'true';
  const runtimeSetup = RUNTIME_SETUP_MODES.includes(fields['runtime-setup']) ? fields['runtime-setup'] : 'auto';
  return { tracker, setup, stack, runtimeSetup };
}

/**
 * Runtimes that run their own setup when they create a worktree, as data: the
 * file a human writes, and the key that declares the script. This is the one
 * place a runtime is named. The key is matched at any depth, so a runtime that
 * moves it inside its file still matches. A runtime that renames it is what
 * `runtime-setup:` in rules/version-control is for: the repository answers,
 * and no AEP release is needed.
 */
export const RUNTIME_SETUP = [
  { runtime: 'T3 Code', file: 't3.json', key: 'runOnWorktreeCreate' },
];

/**
 * The runtimes AEP knows how to drive, as data: the environment that detects
 * each, the variables that carry its session id, and the reference holding its
 * playbook. The first match wins, so a runtime that starts another is listed
 * before it: T3 Code starts Claude Code, and both mark the process.
 */
export const RUNTIMES = [
  {
    name: 'T3 Code',
    reference: 't3code',
    detect: [{ env: 'T3CODE_THREAD_ID' }, { env: 'CLAUDE_CODE_ENTRYPOINT', equals: 't3-code' }, { prefix: 'T3_ACP_MCP_' }, { prefix: 'T3_MCP_' }],
    session: ['T3CODE_THREAD_ID', 'CLAUDE_CODE_SESSION_ID'],
  },
  {
    name: 'Claude Code',
    reference: 'claude-code',
    detect: [{ env: 'CLAUDECODE', equals: '1' }],
    session: ['CLAUDE_CODE_SESSION_ID'],
  },
];

/** The runtime this process runs under, from `RUNTIMES`, or null. */
export function detectRuntime(env = process.env) {
  const hit = (rule) => {
    if (rule.prefix) return Object.keys(env).some((name) => name.startsWith(rule.prefix));
    const value = env[rule.env];
    return rule.equals === undefined ? Boolean(value) : value === rule.equals;
  };
  const runtime = RUNTIMES.find((entry) => entry.detect.some(hit));
  if (!runtime) return null;
  const sessionVar = runtime.session.find((name) => env[name]);
  return { name: runtime.name, reference: runtime.reference, session: sessionVar ? env[sessionVar] : null };
}

/** The session a command runs for: `--session`, or the runtime's own id. */
function sessionOf(args, env = process.env) {
  return args.flags.session ?? detectRuntime(env)?.session ?? null;
}

// --- leases ------------------------------------------------------------------------------

/**
 * A lease names the session working in a surface. Nothing in git or in a
 * runtime says whether a live session stands in a worktree, and a runtime can
 * bind a second thread to one without checking, so the surface records it. It
 * is advisory: it never locks a file, and one left by a crashed session goes
 * stale after `LEASE_STALE_MINUTES`.
 */
export const LEASE_STALE_MINUTES = 60;

function leaseFile(aepDir) {
  return path.join(aepDir, 'scratch', 'lease.json');
}

export function readLease(aepDir) {
  try {
    return JSON.parse(fs.readFileSync(leaseFile(aepDir), 'utf8'));
  } catch {
    return null;
  }
}

/** `none`, `mine`, `stale`, or `live` (another session's, still renewed). */
export function leaseState(lease, session, now = Date.now()) {
  if (!lease) return 'none';
  if (session && lease.session === session) return 'mine';
  const age = now - Date.parse(lease.renewed ?? 0);
  return Number.isFinite(age) && age < LEASE_STALE_MINUTES * 60_000 ? 'live' : 'stale';
}

function writeLease(aepDir, lease) {
  fs.mkdirSync(path.dirname(leaseFile(aepDir)), { recursive: true });
  fs.writeFileSync(leaseFile(aepDir), `${JSON.stringify({ ...lease, renewed: new Date().toISOString() })}\n`, 'utf8');
}

/** Renews the caller's own lease; anyone else's is left alone. */
export function renewLease(aepDir, session) {
  const lease = readLease(aepDir);
  if (!session || leaseState(lease, session) !== 'mine') return false;
  writeLease(aepDir, lease);
  return true;
}

/** Gives a lease up: the caller's own, or a stale one. A live one stays. */
export function yieldLease(aepDir, session) {
  const lease = readLease(aepDir);
  const state = leaseState(lease, session);
  if (state === 'none') return { yielded: false, reason: 'no lease here' };
  if (state === 'live') return { yielded: false, reason: `held by another session, ${lease.session}`, held_by: lease };
  fs.rmSync(leaseFile(aepDir), { force: true });
  return { yielded: true, reason: state === 'mine' ? 'this session\'s lease' : 'a stale lease' };
}

/**
 * Stops where another session's live lease holds the surface, and returns the
 * lease found, so the commands that take or remove a surface share one guard.
 */
function guardLease(aepDir, effort, surface, session) {
  const held = readLease(aepDir);
  if (leaseState(held, session) === 'live') {
    throw new Stop(`${effort} is being worked on by another session at ${surface} (${held.runtime ?? 'unknown runtime'}, session ${held.session}), active ${minutesSince(held.renewed)} minutes ago. Its lease goes stale after ${LEASE_STALE_MINUTES} minutes`, {
      held_by: held, surface,
    });
  }
  return held;
}

function minutesSince(iso) {
  return Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
}

/** True where `key` is set truthy on any object inside `value`. */
function declares(value, key) {
  if (Array.isArray(value)) return value.some((item) => declares(item, key));
  if (!value || typeof value !== 'object') return false;
  if (Object.hasOwn(value, key) && value[key]) return true;
  return Object.values(value).some((item) => declares(item, key));
}

/**
 * Why AEP's `setup:` does not run in a surface the runtime supplied, or null
 * where it does. `aep` always runs it; `runtime` never does; `auto` defers
 * where a known runtime file in the surface declares a worktree setup.
 */
export function runtimeSetupOwner(settings, surface) {
  if (settings.runtimeSetup === 'aep') return null;
  if (settings.runtimeSetup === 'runtime') {
    return 'rules/version-control sets runtime-setup: runtime, so the runtime set this surface up';
  }
  for (const entry of RUNTIME_SETUP) {
    const file = path.join(surface, entry.file);
    if (!fs.existsSync(file)) continue;
    let data;
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    if (declares(data, entry.key)) {
      return `${entry.runtime} runs its own worktree setup: ${entry.file} declares ${entry.key}`;
    }
  }
  return null;
}

const LOCKFILES = [
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock', 'Cargo.lock',
  'poetry.lock', 'uv.lock', 'Pipfile.lock', 'go.sum', 'Gemfile.lock', 'composer.lock', 'deno.lock',
];

function lockfileHash(tree) {
  const hash = crypto.createHash('sha256');
  for (const name of LOCKFILES) {
    const file = path.join(tree, name);
    if (fs.existsSync(file)) hash.update(name).update('\0').update(fs.readFileSync(file));
  }
  return hash.digest('hex');
}

/**
 * Runs the repository's own `setup:` command in a surface, and records the
 * lockfile it ran against in that surface's scratch. With `whenChanged`, it
 * runs only where the lockfiles moved since the last run.
 *
 * With `runtime`, the surface is one the runtime supplied. Where the runtime
 * set it up itself, the first warm records the lockfiles as they stand and
 * runs nothing, so setup does not run twice; a lockfile change after that runs
 * `setup:` as in any surface, because the runtime only sets up at creation.
 */
function warm(where, settings, surface, { whenChanged = false, runtime = false } = {}) {
  const mode = settings.runtimeSetup;
  if (!settings.setup) return { ran: false, mode, reason: 'no setup command' };
  const record = path.join(aepIn(surface, where), 'scratch', 'setup.json');
  const hash = lockfileHash(surface);
  let previous = null;
  if (fs.existsSync(record)) {
    try {
      previous = JSON.parse(fs.readFileSync(record, 'utf8'));
    } catch {
      // An unreadable record is the same as none: run it.
    }
  }
  if (whenChanged && previous?.lockfiles === hash) return { ran: false, mode, reason: 'lockfiles unchanged' };
  const write = (fields) => {
    fs.mkdirSync(path.dirname(record), { recursive: true });
    fs.writeFileSync(record, `${JSON.stringify({ lockfiles: hash, command: settings.setup, ...fields })}\n`, 'utf8');
  };
  let reason = 'AEP made this surface';
  if (runtime && previous) reason = 'the lockfiles changed since this surface was set up';
  else if (runtime) {
    const owner = runtimeSetupOwner(settings, surface);
    if (owner) {
      write({ by: 'runtime' });
      return { ran: false, deferred: true, mode, reason: owner };
    }
    reason = mode === 'aep'
      ? 'rules/version-control sets runtime-setup: aep'
      : 'the runtime declares no worktree setup of its own';
  }
  const outcome = runSetup(settings.setup, surface);
  if (outcome.ok) write({});
  return { ran: true, mode, reason, command: settings.setup, ...outcome };
}

/** The one process start that is not git: the command the repository wrote into `setup:`. */
function runSetup(command, cwd) {
  const result = spawnSync(command, { cwd, shell: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const tail = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split(/\r?\n/).slice(-5).join('\n');
  return { ok: result.status === 0, status: result.status, tail };
}

// --- effort files -------------------------------------------------------------------

function setField(text, field, value) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return `---\n${field}: ${value}\n---\n\n${text}`;
  const block = match[1];
  const line = new RegExp(`^${field}:.*$`, 'm');
  const next = line.test(block) ? block.replace(line, `${field}: ${value}`) : `${block}\n${field}: ${value}`;
  return text.replace(block, next);
}

function readSpec(effortDir) {
  const file = path.join(effortDir, 'spec.md');
  if (!fs.existsSync(file)) throw new Stop(`no spec.md in ${effortDir}`);
  const artifact = readArtifact(file);
  const lane = LANES.includes(artifact.fields.lane) ? artifact.fields.lane : 'full';
  return { file, fields: artifact.fields, body: artifact.body, lane, status: artifact.fields.status };
}

const LOG_HEADER = (effort) => [
  '---',
  'use-when: "resuming this effort, or asking where it stands"',
  '---',
  '',
  `# Run log: ${effort}`,
  '',
  '## Ledger',
  '',
  '## Rounds',
  '',
  '## Recorded',
  '',
  '## Needs you',
  '',
].join('\n');

function logFile(effortDir) {
  return path.join(effortDir, 'log.md');
}

function ensureLog(effortDir, effort) {
  const file = logFile(effortDir);
  if (!fs.existsSync(file)) fs.writeFileSync(file, LOG_HEADER(effort), 'utf8');
  return file;
}

/** Appends a line at the end of one `## <heading>` section of the log. */
function appendToLog(effortDir, effort, heading, line) {
  const file = ensureLog(effortDir, effort);
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const start = lines.findIndex((entry) => entry.trim() === `## ${heading}`);
  if (start === -1) {
    fs.writeFileSync(file, `${text.replace(/\n*$/, '\n')}\n## ${heading}\n\n${line}\n`, 'utf8');
    return;
  }
  let end = lines.findIndex((entry, index) => index > start && entry.startsWith('## '));
  if (end === -1) end = lines.length;
  let insert = end;
  while (insert > start + 1 && lines[insert - 1].trim() === '') insert -= 1;
  if (lines.slice(start + 1, end).includes(line)) return;
  lines.splice(insert, 0, ...(insert === start + 1 ? ['', line] : [line]));
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
}

/** One section of the log, as its non-empty lines. */
export function logSection(text, heading) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((entry) => entry.trim() === `## ${heading}`);
  if (start === -1) return [];
  const out = [];
  for (let i = start + 1; i < lines.length && !lines[i].startsWith('## '); i += 1) {
    if (lines[i].trim() !== '') out.push(lines[i].trim());
  }
  return out;
}

/**
 * A review round is clear when nothing it found blocks. The fix to an Important
 * finding is reviewed again, within the lane's cap; a Nit or a Pre-existing
 * finding starts no round.
 */
const REVIEW_CLEAR = /\b(?:0|no) (?:important )?findings?\b|\b0 important\b|\bnothing to fix\b/i;

/**
 * The rounds the log records. A line reads `converge 1: no gap`,
 * `converge 1: gap, tickets 05 06`, `review 1: 3 findings, 3 fixed`,
 * `review 2: no findings`. A review line ends `(reviewed <commit>)`, the commit
 * that round judged, so the next round reads only what changed since.
 */
export function readRounds(text) {
  const rounds = { converge: [], review: [] };
  for (const line of logSection(text, 'Rounds')) {
    const match = /^(converge|review)\s+(\d+):\s*(.*)$/i.exec(line.replace(/^[-*]\s*/, ''));
    if (!match) continue;
    const kind = match[1].toLowerCase();
    const reviewed = /\s*\(reviewed ([0-9a-f]{7,40})\)\s*$/i.exec(match[3]);
    const result = reviewed ? match[3].slice(0, reviewed.index) : match[3];
    rounds[kind].push({
      round: Number(match[2]),
      result,
      reviewed: reviewed ? reviewed[1] : null,
      clear: kind === 'converge' ? /\bno gap\b/i.test(result) : REVIEW_CLEAR.test(result),
    });
  }
  return rounds;
}

function criteriaOf(text) {
  const section = /^##?\s+(?:Acceptance Criteria|Check)\s*$([\s\S]*?)(?=^#{1,2}\s|(?![\s\S]))/im.exec(text);
  const body = section ? section[1] : '';
  const ticked = (body.match(/^\s*-\s*\[x\]/gim) ?? []).length;
  const open = (body.match(/^\s*-\s*\[ \]/gm) ?? []).length;
  return { ticked, open, total: ticked + open };
}

function ticketFile(effortDir, id) {
  const dir = path.join(effortDir, 'tickets');
  if (!fs.existsSync(dir)) return null;
  const want = String(id).replace(/\.md$/, '');
  const name = fs.readdirSync(dir).find((entry) =>
    entry.endsWith('.md') && (entry === `${want}.md` || entry.startsWith(`${want.split('-')[0]}-`)));
  return name ? path.join(dir, name) : null;
}

// --- finding the effort -------------------------------------------------------------

/**
 * Every effort a local branch holds, as effort -> the branches holding it.
 *
 * The effort is the directory; the branch is whatever the repository or the
 * runtime called it. A branch named for its effort is that effort's, with no
 * diff. Every other branch holds the efforts whose `spec.md` its own commits
 * add, so a runtime-named branch such as `feat/x` resolves as well as
 * `12-csv-export` does. Adding is the test, not touching: a later branch that
 * edits a merged effort's files does not hold it again. The default branch
 * holds nothing, even with an effort merged into it and not yet pushed. A
 * ticket branch, `<effort>--<ticket>`, carries its effort's commits and is
 * never its branch.
 */
function effortIndex(where) {
  const refs = (git(where.repo, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], { allowFail: true }) ?? '')
    .split(/\r?\n/).filter(Boolean);
  const prefix = `${where.aepRel}/efforts/`;
  const hasSpec = (branch, effort) =>
    git(where.repo, ['cat-file', '-e', `${branch}:${prefix}${effort}/spec.md`], { allowFail: true }) !== null;

  const index = new Map();
  const named = new Set(refs.filter((name) => !name.includes('/') && hasSpec(name, name)));
  for (const name of named) index.set(name, [{ branch: name, claims: 1 }]);

  const base = resolveBase(where.repo);
  const baseName = base ? base.replace(/^origin\//, '') : null;
  for (const name of refs) {
    if (named.has(name) || name === base || name === baseName) continue;
    const claim = effortsAddedBy(where, base, prefix, name);
    for (const effort of claim) {
      if (named.has(effort) || name.startsWith(`${effort}--`) || !hasSpec(name, effort)) continue;
      index.set(effort, [...(index.get(effort) ?? []), { branch: name, claims: claim.length }]);
    }
  }
  return index;
}

/** The efforts whose `spec.md` a branch's own commits add, from the merge base. */
function effortsAddedBy(where, base, prefix, ref) {
  if (!base) return [];
  const diff = git(where.repo, ['diff', '--name-only', '--diff-filter=A', `${base}...${ref}`, '--', prefix], { allowFail: true });
  if (!diff) return [];
  const added = new Set();
  for (const line of diff.split(/\r?\n/)) {
    const file = line.trim();
    if (!file.startsWith(prefix)) continue;
    const parts = file.slice(prefix.length).split('/');
    if (parts.length === 2 && parts[1] === 'spec.md') added.add(parts[0]);
  }
  return [...added];
}

/**
 * A stop for a branch another worktree holds. The main checkout is never an
 * effort's surface, so a branch checked out there is switched back, not
 * continued in; any other holder is where the work continues.
 */
function heldElsewhere(where, effort, branch, holderPath) {
  if (same(holderPath, where.main)) {
    const base = resolveBase(where.repo);
    return new Stop(`the main checkout has ${branch}, the branch of ${effort}, checked out. The main checkout is never an effort's surface: switch it back to ${base ? base.replace(/^origin\//, '') : 'the default branch'}, then run this again`, {
      held: holderPath,
    });
  }
  return new Stop(`the ${branch} branch of ${effort} is held by another surface, a runtime's worktree at ${holderPath}. A claim held elsewhere is not taken, and AEP never removes a runtime's worktree: if no run is working there, continue in that directory, or end that thread in its runtime`, {
    held: holderPath,
    continue_in: holderPath,
  });
}

/**
 * The one branch holding an effort, from the index. Where several do, the
 * branch claiming the fewest efforts is the effort's own: a branch stacked on
 * it carries its commits too, and claims one effort more. A tie stops.
 */
function branchFrom(index, effort) {
  const holders = index.get(effort) ?? [];
  if (holders.length === 0) return null;
  const fewest = Math.min(...holders.map((holder) => holder.claims));
  const own = holders.filter((holder) => holder.claims === fewest);
  if (own.length > 1) {
    throw new Stop(`${effort} is held by more than one branch: ${own.map((holder) => holder.branch).join(', ')}. A claim held twice is not taken`, {
      branches: own.map((holder) => holder.branch),
    });
  }
  return own[0].branch;
}

/**
 * What each effort a spec's `builds-on:` names has become: `merged` where its
 * `spec.md` is on the default branch, `open` where a branch holds it, and a
 * stop otherwise. A name is the effort's directory or its number, which under
 * a tracker is the issue number. Merged wins over open, since a branch named
 * for an effort outlives its merge.
 */
function dependencies(where, index, names) {
  const list = Array.isArray(names) ? names.map(String) : names === undefined ? [] : [String(names)];
  if (list.length === 0) return [];
  const base = resolveBase(where.repo);
  const prefix = `${where.aepRel}/efforts/`;
  const merged = base
    ? (git(where.repo, ['ls-tree', '--name-only', `${base}:${prefix}`], { allowFail: true }) ?? '')
      .split(/\r?\n/).filter((name) => name && showAt(where.repo, base, `${prefix}${name}/spec.md`) !== null)
    : [];
  const pick = (pool, wanted) => {
    if (pool.includes(wanted)) return wanted;
    const byNumber = pool.filter((name) => name.startsWith(`${wanted}-`));
    if (byNumber.length > 1) throw new Stop(`builds-on names ${wanted}, which matches more than one effort: ${byNumber.join(', ')}`);
    return byNumber[0] ?? null;
  };
  return list.map((wanted) => {
    const done = pick(merged, wanted);
    if (done) return { effort: done, state: 'merged', branch: null };
    const open = pick([...index.keys()], wanted);
    if (open) return { effort: open, state: 'open', branch: branchFrom(index, open) };
    throw new Stop(`builds-on names ${wanted}, and no effort by that name or number is merged or held by a local branch. If it is open on another machine, fetch and check out its branch first`, { unknown: wanted });
  });
}

/** The effort a name or number means, and the branch holding it. */
function resolveEffort(where, wanted) {
  const index = effortIndex(where);
  const efforts = [...index.keys()];
  let effort = null;
  if (efforts.includes(wanted)) effort = wanted;
  else {
    const byNumber = efforts.filter((name) => name.startsWith(`${wanted}-`));
    if (byNumber.length > 1) throw new Stop(`${wanted} names more than one effort: ${byNumber.join(', ')}`);
    if (byNumber.length === 1) [effort] = byNumber;
  }
  if (!effort) throw new Stop(`no branch holds an effort named ${wanted}. Open it first: aep open <slug> --lane <lane>`);
  return { effort, branch: branchFrom(index, effort) };
}

/**
 * The worktree holding an effort's branch: `_run`, or a surface the runtime
 * supplied. Null where no worktree holds it. Every command that acts on an
 * effort acts here, so a run in the main checkout never writes the effort
 * there, and a runtime surface is found wherever the runtime put it.
 */
function homeOf(where, branch) {
  const holder = worktreeList(where.repo).find((tree) => tree.branch === branch);
  return holder ? holder.path : null;
}

/** `homeOf`, or a stop naming what to run where no worktree holds the branch. */
function requireHome(where, effort, branch) {
  const home = homeOf(where, branch);
  if (!home) throw new Stop(`no surface holds ${branch}, the branch of ${effort}. Run aep start ${effort} first`);
  return home;
}

/** The run surface for an effort, entered or created; never a second one. */
function enterSurface(where, effort, branch, scope) {
  if (scope && scope.surface.kind === 'run' && scope.surface.effort === effort) {
    return { surface: where.repo, entered: 'here' };
  }
  if (scope && scope.isolation.kind === 'worktree' && scope.surface.kind === 'runtime') {
    const current = git(where.repo, ['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true });
    if (current === branch) return { surface: where.repo, entered: 'runtime' };
  }
  const surface = runSurface(where, effort);
  const trees = worktreeList(where.repo);
  const atSurface = trees.find((tree) => same(tree.path, surface));
  const holder = trees.find((tree) => tree.branch === branch && !same(tree.path, surface));
  // Another runtime's worktree, most often one a previous session worked in.
  // AEP never takes or removes it; the run continues there, and the caller
  // moves into it. The main checkout is the one holder nothing continues in.
  if (holder) {
    if (same(holder.path, where.main)) throw heldElsewhere(where, effort, branch, holder.path);
    return { surface: holder.path, entered: 'elsewhere' };
  }
  if (atSurface) {
    if (atSurface.branch === branch) return { surface, entered: 're-entered' };
    if (atSurface.detached) {
      git(surface, ['switch', '--quiet', branch]);
      return { surface, entered: 're-entered' };
    }
    throw new Stop(`${rel(where, surface)} holds ${atSurface.branch}, not ${branch}`);
  }
  if (fs.existsSync(surface)) {
    throw new Stop(`${rel(where, surface)} exists but is not a worktree of this repository. Inspect it, then remove it`);
  }
  git(where.main, ['worktree', 'add', '--quiet', surface, branch]);
  return { surface, entered: 'created' };
}

// --- commands --------------------------------------------------------------------------

function nextNumber(where, index) {
  const numbers = [];
  const take = (name) => {
    const match = /^(\d+)-/.exec(name);
    if (match) numbers.push(Number(match[1]));
  };
  for (const tree of [where.main, where.repo]) {
    const dir = path.join(aepIn(tree, where), 'efforts');
    if (fs.existsSync(dir)) fs.readdirSync(dir).forEach(take);
  }
  (git(where.repo, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']) ?? '').split(/\r?\n/).forEach(take);
  // An effort on a runtime-named branch carries its number only in its directory.
  [...index.keys()].forEach(take);
  const worktrees = path.join(aepIn(where.main, where), 'worktrees');
  if (fs.existsSync(worktrees)) fs.readdirSync(worktrees).forEach(take);
  return numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
}

function open(root, args) {
  const where = locate(root);
  const settings = readSettings(root);
  const slug = args.positional[0];
  const lane = args.flags.lane;
  if (!slug) throw new Stop('usage: aep open <slug> --lane <quick|standard|full>');
  if (!LANES.includes(lane)) throw new Stop(`--lane must be one of: ${LANES.join(', ')}`);

  const index = effortIndex(where);
  const existing = [...index.keys()].find((name) => name.replace(/^\d+-/, '') === slug);
  if (existing) {
    const { surface, entered } = enterSurface(where, existing, branchFrom(index, existing), resolveScope(root));
    const spec = readSpec(path.join(aepIn(surface, where), 'efforts', existing));
    return {
      effort: existing, lane: spec.lane, surface, opened: 'already', entered,
      summary: `${existing} (${spec.lane}) is already open; ${entered} its surface at ${rel(where, surface)}`,
    };
  }

  // The draft is written to scratch, because nothing may be written in the main
  // checkout before a surface is taken. A 3.x draft under efforts/ is still found.
  const candidates = [
    path.join(root, 'scratch', slug),
    path.join(root, 'efforts', `xxxx-${slug}`),
  ];
  const draft = candidates.find((dir) => fs.existsSync(path.join(dir, 'spec.md')));
  if (!draft) throw new Stop(`no draft spec at ${toPosix(path.dirname(root), path.join(candidates[0], 'spec.md'))}. Write it there first`);

  if (settings.tracker !== 'none'
    && git(where.repo, ['ls-remote', '--heads', 'origin', `${args.flags.number ?? ''}-${slug}`], { allowFail: true })) {
    throw new Stop(`a remote branch for ${slug} already exists. A claim held elsewhere is not taken`);
  }
  const number = args.flags.number ? Number(args.flags.number) : nextNumber(where, index);
  if (!Number.isInteger(number) || number < 1) throw new Stop('--number must be a positive integer');
  const effort = `${number}-${slug}`;
  if (branchExists(where.repo, effort)) throw new Stop(`a branch named ${effort} already exists. A claim held elsewhere is not taken`);

  // What the effort builds on decides where it may start. Merged work is on the
  // base already. Unmerged work is stacked on, where the repository stacks, and
  // waited for otherwise; both stops come before anything is created, so the
  // draft stays in scratch.
  const needs = dependencies(where, index, readArtifact(path.join(draft, 'spec.md')).fields['builds-on']);
  // An open effort whose branch another named one already contains is carried
  // by that one: a chain is one edge to its tip.
  const open = needs.filter((need) => need.state === 'open');
  const contains = (outer, inner) => outer.branch !== inner.branch
    && git(where.repo, ['merge-base', '--is-ancestor', inner.branch, outer.branch], { allowFail: true }) !== null;
  const unmerged = open.filter((need) => !open.some((other) => contains(other, need)));
  const waitsOn = unmerged.map((need) => need.effort);
  if (unmerged.length > 1) {
    throw new Stop(`${slug} builds on ${waitsOn.join(' and ')}, and none of them has merged. A branch stacks on one effort: open ${slug} once all but one have merged`, { waits_on: waitsOn });
  }
  if (unmerged.length === 1 && !settings.stack) {
    throw new Stop(`${slug} builds on ${waitsOn[0]}, which has not merged, and rules/version-control sets stack: false. Open ${slug} once ${waitsOn[0]} merges`, { waits_on: waitsOn });
  }
  const onto = unmerged[0] ?? null;

  const base = onto ? onto.branch : settings.stack
    ? git(where.repo, ['rev-parse', '--abbrev-ref', 'HEAD'])
    : resolveBase(where.repo);
  if (!base || base === 'HEAD') throw new Stop('no base to branch from: no default branch was found, and HEAD is detached');

  // A surface the runtime supplied is the run's already, and so is its branch:
  // the effort is committed on the branch the runtime put there, because the
  // runtime records that branch for the thread and renaming away from it leaves
  // the runtime pointing at a branch nobody works on. Only a detached surface,
  // or one standing on the base itself, gets a branch of AEP's. Anywhere else,
  // branch and surface are created together, so the branch never exists unheld.
  const scope = resolveScope(root);
  const runtime = scope?.surface.kind === 'runtime';
  let surface;
  let branch = effort;
  if (runtime) {
    surface = where.repo;
    const dirty = dirtyPaths(surface);
    if (dirty.length > 0) throw new Stop(`this surface has uncommitted changes: ${dirty.join(', ')}. Commit, move, or discard them, then open again`);
    const current = scope.branch;
    const baseName = resolveBase(where.repo)?.replace(/^origin\//, '') ?? null;
    if (current && current !== baseName) {
      // The branch may carry the effort this one stacks on, with what that
      // effort's own branch carries, and nothing else.
      const carried = onto
        ? [onto.effort, ...effortsAddedBy(where, resolveBase(where.repo), `${where.aepRel}/efforts/`, onto.branch)]
        : [];
      const foreign = scope.claim.filter((effort) => !carried.includes(effort));
      if (foreign.length > 0) {
        throw new Stop(`this surface's branch ${current} already holds ${foreign.join(', ')}. One runtime thread is one effort: open ${slug} in a new thread`, {
          claim: scope.claim,
        });
      }
      if (onto && !scope.claim.includes(onto.effort)) {
        // A thread made from the base rather than from the effort it stacks on:
        // it gains that effort's commits by moving forward, never by rewriting.
        // A thread cut from a newer base has no commits of its own either, and
        // moves onto the effort's branch the same way.
        const own = baseName ? git(surface, ['rev-list', '--count', `${baseName}..HEAD`], { allowFail: true }) : null;
        const moved = git(surface, ['merge', '--quiet', '--ff-only', onto.branch], { allowFail: true }) !== null
          || (own === '0' && git(surface, ['reset', '--quiet', '--keep', onto.branch], { allowFail: true }) !== null);
        if (!moved) {
          throw new Stop(`${slug} stacks on ${onto.effort}, and ${current} cannot move forward to ${onto.branch} because it has commits of its own. Start the thread from ${onto.branch}`, { waits_on: [onto.effort] });
        }
      }
      branch = current;
    } else {
      git(surface, ['switch', '--quiet', '-c', effort, base]);
    }
  } else {
    surface = runSurface(where, effort);
    if (fs.existsSync(surface)) throw new Stop(`${rel(where, surface)} already exists. Inspect it, then remove it`);
    git(where.main, ['worktree', 'add', '--quiet', '-b', effort, surface, base]);
  }

  const into = path.join(aepIn(surface, where), 'efforts', effort);
  fs.mkdirSync(path.dirname(into), { recursive: true });
  fs.cpSync(draft, into, { recursive: true });
  const specFile = path.join(into, 'spec.md');
  if (!fs.existsSync(specFile)) throw new Stop(`the draft has no spec.md: ${draft}`);
  fs.writeFileSync(specFile, setField(fs.readFileSync(specFile, 'utf8'), 'lane', lane), 'utf8');
  ensureLog(into, effort);
  const adopted = branch !== effort;
  const basis = adopted
    ? `${branch}, the branch the runtime supplied`
    : onto ? `${base}, the branch of ${onto.effort}, which it builds on`
      : settings.stack ? `${base}, the current branch, because rules/version-control sets stack: true` : base;
  appendToLog(into, effort, 'Recorded', adopted
    ? `- opened in the ${lane} lane, on ${basis}`
    : `- opened in the ${lane} lane, from ${basis}`);
  if (needs.length > 0) {
    appendToLog(into, effort, 'Recorded', `- builds on ${needs.map((need) => `${need.effort} (${need.state === 'open' ? 'stacked on' : 'merged'})`).join(', ')}`);
  }
  writeIndex(aepIn(surface, where));
  git(surface, ['add', '-A']);
  git(surface, ['commit', '--quiet', '-m', `docs(${effort}): open the effort`]);
  fs.rmSync(draft, { recursive: true, force: true });
  if (draft === candidates[1]) writeIndex(root);

  const setup = warm(where, settings, surface, { runtime });
  const tracker = settings.tracker === 'none' ? [] : [
    `create the issue from ${where.aepRel}/efforts/${effort}/spec.md, and rename the effort to the issue number if it differs`,
    `push ${branch} and open a draft pull request carrying the run log`,
  ];
  if (settings.tracker !== 'none' && needs.length > 0) {
    tracker.push(`set each builds-on edge as a dependency of the issue, and name it in the pull request body: ${needs.map((need) => need.effort).join(', ')}`);
  }
  return {
    effort, lane, number, base, branch, adopted, surface, opened: 'created', setup, tracker,
    builds_on: needs.map(({ effort: name, state }) => ({ effort: name, state })),
    summary: runtime
      ? `opened ${effort} (${lane}) in the surface the runtime supplied, ${adopted ? 'on' : 'from'} ${basis}; no second surface taken`
      : `opened ${effort} (${lane}) on a new surface at ${rel(where, surface)}, from ${basis}`,
  };
}

function laneRules(lane) {
  return LANE_RULES[lane] ?? LANE_RULES.full;
}

function plan(where, effortDir, spec) {
  const rules = laneRules(spec.lane);
  const logText = fs.existsSync(logFile(effortDir)) ? fs.readFileSync(logFile(effortDir), 'utf8') : '';
  const rounds = readRounds(logText);
  const roundState = {
    converge: { done: rounds.converge.length, cap: rules.converge, clear: rounds.converge.at(-1)?.clear ?? false },
    review: { done: rounds.review.length, cap: rules.review, clear: rounds.review.at(-1)?.clear ?? false },
  };

  let ready = [];
  let blocked = {};
  let parked = [];
  let unresolved = 0;
  if (rules.tickets && fs.existsSync(path.join(effortDir, 'tickets'))) {
    const tickets = readTickets(path.dirname(path.dirname(effortDir)), path.basename(effortDir));
    const result = frontier(tickets, []);
    ready = result.ready.map((ticket) => `${ticket.id}-${ticket.slug}`);
    blocked = Object.fromEntries(result.blocked.map((ticket) => [`${ticket.id}-${ticket.slug}`, ticket.waiting]));
    parked = result.parked.map((ticket) => `${ticket.id}-${ticket.slug}`);
    unresolved = result.ready.length + result.blocked.length + result.parked.length;
  }

  let next;
  if (spec.status === 'implemented') next = 'close';
  else if (!rules.tickets) next = 'build';
  else if (ready.length > 0) next = 'build';
  else if (unresolved > 0) next = 'blocked';
  else if (!roundState.converge.clear && roundState.converge.done < roundState.converge.cap) next = 'converge';
  else if (roundState.review.cap > 0 && !roundState.review.clear && roundState.review.done < roundState.review.cap) next = 'review';
  else next = 'close';

  const waveOf = rules.children && ready.length >= 2 ? 'dispatch' : 'here';
  return { ready, blocked, parked, rounds: roundState, next, build: waveOf, needsYou: logSection(logText, 'Needs you') };
}

function start(root, args) {
  const where = locate(root);
  const settings = readSettings(root);
  const scope = resolveScope(root);
  if (!scope) throw new Stop('git could not read this tree');

  if (scope.role === 'implementer') {
    const effortDir = path.join(root, 'efforts', scope.surface.effort);
    const file = ticketFile(effortDir, scope.surface.ticket);
    return {
      role: 'implementer', effort: scope.surface.effort, ticket: scope.surface.ticket, surface: where.repo,
      ticket_file: file ? toPosix(path.dirname(root), file) : null, dirty: dirtyPaths(where.repo),
      summary: `implementer for ${scope.surface.ticket} of ${scope.surface.effort}: build that ticket here, integrate nothing`,
    };
  }

  let wanted = args.positional[0] ?? null;
  let onlyTicket = null;
  if (wanted && wanted.includes('/')) [wanted, onlyTicket] = wanted.split('/');
  if (!wanted) {
    if (scope.claim.length === 1) [wanted] = scope.claim;
    else if (scope.claim.length > 1) throw new Stop(`this branch claims more than one effort: ${scope.claim.join(', ')}. Name one`, { claim: scope.claim });
    else throw new Stop('nothing to start: name an effort, or open one with aep open');
  }
  const { effort, branch } = resolveEffort(where, wanted);
  const { surface, entered } = enterSurface(where, effort, branch, scope);

  // One session per surface. Another session's live lease stops this one;
  // a stale one is taken over; without a session id nothing is taken. The
  // lease is taken only by a session standing in the surface: one that has
  // still to move may hand the surface to another session, such as a thread it
  // launches there, and a lease taken from outside is one no hook renews.
  const session = sessionOf(args);
  const runtime = detectRuntime();
  const held = guardLease(aepIn(surface, where), effort, surface, session);
  const move = !same(surface, where.repo);

  const effortDir = path.join(aepIn(surface, where), 'efforts', effort);
  const spec = readSpec(effortDir);
  const dirty = dirtyPaths(surface);
  let lease = 'none: no session id';
  if (move) lease = 'none: taken once the session stands in the surface';
  else if (dirty.length > 0) lease = 'none: the surface is dirty';
  else if (session) {
    writeLease(aepIn(surface, where), { session, runtime: runtime?.name ?? null });
    lease = { none: 'taken', mine: 'renewed', stale: `taken over from ${held?.session}` }[leaseState(held, session)];
  }
  const marker = checkMarker(aepIn(surface, where));
  const state = plan(where, effortDir, spec);
  if (onlyTicket) {
    const match = state.ready.find((stem) => stem === onlyTicket || stem.startsWith(`${onlyTicket}-`));
    state.ready = match ? [match] : [];
    state.build = 'here';
  }
  const setup = dirty.length === 0
    ? warm(where, settings, surface, { whenChanged: true, runtime: entered === 'runtime' || entered === 'elsewhere' })
    : { ran: false, reason: 'dirty' };
  const stop = dirty.length > 0
    ? `the surface has uncommitted changes nobody can attribute: ${dirty.join(', ')}. Commit, move, or discard them, then start again`
    : null;
  const claim = scope.claim.length ? scope.claim.join(' ') : 'unscoped';
  const isolation = `${scope.isolation.kind}, ${scope.isolation.enforcement}`;
  const parts = [`${effort} (${spec.lane}, ${spec.status})`, `claim ${claim}`, `isolation ${isolation}`, `${entered} ${dirty.length ? 'dirty' : 'clean'} surface`];
  if (state.ready.length) parts.push(`${state.ready.length} ready`);
  if (Object.keys(state.blocked).length) parts.push(`${Object.keys(state.blocked).length} blocked`);
  parts.push(`next: ${stop ? 'stop' : state.next}`);
  if (move) parts.push(`move into ${surface}`);
  return {
    effort, branch, lane: spec.lane, status: spec.status, surface, entered, move, lease, session,
    runtime: runtime ? { name: runtime.name, reference: `${where.aepRel}/references/${runtime.reference}.md` } : null,
    role: 'orchestrator', claim: scope.claim, isolation,
    dirty, drift: !marker.matches, marker: marker.message,
    frontier: state.ready, blocked: state.blocked, parked: state.parked, wave: state.build,
    rounds: state.rounds, next: stop ? 'stop' : state.next, needs_you: state.needsYou,
    tracker: settings.tracker, setup, stop,
    summary: parts.join(', '),
  };
}

function dispatch(root, args) {
  const where = locate(root);
  const settings = readSettings(root);
  const [effortArg, ...ids] = args.positional;
  if (!effortArg || ids.length === 0) throw new Stop('usage: aep dispatch <effort> <ticket>...');
  const { effort, branch: effortBranch } = resolveEffort(where, effortArg);
  // The children branch from wherever the effort's branch is held, `_run` or a
  // surface the runtime supplied, and always stand under the main checkout's
  // worktrees, because their path is what makes them implementers.
  const surface = requireHome(where, effort, effortBranch);
  renewLease(aepIn(surface, where), sessionOf(args));
  const effortDir = path.join(aepIn(surface, where), 'efforts', effort);
  if (!fs.existsSync(effortDir)) throw new Stop(`${effort} is not in ${surface}. Run aep start ${effort} first`);
  const tip = git(surface, ['rev-parse', 'HEAD']);
  const trees = worktreeList(where.repo);

  const children = [];
  for (const id of ids) {
    const file = ticketFile(effortDir, id);
    if (!file) throw new Stop(`${effort} has no ticket ${id}`);
    const stem = path.basename(file, '.md');
    const branch = ticketBranch(effort, stem);
    const at = ticketSurface(where, effort, stem);
    const existing = trees.find((tree) => tree.branch === branch);
    if (existing && same(existing.path, at)) {
      children.push({ ticket: stem, branch, surface: at, created: false });
      continue;
    }
    if (existing || branchExists(where.repo, branch)) {
      children.push({ ticket: stem, branch, surface: existing?.path ?? null, held: true });
      continue;
    }
    if (settings.tracker !== 'none'
      && git(where.repo, ['ls-remote', '--heads', 'origin', branch], { allowFail: true })) {
      children.push({ ticket: stem, branch, held: 'remote' });
      continue;
    }
    git(where.main, ['worktree', 'add', '--quiet', '-b', branch, at, tip]);
    children.push({ ticket: stem, branch, surface: at, created: true });
  }
  for (const child of children) {
    if (child.surface && !child.held) child.setup = warm(where, settings, child.surface);
  }
  const held = children.filter((child) => child.held);
  return {
    effort, base: tip, children,
    summary: `${children.length - held.length} surface(s) ready for ${effort}${held.length ? `; held elsewhere, not taken: ${held.map((c) => c.ticket).join(', ')}` : ''}`,
  };
}

function commitAll(surface, message, { amend = false } = {}) {
  git(surface, ['add', '-A']);
  const staged = git(surface, ['diff', '--cached', '--name-only']);
  if (!staged && !amend) return null;
  git(surface, ['commit', '--quiet', ...(amend ? ['--amend'] : []), '-m', message]);
  return git(surface, ['rev-parse', '--short', 'HEAD']);
}

function land(root, args) {
  const where = locate(root);
  const [effortArg, ticketArg] = args.positional;
  const message = args.flags.message;
  if (!effortArg) throw new Stop('usage: aep land <effort> [<ticket>] --message <text>');
  const { effort, branch: effortBranch } = resolveEffort(where, effortArg);
  const here = requireHome(where, effort, effortBranch);
  renewLease(aepIn(here, where), sessionOf(args));
  const effortDir = path.join(aepIn(here, where), 'efforts', effort);
  const spec = readSpec(effortDir);
  const rules = laneRules(spec.lane);

  if (!ticketArg) {
    if (rules.tickets) throw new Stop(`${effort} is in the ${spec.lane} lane: land one ticket at a time`);
    const checks = criteriaOf(spec.body);
    if (checks.total === 0) throw new Stop('the spec\'s Check section lists nothing to verify');
    if (checks.open > 0) throw new Stop(`${checks.open} of ${checks.total} Check items are not ticked. Verify each and tick it with what verified it`);
    if (spec.status === 'implemented' && dirtyPaths(here).length === 0) {
      return { effort, landed: git(here, ['rev-parse', '--short', 'HEAD']), already: true, summary: `${effort} already landed` };
    }
    if (!message) throw new Stop('--message is required');
    fs.writeFileSync(spec.file, setField(fs.readFileSync(spec.file, 'utf8'), 'status', 'implemented'), 'utf8');
    appendToLog(effortDir, effort, 'Ledger', `[x] spec ${effort.replace(/^\d+-/, '')} ${checks.ticked}/${checks.total}`);
    writeIndex(aepIn(here, where));
    // The quick lane lands as one commit by construction: whatever the branch
    // gathered since it forked (the opening commit, a revised Check item) is
    // folded into the one commit that lands, never left beside it.
    const base = resolveBase(where.repo);
    const fork = base ? git(here, ['merge-base', base, 'HEAD'], { allowFail: true }) : '';
    const own = fork ? Number(git(here, ['rev-list', '--count', `${fork}..HEAD`])) : 0;
    if (own > 1) git(here, ['reset', '--quiet', '--soft', fork]);
    const sha = commitAll(here, message, { amend: own === 1 });
    stampMarker(aepIn(here, where), args.flags.session ?? null);
    return {
      effort, landed: sha, amended: own >= 1, ledger: `[x] spec ${checks.ticked}/${checks.total}`,
      summary: `landed ${effort} as one commit ${sha}`,
    };
  }

  const file = ticketFile(effortDir, ticketArg);
  if (!file) throw new Stop(`${effort} has no ticket ${ticketArg}`);
  const stem = path.basename(file, '.md');
  const branch = ticketBranch(effort, stem);
  const child = ticketSurface(where, effort, stem);
  const childTree = worktreeList(where.repo).find((tree) => tree.branch === branch);
  const ticket = readArtifact(file);

  const release = () => {
    const released = {};
    if (childTree) {
      if (dirtyPaths(childTree.path).length > 0) {
        throw new Stop(`the child surface for ${stem} has uncommitted work: ${dirtyPaths(childTree.path).join(', ')}. Releasing it would lose that work`);
      }
      git(where.main, ['worktree', 'remove', childTree.path]);
      released.surface = childTree.path;
    }
    if (branchExists(where.repo, branch)) {
      git(where.main, ['branch', '-D', branch]);
      released.branch = branch;
    }
    return released;
  };

  if (ticket.fields.status === 'resolved' && dirtyPaths(here).length === 0) {
    const released = release();
    stampMarker(aepIn(here, where), args.flags.session ?? null);
    return { effort, ticket: stem, already: true, released, summary: `${stem} was already landed; released what it still held` };
  }

  // Integrate the child's commits, squashed, unless a conflict is already resolved here.
  const squashing = fs.existsSync(path.join(git(here, ['rev-parse', '--absolute-git-dir']), 'SQUASH_MSG'));
  if (branchExists(where.repo, branch) && !squashing) {
    const ahead = Number(git(here, ['rev-list', '--count', `HEAD..${branch}`]));
    if (ahead > 0) {
      if (childTree && dirtyPaths(childTree.path).length > 0) {
        throw new Stop(`the child for ${stem} left uncommitted work: ${dirtyPaths(childTree.path).join(', ')}`);
      }
      const merged = git(here, ['merge', '--squash', '--no-commit', branch], { allowFail: true });
      if (merged === null) {
        const conflicts = (git(here, ['diff', '--name-only', '--diff-filter=U']) ?? '').split(/\r?\n/).filter(Boolean);
        throw new Stop(`integrating ${stem} conflicts in: ${conflicts.join(', ')}. Resolve them here, then run land again`, { conflicts });
      }
    }
  }
  const unmerged = (git(here, ['diff', '--name-only', '--diff-filter=U']) ?? '').split(/\r?\n/).filter(Boolean);
  if (unmerged.length > 0) throw new Stop(`unresolved conflicts: ${unmerged.join(', ')}`, { conflicts: unmerged });

  const current = fs.readFileSync(file, 'utf8');
  const checks = criteriaOf(readArtifact(file).body);
  if (checks.total === 0) throw new Stop(`${stem} lists no acceptance criteria`);
  if (checks.open > 0) {
    throw new Stop(`${checks.open} of ${checks.total} criteria of ${stem} are not ticked. Verify each and tick it with what verified it, or park the ticket`);
  }
  if (!message) throw new Stop('--message is required');
  fs.writeFileSync(file, setField(current, 'status', 'resolved'), 'utf8');
  const ledger = `[x] ${stem.replace(/^(\d+)-/, '$1 ')} ${checks.ticked}/${checks.total}`;
  appendToLog(effortDir, effort, 'Ledger', ledger);
  writeIndex(aepIn(here, where));
  const sha = commitAll(here, message);
  const released = release();
  stampMarker(aepIn(here, where), args.flags.session ?? null);
  return { effort, ticket: stem, landed: sha, ledger, released, summary: `landed ${stem} as ${sha}` };
}

function close(root, args) {
  const where = locate(root);
  const settings = readSettings(root);
  const [effortArg] = args.positional;
  if (!effortArg) throw new Stop('usage: aep close <effort> [--stop <reason>]');
  const { effort, branch } = resolveEffort(where, effortArg);
  const surface = runSurface(where, effort);
  // A close re-run after the detach finds `_run` holding no branch, and goes on
  // from there, so the command stays safe to run twice.
  const here = homeOf(where, branch) ?? (fs.existsSync(surface) ? surface : requireHome(where, effort, branch));
  // Any home but `_run` is a surface the runtime supplied. AEP made none of it,
  // so it detaches and removes nothing there.
  const runtime = !same(here, surface);
  guardLease(aepIn(here, where), effort, here, sessionOf(args));
  const effortDir = path.join(aepIn(here, where), 'efforts', effort);
  const spec = readSpec(effortDir);
  const rules = laneRules(spec.lane);
  const stopReason = args.flags.stop ?? null;
  const friction = [].concat(args.flags.friction ?? []).slice(0, 3);

  if (!stopReason) {
    const state = plan(where, effortDir, spec);
    const open = [...state.ready, ...Object.keys(state.blocked), ...state.parked];
    if (open.length > 0) throw new Stop(`unresolved tickets remain: ${open.join(', ')}. Build them, or close with --stop`);
    if (!rules.tickets && spec.status !== 'implemented') throw new Stop(`${effort} has not landed. Run aep land ${effort} first`);
  }
  const dirty = dirtyPaths(here).filter((file) => !file.startsWith(`${where.aepRel}/efforts/${effort}/`)
    && file !== `${where.aepRel}/friction.md` && file !== `${where.aepRel}/index.md`);
  if (dirty.length > 0) throw new Stop(`uncommitted changes outside the effort's records: ${dirty.join(', ')}`);

  if (stopReason) appendToLog(effortDir, effort, 'Needs you', `- stopped: ${stopReason}`);
  else if (spec.status !== 'implemented') {
    fs.writeFileSync(spec.file, setField(fs.readFileSync(spec.file, 'utf8'), 'status', 'implemented'), 'utf8');
  }
  if (friction.length > 0) {
    const file = path.join(aepIn(here, where), 'friction.md');
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, '---\nuse-when: "deciding what to change in AEP, between projects"\n---\n\n# Friction\n\n', 'utf8');
    }
    const stamp = new Date().toISOString().slice(0, 10);
    fs.appendFileSync(file, friction.map((line) => `- ${stamp} ${effort}: ${line}\n`).join(''), 'utf8');
  }
  writeIndex(aepIn(here, where));
  const amend = !rules.tickets && !stopReason;
  const sha = commitAll(here, stopReason ? `docs(${effort}): stopped` : amend
    ? git(here, ['log', '-1', '--format=%B'])
    : `docs(${effort}): close`, { amend: amend && dirtyPaths(here).length > 0 });
  stampMarker(aepIn(here, where), args.flags.session ?? null);
  // The run is over here, so its lease goes with it.
  yieldLease(aepIn(here, where), sessionOf(args));

  const outcome = { effort, closed: stopReason ? 'stopped' : 'clean', commit: sha };
  if (runtime) {
    outcome.surface = 'supplied by the runtime; nothing to release';
  } else {
    if (!worktreeList(where.repo).find((tree) => same(tree.path, surface))?.detached) {
      git(surface, ['switch', '--quiet', '--detach']);
    }
    outcome.detached = true;
    if (stopReason) {
      outcome.kept = surface;
    } else {
      const removed = git(where.main, ['worktree', 'remove', surface], { allowFail: true });
      outcome.removed = removed !== null;
      if (removed === null) outcome.remove_by_hand = `git worktree remove "${surface}"  (run from ${where.main})`;
      // The effort's directory under worktrees/ held only this surface and any
      // children, all released by now. Left empty, it is litter.
      const holder = path.dirname(surface);
      if (removed !== null && fs.existsSync(holder) && fs.readdirSync(holder).length === 0) fs.rmdirSync(holder);
    }
  }
  outcome.tracker = settings.tracker === 'none' ? [] : stopReason
    ? ['mirror the run log into the pull request; leave it a draft']
    : ['mirror the run log into the pull request', 'mark the pull request ready for review'];
  if (runtime) {
    outcome.summary = `${stopReason ? 'stopped' : 'closed'} ${effort}: the runtime's surface at ${here} is left as the runtime made it`;
  } else {
    outcome.summary = stopReason
      ? `stopped ${effort}: branch released, surface kept at ${rel(where, surface)}`
      : `closed ${effort}: branch released${outcome.removed ? ', surface removed' : ''}`;
  }
  return outcome;
}

/**
 * Frees an effort's branch, so a session in another runtime can take it in a
 * worktree of its own, and leaves the effort open.
 *
 * Only `_run` is released: it is the one surface holding an effort branch that
 * AEP made. A worktree the runtime supplied is the runtime's, so the command
 * stops there and names the directory to continue in instead. Nothing
 * uncommitted is carried, because a release that dropped work would lose it;
 * the session's handoff, which lives in that surface's scratch, is carried to
 * the main checkout's scratch, where every surface can read it.
 */
function release(root, args) {
  const where = locate(root);
  const [effortArg] = args.positional;
  if (!effortArg) throw new Stop('usage: aep release <effort>');
  const { effort, branch } = resolveEffort(where, effortArg);
  const surface = runSurface(where, effort);
  const home = homeOf(where, branch);
  // AEP releases only its own surface.
  if (home && !same(home, surface)) throw heldElsewhere(where, effort, branch, home);
  if (!fs.existsSync(surface)) {
    return { effort, branch, released: false, summary: `${branch} of ${effort} is held by no surface; any runtime can take it` };
  }
  if (same(where.repo, surface)) {
    throw new Stop(`run aep release from outside the surface it removes, such as the main checkout at ${where.main}`);
  }
  guardLease(aepIn(surface, where), effort, surface, sessionOf(args));
  const dirty = dirtyPaths(surface);
  if (dirty.length > 0) {
    throw new Stop(`the surface has uncommitted changes: ${dirty.join(', ')}. Commit or land them first; a release never carries uncommitted work`);
  }
  if (home) git(surface, ['switch', '--quiet', '--detach']);

  const carried = [];
  const from = path.join(aepIn(surface, where), 'scratch');
  const to = path.join(aepIn(where.main, where), 'scratch');
  if (fs.existsSync(from)) {
    for (const name of fs.readdirSync(from).filter((entry) => entry.startsWith('handoff-') && entry.endsWith('.md'))) {
      fs.mkdirSync(to, { recursive: true });
      fs.copyFileSync(path.join(from, name), path.join(to, name));
      carried.push(path.join(to, name));
    }
  }
  const removed = git(where.main, ['worktree', 'remove', surface], { allowFail: true }) !== null;
  const holder = path.dirname(surface);
  if (removed && fs.existsSync(holder) && fs.readdirSync(holder).length === 0) fs.rmdirSync(holder);
  const outcome = { effort, branch, released: true, removed, carried };
  if (!removed) outcome.remove_by_hand = `git worktree remove "${surface}"  (run from ${where.main})`;
  outcome.summary = `released ${branch} of ${effort}: any runtime can take it now${carried.length ? `; handoff kept at ${carried.join(', ')}` : ''}`;
  return outcome;
}

/**
 * Gives up this session's lease on a surface, so another runtime's session can
 * take the effort at once rather than after the stale window. With no effort,
 * the surface is the directory the command runs in.
 */
function yieldSurface(root, args) {
  const where = locate(root);
  let surface = where.repo;
  let effort = null;
  if (args.positional[0]) {
    const resolved = resolveEffort(where, args.positional[0]);
    effort = resolved.effort;
    surface = requireHome(where, effort, resolved.branch);
  }
  const outcome = yieldLease(aepIn(surface, where), sessionOf(args));
  return {
    effort, surface, ...outcome,
    summary: outcome.yielded ? `yielded ${outcome.reason} at ${surface}` : `nothing yielded at ${surface}: ${outcome.reason}`,
  };
}

function raise(root, args) {
  const where = locate(root);
  const [effortArg, lane] = args.positional;
  if (!effortArg || !LANES.includes(lane)) throw new Stop(`usage: aep raise <effort> <${LANES.join('|')}> --reason <text>`);
  const { effort, branch } = resolveEffort(where, effortArg);
  const here = requireHome(where, effort, branch);
  renewLease(aepIn(here, where), sessionOf(args));
  const effortDir = path.join(aepIn(here, where), 'efforts', effort);
  const spec = readSpec(effortDir);
  const from = LANES.indexOf(spec.lane);
  const to = LANES.indexOf(lane);
  if (to < from) throw new Stop(`lanes only go up: ${effort} is ${spec.lane}, and ${lane} is lower`);
  if (to === from) return { effort, lane, raised: false, summary: `${effort} is already ${lane}` };
  fs.writeFileSync(spec.file, setField(fs.readFileSync(spec.file, 'utf8'), 'lane', lane), 'utf8');
  appendToLog(effortDir, effort, 'Recorded', `- lane raised ${spec.lane} -> ${lane}: ${args.flags.reason ?? 'no reason given'}`);
  return { effort, from: spec.lane, lane, raised: true, summary: `raised ${effort} from ${spec.lane} to ${lane}` };
}

const RECORDS = {
  converge: 'Rounds',
  review: 'Rounds',
  note: 'Recorded',
  'needs-you': 'Needs you',
};

/**
 * Writes one line to the effort's log and commits only that file, so the
 * surface stays clean for the next `start`. A round is numbered here, and a
 * round past the lane's cap is refused.
 */
function record(root, args) {
  const where = locate(root);
  const [effortArg] = args.positional;
  const kinds = Object.keys(RECORDS).filter((kind) => args.flags[kind] !== undefined);
  if (!effortArg || kinds.length !== 1) {
    throw new Stop('usage: aep record <effort> --converge|--review|--note|--needs-you "<line>" [--at <commit>]');
  }
  const [kind] = kinds;
  const text = String(args.flags[kind]).trim();
  if (!text) throw new Stop(`--${kind} needs a line`);
  const { effort, branch } = resolveEffort(where, effortArg);
  const here = requireHome(where, effort, branch);
  renewLease(aepIn(here, where), sessionOf(args));
  const effortDir = path.join(aepIn(here, where), 'efforts', effort);
  const spec = readSpec(effortDir);
  const file = ensureLog(effortDir, effort);

  let line;
  if (kind === 'converge' || kind === 'review') {
    const cap = laneRules(spec.lane)[kind];
    const done = readRounds(fs.readFileSync(file, 'utf8'))[kind].length;
    if (done >= cap) {
      throw new Stop(`${effort} is ${spec.lane}: at most ${cap} ${kind} round(s), and ${done} ran. Close it, with --stop where anything is open`);
    }
    line = `${kind} ${done + 1}: ${text}`;
    if (kind === 'review') {
      // The commit this round judged, so the next round diffs from it.
      const at = typeof args.flags.at === 'string' ? args.flags.at : 'HEAD';
      const sha = git(here, ['rev-parse', '--verify', '--quiet', `${at}^{commit}`], { allowFail: true });
      if (!sha) throw new Stop(`--at ${at} does not name a commit`);
      line += ` (reviewed ${sha.slice(0, 12)})`;
    }
  } else {
    line = `- ${text}`;
  }
  appendToLog(effortDir, effort, RECORDS[kind], line);
  const relLog = path.relative(here, file).replace(/\\/g, '/');
  git(here, ['add', '--', relLog]);
  // A short summary, and the whole line in the body: a note can run long.
  const subject = kind === 'converge' || kind === 'review' ? line.slice(0, line.indexOf(':')) : `record ${kind}`;
  git(here, ['commit', '--quiet', '-m', `docs(${effort}): ${subject}`, '-m', line.replace(/^- /, ''), '--', relLog]);
  return { effort, section: RECORDS[kind], line, summary: `recorded in ${effort}: ${line}` };
}

// --- status ------------------------------------------------------------------------------

function showAt(repo, ref, file) {
  return git(repo, ['show', `${ref}:${file}`], { allowFail: true });
}

function frontmatterOf(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text ?? '');
  return match ? parseFrontmatterBlock(match[1]).fields : {};
}

export function boardFor(repoDir) {
  const root = path.join(repoDir, '.aep');
  const where = locate(root);
  const base = resolveBase(where.repo);
  const trees = worktreeList(where.repo);
  const efforts = [];
  const index = effortIndex(where);
  for (const effort of [...index.keys()].sort()) {
    let branch;
    try {
      branch = branchFrom(index, effort);
    } catch (error) {
      efforts.push({ effort, lane: 'unknown', status: 'held twice', tickets: { total: 0, resolved: 0, ready: [], blocked: [] }, surface: null, last: '-', waiting: [error.message] });
      continue;
    }
    const dir = `${where.aepRel}/efforts/${effort}`;
    const specText = showAt(where.repo, branch, `${dir}/spec.md`);
    const fields = frontmatterOf(specText);
    const lane = LANES.includes(fields.lane) ? fields.lane : 'full';
    const files = (git(where.repo, ['ls-tree', '-r', '--name-only', branch, `${dir}/tickets/`], { allowFail: true }) ?? '')
      .split(/\r?\n/).filter((name) => name.endsWith('.md'));
    const tickets = files.map((file) => {
      const front = frontmatterOf(showAt(where.repo, branch, file));
      const stem = path.posix.basename(file, '.md');
      return { id: stem.split('-')[0], slug: stem.replace(/^\d+-/, ''), status: front.status, blockedBy: (front['blocked-by'] ?? []).map(String) };
    });
    let ready = [];
    let blocked = [];
    try {
      const result = frontier(tickets, []);
      ready = result.ready.map((ticket) => ticket.id);
      blocked = result.blocked.map((ticket) => ticket.id);
    } catch {
      // A broken edge is the validator's to report, not the board's.
    }
    const logText = showAt(where.repo, branch, `${dir}/log.md`) ?? '';
    const holder = trees.find((tree) => tree.branch === branch);
    // Where a surface holds the branch, its lease and next step are read there,
    // so a session arriving from any runtime sees who works where, and on what.
    let lease = null;
    let next = null;
    if (holder) {
      const aepDir = aepIn(holder.path, where);
      const held = readLease(aepDir);
      if (held) {
        lease = { session: held.session, runtime: held.runtime ?? null, state: leaseState(held, null), active_minutes_ago: minutesSince(held.renewed) };
      }
      try {
        const effortDir = path.join(aepDir, 'efforts', effort);
        next = plan(where, effortDir, readSpec(effortDir)).next;
      } catch {
        // A surface mid-change may not read cleanly; the board still shows it.
      }
    }
    const kept = path.join(aepIn(where.main, where), 'worktrees', effort, '_run');
    const merged = base ? git(where.repo, ['merge-base', '--is-ancestor', branch, base], { allowFail: true }) !== null : false;
    const waiting = [...logSection(logText, 'Needs you')];
    let buildsOn;
    try {
      buildsOn = dependencies(where, index, fields['builds-on']).map(({ effort: name, state }) => ({ effort: name, state }));
    } catch (error) {
      // An edge naming nothing is the validator's and the run's to report; the
      // board shows it rather than failing.
      buildsOn = [{ effort: String(error.extra?.unknown ?? fields['builds-on']), state: 'unknown' }];
    }
    if (fields.status === 'implemented' && !merged) waiting.push('ready to merge');
    if (!holder && fs.existsSync(kept) && fields.status !== 'implemented') waiting.push(`stopped; surface kept at ${rel(where, kept)}`);
    efforts.push({
      effort,
      branch,
      lane,
      status: merged ? 'merged' : (fields.status ?? 'unknown'),
      builds_on: buildsOn,
      next,
      lease,
      tickets: { total: tickets.length, resolved: tickets.filter((t) => t.status !== 'open').length, ready, blocked },
      // A surface outside the main checkout, such as a runtime's, has no useful
      // relative spelling, so it is shown whole.
      surface: holder ? (rel(where, holder.path).startsWith('..') ? holder.path : rel(where, holder.path)) : null,
      last: git(where.repo, ['log', '-1', '--format=%h %s (%cr)', branch]),
      waiting: merged ? [] : waiting,
    });
  }
  return { repo: where.main, efforts: efforts.filter((effort) => effort.status !== 'merged') };
}

function renderBoard(boards) {
  const out = [];
  const waiting = [];
  for (const board of boards) {
    out.push(`${board.repo}`);
    if (board.efforts.length === 0) out.push('  no open efforts');
    for (const effort of board.efforts) {
      const tickets = effort.tickets.total
        ? `${effort.tickets.resolved}/${effort.tickets.total} tickets${effort.tickets.ready.length ? `, ready ${effort.tickets.ready.join(' ')}` : ''}`
        : 'no tickets';
      out.push(`  ${effort.effort.padEnd(28)} ${effort.lane.padEnd(8)} ${effort.status.padEnd(11)} ${tickets}`);
      const on = effort.branch && effort.branch !== effort.effort ? `on ${effort.branch}, ` : '';
      out.push(`  ${''.padEnd(28)} ${on}${effort.surface ? `surface ${effort.surface}` : 'no surface'}; last ${effort.last}`);
      if (effort.lease) {
        out.push(`  ${''.padEnd(28)} lease: session ${effort.lease.session}${effort.lease.runtime ? ` (${effort.lease.runtime})` : ''}, ${effort.lease.state}, active ${effort.lease.active_minutes_ago} min ago`);
      }
      if (effort.builds_on?.length) {
        out.push(`  ${''.padEnd(28)} builds on ${effort.builds_on.map((need) => `${need.effort} (${need.state})`).join(', ')}`);
      }
      for (const item of effort.waiting) waiting.push(`${path.basename(board.repo)}/${effort.effort}: ${item.replace(/^-\s*/, '')}`);
    }
    out.push('');
  }
  out.push(waiting.length ? 'Waiting on you:' : 'Nothing is waiting on you.');
  for (const item of waiting) out.push(`  ${item}`);
  return `${out.join('\n')}\n`;
}

function status(root, args) {
  const boards = [];
  if (args.flags.repos) {
    const dir = path.resolve(args.flags.repos);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const repo = path.join(dir, entry.name);
      if (!entry.isDirectory() || !fs.existsSync(path.join(repo, '.aep', 'protocol.md'))) continue;
      try {
        boards.push(boardFor(repo));
      } catch (error) {
        boards.push({ repo, error: error.message, efforts: [] });
      }
    }
  } else {
    boards.push(boardFor(locate(root).main));
  }
  return { boards, text: renderBoard(boards) };
}

function check(root) {
  const validation = validateTree(root);
  const result = runChecks(root);
  return {
    ok: validation.failures.length === 0 && result.ok,
    validate: validation.failures,
    budgets_over: result.budgets.over.map((entry) => `${entry.file} ${entry.words}/${entry.limit}`),
    hot_path: `${result.budgets.hotPath.words}/${result.budgets.hotPath.limit}`,
    why: result.why.map((hit) => `${hit.file}:${hit.line}`),
    outside: result.outside.map((hit) => `${hit.file}:${hit.line} ${hit.wording}`),
    summary: `validate ${validation.failures.length} failure(s); ${result.budgets.over.length} over budget; ${result.why.length} rationale; ${result.outside.length} outside-write wording`,
  };
}

// --- entry -----------------------------------------------------------------------------

export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    const boolean = ['json'].includes(name);
    const value = boolean ? true : argv[i + 1];
    if (!boolean) i += 1;
    if (name === 'friction') flags.friction = [...(flags.friction ?? []), value];
    else flags[name] = value;
  }
  return { positional, flags };
}

const COMMANDS = { status, open, start, dispatch, land, close, release, yield: yieldSurface, raise, record, check };

export function run(argv, { cwdRoot = null } = {}) {
  const [command, ...rest] = argv;
  const args = parseArgs(rest);
  if (!COMMANDS[command]) {
    return { code: 2, output: { stop: `unknown command "${command ?? ''}". Expected: ${Object.keys(COMMANDS).join(', ')}` } };
  }
  const root = cwdRoot ?? resolveAepRoot(args.flags.root ?? null, null);
  if (!root) return { code: 2, output: { stop: 'no .aep/ found here. Run from inside a repository that has one' } };
  try {
    const output = COMMANDS[command](root, args);
    return { code: output.stop ? 1 : 0, output };
  } catch (error) {
    if (error instanceof Stop) {
      return { code: 1, output: { stop: error.message, ...error.extra, summary: `stopped: ${error.message}` } };
    }
    throw error;
  }
}

function main() {
  const argv = process.argv.slice(2);
  const { code, output } = run(argv);
  if (argv[0] === 'status' && !argv.includes('--json') && output.text) process.stdout.write(output.text);
  else {
    const { text, ...rest } = output;
    process.stdout.write(`${JSON.stringify(argv[0] === 'status' ? rest : output, null, 2)}\n`);
  }
  process.exit(code);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
