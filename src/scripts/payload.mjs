// What a release installs, and what it moved to get there, declared once.
//
// Both the installer and the verification suite read this, so "what ships" has a
// single home. A file that is neither payload, nor seed, nor listed as
// build-only is a verification failure rather than a silent omission. The
// failure this manifest exists to remove is a new protocol artifact that nobody
// installs because nobody remembered to add it to a copy list.
//
// `MOVES` is the exception to the file's title and sits here deliberately: a
// move is not a thing a release installs, it is an instruction about a tree that
// already exists. It belongs beside the payload because it is read by the same
// two callers and describes the same release, and giving it its own module would
// buy separation nobody needs at the cost of a second import for one array.

/** Protocol-owned files installed at the root of `.aep/`. */
export const PAYLOAD_FILES = ['protocol.md'];

/** Protocol-owned directories copied wholesale into `.aep/`. */
export const PAYLOAD_DIRS = ['policies', 'skills', 'agents', 'templates'];

/**
 * Protocol-owned files a release moved, and where their content now ships.
 *
 * A move is not a retirement. `copyDir` reports a protocol-owned file the
 * release no longer ships and never deletes it, because deciding a file is
 * obsolete is a human's call: right for a concept that was dropped, and wrong
 * for one that only changed address. Left in place, the old file keeps
 * resolving, and the tree is governed by two copies of one text.
 *
 * So the release declares its moves and the installer applies them under
 * `--update`: it removes the protocol-owned source, repairs the links that
 * pointed at it, and reports both. One declaration drives the removal, the
 * rewrite, and the verification, so the three cannot disagree.
 *
 * `since` is the release that made the move. An entry may be dropped once no
 * supported tree predates it. A manifest that only grows is one nobody prunes.
 *
 * `was` is what the protocol's version of that file hashed to when it moved,
 * under the same content hash a release stamps with. Ownership is otherwise a
 * fact about location, and a move source is the one path location cannot answer
 * for: the file is gone from the payload, so the manifest does not name it, and
 * a repository is entitled to write its own file under a name the protocol
 * vacated. Content answers what location cannot. A match is the protocol's
 * leftover and is removed; anything else is somebody's work and is reported and
 * left alone.
 *
 * The nine from 2.2.0 were recovered from the commit that removed them; 4.0.0
 * folded `authority` and `engineering` into the bootstrap, and their 2.2.0
 * sources now point there too. **A new move
 * without a `was` is a defect**, and the suite says so: without it the installer
 * is back to deleting a file it cannot identify.
 */
export const MOVES = [
  { from: 'rules/precedence.md', to: 'protocol.md', since: '2.2.0', was: 'ed2d2ab2056a234382967bceb28e2140665a0c3f967af2f421bfe23d7cfcb140' },
  { from: 'rules/boundary.md', to: 'protocol.md', since: '2.2.0', was: 'e7b2521f8ab240c3bf1da89722444bba87cfcd6595bb3a81a1338cb0ca252d5f' },
  { from: 'rules/engineering.md', to: 'protocol.md', since: '2.2.0', was: '184a48399e02cf56ec3c29d6b1845a71d3411013dd52523600b4de71a01ef3c9' },
  { from: 'rules/evidence.md', to: 'protocol.md', since: '2.2.0', was: 'ca94f29efe6c786b0824de4e36e8d7e57e0442381d43a8ded46f60cd17d767bd' },
  { from: 'rules/change-control.md', to: 'policies/execution.md', since: '2.2.0', was: '95c012cdec66b27ab025c591659a880484895cc9e4ff5864d07fe5412beb872d' },
  { from: 'rules/sub-agents.md', to: 'policies/execution.md', since: '2.2.0', was: 'e144175d0c08a0694dc6a15e997edd45646b031151f301fe31f2997bf9098e62' },
  { from: 'rules/artifacts.md', to: 'policies/artifacts.md', since: '2.2.0', was: '84c08a0cd9ee9473f8c18e475c6617757ad9f0a5b7c32b767fda3bc7953be6fa' },
  { from: 'rules/ownership.md', to: 'policies/artifacts.md', since: '2.2.0', was: 'fd91ca623bbd60c9fa990cbf996dd940fc5ad6bd952baea3fbd2417be59d8753' },
  { from: 'rules/placement.md', to: 'policies/artifacts.md', since: '2.2.0', was: 'd2bc66fbd7e39479ac52b18e64c2a3459bc8a1a871e946f915ce2f00d0bf905b' },
  { from: 'policies/authority.md', to: 'protocol.md', since: '4.0.0', was: 'e67bba113de4adcd397a436c6233bfe4819f3442415bdddc317680c81e04d8a9' },
  { from: 'policies/engineering.md', to: 'protocol.md', since: '4.0.0', was: '086fdb3d2362afe18267e5da7abb3d8997bd87fce9f2cceb90bdc8f727618360' },
];

