// Computes tracker drift: which efforts have objects disagreeing with their spec.
//
// The label ladder's terminal row turns on an event no run is alive for. A human
// merges, and the run that would have moved the label ended two steps earlier.
// The forge's own merge-time job is the fast owner of that row; this is the slow
// one, and it exists so a repository that declined the offer, or predates it,
// still converges.
//
// It fetches nothing. That is the shape of it rather than an incidental
// property: this is the component that exists for the repository with no
// automation, so a `gh` or `glab` call here would make the fallback carry the
// exact cost it was built to avoid. The caller has already fetched, because the
// caller is a run that was reaching for the tracker anyway. What arrives here is
// that JSON, unmodified.
//
//   node reconcile.mjs [--root <path-to-.aep>] [--observed <file>|-]
//
//   read       <forge>   <n> issues, <n> change requests
//   agree      <effort>  <status>
//   drift      <effort>  issue <n> <observed> want <expected>
//   drift      <effort>  change-request <n> <observed> want <expected>
//   drift      <effort>  issue <n> open after change-request <n> merged
//   unobserved <effort>  no tracker object supplied
//
//   exit 0  every observed effort agrees
//   exit 1  at least one disagreement
//   exit 2  the tree or the observation could not be read
//
// The file wins. Drift is reported as a label to correct and never as a spec to
// edit, including where the drift was a human's edit. And only the derived
// families are compared: `priority:` and the inviting flags were set by a person
// when the effort opened, and re-deriving one overwrites them.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readArtifact, resolveAepRoot, STATUS_LADDER } from './contract.mjs';

/**
 * The `status:` value carried by a label, whatever decorates it.
 *
 * A repository's vocabulary is its own. This one prefixes every label with an
 * emoji, so `status: in progress` arrives wearing one and the bare value does
 * not, and a comparison that missed the difference would report every effort in
 * this repository as drift.
 */
export function statusOf(labels) {
  for (const label of labels) {
    const found = /status:\s*(.+?)\s*$/.exec(label);
    if (found) return `status: ${found[1]}`;
  }
  return null;
}

/**
 * The labels one object may legitimately carry, given the two inputs.
 *
 * An observed change request that merged or closed selects the terminal row, and
 * otherwise the row is projected from `spec.md`. That second input is why the
 * value in `contract.mjs` carries a column the policy's table does not:
 * `status: done` is reachable from no file, because a spec stops at
 * `implemented`, and a consumer left to know that on its own can get it wrong.
 *
 * A set rather than a value, because `accepted` reaches two rows. Taking the
 * first ticket moves the label without moving the field, so an effort mid-run
 * legitimately shows either, and a consumer taking the first matching row would
 * report every run in flight as drift.
 */
export function expectedFor(specStatus, changeRequestState, column) {
  const terminal = changeRequestState === 'MERGED' || changeRequestState === 'CLOSED';
  const rows = terminal
    ? STATUS_LADDER.filter((row) => row.changeRequest !== null)
    : STATUS_LADDER.filter((row) => row.spec === specStatus);
  return [...new Set(rows.map((row) => row[column]))];
}

/**
 * Reads either forge's JSON into one shape, and says which one it read.
 *
 * The two shapes differ in the places that matter, so the discriminator is the
 * data rather than a flag the caller has to pass: GitHub numbers an object
 * `number` and gives labels as objects, GitLab numbers it `iid` and gives labels
 * as strings. A shape matching neither throws rather than parsing to nothing. An
 * empty answer delivered confidently is worse than an error, because a run
 * reading `no drift` cannot tell it from `nothing here was understood`.
 */
