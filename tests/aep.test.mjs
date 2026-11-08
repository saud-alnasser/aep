// Tests for the AEP command line, against throwaway repositories made through
// the temp API. Run from the repository root:
//
//   node --test tests/aep.test.mjs
//
// Each test installs AEP from this checkout's src/ into a fresh repository, so
// what is tested is what ships.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'src');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function write(root, rel, content) {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function setFrontmatter(file, fields) {
  let text = fs.readFileSync(file, 'utf8');
  for (const [field, value] of Object.entries(fields)) {
    const line = new RegExp(`^${field}:.*$`, 'm');
    text = line.test(text.split(/^---$/m)[1] ?? '')
      ? text.replace(line, `${field}: ${value}`)
      : text.replace(/^---\r?\n/, `---\n${field}: ${value}\n`);
  }
  fs.writeFileSync(file, text, 'utf8');
}

/** A repository with AEP installed and committed on main. */
function fixture(t, settings = {}, parent = null) {
  const dir = parent
    ? fs.mkdtempSync(path.join(parent, 'repo-'))
    : fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'aep-cli-')));
  t.after(() => {
    for (const line of (spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: dir, encoding: 'utf8' }).stdout ?? '').split(/\r?\n/)) {
      if (line.startsWith('worktree ') && path.resolve(line.slice(9)) !== path.resolve(dir)) {
        spawnSync('git', ['worktree', 'remove', '--force', line.slice(9)], { cwd: dir });
      }
    }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  git(dir, 'init', '--quiet', '-b', 'main');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'commit.gpgsign', 'false');
  write(dir, 'README.md', '# project\n\nTo recieve help, ask.\n');
  write(dir, 'setup.js', "require('fs').appendFileSync('warmed.txt', 'x');\n");
  git(dir, 'add', '-A');
  git(dir, 'commit', '--quiet', '-m', 'init');
  execFileSync(process.execPath, [path.join(SRC, 'scripts', 'install.mjs'), '--into', dir], { stdio: 'ignore' });
  if (Object.keys(settings).length > 0) {
    setFrontmatter(path.join(dir, '.aep', 'rules', 'version-control.md'), settings);
  }
  execFileSync(process.execPath, [path.join(dir, '.aep', 'scripts', 'index.mjs')], { cwd: dir, stdio: 'ignore' });
  git(dir, 'add', '-A');
  git(dir, 'commit', '--quiet', '-m', 'chore: install AEP');
  return dir;
}

/**
 * The environment with every runtime marker removed. These tests may run
 * inside a runtime, and its session id would otherwise turn on runtime
 * detection and leases in every test that did not ask for them.
 */
function cleanEnv(extra = {}) {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!/^(CLAUDECODE|CLAUDE_CODE_|T3CODE_|T3_ACP_MCP_|T3_MCP_)/.test(name)) env[name] = value;
  }
  return { ...env, ...extra };
}

/** Runs the installed CLI in `cwd`, returning its exit code and parsed JSON. */
function aep(cwd, ...args) {
  return aepWith({}, cwd, ...args);
}

/** `aep`, with runtime variables set on top of a clean environment. */
function aepWith(extra, cwd, ...args) {
  const result = spawnSync(process.execPath, [path.join(cwd, '.aep', 'scripts', 'aep.mjs'), ...args], {
    cwd, encoding: 'utf8', env: cleanEnv(extra),
  });
  let json = null;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    json = { raw: result.stdout, stderr: result.stderr };
  }
  return { code: result.status, json, stderr: result.stderr };
}

function draft(dir, slug, { lane = 'standard', check = null, buildsOn = null } = {}) {
  const edge = buildsOn ? `builds-on: [${buildsOn.join(', ')}]\n` : '';
  const body = lane === 'quick'
    ? `---\nstatus: accepted\nlane: quick\n---\n\n# Problem\nA typo.\n\n# Change\nFix it.\n\n# Check\n- [ ] ${check ?? 'README reads "receive"'}\n`
    : `---\nstatus: accepted\nlane: ${lane}\n${edge}---\n\n# Problem\nx\n\n# Goal\nx\n\n# Scope\nx\n\n# Requirements\n1. a\n2. b\n\n# Acceptance Criteria\n1. a works\n2. b works\n\n# Out of Scope\n- nothing\n`;
  write(dir, `.aep/scratch/${slug}/spec.md`, body);
}

function ticket(surface, effort, stem, { blockedBy = [] } = {}) {
  const front = ['---', 'status: open'];
  if (blockedBy.length) front.push(`blocked-by: [${blockedBy.join(', ')}]`);
  front.push('---', '');
  const n = Number(stem.split('-')[0]);
  write(surface, `.aep/efforts/${effort}/tickets/${stem}.md`, [
    ...front, `# feat: ${stem}`, '', '## Outcome', 'x', '', '## Acceptance Criteria',
    `- [ ] criterion ${n}: ${stem} exists`, '',
  ].join('\n'));
}

function tick(surface, effort, stem) {
  const file = path.join(surface, '.aep', 'efforts', effort, 'tickets', `${stem}.md`);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/- \[ \]/g, '- [x]').replace(/exists$/m, 'exists (verified: file present)'), 'utf8');
}

/** Opens a standard or full effort with tickets committed on its branch. */
function openWithTickets(t, dir, lane, stems, settings) {
  draft(dir, 'feature', { lane });
  const opened = aep(dir, 'open', 'feature', '--lane', lane);
  assert.equal(opened.code, 0, JSON.stringify(opened.json));
  const { surface, effort } = opened.json;
  for (const stem of stems) ticket(surface, effort, stem);
  execFileSync(process.execPath, [path.join(surface, '.aep', 'scripts', 'index.mjs')], { cwd: surface, stdio: 'ignore' });
  git(surface, 'add', '-A');
  git(surface, 'commit', '--quiet', '-m', 'docs: tickets');
  return { surface, effort };
}

test('open makes the branch and the surface in one act, and moves the draft in', (t) => {
  const dir = fixture(t);
  draft(dir, 'csv-export');
  const { code, json } = aep(dir, 'open', 'csv-export', '--lane', 'standard');
  assert.equal(code, 0, JSON.stringify(json));
  assert.equal(json.effort, '1-csv-export');
  assert.equal(path.resolve(json.surface), path.join(dir, '.aep', 'worktrees', '1-csv-export', '_run'));
  assert.equal(git(json.surface, 'rev-parse', '--abbrev-ref', 'HEAD'), '1-csv-export');
  const spec = fs.readFileSync(path.join(json.surface, '.aep', 'efforts', '1-csv-export', 'spec.md'), 'utf8');
  assert.match(spec, /^lane: standard$/m);
  assert.ok(fs.existsSync(path.join(json.surface, '.aep', 'efforts', '1-csv-export', 'log.md')));
  assert.equal(git(json.surface, 'status', '--porcelain'), '');
  assert.ok(!fs.existsSync(path.join(dir, '.aep', 'scratch', 'csv-export')), 'the draft is moved, not copied');
  assert.equal(git(dir, 'status', '--porcelain'), '', 'the main checkout is untouched');

  const again = aep(dir, 'open', 'csv-export', '--lane', 'standard');
  assert.equal(again.code, 0);
  assert.equal(again.json.opened, 'already');
});