/**
 * What a release asks of the **reader**, where moving files is not enough.
 *
 * `MOVES` covers everything a release does to a tree. Some releases also require
 * something a release cannot do for itself, most often because the thing to
 * change is repository-owned, and an upgrade correctly refuses to touch it. That
 * knowledge exists at release time and has nowhere to go: `CHANGELOG.md` is not
 * payload, so a repository running an upgrade has never received it.
 *
 * A notice is that knowledge, declared, and filtered by exactly the predicate
 * `MOVES` uses, so the two cannot disagree about which releases a tree is
 * crossing. A tree already at or past `since` is shown nothing.
 *
 * `check` is an instruction, not a changelog entry. It says what to look at and
 * why it matters. **A release with nothing to ask of the reader declares no
 * notice**, and most releases will not.
 */
export const NOTICES = [
  {
    since: '4.5.0',
    check:
      'Every repository now gets .aep/references/t3code.md and .aep/references/claude-code.md, ' +
      'each with a playbook that aep start points at through runtime.reference: how to build ' +
      'tickets, review, research, and continue an effort with the tools of that runtime. This ' +
      'upgrade wrote whichever of the two was missing. If you already had a t3code.md, it is ' +
      'yours and was left as it was: compare it with the shipped seed and take the Playbook ' +
      'section, which replaces the old Running a child and Continuing in another runtime ' +
      'sections. If you do not use one of these runtimes, keep its reference anyway: the ' +
      'runtime is the choice of each developer, and a teammate may open this repository in it.',
  },
  {
    since: '4.2.0',
    check:
      'If this repository runs AEP through T3 Code, your .aep/references/t3code.md is stale ' +
      'and an upgrade never edits a reference you own. Compare it with the shipped seed and ' +
      'take what applies: T3 Code now places thread worktrees outside the project, under ' +
      '~/.t3/worktrees/ by default, so the old .t3-worktrees/ ignore line is no longer needed ' +
      'unless you moved that location inside the repository. aep open in a worktree the ' +
      'runtime supplied now commits the effort on the branch the runtime made, and never ' +
      'switches away from it. A new optional field, runtime-setup, in the frontmatter of ' +
      'your .aep/rules/version-control.md says who sets up such a worktree: auto (the ' +
      'default, read when the field is absent), aep, or runtime. Under T3 Code, set aep if ' +
      'you never imported the runOnWorktreeCreate action from t3.json, and runtime if your ' +
      'setup lives in T3 actions and not in t3.json. Repositories that do not use T3 Code ' +
      'need do nothing.',
  },
  {
    since: '4.1.0',
    check:
      'policies/reporting now chooses one of three registers by who reads a text. Public ' +
      'text (a README, docs, a changelog, a code comment) keeps skills/prose. Session ' +
      'output, commit messages, pull request titles and bodies, briefs, returns, and new ' +
      'effort artifacts take a controlled register based on ASD-STE100, whose craft is the ' +
      'new skills/plain. If one of your own rules says how commit messages, pull request ' +
      'bodies, or briefs read, or uses the old words governed and exempt, reconcile it now: ' +
      'a rule may tighten a policy and never soften one. No file you own changes, effort ' +
      'artifacts already written are not rewritten, and nothing starts failing validation.',
  },
  {
    since: '4.0.0',
    check:
      'The tracker is now opt-in. Your .aep/rules/version-control.md takes three settings in ' +
      'its frontmatter: tracker (none, github, or gitlab), setup (a command that readies a ' +
      'fresh worktree), and stack (true where a stacking tool submits changes). Read with no ' +
      'tracker field, a repository gets none: no issue, pull request, label, or forge call, ' +
      'and the log.md of each effort is the whole run log. If you used issues and pull requests ' +
      'under 3.x, set tracker to the forge your references/ names (github.md or gitlab.md), ' +
      'or it stops. Efforts already in flight finish under the rules they started with: put ' +
      'lane: full in the frontmatter of every spec.md that is draft or accepted (a spec with ' +
      'no lane is read as full, so this makes visible what already holds). A new effort ' +
      'picks quick, standard, or full when /specify opens it. The ticket branch is now ' +
      '<effort>--<ticket>; existing branches keep their names. Every git and worktree step ' +
      'runs through node .aep/scripts/aep.mjs.',
  },
  {
    since: '3.5.0',
    check:
      'The status label ladder now reaches its terminal value without anybody remembering ' +
      'to move it. Two things arrive. First, a merge-time job for your forge, offered once ' +
      'at install and once here: it fires when a human merges, moves status: done onto the ' +
      'change request and the issue it closes, and reaches the same value for a change ' +
      'request closed without merging. On GitHub it needs nothing provisioned; on GitLab it ' +
      'needs a project access token with api scope, and the offer says so before it says ' +
      'anything else. It is written into your repository only if you accept, and where you ' +
      'already run a workflow that assigns labels it is proposed as an addition to that file ' +
      'rather than a second one. Decline and nothing is written: the decision is recorded in ' +
      'your own .aep/rules/version-control.md as an ordinary decision, and it is read ' +
      'offer is made again, so you are asked once rather than every upgrade. Delete that ' +
      'paragraph and you will be asked again, which is how you change your mind. Second, ' +
      '.aep/scripts/reconcile.mjs, which needs no decision from you and arrives either ' +
      'reads an observation you already fetched, on stdin or from a file, and prints which ' +
      'efforts have tracker labels disagreeing with their spec.md, including an issue left ' +
      'open after its change request merged. It makes no network call of its own, so a ' +
      'repository that declined the job still converges, and a repository with no tracker ' +
      'runs it and is told every effort is unobserved, which is the answer rather than a ' +
      'fault. .aep/references/github.md and .aep/references/gitlab.md carry the fetch ' +
      'the observation, and an upgrade never edits a reference you own, so add it yourself ' +
      'or read it from the shipped seed.',
  },
  {
    since: '3.4.0',
    check:
      'validate.mjs now looks one level outside the tree. Until this release an artifact ' +
      'written to your repository root instead of into .aep/ was not wrong to the check, ' +
      'it was absent, so a whole effort could sit beside .aep/ while validate reported no ' +
      'failures. It now reads the root\'s immediate children and reports a directory ' +
      'holding AEP artifacts, naming what it found, where it sits, and where it belongs. ' +
      'A tree that validated yesterday can fail today, and what changed is that a defect ' +
      'you already had became visible. The fix is to move the directory under .aep/ and ' +
      'run validate again. AEP will not move it for you: relocating your files is a write ' +
      'nobody asked for and the right destination is not always the obvious one. Your own ' +
      'templates/, references/, or contexts/ at the root is not a finding, because ' +
      'recognition is by what the files are and never by the name of the directory.',
  },
  {
    since: '3.0.0',
    check:
      'Two skills are gone and one moved. /commit is no longer a command: landing is ' +
      'part of finishing a task, so its mechanics run inline at the end of /implement, ' +
      'and the two judgements it made about a whole effort, whether the effort is ' +
      'implemented and whether the change falsified a context or a reference, are made ' +
      'once the effort has no unresolved task left. skills/tasks/labels.md is gone with ' +
      'its ladder and its approval gate; what replaces it asks which of your labels ' +
      'describe an effort rather than which label carries a grouping fact. And ' +
      'skills/commit/conflicts.md is now skills/implement/conflicts.md, beside the skill ' +
      'that reads it. Your own reference for a tracker is untouched, and the query it ' +
      'records is still what the frontier is read from.',
  },
  {
    since: '3.0.0',
    check:
      'modes/ is gone. A mode existed to state a posture, its mindset and what that ' +
      'mindset gives up, and every one of those now sits inside the skill that used to ' +
      'enter it, where it is read at the moment it applies rather than fetched. Delete ' +
      '.aep/modes/: validate.mjs now fails a tree that still has one, because a ' +
      'directory nothing ships and nothing links to is a second copy of text the skills ' +
      'now carry. If you wrote a mode of your own, its content belongs in your own skill ' +
      'or rule. Nothing under modes/ is preserved by the upgrade, and nothing there is ' +
      'deleted for you either.',
  },
  {
    since: '2.7.0',
    check:
      'Text an agent writes for you is now governed. policies/reporting covered the turn ' +
      'report and now covers everything a human reads: session output, commit messages, pull ' +
      'request titles and bodies, comments in source, and your own documentation. It fixes ' +
      'four things a script can check, no em dashes among them, and the new skills/prose ' +
      'carries the rest as craft rather than law. If your own rules say anything about how ' +
      'prose reads here, reconcile them now: a rule may tighten a policy and never soften ' +
      'one, so a rule permitting what the policy prohibits is the thing to look for. No file ' +
      'you own changes, and nothing starts failing validation.',
  },
  {
    since: '2.5.0',
    check:
      'A context now sits at contexts/<area>.md or contexts/<project>/<area>.md, one project ' +
      'directory deep, and no more. The nested form is for a monorepo, where two projects would ' +
      'otherwise fight over the same area name; the directory holds the name, while paths: still ' +
      'decides when the context loads. If you have a context nested deeper than that, ' +
      'validate.mjs now fails it: move it up to contexts/<project>/<area>.md, or flatten it. ' +
      'The upgrade will not move it for you, since contexts/ is yours, and an upgrade never edits a ' +
      'file you own. A flat tree needs no change at all.',
  },
  {
    since: '2.3.0',
    check:
      'Tasks are files under efforts/<effort>/tickets/ and are never in a tracker. If 2.3.0 ' +
      'had you record a query in references/github.md, references/gitlab.md, or your own ' +
      'reference for finding an effort\'s open work, nothing reads that query any more: the ' +
      'frontier is computed from the ticket files, which is what keeps blocked-by machine- ' +
      'readable. What the tracker still carries is the effort itself, one issue and one pull ' +
      'request, and the part of that section naming what carries an effort is still right. ' +
      'An upgrade never edits a reference you own, so this is yours to trim.',
  },
];