export function parseObservation(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`the observation is not JSON: ${error.message}`);
  }
  const issues = parsed?.issues;
  const changeRequests = parsed?.changeRequests;
  if (!Array.isArray(issues) || !Array.isArray(changeRequests)) {
    throw new Error('the observation needs an "issues" array and a "changeRequests" array');
  }

  const every = [...issues, ...changeRequests];
  const github = every.every((object) => Number.isInteger(object?.number));
  const gitlab = every.every((object) => Number.isInteger(object?.iid));
  if (every.length > 0 && !github && !gitlab) {
    throw new Error(
      'the observation matches neither forge: every object needs a number, or every object an iid',
    );
  }
  const forge = gitlab && !github ? 'gitlab' : 'github';

  const numberOf = (object) => (forge === 'gitlab' ? object.iid : object.number);
  const labelsOf = (object, kind) => requireArray(object, kind, 'labels')
    .map((label) => (typeof label === 'string' ? label : label?.name))
    .filter((label) => typeof label === 'string');
  // Absent is not empty. A change request whose closing links were never fetched
  // looks exactly like one that closes nothing, and the difference is the whole
  // answer: unobserved, the change request stops selecting a terminal row, the
  // expectation falls back to projecting `spec.md`, and the script tells its
  // caller to move a correct `status: done` back to `status: in review`. Under
  // the constraint that the file wins, a run acts on that. So a missing field
  // throws, which is what this file's own promise about a confident empty answer
  // is worth.
  const requireArray = (object, kind, field, alternatives = []) => {
    const present = [field, ...alternatives].find((name) => object[name] !== undefined);
    if (present === undefined) {
      throw new Error(
        `${kind} ${object.number ?? object.iid ?? '?'} has no ${[field, ...alternatives].join(' or ')}: `
        + 'the observation was fetched without it, and absent is not the same as empty',
      );
    }
    if (!Array.isArray(object[present])) throw new Error(`${kind} ${present} is not an array`);
    return object[present];
  };

  const closesOf = (object) => requireArray(object, 'change request', 'closingIssuesReferences', ['closesIssues'])
    .map((link) => (typeof link === 'number' ? link : link?.number ?? link?.iid))
    .filter(Number.isInteger);

  // GitLab says `opened` where GitHub says `OPEN`, so upper-casing alone leaves
  // two vocabularies rather than one. The states are mapped as well as cased,
  // because the open-after-merge finding tests for one word and a synonym it
  // does not know reads as a state that is not open, which is silence rather
  // than a wrong answer and therefore the harder kind to notice.
  const STATE_WORDS = { OPENED: 'OPEN', LOCKED: 'OPEN' };
  const stateOf = (object) => {
    const raw = String(object.state ?? '').toUpperCase();
    return STATE_WORDS[raw] ?? raw;
  };

  const read = (object, kind) => ({
    number: numberOf(object),
    state: stateOf(object),
    labels: labelsOf(object, kind),
  });

  // GitHub calls the body `body` and GitLab `description`. Absent is allowed
  // here, unlike the fields above: an observation fetched before 4.15 has no
  // body, and its change requests still reconcile by their closing reference.
  const bodyOf = (object) => [object.body, object.description].find((text) => typeof text === 'string') ?? '';

  return {
    forge,
    issues: issues.map((object) => read(object, 'issue')),
    changeRequests: changeRequests.map((object) => ({
      ...read(object, 'change request'),
      closes: closesOf(object),
      effort: effortOfBody(bodyOf(object)),
    })),
  };
}

/**
 * The effort a pull request's `AEP` block names on its `effort:` line, or null.
 *
 * Only the folded block is read. The same words in the human part are prose a
 * person wrote, and a pull request that quotes another effort's path there must
 * not be tied to it.
 */
export function effortOfBody(body) {
  const block = /<details>\s*<summary>AEP<\/summary>([\s\S]*?)<\/details>/i.exec(String(body ?? ''));
  if (!block) return null;
  const line = /^effort:\s*(?:\S*\/)?efforts\/([^/\s]+)\/?\s*$/m.exec(block[1]);
  return line ? line[1] : null;
}

/** An effort directory's numeric prefix: its issue's number, or its pull request's where it has no issue. */
export function effortNumber(effort) {
  const found = /^(\d+)-/.exec(effort);
  return found ? Number(found[1]) : null;
}

/**
 * Reads every effort's `spec.md` status, in directory order.
 *
 * An unreadable spec is an error rather than a skip, for the reason
 * `frontier.mjs` gives about a partial graph: a reconciliation computed over
 * most of the tree is worse than none, because it looks complete.
 */
export function readEfforts(root) {
  const dir = path.join(root, 'efforts');
  if (!fs.existsSync(dir)) throw new Error('no efforts directory');

  const efforts = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const spec = path.join(dir, name, 'spec.md');
    if (!fs.existsSync(spec)) continue;
    const artifact = readArtifact(spec);
    if (artifact.errors.length > 0) {
      throw new Error(`${name}/spec.md: ${artifact.errors.join('; ')}`);
    }
    efforts.push({ effort: name, status: artifact.fields.status ?? null });
  }
  return efforts;
}