test('open in a surface the runtime supplied takes no second one', (t) => {
  const dir = fixture(t);
  const supplied = fs.mkdtempSync(path.join(path.dirname(dir), 'aep-runtime-'));
  fs.rmSync(supplied, { recursive: true });
  t.after(() => fs.rmSync(supplied, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  git(dir, 'worktree', 'add', '--quiet', '--detach', supplied, 'main');
  draft(supplied, 'from-runtime');
  const { code, json } = aep(supplied, 'open', 'from-runtime', '--lane', 'standard');
  assert.equal(code, 0, JSON.stringify(json));
  assert.equal(path.resolve(json.surface), path.resolve(supplied));
  assert.equal(git(supplied, 'rev-parse', '--abbrev-ref', 'HEAD'), json.effort);
  assert.ok(!fs.existsSync(path.join(dir, '.aep', 'worktrees', json.effort)), 'no surface under .aep/worktrees');
  git(dir, 'worktree', 'remove', '--force', supplied);
});

test('open numbers past every effort a branch or a surface already holds', (t) => {
  const dir = fixture(t);
  draft(dir, 'one');
  aep(dir, 'open', 'one', '--lane', 'standard');
  draft(dir, 'two');
  const { json } = aep(dir, 'open', 'two', '--lane', 'standard');
  assert.equal(json.effort, '2-two');
});

test('start re-enters the surface an effort already has, and never makes a second', (t) => {
  const dir = fixture(t);
  const { surface, effort } = openWithTickets(t, dir, 'standard', ['01-a', '02-b']);
  const first = aep(dir, 'start', effort);
  assert.equal(first.code, 0, JSON.stringify(first.json));
  assert.equal(first.json.entered, 're-entered');
  assert.deepEqual(first.json.frontier, ['01-a', '02-b']);
  assert.equal(first.json.next, 'build');
  assert.equal(first.json.wave, 'here', 'a standard lane builds here, not in children');
  const second = aep(surface, 'start');
  assert.equal(second.json.entered, 'here');
  const holders = git(dir, 'worktree', 'list', '--porcelain').split(/\r?\n/).filter((line) => line === `branch refs/heads/${effort}`);
  assert.equal(holders.length, 1);
});

test('start recreates a removed surface from the effort branch', (t) => {
  const dir = fixture(t);
  const { surface, effort } = openWithTickets(t, dir, 'standard', ['01-a']);
  git(dir, 'worktree', 'remove', surface);
  const { json } = aep(dir, 'start', effort);
  assert.equal(json.entered, 'created');
  assert.ok(fs.existsSync(surface));
});

test('start stops on a dirty surface and names the paths', (t) => {
  const dir = fixture(t);
  const { surface, effort } = openWithTickets(t, dir, 'standard', ['01-a']);
  fs.appendFileSync(path.join(surface, 'README.md'), 'half an edit\n');
  const { code, json } = aep(dir, 'start', effort);
  assert.equal(code, 1);
  assert.equal(json.next, 'stop');
  assert.deepEqual(json.dirty, ['README.md']);
  assert.match(json.stop, /README\.md/);
});

test('start hands back a surface held elsewhere, and stops on another session\'s live lease there', (t) => {
  const dir = fixture(t);
  const { surface, effort } = openWithTickets(t, dir, 'standard', ['01-a']);
  git(surface, 'switch', '--quiet', '--detach');
  const elsewhere = path.join(dir, '.aep', 'worktrees', 'elsewhere');
  git(dir, 'worktree', 'add', '--quiet', elsewhere, effort);
  const handed = aep(dir, 'start', effort);
  assert.equal(handed.code, 0, JSON.stringify(handed.json));
  assert.equal(path.resolve(handed.json.surface), path.resolve(elsewhere));
  assert.equal(handed.json.move, true);

  assert.equal(aepWith({ CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'first' }, elsewhere, 'start', effort).code, 0);
  const { code, json } = aepWith({ CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'second' }, dir, 'start', effort);
  assert.equal(code, 1);
  assert.match(json.stop, /being worked on by another session/);
  assert.equal(json.held_by.session, 'first');
});

test('a wave of two: dispatch makes both surfaces first, land integrates one at a time', (t) => {
  const dir = fixture(t);
  const { surface, effort } = openWithTickets(t, dir, 'full', ['01-a', '02-b']);
  const started = aep(dir, 'start', effort);
  assert.equal(started.json.wave, 'dispatch');

  const sent = aep(surface, 'dispatch', effort, '01', '02');
  assert.equal(sent.code, 0, JSON.stringify(sent.json));
  assert.equal(sent.json.children.length, 2);
  for (const child of sent.json.children) {
    assert.ok(child.created);
    assert.equal(path.dirname(path.resolve(child.surface)), path.join(dir, '.aep', 'worktrees', effort));
    write(child.surface, `${child.ticket}.txt`, child.ticket);
    git(child.surface, 'add', '-A');
    git(child.surface, 'commit', '--quiet', '-m', `wip ${child.ticket}`);
  }
  const again = aep(surface, 'dispatch', effort, '01');
  assert.equal(again.json.children[0].created, false, 'dispatch is idempotent');

  const before = Number(git(surface, 'rev-list', '--count', 'HEAD'));
  for (const stem of ['01-a', '02-b']) {
    tick(surface, effort, stem);
    const landed = aep(surface, 'land', effort, stem.split('-')[0], '--message', `feat: ${stem}`);
    assert.equal(landed.code, 0, JSON.stringify(landed.json));
    assert.ok(landed.json.released.branch, 'the ticket branch is released');
  }
  assert.equal(Number(git(surface, 'rev-list', '--count', 'HEAD')), before + 2, 'one commit per ticket');
  assert.ok(fs.existsSync(path.join(surface, '01-a.txt')) && fs.existsSync(path.join(surface, '02-b.txt')));
  assert.equal(git(dir, 'branch', '--list', `${effort}--*`), '');
  const log = fs.readFileSync(path.join(surface, '.aep', 'efforts', effort, 'log.md'), 'utf8');
  assert.match(log, /\[x\] 01 a 1\/1/);
  assert.match(log, /\[x\] 02 b 1\/1/);
  assert.equal(aep(dir, 'start', effort).json.next, 'converge');
});

test('land refuses a ticket whose criteria are not all ticked', (t) => {
  const dir = fixture(t);
  const { surface, effort } = openWithTickets(t, dir, 'standard', ['01-a']);
  const { code, json } = aep(surface, 'land', effort, '01', '--message', 'feat: a');
  assert.equal(code, 1);
  assert.match(json.stop, /not ticked/);
});

test('land after a crash between the commit and the release finishes the release', (t) => {
  const dir = fixture(t);
  const { surface, effort } = openWithTickets(t, dir, 'full', ['01-a', '02-b']);
  const sent = aep(surface, 'dispatch', effort, '01');
  const child = sent.json.children[0];
  write(child.surface, 'a.txt', 'a');
  git(child.surface, 'add', '-A');
  git(child.surface, 'commit', '--quiet', '-m', 'wip');
  // The crash: the work and the status reached the effort branch, the release never ran.
  git(surface, 'merge', '--squash', `${effort}--01-a`);
  tick(surface, effort, '01-a');
  const file = path.join(surface, '.aep', 'efforts', effort, 'tickets', '01-a.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('status: open', 'status: resolved'), 'utf8');
  git(surface, 'add', '-A');
  git(surface, 'commit', '--quiet', '-m', 'feat: a');
  const head = git(surface, 'rev-parse', 'HEAD');

  const { code, json } = aep(surface, 'land', effort, '01', '--message', 'feat: a');
  assert.equal(code, 0, JSON.stringify(json));
  assert.equal(json.already, true);
  assert.equal(git(surface, 'rev-parse', 'HEAD'), head, 'nothing is committed twice');
  assert.ok(!fs.existsSync(child.surface));
  assert.equal(git(dir, 'branch', '--list', `${effort}--01-a`), '');
});

test('close on a clean finish stamps implemented, releases the branch, and removes the surface', (t) => {
  const dir = fixture(t);
  const { surface, effort } = openWithTickets(t, dir, 'standard', ['01-a']);
  tick(surface, effort, '01-a');
  write(surface, 'a.txt', 'a');
  assert.equal(aep(surface, 'land', effort, '01', '--message', 'feat: a').code, 0);
  const premature = aep(dir, 'close', effort, '--stop', 'review found a gap nobody can fix here');
  assert.equal(premature.json.closed, 'stopped');
  assert.ok(fs.existsSync(surface), 'a stop keeps the surface');
  assert.match(git(dir, 'worktree', 'list', '--porcelain'), /detached/);
  const board = aep(dir, 'status', '--json');
  assert.match(JSON.stringify(board.json), /review found a gap/);

  const resumed = aep(dir, 'start', effort);
  assert.equal(resumed.json.entered, 're-entered');
  write(surface, '.aep/scratch/notes.md', 'exploration notes\n');
  const { code, json } = aep(dir, 'close', effort, '--friction', 'the review asked twice');
  assert.equal(code, 0, JSON.stringify(json));
  assert.equal(json.closed, 'clean');
  assert.ok(!fs.existsSync(surface));
  assert.match(git(dir, 'show', `${effort}:.aep/efforts/${effort}/spec.md`), /^status: implemented$/m);
  assert.match(git(dir, 'show', `${effort}:.aep/friction.md`), /the review asked twice/);
  assert.equal(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
});

test('close refuses while a ticket is unresolved', (t) => {
  const dir = fixture(t);
  const { effort } = openWithTickets(t, dir, 'standard', ['01-a']);
  const { code, json } = aep(dir, 'close', effort);
  assert.equal(code, 1);
  assert.match(json.stop, /unresolved tickets remain: 01-a/);
});

test('the quick lane lands as exactly one commit on its branch', (t) => {
  const dir = fixture(t);
  draft(dir, 'typo', { lane: 'quick' });
  const opened = aep(dir, 'open', 'typo', '--lane', 'quick');
  const { surface, effort } = opened.json;
  fs.writeFileSync(path.join(surface, 'README.md'), '# project\n\nTo receive help, ask.\n', 'utf8');
  const spec = path.join(surface, '.aep', 'efforts', effort, 'spec.md');
  const early = aep(surface, 'land', effort, '--message', 'docs: fix typo');
  assert.equal(early.code, 1, 'an unticked Check stops the land');
  // A revised Check item committed on its own, as specify says a revision is:
  // it is still folded into the one commit that lands.
  fs.writeFileSync(spec, fs.readFileSync(spec, 'utf8').replace('README reads', 'The README reads'), 'utf8');
  git(surface, 'commit', '--quiet', '-am', 'docs: sharpen the check');
  fs.writeFileSync(spec, fs.readFileSync(spec, 'utf8').replace('- [ ]', '- [x]'), 'utf8');
  const landed = aep(surface, 'land', effort, '--message', 'docs: fix typo');
  assert.equal(landed.code, 0, JSON.stringify(landed.json));
  assert.equal(git(dir, 'rev-list', '--count', `main..${effort}`), '1');
  assert.equal(git(dir, 'log', '-1', '--format=%s', effort), 'docs: fix typo');
  const closed = aep(dir, 'close', effort);
  assert.equal(closed.code, 0, JSON.stringify(closed.json));
  assert.equal(git(dir, 'rev-list', '--count', `main..${effort}`), '1', 'close adds no commit in the quick lane');
  assert.ok(!fs.existsSync(path.join(dir, '.aep', 'worktrees', effort)), 'no empty effort directory is left behind');
  assert.ok(!git(dir, 'ls-tree', '-r', '--name-only', effort).includes('tickets/'));
});

test('record numbers the rounds, keeps the surface clean, and refuses one past the lane\'s cap', (t) => {
  const dir = fixture(t);
  const { surface, effort } = openWithTickets(t, dir, 'standard', ['01-a']);
  tick(surface, effort, '01-a');
  assert.equal(aep(surface, 'land', effort, '01', '--message', 'feat: a').code, 0);
  assert.equal(aep(dir, 'start', effort).json.next, 'converge');
  const converged = aep(surface, 'record', effort, '--converge', 'no gap');
  assert.equal(converged.code, 0, JSON.stringify(converged.json));
  assert.equal(converged.json.line, 'converge 1: no gap');
  assert.equal(git(surface, 'status', '--porcelain'), '', 'the record is committed');
  assert.equal(aep(dir, 'start', effort).json.next, 'review');
  const again = aep(surface, 'record', effort, '--converge', 'gap, tickets 02');
  assert.equal(again.code, 1, 'a standard effort converges once');
  assert.match(again.json.stop, /at most 1 converge/);
  aep(surface, 'record', effort, '--review', '2 findings, 2 fixed');
  assert.equal(aep(dir, 'start', effort).json.next, 'close', 'a standard effort reviews once');
  aep(surface, 'record', effort, '--needs-you', 'decide the export');
  const board = aep(dir, 'status', '--json');
  assert.match(JSON.stringify(board.json), /decide the export/);
});

test('a full-lane review that fixed findings is reviewed again; one that found nothing ends review', (t) => {
  const dir = fixture(t);
  const { surface, effort } = openWithTickets(t, dir, 'full', ['01-a']);
  tick(surface, effort, '01-a');
  assert.equal(aep(surface, 'land', effort, '01', '--message', 'feat: a').code, 0);
  aep(surface, 'record', effort, '--converge', 'no gap');
  aep(surface, 'record', effort, '--review', '3 findings, 3 fixed');
  assert.equal(aep(dir, 'start', effort).json.next, 'review', 'the fixes are reviewed again');
  aep(surface, 'record', effort, '--review', 'no findings');
  assert.equal(aep(dir, 'start', effort).json.next, 'close');
});

test('a review round records the commit it judged, and a round with no Important finding is clear', (t) => {
  const dir = fixture(t);
  const { surface, effort } = openWithTickets(t, dir, 'full', ['01-a']);
  tick(surface, effort, '01-a');
  assert.equal(aep(surface, 'land', effort, '01', '--message', 'feat: a').code, 0);
  aep(surface, 'record', effort, '--converge', 'no gap');
  const judged = git(surface, 'rev-parse', 'HEAD').slice(0, 12);
  const first = aep(surface, 'record', effort, '--review', '1 Important, 1 fixed', '--at', judged);
  assert.equal(first.code, 0, JSON.stringify(first.json));
  assert.equal(first.json.line, `review 1: 1 Important, 1 fixed (reviewed ${judged})`);
  assert.equal(aep(dir, 'start', effort).json.next, 'review', 'the fix is reviewed again');
  const second = aep(surface, 'record', effort, '--review', '0 Important, 2 Nit');
  const head = git(surface, 'rev-parse', 'HEAD~1').slice(0, 12);
  assert.match(second.json.line, /^review 2: 0 Important, 2 Nit \(reviewed [0-9a-f]{12}\)$/);
  assert.equal(second.json.line.slice(-13, -1), head, 'the default is the commit the surface stood on');
  assert.equal(aep(dir, 'start', effort).json.next, 'close', 'Nits start no round');
});

test('a review round names a commit that exists', (t) => {
  const dir = fixture(t);
  const { surface, effort } = openWithTickets(t, dir, 'standard', ['01-a']);
  tick(surface, effort, '01-a');
  assert.equal(aep(surface, 'land', effort, '01', '--message', 'feat: a').code, 0);
  aep(surface, 'record', effort, '--converge', 'no gap');
  const missing = aep(surface, 'record', effort, '--review', 'Nothing to fix', '--at', 'no-such-ref');
  assert.equal(missing.code, 1);
  assert.match(missing.json.stop, /--at no-such-ref does not name a commit/);
  const clean = aep(surface, 'record', effort, '--review', 'Nothing to fix');
  assert.equal(clean.code, 0);
  assert.equal(aep(dir, 'start', effort).json.next, 'close');
});

test('lanes only go up', (t) => {
  const dir = fixture(t);
  draft(dir, 'typo', { lane: 'quick' });
  const { effort } = aep(dir, 'open', 'typo', '--lane', 'quick').json;
  const up = aep(dir, 'raise', effort, 'standard', '--reason', 'it crosses two modules');
  assert.equal(up.json.raised, true);
  const down = aep(dir, 'raise', effort, 'quick');
  assert.equal(down.code, 1);
  assert.match(down.json.stop, /lanes only go up/);
});

test('a new surface is warmed by the repository\'s setup command, and start reruns it only on a lockfile change', (t) => {
  const dir = fixture(t, { setup: 'node setup.js' });
  draft(dir, 'warm');
  const { json } = aep(dir, 'open', 'warm', '--lane', 'standard');
  assert.equal(json.setup.ran, true, JSON.stringify(json.setup));
  assert.equal(fs.readFileSync(path.join(json.surface, 'warmed.txt'), 'utf8'), 'x');
  fs.rmSync(path.join(json.surface, 'warmed.txt'));
  const again = aep(dir, 'start', json.effort);
  assert.equal(again.json.setup.ran, false);
  write(json.surface, 'package-lock.json', '{}');
  git(json.surface, 'add', '-A');
  git(json.surface, 'commit', '--quiet', '-m', 'chore: lock');
  const moved = aep(dir, 'start', json.effort);
  assert.equal(moved.json.setup.ran, true);
  fs.rmSync(path.join(json.surface, 'warmed.txt'), { force: true });
});

test('status reads every effort branch and says what waits on the human', (t) => {
  const dir = fixture(t);
  openWithTickets(t, dir, 'standard', ['01-a', '02-b']);
  const { code, json } = aep(dir, 'status', '--json');
  assert.equal(code, 0);
  const [board] = json.boards;
  assert.equal(board.efforts.length, 1);
  assert.equal(board.efforts[0].tickets.total, 2);
  assert.deepEqual(board.efforts[0].tickets.ready, ['01', '02']);
  const text = spawnSync(process.execPath, [path.join(dir, '.aep', 'scripts', 'aep.mjs'), 'status'], { cwd: dir, encoding: 'utf8' }).stdout;
  assert.match(text, /1-feature/);
  assert.match(text, /Nothing is waiting on you/);
  assert.equal(git(dir, 'status', '--porcelain'), '', 'status writes nothing');
});

test('status --repos reads several repositories and writes to none', (t) => {
  const parent = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'aep-repos-')));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const one = fixture(t, {}, parent);
  const two = fixture(t, {}, parent);
  fs.mkdirSync(path.join(parent, 'not-a-repo'));
  openWithTickets(t, one, 'standard', ['01-a']);
  const result = spawnSync(process.execPath, [path.join(one, '.aep', 'scripts', 'aep.mjs'), 'status', '--repos', parent, '--json'], {
    cwd: one, encoding: 'utf8',
  });
  const json = JSON.parse(result.stdout);
  const repos = json.boards.map((board) => path.resolve(board.repo));
  assert.ok(repos.includes(path.resolve(one)) && repos.includes(path.resolve(two)));
  assert.equal(git(two, 'status', '--porcelain'), '');
});

// --- a surface the runtime supplied, on a branch the runtime named ----------------
//
// A runtime such as T3 Code puts each thread in a worktree outside the project,
// on a branch it named and records. These tests stand in for one: a linked
// worktree beside the repository, on `t3code/abc123`.

const RUNTIME_BRANCH = 't3code/abc123';

/** A linked worktree outside `.aep/worktrees/`, on a branch the runtime named. */
function runtimeSurface(t, dir, branch = RUNTIME_BRANCH, from = 'main') {
  const supplied = fs.mkdtempSync(path.join(path.dirname(dir), 'aep-runtime-'));
  fs.rmSync(supplied, { recursive: true });
  t.after(() => fs.rmSync(supplied, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  git(dir, 'worktree', 'add', '--quiet', '-b', branch, supplied, from);
  return supplied;
}

/** Opens an effort in a runtime surface, with tickets committed on the runtime's branch. */
function openInRuntime(t, dir, lane, stems = []) {
  const supplied = runtimeSurface(t, dir);
  draft(supplied, 'feature', { lane });
  const opened = aep(supplied, 'open', 'feature', '--lane', lane);
  assert.equal(opened.code, 0, JSON.stringify(opened.json));
  const { effort } = opened.json;
  if (stems.length > 0) {
    for (const stem of stems) ticket(supplied, effort, stem);
    execFileSync(process.execPath, [path.join(supplied, '.aep', 'scripts', 'index.mjs')], { cwd: supplied, stdio: 'ignore' });
    git(supplied, 'add', '-A');
    git(supplied, 'commit', '--quiet', '-m', 'docs: tickets');
  }
  return { supplied, effort, opened: opened.json };
}

test('open in a runtime surface commits on the branch the runtime named, and makes none of its own', (t) => {
  const dir = fixture(t);
  const { supplied, effort, opened } = openInRuntime(t, dir, 'standard');
  assert.equal(opened.adopted, true);
  assert.equal(opened.branch, RUNTIME_BRANCH);
  assert.equal(git(supplied, 'rev-parse', '--abbrev-ref', 'HEAD'), RUNTIME_BRANCH, 'the runtime branch is still checked out');
  assert.equal(git(dir, 'branch', '--list', effort), '', 'no branch named for the effort');
  assert.equal(git(dir, 'cat-file', '-t', `${RUNTIME_BRANCH}:.aep/efforts/${effort}/spec.md`), 'blob', 'the spec is committed on the runtime branch');
  assert.equal(git(supplied, 'status', '--porcelain'), '');
  assert.match(fs.readFileSync(path.join(supplied, '.aep', 'efforts', effort, 'log.md'), 'utf8'), /on t3code\/abc123, the branch the runtime supplied/);

  draft(supplied, 'second');
  const second = aep(supplied, 'open', 'second', '--lane', 'standard');
  assert.equal(second.code, 1);
  assert.match(second.json.stop, /already holds 1-feature/);
  assert.deepEqual(second.json.claim, [effort]);
});

test('every command finds an effort on a runtime-named branch, from the runtime surface and from the main checkout', (t) => {
  const dir = fixture(t);
  const { supplied, effort } = openInRuntime(t, dir, 'standard', ['01-a']);

  const here = aep(supplied, 'start');
  assert.equal(here.code, 0, JSON.stringify(here.json));
  assert.equal(here.json.effort, effort);
  assert.equal(here.json.entered, 'runtime');
  assert.equal(here.json.branch, RUNTIME_BRANCH);

  const fromMain = aep(dir, 'start', effort);
  assert.equal(fromMain.code, 0, JSON.stringify(fromMain.json));
  assert.equal(path.resolve(fromMain.json.surface), path.resolve(supplied), 'the main checkout is handed the runtime surface, never a second one');
  assert.equal(fromMain.json.move, true);

  const noted = aep(dir, 'record', effort, '--note', 'written from the main checkout');
  assert.equal(noted.code, 0, JSON.stringify(noted.json));
  assert.match(fs.readFileSync(path.join(supplied, '.aep', 'efforts', effort, 'log.md'), 'utf8'), /written from the main checkout/);
  assert.equal(git(dir, 'status', '--porcelain'), '', 'record writes the runtime surface, never the main checkout');
  assert.equal(git(supplied, 'status', '--porcelain'), '', 'and commits what it wrote');

  const raised = aep(dir, 'raise', effort, 'full', '--reason', 'grew');
  assert.equal(raised.code, 0, JSON.stringify(raised.json));
  assert.match(fs.readFileSync(path.join(supplied, '.aep', 'efforts', effort, 'spec.md'), 'utf8'), /^lane: full$/m);
  git(supplied, 'commit', '--quiet', '-am', 'docs: raise');

  const board = aep(dir, 'status', '--json').json.boards[0];
  assert.deepEqual(board.efforts.map((entry) => [entry.effort, entry.branch]), [[effort, RUNTIME_BRANCH]]);

  tick(supplied, effort, '01-a');
  assert.equal(aep(supplied, 'land', effort, '01', '--message', 'feat: a').code, 0);
  const closed = aep(dir, 'close', effort, '--stop', 'review left open');
  assert.equal(closed.code, 0, JSON.stringify(closed.json));
  assert.equal(closed.json.surface, 'supplied by the runtime; nothing to release');
  assert.equal(git(supplied, 'rev-parse', '--abbrev-ref', 'HEAD'), RUNTIME_BRANCH, 'close leaves the runtime branch where it is');
});

test('two branches holding one effort stop the command, naming both', (t) => {
  const dir = fixture(t);
  const { effort } = openInRuntime(t, dir, 'standard');
  git(dir, 'branch', 't3code/copy', RUNTIME_BRANCH);
  const { code, json } = aep(dir, 'start', effort);
  assert.equal(code, 1);
  assert.match(json.stop, /held by more than one branch/);
  assert.deepEqual([...json.branches].sort(), ['t3code/abc123', 't3code/copy']);
});

test('dispatch from a runtime surface puts each child under the main checkout, and land integrates into the runtime branch', (t) => {
  const dir = fixture(t, { setup: 'node setup.js' });
  const { supplied, effort } = openInRuntime(t, dir, 'full', ['01-a', '02-b']);
  const sent = aep(supplied, 'dispatch', effort, '01', '02');
  assert.equal(sent.code, 0, JSON.stringify(sent.json));
  const tip = git(supplied, 'rev-parse', 'HEAD');
  for (const child of sent.json.children) {
    assert.ok(child.created);
    assert.equal(path.dirname(path.resolve(child.surface)), path.join(dir, '.aep', 'worktrees', effort));
    assert.equal(git(child.surface, 'merge-base', 'HEAD', tip), tip, 'the child branches from the runtime branch tip');
    assert.equal(child.setup.ran, true, 'a child surface is AEP\'s, so AEP warms it');
    const scope = JSON.parse(spawnSync(process.execPath, [path.join(child.surface, '.aep', 'scripts', 'scope.mjs'), 'read', '--json'], {
      cwd: child.surface, encoding: 'utf8',
    }).stdout);
    assert.equal(scope.role, 'implementer');
    fs.rmSync(path.join(child.surface, 'warmed.txt'), { force: true });
    write(child.surface, `${child.ticket}.txt`, child.ticket);
    git(child.surface, 'add', '-A');
    git(child.surface, 'commit', '--quiet', '-m', `wip ${child.ticket}`);
  }
  const board = aep(dir, 'status', '--json').json.boards[0];
  assert.deepEqual(board.efforts.map((entry) => entry.branch), [RUNTIME_BRANCH], 'a ticket branch is never the effort\'s branch');

  for (const stem of ['01-a', '02-b']) {
    tick(supplied, effort, stem);
    const landed = aep(dir, 'land', effort, stem.split('-')[0], '--message', `feat: ${stem}`);
    assert.equal(landed.code, 0, JSON.stringify(landed.json));
  }
  assert.ok(fs.existsSync(path.join(supplied, '01-a.txt')) && fs.existsSync(path.join(supplied, '02-b.txt')));
  assert.equal(git(supplied, 'rev-parse', '--abbrev-ref', 'HEAD'), RUNTIME_BRANCH);
  assert.equal(git(dir, 'branch', '--list', `${effort}--*`), '');
});

// --- one effort, continued from one runtime in another ---------------------------

test('work begun in a runtime\'s worktree continues in another runtime: there, or from the main checkout once the runtime lets go', (t) => {
  const dir = fixture(t);
  const { supplied, effort } = openInRuntime(t, dir, 'standard', ['01-a']);

  const handed = aep(dir, 'start', effort);
  assert.equal(handed.code, 0, JSON.stringify(handed.json));
  assert.equal(path.resolve(handed.json.surface), path.resolve(supplied), 'start hands back the directory to continue in');
  assert.equal(handed.json.move, true);
  assert.equal(handed.json.entered, 'elsewhere');
  const refused = aep(dir, 'release', effort);
  assert.equal(refused.code, 1, 'AEP never releases a runtime\'s worktree');
  assert.equal(path.resolve(refused.json.continue_in), path.resolve(supplied));
  assert.equal(aep(supplied, 'start').json.entered, 'runtime', 'a second runtime started in that directory continues there');

  git(dir, 'worktree', 'remove', supplied);
  const taken = aep(dir, 'start', effort);
  assert.equal(taken.code, 0, JSON.stringify(taken.json));
  assert.equal(taken.json.entered, 'created');
  assert.equal(taken.json.branch, RUNTIME_BRANCH, 'the new surface takes the runtime\'s branch, not a new one');
  assert.equal(path.resolve(taken.json.surface), path.join(dir, '.aep', 'worktrees', effort, '_run'));
  tick(taken.json.surface, effort, '01-a');
  assert.equal(aep(dir, 'land', effort, '01', '--message', 'feat: a').code, 0);
  assert.equal(git(dir, 'rev-parse', RUNTIME_BRANCH), git(taken.json.surface, 'rev-parse', 'HEAD'));
});

test('release frees an effort begun in AEP\'s own surface for another runtime, and carries the handoff', (t) => {
  const dir = fixture(t);
  const { surface, effort } = openWithTickets(t, dir, 'standard', ['01-a']);
  write(surface, `.aep/scratch/handoff-${effort}.md`, '# Handoff\n\nResume with: /aep:implement\n');
  write(surface, 'stray.txt', 'x');
  const dirty = aep(dir, 'release', effort);
  assert.equal(dirty.code, 1, 'a release never carries uncommitted work');
  assert.match(dirty.json.stop, /stray\.txt/);
  fs.rmSync(path.join(surface, 'stray.txt'));

  const released = aep(dir, 'release', effort);
  assert.equal(released.code, 0, JSON.stringify(released.json));
  assert.equal(released.json.removed, true);
  assert.ok(!fs.existsSync(surface), 'the surface AEP made is removed');
  const kept = path.join(dir, '.aep', 'scratch', `handoff-${effort}.md`);
  assert.deepEqual(released.json.carried.map((file) => path.resolve(file)), [kept]);
  assert.match(fs.readFileSync(kept, 'utf8'), /Resume with/);
  assert.equal(git(dir, 'status', '--porcelain'), '', 'the handoff stays in ignored scratch');
  assert.equal(aep(dir, 'release', effort).json.released, false, 'release is safe to run twice');

  const supplied = fs.mkdtempSync(path.join(path.dirname(dir), 'aep-runtime-'));
  fs.rmSync(supplied, { recursive: true });
  t.after(() => fs.rmSync(supplied, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  git(dir, 'worktree', 'add', '--quiet', supplied, effort);
  const there = aep(supplied, 'start');
  assert.equal(there.code, 0, JSON.stringify(there.json));
  assert.equal(there.json.entered, 'runtime');
  assert.equal(there.json.effort, effort);
});

test('a runtime that sets up its own worktrees is not set up twice, and the repository can override it', (t) => {
  const t3 = JSON.stringify({ scripts: [{ id: 'install', command: 'node setup.js', runOnWorktreeCreate: true }] });
  const cases = [
    { settings: { setup: 'node setup.js' }, config: t3, ran: false, reason: /t3\.json declares runOnWorktreeCreate/ },
    { settings: { setup: 'node setup.js', 'runtime-setup': 'aep' }, config: t3, ran: true },
    { settings: { setup: 'node setup.js', 'runtime-setup': 'runtime' }, config: null, ran: false, reason: /runtime-setup: runtime/ },
    { settings: { setup: 'node setup.js' }, config: null, ran: true },
  ];
  for (const { settings, config, ran, reason } of cases) {
    const dir = fixture(t, settings);
    if (config) {
      write(dir, 't3.json', config);
      git(dir, 'add', '-A');
      git(dir, 'commit', '--quiet', '-m', 'chore: t3');
    }
    const { supplied, opened, effort } = openInRuntime(t, dir, 'standard');
    const label = `${JSON.stringify(settings)}: ${JSON.stringify(opened.setup)}`;
    assert.equal(opened.setup.ran, ran, label);
    assert.equal(opened.setup.mode, settings['runtime-setup'] ?? 'auto', `the JSON says which setting applied: ${label}`);
    assert.ok(opened.setup.reason, `and why: ${label}`);
    if (reason) assert.match(opened.setup.reason, reason, label);
    if (settings['runtime-setup'] === 'aep') assert.match(opened.setup.reason, /runtime-setup: aep/, label);
    assert.equal(fs.existsSync(path.join(supplied, 'warmed.txt')), ran, label);
    if (!ran) {
      assert.equal(aep(supplied, 'start').json.setup.ran, false, 'start does not run it either while the lockfiles stand');
      write(supplied, 'package-lock.json', '{}');
      git(supplied, 'add', '-A');
      git(supplied, 'commit', '--quiet', '-m', 'chore: lock');
      assert.equal(aep(supplied, 'start', effort).json.setup.ran, true, 'a lockfile change after creation runs setup');
    }
    fs.rmSync(path.join(supplied, 'warmed.txt'), { force: true });
  }
});

test('every command runs from the runtime surface itself', (t) => {
  const dir = fixture(t);
  const { supplied, effort } = openInRuntime(t, dir, 'standard', ['01-a']);

  const noted = aep(supplied, 'record', effort, '--note', 'written in the runtime surface');
  assert.equal(noted.code, 0, JSON.stringify(noted.json));
  assert.match(fs.readFileSync(path.join(supplied, '.aep', 'efforts', effort, 'log.md'), 'utf8'), /written in the runtime surface/);
  assert.equal(git(supplied, 'status', '--porcelain'), '');

  const raised = aep(supplied, 'raise', effort, 'full', '--reason', 'grew');
  assert.equal(raised.code, 0, JSON.stringify(raised.json));
  git(supplied, 'commit', '--quiet', '-am', 'docs: raise');

  const board = aep(supplied, 'status', '--json').json.boards[0];
  assert.deepEqual(board.efforts.map((entry) => [entry.effort, entry.branch]), [[effort, RUNTIME_BRANCH]]);

  tick(supplied, effort, '01-a');
  assert.equal(aep(supplied, 'land', effort, '01', '--message', 'feat: a').code, 0);
  const closed = aep(supplied, 'close', effort, '--stop', 'review left open');
  assert.equal(closed.code, 0, JSON.stringify(closed.json));
  assert.equal(closed.json.surface, 'supplied by the runtime; nothing to release');
  assert.equal(git(dir, 'status', '--porcelain'), '', 'nothing is written into the main checkout');
});

test('a child dispatched from a runtime surface is warmed even where the runtime sets up its own worktrees', (t) => {
  const dir = fixture(t, { setup: 'node setup.js' });
  write(dir, 't3.json', JSON.stringify({ scripts: [{ id: 'install', command: 'node setup.js', runOnWorktreeCreate: true }] }));
  git(dir, 'add', '-A');
  git(dir, 'commit', '--quiet', '-m', 'chore: t3');
  const { supplied, effort, opened } = openInRuntime(t, dir, 'full', ['01-a']);
  assert.equal(opened.setup.deferred, true, 'the runtime surface itself is left to the runtime');
  const sent = aep(supplied, 'dispatch', effort, '01');
  assert.equal(sent.code, 0, JSON.stringify(sent.json));
  const [child] = sent.json.children;
  assert.equal(child.setup.ran, true, 'a child surface is AEP\'s, so AEP warms it');
  assert.ok(fs.existsSync(path.join(child.surface, 'warmed.txt')));
});

test('the default branch never holds an effort, even one merged into it and not yet pushed', (t) => {
  const dir = fixture(t);
  const pushed = git(dir, 'rev-parse', 'HEAD');
  const { supplied, effort } = openInRuntime(t, dir, 'standard');
  git(dir, 'merge', '--quiet', '--no-ff', '-m', 'merge', RUNTIME_BRANCH);
  git(dir, 'worktree', 'remove', supplied);
  git(dir, 'branch', '-D', RUNTIME_BRANCH);
  git(dir, 'update-ref', 'refs/remotes/origin/main', pushed);
  git(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');

  const boards = aep(dir, 'status', '--json').json.boards;
  assert.deepEqual(boards.flatMap((board) => board.efforts.map((entry) => entry.effort)), []);
  const head = git(dir, 'rev-parse', 'HEAD');
  const noted = aep(dir, 'record', effort, '--note', 'x');
  assert.equal(noted.code, 1, 'record finds no branch holding the effort');
  assert.equal(git(dir, 'rev-parse', 'HEAD'), head, 'and commits nothing on the default branch');
});

test('a later branch that edits a merged effort\'s files does not hold it again', (t) => {
  const dir = fixture(t);
  const { supplied, effort } = openInRuntime(t, dir, 'standard');
  git(dir, 'merge', '--quiet', '--no-ff', '-m', 'merge', RUNTIME_BRANCH);
  git(dir, 'worktree', 'remove', supplied);
  git(dir, 'branch', '-D', RUNTIME_BRANCH);

  const later = runtimeSurface(t, dir, 't3code/later');
  fs.appendFileSync(path.join(later, '.aep', 'efforts', effort, 'log.md'), '\n- a later note\n');
  git(later, 'commit', '--quiet', '-am', 'docs: a later note');

  const boards = aep(dir, 'status', '--json').json.boards;
  assert.deepEqual(boards.flatMap((board) => board.efforts.map((entry) => entry.effort)), []);
  assert.equal(aep(dir, 'record', effort, '--note', 'x').code, 1);
});

test('a branch checked out in the main checkout is switched back there, not continued in', (t) => {
  const dir = fixture(t);
  const { supplied, effort } = openInRuntime(t, dir, 'standard');
  git(dir, 'worktree', 'remove', supplied);
  git(dir, 'switch', '--quiet', RUNTIME_BRANCH);
  t.after(() => spawnSync('git', ['switch', '--quiet', 'main'], { cwd: dir }));

  for (const command of ['start', 'release']) {
    const { code, json } = aep(dir, command, effort);
    assert.equal(code, 1, `${command}: ${JSON.stringify(json)}`);
    assert.match(json.stop, /main checkout is never an effort's surface: switch it back to main/, command);
    assert.equal(json.continue_in, undefined, `${command} names no directory to continue in`);
  }
  git(dir, 'switch', '--quiet', 'main');
  assert.equal(aep(dir, 'start', effort).code, 0, 'switched back, start makes the surface');
});

// --- one effort building on another ------------------------------------------------

/** Opens an effort from the main checkout, returning its JSON. */
function openHere(dir, slug, options = {}) {
  draft(dir, slug, options);
  return aep(dir, 'open', slug, '--lane', options.lane ?? 'standard');
}

test('builds-on is legal on a spec and nowhere else', (t) => {
  const dir = fixture(t);
  const opened = openHere(dir, 'base');
  assert.equal(opened.code, 0, JSON.stringify(opened.json));
  const { surface, effort } = opened.json;
  const spec = path.join(surface, '.aep', 'efforts', effort, 'spec.md');
  fs.writeFileSync(spec, fs.readFileSync(spec, 'utf8').replace('lane: standard\n', 'lane: standard\nbuilds-on: [0-nothing]\n'), 'utf8');
  write(surface, `.aep/efforts/${effort}/tickets/01-a.md`, '---\nstatus: open\nbuilds-on: [1]\n---\n\n# feat: a\n\n## Acceptance Criteria\n- [ ] criterion 1: a\n');
  const run = spawnSync(process.execPath, [path.join(surface, '.aep', 'scripts', 'validate.mjs')], { cwd: surface, encoding: 'utf8' });
  const out = `${run.stdout}${run.stderr}`;
  assert.notEqual(run.status, 0);
  assert.match(out, /tickets\/01-a\.md: builds-on is legal only on an effort spec\.md/);
  assert.doesNotMatch(out, /spec\.md: builds-on/);
});

test('an effort building on a merged one opens from the base', (t) => {
  const dir = fixture(t);
  const first = openHere(dir, 'first');
  git(dir, 'merge', '--quiet', '--no-ff', '-m', 'merge', first.json.branch);
  const second = openHere(dir, 'second', { buildsOn: [1] });
  assert.equal(second.code, 0, JSON.stringify(second.json));
  assert.deepEqual(second.json.builds_on, [{ effort: first.json.effort, state: 'merged' }]);
  assert.equal(second.json.base, 'main');
});

test('an effort building on an open one stacks on its branch, and the board shows the edge', (t) => {
  const dir = fixture(t, { stack: 'true' });
  const first = openHere(dir, 'first');
  const second = openHere(dir, 'second', { buildsOn: [first.json.effort] });
  assert.equal(second.code, 0, JSON.stringify(second.json));
  assert.deepEqual(second.json.builds_on, [{ effort: first.json.effort, state: 'open' }]);
  assert.equal(git(dir, 'rev-parse', `${second.json.branch}^`), git(dir, 'rev-parse', first.json.branch), 'the new branch starts at the tip of the one it builds on');

  const board = aep(dir, 'status', '--json').json.boards[0];
  const row = board.efforts.find((entry) => entry.effort === second.json.effort);
  assert.deepEqual(row.builds_on, [{ effort: first.json.effort, state: 'open' }]);
  assert.ok(aep(dir, 'status').json.raw.includes(`builds on ${first.json.effort} (open)`), 'the board prints the edge');
});

test('a runtime branch carrying the effort it builds on is adopted, one carrying another effort is not', (t) => {
  const dir = fixture(t, { stack: 'true' });
  const first = openHere(dir, 'first');
  const other = openHere(dir, 'other');

  const stacked = runtimeSurface(t, dir, 't3code/stacked', first.json.branch);
  draft(stacked, 'third', { buildsOn: [1] });
  const adopted = aep(stacked, 'open', 'third', '--lane', 'standard');
  assert.equal(adopted.code, 0, JSON.stringify(adopted.json));
  assert.equal(adopted.json.branch, 't3code/stacked');

  const fresh = runtimeSurface(t, dir, 't3code/fresh');
  draft(fresh, 'fourth', { buildsOn: [1] });
  const moved = aep(fresh, 'open', 'fourth', '--lane', 'standard');
  assert.equal(moved.code, 0, JSON.stringify(moved.json));
  assert.equal(git(dir, 'merge-base', '--is-ancestor', first.json.branch, 't3code/fresh'), '', 'a thread made from the base moves forward onto the effort it builds on');

  const wrong = runtimeSurface(t, dir, 't3code/wrong', other.json.branch);
  draft(wrong, 'fifth', { buildsOn: [1] });
  const refused = aep(wrong, 'open', 'fifth', '--lane', 'standard');
  assert.equal(refused.code, 1);
  assert.match(refused.json.stop, new RegExp(`already holds ${other.json.effort}`));
});

test('a chain of open efforts is one edge to its tip, in the main checkout and in a runtime thread', (t) => {
  const dir = fixture(t, { stack: 'true' });
  const first = openHere(dir, 'first');
  const second = openHere(dir, 'second', { buildsOn: [first.json.effort] });
  assert.equal(second.code, 0, JSON.stringify(second.json));

  const both = openHere(dir, 'third', { buildsOn: [first.json.effort, second.json.effort] });
  assert.equal(both.code, 0, JSON.stringify(both.json));
  assert.equal(both.json.base, second.json.branch, 'naming the whole chain stacks on its tip');

  const thread = runtimeSurface(t, dir, 't3code/chain', second.json.branch);
  draft(thread, 'fourth', { buildsOn: [second.json.effort] });
  const adopted = aep(thread, 'open', 'fourth', '--lane', 'standard');
  assert.equal(adopted.code, 0, JSON.stringify(adopted.json));
  assert.equal(adopted.json.branch, 't3code/chain', 'a thread carrying the chain is adopted');
});

test('a thread cut from a newer base moves onto the effort it builds on', (t) => {
  const dir = fixture(t, { stack: 'true' });
  const first = openHere(dir, 'first');
  write(dir, 'later.txt', 'later\n');
  git(dir, 'add', 'later.txt');
  git(dir, 'commit', '--quiet', '-m', 'main moves on');

  const thread = runtimeSurface(t, dir, 't3code/newer');
  draft(thread, 'second', { buildsOn: [first.json.effort] });
  const moved = aep(thread, 'open', 'second', '--lane', 'standard');
  assert.equal(moved.code, 0, JSON.stringify(moved.json));
  assert.equal(git(dir, 'merge-base', '--is-ancestor', first.json.branch, 't3code/newer'), '');
});

test('an effort waits where it cannot stack, and an unknown edge stops it, with the draft kept', (t) => {
  const flat = fixture(t);
  const first = openHere(flat, 'first');
  const waits = openHere(flat, 'second', { buildsOn: [first.json.effort] });
  assert.equal(waits.code, 1);
  assert.match(waits.json.stop, /stack: false/);
  assert.deepEqual(waits.json.waits_on, [first.json.effort]);
  assert.ok(fs.existsSync(path.join(flat, '.aep', 'scratch', 'second', 'spec.md')), 'the draft stays in scratch');

  const unknown = openHere(flat, 'third', { buildsOn: ['99'] });
  assert.equal(unknown.code, 1);
  assert.match(unknown.json.stop, /builds-on names 99/);

  const stacked = fixture(t, { stack: 'true' });
  const a = openHere(stacked, 'alpha');
  const b = openHere(stacked, 'beta');
  const both = openHere(stacked, 'gamma', { buildsOn: [a.json.effort, b.json.effort] });
  assert.equal(both.code, 1);
  assert.deepEqual([...both.json.waits_on].sort(), [a.json.effort, b.json.effort].sort());
  assert.ok(fs.existsSync(path.join(stacked, '.aep', 'scratch', 'gamma', 'spec.md')));
});

// --- leases and the session hooks ------------------------------------------------

const A = { CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'session-a' };
const B = { CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'session-b' };

function leaseAt(surface) {
  const file = path.join(surface, '.aep', 'scratch', 'lease.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

function ageLease(surface, minutes) {
  const file = path.join(surface, '.aep', 'scratch', 'lease.json');
  const lease = JSON.parse(fs.readFileSync(file, 'utf8'));
  lease.renewed = new Date(Date.now() - minutes * 60_000).toISOString();
  fs.writeFileSync(file, JSON.stringify(lease), 'utf8');
}

test('start from anywhere hands back the surface, and a lease keeps one session in it', (t) => {
  const dir = fixture(t);
  const { supplied, effort } = openInRuntime(t, dir, 'standard', ['01-a']);

  const first = aepWith(A, dir, 'start', effort);
  assert.equal(first.code, 0, JSON.stringify(first.json));
  assert.equal(path.resolve(first.json.surface), path.resolve(supplied));
  assert.equal(first.json.move, true);
  assert.match(first.json.lease, /^none: taken once the session stands in the surface/);
  assert.equal(leaseAt(supplied), null, 'a session that has still to move takes no lease, so it can hand the surface on');
  const there = aepWith(A, supplied, 'start');
  assert.equal(there.json.move, false, 'standing in the surface, nothing moves');
  assert.equal(there.json.lease, 'taken');
  assert.equal(leaseAt(supplied).session, 'session-a');
  assert.equal(aepWith(A, supplied, 'start').json.lease, 'renewed', 'the same session renews');

  const second = aepWith(B, dir, 'start', effort);
  assert.equal(second.code, 1);
  assert.equal(second.json.held_by.session, 'session-a');
  assert.equal(aep(dir, 'start', effort).code, 1, 'a session with no id still honours a live lease');

  ageLease(supplied, 61);
  const taken = aepWith(B, supplied, 'start', effort);
  assert.equal(taken.code, 0, JSON.stringify(taken.json));
  assert.match(taken.json.lease, /taken over from session-a/);

  const yielded = aepWith(B, dir, 'yield', effort);
  assert.equal(yielded.json.yielded, true, JSON.stringify(yielded.json));
  assert.equal(leaseAt(supplied), null);
  const anonymous = aep(supplied, 'start', effort);
  assert.equal(anonymous.json.lease, 'none: no session id');
  assert.equal(leaseAt(supplied), null, 'with no session id no lease is written');
});

test('start names the runtime it runs under and its seeded playbook, T3 Code before Claude Code', (t) => {
  const dir = fixture(t);
  const opened = openHere(dir, 'detected');
  assert.equal(opened.code, 0, JSON.stringify(opened.json));
  const { effort } = opened.json;
  const startUnder = (env) => {
    const result = aepWith(env, opened.json.surface, 'start', effort);
    assert.equal(result.code, 0, JSON.stringify(result.json));
    return result.json.runtime;
  };

  assert.equal(startUnder({}), null, 'under neither, no runtime');
  const cases = [
    [{ T3CODE_THREAD_ID: 's' }, 'T3 Code', 't3code'],
    [{ CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 's' }, 'Claude Code', 'claude-code'],
    [{ T3CODE_THREAD_ID: 's', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'other' }, 'T3 Code', 't3code'],
  ];
  for (const [env, name, reference] of cases) {
    const runtime = startUnder(env);
    assert.equal(runtime.name, name, JSON.stringify(env));
    assert.equal(runtime.reference, `.aep/references/${reference}.md`);
    assert.ok(fs.existsSync(path.join(dir, runtime.reference)), `${reference} is seeded with no t3.json`);
  }
  assert.equal(leaseAt(opened.json.surface).session, 's', 'under both, the session is the T3 thread');
});

test('release and close leave a surface another session is working in', (t) => {
  const dir = fixture(t);
  const opened = openHere(dir, 'guarded');
  const { surface, effort } = opened.json;
  assert.equal(aepWith(A, surface, 'start').json.lease, 'taken');

  const released = aepWith(B, dir, 'release', effort);
  assert.equal(released.code, 1, JSON.stringify(released.json));
  assert.equal(released.json.held_by.session, 'session-a');
  assert.ok(fs.existsSync(surface), 'the surface stays');
  const closed = aepWith(B, dir, 'close', effort, '--stop', 'not mine');
  assert.equal(closed.code, 1, JSON.stringify(closed.json));
  assert.equal(closed.json.held_by.session, 'session-a');
});

const HOOK = path.join(SRC, 'adapters', 'claude', 'hooks', 'session.mjs');

function hook(event, input, extra = {}) {
  const result = spawnSync(process.execPath, [HOOK, event], {
    input: JSON.stringify(input), encoding: 'utf8', env: cleanEnv(extra),
  });
  return result.stdout ? JSON.parse(result.stdout).hookSpecificOutput.additionalContext : '';
}

test('the session hooks resume an effort, renew its lease each turn, and give it up at the end', (t) => {
  const bare = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'aep-bare-')));
  t.after(() => fs.rmSync(bare, { recursive: true, force: true }));
  assert.equal(hook('start', { cwd: bare, session_id: 's' }), '', 'silent where the repository runs no AEP');

  const dir = fixture(t);
  const { surface, effort } = openWithTickets(t, dir, 'standard', ['01-a']);
  const inSurface = hook('start', { cwd: surface, session_id: 's', source: 'startup' });
  assert.match(inSurface, new RegExp(`this session stands in the surface of effort ${effort}`));
  assert.match(inSurface, /next step: build/);
  const inMain = hook('start', { cwd: dir, session_id: 's', source: 'startup' });
  assert.match(inMain, /open efforts in this repository/);
  assert.ok(inMain.includes(effort));

  assert.equal(aepWith({ CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 's' }, surface, 'start').json.lease, 'taken');
  ageLease(surface, 30);
  const before = Date.parse(leaseAt(surface).renewed);
  hook('stop', { cwd: surface, session_id: 's' });
  assert.ok(Date.parse(leaseAt(surface).renewed) > before, 'Stop renews this session\'s lease');
  hook('stop', { cwd: surface, session_id: 'someone-else' });
  hook('end', { cwd: surface, session_id: 'someone-else' });
  assert.equal(leaseAt(surface).session, 's', 'another session neither renews nor gives it up');
  hook('end', { cwd: surface, session_id: 's' });
  assert.equal(leaseAt(surface), null, 'SessionEnd gives it up');

  // On /clear the environment may already carry the new id; the input names
  // the session that ended, and that is the lease given up.
  assert.equal(aepWith({ CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'old' }, surface, 'start').json.lease, 'taken');
  hook('end', { cwd: surface, session_id: 'old' }, { CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'new' });
  assert.equal(leaseAt(surface), null, 'the ending session is the one in the input');

  // Under T3 Code the thread id names the session, whatever Claude Code calls it.
  assert.equal(aepWith({ T3CODE_THREAD_ID: 'thread' }, surface, 'start').json.lease, 'taken');
  hook('end', { cwd: surface, session_id: 'claude-id' }, { CLAUDECODE: '1', T3CODE_THREAD_ID: 'thread' });
  assert.equal(leaseAt(surface), null, 'the thread lease is given up');
});