/** Scripts installed to `.aep/scripts/`, available to every configured repository. */
export const PAYLOAD_SCRIPTS = [
  'contract.mjs',
  'frontier.mjs',
  'index.mjs',
  'validate.mjs',
  'position.mjs',
  'scope.mjs',
  'reconcile.mjs',
  'check.mjs',
  'aep.mjs',
];

/**
 * Scripts that build or check the distribution and are never installed.
 * They run from a checkout of the protocol repository, not from `.aep/`.
 */
export const BUILD_ONLY_SCRIPTS = [
  'payload.mjs',
  'adapters.mjs',
  'install.mjs',
  'manifest.mjs',
  'release.mjs',
  'verify.mjs',
];

/**
 * The release script's baseline, at the distribution root rather than beside the
 * scripts because everything in `scripts/` is `.mjs`, so a consuming
 * `package.json` cannot then change how any of it parses.
 *
 * Build-time only. It records what each shipped artifact hashed to when it was
 * last stamped, which is how a release knows what actually moved. An installed
 * tree has no use for it and never receives it.
 */
export const STAMPS_SOURCE = 'stamps.json';

/** Source of `.aep/.gitignore`. Kept undotted in the distribution so it governs nothing here. */
export const GITIGNORE_SOURCE = 'gitignore';