/**
 * Compares each effort's objects against what its files project.
 *
 * One finding per disagreement rather than one per effort, so every line names
 * the object to correct. An effort with neither object observed is `unobserved`
 * and not agreement: a repository with no tracker learns nothing here, and
 * saying so is the answer rather than a fault.
 */
export function reconcile(efforts, observation) {
  const findings = [];
  const issues = new Map((observation?.issues ?? []).map((object) => [object.number, object]));
  const changeRequests = observation?.changeRequests ?? [];

  for (const { effort, status } of efforts) {
    const number = effortNumber(effort);
    // The AEP block names its effort; a pull request with no block falls back
    // to the issue it closes, which is how every pull request before 4.15 links.
    const byBlock = changeRequests.find((object) => object.effort === effort);
    const changeRequest = byBlock
      ?? (number === null
        ? undefined
        : changeRequests.find((object) => object.effort === null && object.closes.includes(number)));
    // An effort numbered for its pull request has no issue. Where the forge
    // numbers issues apart, an issue may share that number, so a pull request
    // linked by its block brings only the issue it closes.
    const issue = number === null || (byBlock && !byBlock.closes.includes(number))
      ? undefined
      : issues.get(number);

    if (!issue && !changeRequest) {
      findings.push({ verdict: 'unobserved', effort, detail: 'no tracker object supplied' });
      continue;
    }

    const before = findings.length;
    let agreed = null;

    for (const [object, kind, column] of [
      [issue, 'issue', 'issue'],
      [changeRequest, 'change-request', 'pullRequest'],
    ]) {
      if (!object) continue;
      const expected = expectedFor(status, changeRequest?.state ?? null, column);
      const observed = statusOf(object.labels);
      if (expected.includes(observed)) {
        agreed = agreed ?? observed;
        continue;
      }
      findings.push({
        verdict: 'drift',
        effort,
        detail: `${kind} ${object.number} ${observed ?? 'none'} want ${expected.join(' or ')}`,
      });
    }

    // The other half of the terminal row, and the half no label can show. An
    // issue still open after the change request that merged means the closing
    // keyword was missing, or was written in the form that only references,
    // which is how an issue survives its own merge.
    if (changeRequest?.state === 'MERGED' && issue?.state === 'OPEN') {
      findings.push({
        verdict: 'drift',
        effort,
        detail: `issue ${issue.number} open after change-request ${changeRequest.number} merged`,
      });
    }

    if (findings.length === before) {
      findings.push({ verdict: 'agree', effort, detail: agreed ?? 'none' });
    }
  }
  return findings;
}

function main() {
  const args = process.argv.slice(2);
  const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);

  const root = resolveAepRoot(value('--root'), import.meta.url);
  if (!root) {
    process.stderr.write('no .aep/ found. Pass --root, or run from a repository that has one\n');
    process.exit(2);
  }

  // A flag with no value is not the same as no flag. `--observed` on its own,
  // or followed by another flag, means a caller asked for a comparison and would
  // otherwise be told every effort is unobserved and nothing disagrees, at exit
  // 0, which is the answer for a repository that has no tracker at all.
  const source = value('--observed');
  if (args.includes('--observed') && (!source || source.startsWith('--'))) {
    process.stderr.write('--observed needs a file, or - to read the observation on stdin\n');
    process.exit(2);
  }
  let observation = null;
  let efforts;
  try {
    efforts = readEfforts(root);
    if (source) {
      const raw = source === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(source, 'utf8');
      observation = parseObservation(raw);
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }

  if (observation) {
    process.stdout.write(`read       ${observation.forge}  ${observation.issues.length} issues, `
      + `${observation.changeRequests.length} change requests\n`);
  }
  const findings = reconcile(efforts, observation);
  for (const finding of findings) {
    process.stdout.write(`${finding.verdict.padEnd(10)} ${finding.effort}  ${finding.detail}\n`);
  }
  process.exit(findings.some((finding) => finding.verdict === 'drift') ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
