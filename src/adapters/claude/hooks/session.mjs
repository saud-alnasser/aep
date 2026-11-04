// Keeps a session and an effort's surface in step, so moving between runtimes
// needs no command from the developer.
//
//   node session.mjs start   SessionStart: says, as facts, which effort this
//                            session stands in and its next step, or which
//                            efforts are open and where
//   node session.mjs stop    Stop: renews this session's lease on the surface
//   node session.mjs end     SessionEnd: gives the lease up, so the next
//                            session takes the effort at once
//
// The hook reads its input on stdin and imports the repository's own installed
// `aep.mjs`, so the lease and the board have one implementation, the one the
// repository runs. A repository without AEP, or on a release without these
// exports, gets silence: a hook that cannot help must not get in the way.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const CONTEXT_LIMIT = 9000;

function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function topOf(cwd) {
  const result = spawnSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  return result.status === 0 ? path.resolve(result.stdout.trim()) : null;
}

function same(a, b) {
  const norm = (p) => path.resolve(p).replace(/\\/g, '/').toLowerCase();
  return norm(a) === norm(b);
}

function describe(effort, repo) {
  const surface = effort.surface && !path.isAbsolute(effort.surface) ? path.join(repo, effort.surface) : effort.surface;
  const parts = [`${effort.effort} (${effort.lane}, ${effort.status})`];
  parts.push(surface ? `surface ${surface}` : 'no surface');
  if (effort.branch && effort.branch !== effort.effort) parts.push(`branch ${effort.branch}`);
  if (effort.next) parts.push(`next step: ${effort.next}`);
  if (effort.tickets?.total) parts.push(`${effort.tickets.resolved}/${effort.tickets.total} tickets resolved`);
  if (effort.builds_on?.length) parts.push(`builds on ${effort.builds_on.map((need) => `${need.effort} (${need.state})`).join(', ')}`);
  if (effort.lease) {
    parts.push(`lease: session ${effort.lease.session}${effort.lease.runtime ? ` in ${effort.lease.runtime}` : ''}, ${effort.lease.state}, active ${effort.lease.active_minutes_ago} minutes ago`);
  }
  if (effort.waiting?.length) parts.push(`waiting on the human: ${effort.waiting.join('; ')}`);
  return { surface, text: parts.join('; ') };
}

async function main() {
  const event = process.argv[2];
  const input = readInput();
  const cwd = input.cwd || process.cwd();
  const top = topOf(cwd);
  if (!top) return;
  const script = path.join(top, '.aep', 'scripts', 'aep.mjs');
  if (!fs.existsSync(script)) return;
  let aep;
  try {
    aep = await import(pathToFileURL(script).href);
  } catch {
    return;
  }
  // The session id the command line uses, so the lease the agent took with
  // `aep start` is the one renewed and given up here. The input's `session_id`
  // is the session this event is about, which on `/clear` is the one ending, so
  // it stands in for Claude Code's own variable; a runtime that started Claude
  // Code still wins by the order of the runtime table.
  const env = input.session_id ? { ...process.env, CLAUDE_CODE_SESSION_ID: input.session_id } : process.env;
  const session = aep.detectRuntime?.(env)?.session ?? input.session_id ?? null;
  const aepDir = path.join(top, '.aep');

  if (event === 'stop') {
    aep.renewLease?.(aepDir, session);
    return;
  }
  if (event === 'end') {
    aep.yieldLease?.(aepDir, session);
    return;
  }
  if (event !== 'start' || typeof aep.boardFor !== 'function') return;

  let board;
  try {
    board = aep.boardFor(top);
  } catch {
    return;
  }
  if (!board?.efforts?.length) return;
  const rows = board.efforts.map((effort) => describe(effort, board.repo));
  const here = rows.find((row) => row.surface && same(row.surface, top));
  const lines = here
    ? [`AEP: this session stands in the surface of effort ${here.text}.`]
    : [
      'AEP: open efforts in this repository:',
      ...rows.map((row) => `- ${row.text}`),
      '`aep start <effort>` returns the surface an effort is worked in. Where it reports `move: true`, the work continues in that surface, by the move the runtime\'s reference in .aep/references/ describes.',
    ];
  let context = lines.join('\n');
  if (context.length > CONTEXT_LIMIT) context = `${context.slice(0, CONTEXT_LIMIT)}\n(cut; run aep status for the rest)`;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }));
}

main().catch(() => {});