/**
 * Directories a repository owns. Created so there is somewhere to put things.
 *
 * `rules/` is one of them: governance the protocol defines ships as policies,
 * and `rules/` holds what this repository decides for itself. It arrives empty
 * apart from the version-control seed.
 *
 * Re-exported from `contract.mjs` rather than restated. The same list decides
 * what an upgrade preserves and what the validator will not police, and two
 * copies of it would disagree on the first directory either version gains.
 */
export { REPOSITORY_DIRS } from './contract.mjs';

/**
 * The canonical entrypoint, re-exported for the same reason `REPOSITORY_DIRS`
 * is: the seed that writes it and the target table that points at it both need
 * the name, and two copies would disagree the day it changes.
 */
export { CANONICAL_ENTRYPOINT } from './contract.mjs';
import { CANONICAL_ENTRYPOINT } from './contract.mjs';

/**
 * The seeded label vocabulary, offered to the tracker rather than written into
 * the tree.
 *
 * It is a seed by every test that matters: shipped as a starting point, owned by
 * the repository the moment it is accepted, and never reconsidered afterwards.
 * What it is not is a file that lands under `.aep/`, because the thing it seeds
 * lives in the tracker. A repository that already has labels keeps them and AEP
 * maps onto what is there; this set exists for the one that has only its
 * tracker's defaults.
 *
 * Declared here rather than in `SEEDS` so that neither list has to grow a
 * conditional for the other: every entry in `SEEDS` has a path in the tree, and
 * this one never will.
 */
export const LABEL_SEED = 'seed/labels.json';

/**
 * Directories a past release owned and this one does not ship.
 *
 * Not a move: a move relocates content, and these hold a concept that is gone.
 * Not a deletion either -- deciding a file is obsolete is a human's call, and a
 * repository may have written its own notes inside one. So an upgrade reports
 * them and leaves them, which is what `retired` already means for a file.
 *
 * Without this list the failure is silent in the worst way: ownership is a
 * lookup now, so a directory the manifest does not name reads as the
 * repository's, and `.aep/modes/` sits in an upgraded tree forever with nothing
 * saying it stopped meaning anything.
 */
export const RETIRED_DIRS = [
  { dir: 'modes', since: '3.0.0', was: 'the working posture, now stated in each skill' },
];

/** Directories that stay local to a working tree and are gitignored. */
export { PER_CLONE_DIRS } from './contract.mjs';

/**
 * A detected reference seed. Every reference is named for its tool, lands at
 * `references/<tool>.md`, and installs only where `paths`, or for a forge a git
 * remote, shows the repository actually uses it.
 *
 * `paths` are matched by existence, not by glob, so each variant a tool is
 * commonly configured under is listed explicitly. A detector that guesses wider
 * than that installs a reference for a tool the repository does not have, which
 * is the one failure a seed must not have.
 *
 * **A reference for a tracker is declared with `forge()` below, never with
 * this.** A tracker reference records how an effort's state projects onto that
 * forge's labels, and the terminal value of that projection is the one no file
 * can derive: merged is a fact the forge holds and the repository never learns.
 * Something has to move the label at merge, and that something is native to the
 * forge, so it ships beside the reference or it ships nowhere. `forge()` is what
 * makes the pair inseparable, and the suite fails a reference carrying the
 * tracker section with no automation declared next to it. Adding a forge is
 * therefore two files, and finding that out from a red suite beats finding it
 * out from a tracker whose labels stopped being true after a merge.
 */
const reference = (tool, paths, remote) => ({
  source: `seed/references/${tool}.md`,
  target: `references/${tool}.md`,
  detect: remote ? { paths, remote } : { paths },
});

/** A reference with no `detect`, so it installs in every repository. */
const everywhere = (tool) => ({
  source: `seed/references/${tool}.md`,
  target: `references/${tool}.md`,
});

/**
 * A tracker reference, and the merge-time job that has to arrive with it.
 *
 * `automation` is a path in the distribution and deliberately not a seed of its
 * own: it has no `target`, so the installer, which copies `source` to `target`
 * for every entry in `SEEDS` and knows nothing about this field, cannot write it
 * into anybody's repository. That is the point. A workflow file is executable
 * and lands outside `.aep/`, which makes it a larger thing to put in someone's
 * repository than a reference file, so it is a candidate that `[[skills/install]]`
 * offers with its exact text and writes only on a yes.
 *
 * Where it lands is that offer's to decide rather than this file's, which is why
 * no target is named here: a repository already running a labeler gets the job
 * added to that workflow instead of a second one beside it.
 */
const forge = (tool, paths, remote) => ({
  ...reference(tool, paths, remote),
  automation: `seed/automation/${tool}.yml`,
});

/**
 * Repository-owned starting points.
 *
 * Every one installs as `owner: repository`, is written **once**, and is never
 * touched again by any upgrade, which is what makes shipping a starting point
 * safe. Each is a draft to be corrected, not a description that is already true;
 * they say so in their own first paragraph, because a seeded file that reads as
 * authoritative is worse than no file at all.
 *
 * `detect` gates installation on evidence in the repository. A seed with no
 * `detect` always installs. `paths` matches if any listed path exists; `remote`
 * matches if any git remote URL contains the string.
 *
 * `root: true` targets the repository root rather than `.aep/`. Exactly one seed
 * needs it: the entrypoint, which the harness loads by name and therefore
 * cannot live inside `.aep/`. Being outside the tree, it carries no AEP
 * frontmatter: it is the repository's own file from the moment it is written.
 *
 * The catalogue below is wide on purpose: a repository that runs a tool gets a
 * starting point for it, and one that does not gets nothing. Breadth costs the
 * installing repository nothing, because the detector decides.
 */
export const SEEDS = [
  { source: 'seed/AGENTS.md', target: CANONICAL_ENTRYPOINT, root: true },
  { source: 'seed/contexts/repository.md', target: 'contexts/repository.md' },
  { source: 'seed/rules/version-control.md', target: 'rules/version-control.md' },

  // Version control and forges.
  reference('git', ['.git']),
  forge('github', ['.github'], 'github.com'),
  forge('gitlab', ['.gitlab-ci.yml'], 'gitlab'),
  reference('graphite', ['.graphite_repo_config', '.graphite']),

  // JavaScript package managers and runtimes.
  reference('pnpm', ['pnpm-lock.yaml']),
  reference('npm', ['package-lock.json']),
  reference('yarn', ['yarn.lock']),
  reference('bun', ['bun.lockb', 'bun.lock']),
  reference('deno', ['deno.json', 'deno.jsonc', 'deno.lock']),
  reference('node', ['.nvmrc', '.node-version']),

  // JavaScript and TypeScript quality tooling.
  reference('typescript', ['tsconfig.json', 'tsconfig.base.json']),
  reference('eslint', [
    'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts',
    '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml',
  ]),
  reference('prettier', [
    '.prettierrc', '.prettierrc.json', '.prettierrc.json5', '.prettierrc.yml',
    '.prettierrc.yaml', '.prettierrc.js', '.prettierrc.mjs', '.prettierrc.cjs',
    'prettier.config.js', 'prettier.config.mjs', 'prettier.config.cjs', 'prettier.config.ts',
  ]),
  reference('biome', ['biome.json', 'biome.jsonc']),

  // Test runners.
  reference('vitest', [
    'vitest.config.ts', 'vitest.config.js', 'vitest.config.mts', 'vitest.config.mjs',
    'vitest.workspace.ts', 'vitest.workspace.js',
  ]),
  reference('jest', [
    'jest.config.js', 'jest.config.ts', 'jest.config.mjs', 'jest.config.cjs',
    'jest.config.mts', 'jest.config.json',
  ]),
  reference('playwright', ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mts']),
  reference('cypress', ['cypress.config.ts', 'cypress.config.js', 'cypress.config.mjs']),
  reference('pytest', ['pytest.ini', 'conftest.py', 'tox.ini']),

  // Bundlers, monorepo orchestration, and application frameworks.
  reference('vite', ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs']),
  reference('webpack', [
    'webpack.config.js', 'webpack.config.ts', 'webpack.config.mjs', 'webpack.config.cjs',
  ]),
  reference('turborepo', ['turbo.json', 'turbo.jsonc']),
  reference('nx', ['nx.json']),
  reference('next', ['next.config.js', 'next.config.mjs', 'next.config.ts', 'next.config.cjs']),
  reference('astro', ['astro.config.mjs', 'astro.config.ts', 'astro.config.js']),
  reference('svelte', ['svelte.config.js', 'svelte.config.ts']),
  reference('nuxt', ['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs']),
  reference('tailwind', [
    'tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.cjs', 'tailwind.config.mjs',
  ]),
  reference('storybook', ['.storybook']),

  // Desktop and mobile shells.
  reference('tauri', ['src-tauri/tauri.conf.json', 'tauri.conf.json', 'src-tauri/Cargo.toml']),
  reference('electron', [
    'electron-builder.yml', 'electron-builder.yaml', 'electron-builder.json',
    'electron.vite.config.ts', 'forge.config.js', 'forge.config.ts', 'forge.config.cjs',
  ]),
  reference('expo', ['app.config.ts', 'app.config.js', 'app.config.json', 'eas.json']),

  // Other language toolchains.
  reference('cargo', ['Cargo.toml']),
  reference('go', ['go.mod']),
  reference('uv', ['uv.lock']),
  reference('poetry', ['poetry.lock']),
  reference('pip', ['requirements.txt', 'requirements.in', 'requirements-dev.txt']),
  reference('ruff', ['ruff.toml', '.ruff.toml']),
  reference('bundler', ['Gemfile', 'Gemfile.lock']),
  reference('composer', ['composer.json', 'composer.lock']),
  reference('gradle', [
    'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'gradlew',
  ]),
  reference('maven', ['pom.xml', 'mvnw']),
  reference('dotnet', [
    'global.json', 'Directory.Build.props', 'Directory.Packages.props',
    'NuGet.config', 'nuget.config',
  ]),
  reference('nix', ['flake.nix', 'shell.nix', 'default.nix']),

  // Databases and schema tooling.
  reference('drizzle-kit', [
    'drizzle.config.ts', 'drizzle.config.js', 'drizzle.config.mts', 'drizzle.config.json',
  ]),
  reference('prisma', ['prisma/schema.prisma', 'schema.prisma']),
  reference('supabase', ['supabase/config.toml']),

  // Containers, infrastructure, and deployment targets.
  reference('docker', [
    'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml',
  ]),
  reference('kubernetes', [
    'Chart.yaml', 'kustomization.yaml', 'helmfile.yaml', 'skaffold.yaml',
  ]),
  reference('terraform', [
    '.terraform.lock.hcl', 'main.tf', 'versions.tf', 'terraform.tf', 'providers.tf',
  ]),
  reference('wrangler', ['wrangler.toml', 'wrangler.json', 'wrangler.jsonc']),
  reference('vercel', ['vercel.json', '.vercel']),
  reference('fly', ['fly.toml']),

  // Release automation.
  reference('changesets', ['.changeset']),
  reference('semantic-release', [
    '.releaserc', '.releaserc.json', '.releaserc.yaml', '.releaserc.yml', '.releaserc.js',
    'release.config.js', 'release.config.cjs', 'release.config.mjs',
  ]),

  // Task runners, environments, and git hooks.
  reference('make', ['Makefile', 'makefile', 'GNUmakefile']),
  reference('just', ['justfile', 'Justfile', '.justfile']),
  reference('task', ['Taskfile.yml', 'Taskfile.yaml', 'taskfile.yml', 'taskfile.yaml']),
  reference('mise', ['mise.toml', '.mise.toml', '.config/mise.toml', '.tool-versions']),
  reference('devcontainer', ['.devcontainer', '.devcontainer.json']),
  reference('pre-commit', ['.pre-commit-config.yaml', '.pre-commit-config.yml']),
  reference('husky', ['.husky']),
  reference('lefthook', [
    'lefthook.yml', 'lefthook.yaml', 'lefthook.toml', 'lefthook.json', '.lefthook.yml',
  ]),

  // Agent runtimes and the harnesses that drive them. Detected by the config a
  // human writes, never by a directory an adapter creates: `.opencode/` is
  // written by AEP's own OpenCode adapter, so detecting on it would make this
  // installation the evidence that the repository uses OpenCode.
  reference('opencode', ['opencode.json', 'opencode.jsonc']),

  // The runtimes `aep start` detects from the environment, in `RUNTIMES`. Seeded
  // in every repository: the runtime is the developer's choice, not the
  // repository's, so no file here can say which one will open it. Each carries
  // the playbook `start` points at.
  everywhere('t3code'),
  everywhere('claude-code'),
];
