---

---

# Question

At pingdotgg/t3code main as of 2026-11-04, which of the claims about T3 Code's worktree location, branch naming and tracking, t3.json, skill discovery, orchestrator MCP, process environment, and stability hold?

# Sources

All read on 2026-11-04 through raw.githubusercontent.com and the GitHub API. Nothing was cloned.

- T3 Code source and docs at commit `8b44f42b14c8e273156474a924ccf29680dd7857`, the head of `main` at 2026-11-04T07:01Z. Every path below is at that commit. Permalink form: `https://github.com/pingdotgg/t3code/blob/8b44f42b14c8e273156474a924ccf29680dd7857/<path>#L<n>`.
- The published JSON Schema at `https://t3.codes/schema/t3.json`, fetched the same day. It is generated from the source, so it is primary.
- GitHub commit history per path, and the release list. Latest stable release is `v0.1.7`, published 2026-11-04.
- GitHub code search. It was used only to find files. Every finding was then read in the raw file. Code search missed at least one real hit, so an absence found only by code search is weak.

No secondary write-ups were used.

# Findings

## 1. Worktree location

**Verdict: confirmed in part, with corrections. The older AEP reference `.t3-worktrees/<thread-id>/` is refuted.**

- source: the default worktrees folder is `<baseDir>/worktrees`. `apps/server/src/config.ts#L160` sets `worktreesDir: join(baseDir, "worktrees")`.
- source: `baseDir` is `$T3CODE_HOME`, or `--base-dir`, or else `~/.t3`. `apps/server/src/os-jank.ts#L123-L129` returns `join(HomeDirectory, ".t3")` when nothing is set. `apps/server/src/cli/config.ts#L333-L345` applies the flag and env precedence.
- source: the path is built in `createWorktree`, `apps/server/src/vcs/GitVcsDriverCore.ts#L4210-L4243`. It is `path.join(parentDir, repoName, directoryName)`. `repoName` is the basename of the project root. `directoryName` is the target branch with every `/` replaced by `-`. A name over 40 characters becomes its first 23 characters plus `-` plus 16 hex characters of a SHA-256 of the branch.
- interpretation: the directory is named from the branch at creation time. For a normal new thread that is the temporary branch, see finding 2. So the real default is `~/.t3/worktrees/<repo>/t3-<8 hex>`, not `<repo>/<final branch>`. The docs agree: "Worktree directories keep their original names" (`docs/user/project-settings.md#L75`).
- source: the setting key is `worktreesDirectory`, a trimmed string, default `""` (`packages/contracts/src/settings.ts#L1197`). The UI label is Settings, Worktrees, Creation, "Worktree location" (`apps/web/src/components/settings/StorageSettings.tsx#L52-L109`, `apps/web/src/components/settings/WorktreesSettings.tsx#L61`). `previousWorktreesDirectories` keeps old values so cleanup still covers them.
- source: `resolveWorktreesDirectory` in `apps/server/src/worktreesDirectory.ts#L12-L23` expands `~`, rejects a path that is not absolute, and rejects a filesystem root. It makes no other check.
- source: the row is hidden in project scope (`WorktreesSettings.tsx#L61`), and the docs say "The setting is per machine" (`docs/user/project-settings.md#L189-L196`).
- interpretation: a configured path can fall inside a project. Nothing in the resolver compares it to any project root. But the value is one absolute path for every project on that machine. It cannot be project-relative, because relative paths are rejected. Pointing it into one project would put every other project's worktrees there too.
- source: T3 treats a path as its own managed worktree only when it is exactly two segments below a managed root, `<root>/<repo>/<dir>` (`worktreesDirectory.ts#L86-L95`). The docs say only T3-managed worktrees are eligible for cleanup (`docs/user/project-settings.md#L211`).
- source: the setting was added in commit `1024941575` on 2026-10-06, "feat(server,web): choose where new worktrees are created (#16231)".
- observation: the string `t3-worktrees` does not appear in code or in commit messages. I searched both.

## 2. Branch naming and tracking

**Verdict on naming: `t3/<8 hex>` at creation, then renamed by a model. The default final form is `t3/<slug>`. `t3code/<hex>` is recognised but no longer made.**

- source: `packages/shared/src/git.ts#L12` sets `WORKTREE_BRANCH_PREFIX = "t3"`. `buildTemporaryWorktreeBranchName` at `#L103-L111` returns `t3/<8 hex>`.
- source: `apps/server/src/orchestration-v2/ThreadLaunchService.ts#L375-L379`. When the strategy is `worktree` and no branch is given, the branch is `buildTemporaryWorktreeBranchName` over a UUID v4.
- source: `ThreadLaunchService.ts#L425-L435`. If a branch named `t3` exists, the name is flattened to `t3-<8 hex>` (`git.ts#L114-L119`). This came in `1917c8a33a`, 2026-11-01.
- source: the regex at `git.ts#L16-L18` recognises `t3/<hex8>`, `t3-<hex8>`, `t3code/<hex8>`, `t3code-<hex8>`, and `t3code/<uuid v4>` as temporary.
- source: after the worktree exists and an initial message exists, `ThreadLaunchService.ts#L482-L570` asks text generation for a name and runs `git.renameBranch` in the worktree. It then updates the stored thread branch with `expectedBranch` set to the old name.
- source: naming settings are `branchNamingMode` with values `static`, `semantic`, `custom`, default `static`. `branchNamePrefix` defaults to `t3` (`packages/contracts/src/settings.ts#L939-L946`, `#L1333-L1337`). `formatGeneratedBranchName` at `git.ts#L40-L55` builds `<prefix>/<slug>` for static mode. The docs say semantic mode lets the model pick a prefix such as `feat/` or `fix/` (`docs/user/project-settings.md#L65-L78`).
- conclusion: with defaults, a thread branch goes `t3/<hex>` then `t3/<slug>`. `feat/...` appears only in semantic mode. If generation fails, the temporary name stays.

**Verdict on tracking: T3 stores the branch at launch and does not re-read it for a launched thread. Live git views follow HEAD. The thread's branch field and PR linking do not.**

- source: launch writes `branch` and `worktreePath` into thread metadata with `thread.metadata.update` (`ThreadLaunchService.ts#L469-L478`).
- source: the web client syncs the stored branch from live git status only for a draft thread. In `apps/web/src/components/GitActionsControl.tsx#L1077-L1098`:

  ```ts
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- persists the draft thread branch when the live git status subscription reports a different branch
  useEffect(() => {
    if (isGitActionRunning || isSelectingWorktreeBase || activeServerThread) {
      return;
    }
    const branchUpdate = resolveLiveThreadBranchUpdate({
      threadBranch: activeDraftThread?.branch ?? null,
      gitStatus: gitStatusForActions,
    });
  ```

  The early return on `activeServerThread` means a launched thread is skipped.
- source: for a launched thread the stored branch changes only after a git action run through T3's own UI, through `syncThreadBranchAfterGitAction` (`GitActionsControl.tsx#L1025-L1032`, `#L984-L1006`).
- source: the git status query is keyed by `cwd`, the thread's checkout (`GitActionsControl.tsx#L1034-L1041`). Its result carries `refName`, working tree files and stats, and `pr` (`packages/contracts/src/git.ts#L216-L263`).
- source: after each run, `apps/server/src/orchestration-v2/RunFinalizationService.ts#L103-L111` refreshes PR status only when `thread.branch === local.refName`. It returns early otherwise.
- source: thread PR discovery calls `git.branchPullRequest({ cwd, branch: first.branch })` with the stored branch (`apps/server/src/orchestration-v2/ThreadPullRequestService.ts#L191-L196`).
- source: `t3_worktree_status` returns `projection.thread.branch`, the stored value (`apps/server/src/mcp/WorktreeMcpService.ts#L429-L441`).
- source: one server path re-reads HEAD. `ProviderEventIngestor.ts#L744-L753` does it only for a newly created child thread whose stored branch is still temporary, to catch a rename it missed.
- interpretation: if an agent runs `git switch -c other` in the thread worktree, the git panel's branch, changed files, and status PR badge follow `other`, because they read the cwd. The thread's stored branch stays on the old name. The sidebar, `t3_worktree_status`, the thread's linked PR discovery, and the post-run PR refresh keep using the old name. The post-run refresh is skipped while the two differ.
- not traced: which exact component draws the diff panel. I infer it uses the same cwd status, because the git panel reads `workingTree.rootPath` from that status.

## 3. t3.json

**Verdict: `runOnWorktreeCreate` is the exact name, a boolean, on each `scripts` entry. A JSON Schema exists. Setup runs in the worktree, not the project root. T3 does not run t3.json scripts directly.**

- source: the schema is `T3ProjectFile` in `packages/contracts/src/t3ProjectFile.ts#L25-L110`. File name `t3.json` at the repository root. Schema URL `https://t3.codes/schema/t3.json`.
- source: top-level keys: `$schema`, `iconPath`, `defaultThreadEnvMode` (`local` or `worktree`), `worktreeSubmodules` (`recursive`, `top-level`, `none`), and `scripts` (array, at most 50).
- source: each script has `name` and `command`, both required, plus optional `icon`, `runOnWorktreeCreate`, `runOnSettle`, `async`, `previewUrl`, `autoOpenPreview`. `async` applies only to `runOnWorktreeCreate` scripts. It defaults to true, which means the agent starts while the script runs.
- source: the published schema at `https://t3.codes/schema/t3.json` sets `additionalProperties: false` at the top level and on each script. It is generated by `buildT3ProjectFileJsonSchema` in `packages/shared/src/t3ProjectFile.ts` and served by `apps/marketing/src/pages/schema/t3.json.ts`.
- source: T3's own `t3.json` at the repository root has one script, "Setup Worktree", `node scripts/setup-worktree.ts`, with `runOnWorktreeCreate: true`.
- source: the server's setup runner reads the project's resolved actions, not t3.json. `apps/server/src/project/ProjectSetupScriptRunner.ts#L420-L443` calls `resolveProjectScripts`, then `setupProjectScript`, which takes the first script with `runOnWorktreeCreate` (`packages/shared/src/projectScripts.ts#L55-L57`).
- source: t3.json scripts reach project actions only through a manual import, one script at a time, in Settings, Projects, Actions (`apps/web/src/components/settings/ProjectActionsSettings.tsx#L74-L104`). The docs say "A project's `t3.json` actions can be imported there."
- source: the setup script runs in a T3 terminal with `cwd = input.worktreePath` (`ProjectSetupScriptRunner.ts#L435`). Its env adds `T3CODE_PROJECT_ROOT` and `T3CODE_WORKTREE_PATH` (`projectScripts.ts#L40-L53`).
- observation: the schema text for `command` says "executed in a T3 Code terminal at the project root". For setup and settle, the code uses the worktree as cwd. `projectScriptCwd` also returns the worktree when one exists (`projectScripts.ts#L31-L38`).
- source: launch calls the setup runner whenever `worktreePath` is not null (`ThreadLaunchService.ts#L584-L608`). That includes the `existing_worktree` strategy.
- source: the server reads t3.json directly for `worktreeSubmodules`, from the new worktree (`GitVcsDriverCore.ts` in `createWorktree`, after the claim), and for `iconPath` (`apps/server/src/project/T3ProjectFileLoader.ts`).
- conclusion: no other key holds worktree setup. The only setup hook is a script with `runOnWorktreeCreate: true`. `runOnSettle: true` is the teardown hook. It came in `079e4bccdc`, 2026-10-07.

## 4. Skill discovery per provider

**Verdict: the Claude claim is confirmed and needs more detail. "`.agents/skills` is read by Cursor and Antigravity" is confirmed but incomplete. Fx reads it too.**

These lists are what T3 scans to show skills in its own composer. The provider CLI still loads skills its own way.

- **Claude** (`apps/server/src/provider/Drivers/ClaudeSkills.ts#L496-L525`). Config dir is the provider's `homePath`, else `$CLAUDE_CONFIG_DIR`, else `~/.claude` (`#L420-L433`). Roots, first name wins: `<config>/skills` as user scope. `<cwd>/.claude/skills` as project scope. `<dir>/.claude/skills` for each `--add-dir` in launch args. Then plugin roots from `<config>/plugins/installed_plugins.json`, or `$CLAUDE_CODE_PLUGIN_CACHE_DIR`, for enabled plugins only (`#L314-L395`). Each plugin uses its `plugin.json` skills path, else `<installPath>/skills`. It does not read `.agents/skills`.
- **Codex**. T3 asks the Codex app-server with the RPC `skills/list` and `{ cwds: [cwd] }` (`apps/server/src/provider/CodexProvider.ts#L556`, `#L655`). T3 hardcodes no roots.
- **Cursor** (`packages/provider-cursor/src/server/skills.ts#L226-L246`). Under the cwd, then under the home folder: `.cursor/skills`, `.agents/skills`, `.codex/skills`, `.claude/skills`. Then `~/.cursor/skills-cursor` as system scope.
- **Antigravity** (`apps/server/src/provider/Drivers/AntigravitySkills.ts#L141-L160`). `<gemini home>/config/skills`, `<cwd>/.gemini/skills`, `<gemini home>/antigravity-cli/skills`, `<cwd>/.agents/skills`, `<cwd>/.agent/skills`. Gemini home is `~/.gemini`. A comment at `#L26` says `~/.agents/skills` is ignored because `.agents/skills` is project-only.
- **OpenCode**. T3 asks the OpenCode server with `client.skill.list({ location })` (`packages/provider-opencode/src/server/driver.ts#L322`). OpenCode picks the roots.
- **Fx** (`packages/provider-fx/src/server/skills.ts#L17-L43`, `#L226-L256`). From the cwd up to, not including, home, in each folder: `.fx/skills`, `skills`, `.opencode/skills`, `.codex/skills`, `.claude/skills`, `.agents/skills`, `.claw/skills`. Then home: `.fx/skills`, `.config/opencode/skills`, `.codex/skills`, `.claude/skills`, `.agents/skills`, `.claw/skills`.
- **Grok** (`packages/provider-grok/src/server/skills.ts#L87-L100`). Runs `grok inspect --json` in the cwd. Grok picks the roots.
- **Pi** (`packages/provider-pi/src/server/commands.ts`). Takes Pi's reported commands whose `source` is `skill`. Pi picks the roots.
- not checked: Kiro, Muse, and generic ACP registry agents. I found no skill scan in `packages/provider-kiro`.

## 5. Orchestrator MCP

**Verdict: `delegate_task` isolation is confirmed. `t3_thread_launch` with `existing_worktree` is confirmed. `t3_thread_wait` is confirmed. Children can delegate further. I found no depth limit.**

- source: tool names in `apps/server/src/mcp/toolkits/orchestrator/tools.ts#L72-L336`: `orchestrator_capabilities`, `delegate_task`, `task_status`, `task_cancel`, `t3_workflow_stop`, `t3_background_wait`, `schedule_task`, `list_scheduled_tasks`, `delete_scheduled_task`, `request_secret`, `create_threads`, `t3_thread_list`, `t3_thread_read`, `t3_thread_update`, `t3_thread_send`, `t3_thread_wait`, `t3_thread_interrupt`, `t3_environment_links`, `t3_environment_link`, `t3_environment_unlink`.
- source: `t3_thread_launch` is in the project toolkit, `apps/server/src/mcp/toolkits/project/tools.ts#L124`. Worktree tools are `t3_worktree_handoff`, `t3_worktree_status`, `t3_worktree_list` (`apps/server/src/mcp/toolkits/worktree/tools.ts`).
- source: the MCP server key is `t3-code`. For Claude the tools appear as `mcp__t3-code__<name>`, with wildcard `mcp__t3-code__*` (`apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L1754`). The doc says Pi keeps `mcp__t3-code__` too.
- source: `delegate_task` input in `packages/contracts/src/orchestratorMcp.ts#L169-L187` has `isolation: "shared" | "worktree"`, optional. The description says `shared` is the default and uses the parent checkout. `worktree` is "new prepared checkout from the parent commit". Uncommitted edits stay out.
- source: for `worktree`, `apps/server/src/mcp/OrchestratorMcpService.ts#L2403-L2430` resolves the parent checkout's `HEAD` commit and sets `{ type: "worktree", baseRef: <sha>, startFromOrigin: false }`. No branch is passed, so the child gets the temporary branch from finding 2. It fails if the project root does not contain that commit.
- source: `mode` is `async`, the default, or `wait`. `timeoutMs` defaults to 10 minutes and is capped at 60 minutes (`OrchestratorMcpService.ts#L130-L131`).
- observation: `docs/orchestration-v2/orchestrator-mcp-server.md#L228-L250` documents `DelegateTaskInput` without `isolation`. The doc lags the contract.
- source on nesting: the doc says every new V2 provider session gets a credential with `preview` and `orchestration` capability. It says `mode: "wait"` waits for "nested work", and `task_cancel` "stops every task the child delegated".
- source on depth: the only delegation depth in the MCP server is `depthOf` in `apps/server/src/mcp/McpHttpServer.ts#L896-L912`. It is capped by `MAX_REPORTED_DEPTH` from `telemetry/ProviderDimensions.ts` and fed to analytics as `callerDepth`. It does not block a call.
- observation: I searched for `depth`, `nesting`, `maxDepth`, `MAX_DELEGATION_DEPTH`, and `delegationDepth` in the server's orchestration and MCP code. I found no enforced limit.
- source: `t3_thread_launch` `workspaceStrategy` is one of three shapes (`packages/contracts/src/orchestrationV2.ts#L654-L670`):
  - `{ type: "root", branch?: string }`
  - `{ type: "existing_worktree", worktreePath: string, branch?: string }`
  - `{ type: "worktree", baseRef: string, branch?: string, startFromOrigin?: boolean }`
- source: other launch fields are `environmentId`, `projectId`, `scratch`, `title` (required), `modelSelection`, `runtimeMode`, `interactionMode`, `message`, `attachments`, `clientRequestId` (`project/tools.ts#L128-L155`). Workspace is not inherited. The default is `root`.
- source: `existing_worktree` requires `worktreePath` to be in the project's `git worktree list`, compared after `realPath` (`apps/server/src/mcp/toolkits/project/handlers.ts#L49-L66`, `#L144-L152`). It need not sit under T3's worktrees folder.
- interpretation: a worktree made outside T3, for example under `.aep/worktrees/`, can be bound with `existing_worktree`. It will not count as T3-managed for cleanup. The setup script will still run in it, per finding 3.
- source: `t3_thread_wait` input is `environmentId`, `threadId`, `runId?`, `timeoutMs?`, `untilDelegatedWorkSettled?`. The result is `threadId`, `runId`, `status`, `timedOut`, `next?`, `resultRun?` (`orchestratorMcp.ts#L521-L543`). Without `runId` it pins the latest run. An idle thread returns at once. A timeout does not cancel.

## 6. Environment in the provider process

**Verdict: T3 sets `T3CODE_THREAD_ID` for Claude and for Codex shells. It sets no variable for the worktree path in any agent process. Pi and ACP agents get MCP connection variables.**

- source: `apps/server/src/preview/PortScanner.ts#L66-L70` defines `AGENT_THREAD_ENV = "T3CODE_THREAD_ID"`. It is used to tie dev servers to threads.
- source: Claude. `ClaudeAdapterV2.ts#L996-L1005` sets `env: { ...hostEnvironment, T3CODE_THREAD_ID: <threadId> }` on the Claude Code process. MCP credentials go over stdin, not env.
- source: Codex. `CodexAdapterV2.ts#L1406-L1409` sets `shell_environment_policy.set.T3CODE_THREAD_ID` per thread. One app-server serves many threads, so the variable is in the shells Codex runs, not in the app-server's own env.
- source: Pi. `packages/provider-pi/src/server/mcpInjection.ts#L286-L310` sets `T3_MCP_URL`, `T3_MCP_BEARER_TOKEN`, `T3_PI_RUNTIME_MODE`, and `T3_PI_MCP_EXTENSION_PATH`.
- source: ACP agents. `packages/provider-acp/src/server/adapter.ts#L848-L853` builds `T3_ACP_MCP_ENDPOINT`, `T3_ACP_MCP_AUTHORIZATION`, `T3_ACP_MCP_NODE`, and `T3_ACP_MCP_ENTRYPOINT` as the process environment. `packages/provider-acp-registry/src/server/adapter.ts#L161-L165` merges it into the spawn env. `AcpSessionRuntime.ts#L1448` sets `T3_ACP_CGROUP_WRAPPER=1` on a wrapper.
- source: setup and settle scripts, not agents, get `T3CODE_PROJECT_ROOT` and `T3CODE_WORKTREE_PATH`.
- observation: I scanned all 143 non-test `.ts` files in `apps/server/src/orchestration-v2/Adapters/` and `packages/provider-*/src/server/`. Only the Claude and Codex adapters set `T3CODE_THREAD_ID`. No adapter sets a worktree or project path variable.
- interpretation: `T3CODE_THREAD_ID` is the only cross-provider marker, and it covers Claude and Codex only. Cursor, OpenCode, Antigravity, Fx, Grok, and Kiro agents get no T3 thread marker from these files. Which of them run through `provider-acp`, and so get `T3_ACP_MCP_*`, I did not trace.

## 7. Stability and recent change

- source: `README.md#L100-L102`: "We are very very early in this project. Expect bugs." and "We are (mostly) not accepting contributions yet. Small fixes may be considered. Big features will not be."
- source: version is `v0.1.7`, released 2026-11-04. Nightly builds ship several times a day.
- source: recent commits in these areas, newest first:
  - `dd69b31665` 2026-11-04 and `0bd447e51e` 2026-11-03 touch `ClaudeSkills.ts`. The second makes Claude skill discovery resolve each repository root once.
  - `0a41bbce4f` 2026-11-03: `t3_worktree_list` after cleanup removes a worktree.
  - `1917c8a33a` 2026-11-01: worktree threads get the generated branch name when a branch named `t3` exists.
  - `0743ba5524` 2026-11-01: branch names keep accented letters as plain letters.
  - `f46f838bf2` 2026-10-30: setup scripts follow terminal shell fallbacks.
  - `a27ec88bfa` 2026-10-27: dev servers a thread started, which uses `T3CODE_THREAD_ID`.
  - `8e0d5e5e4d` 2026-10-17: project and worktree folders resolved in one place.
  - `079e4bccdc` 2026-10-07: `runOnSettle`.
  - `1024941575` 2026-10-06: the worktree location setting.
  - `1262d2f3ab` 2026-09-21: `worktreeSubmodules` in t3.json.
- interpretation: these areas change weekly. Claims about T3 internals should be pinned to a commit.

# Conclusion

1. Default worktree path is `~/.t3/worktrees/<repo basename>/<branch with / as ->`, under `$T3CODE_HOME` when set. In practice the last part is `t3-<8 hex>`, because the folder is named before the rename. The setting is `worktreesDirectory`, "Worktree location". It is absolute, per machine, and not checked against project roots. `.t3-worktrees/<thread-id>/` is refuted.
2. The branch starts as `t3/<8 hex>`, or `t3-<8 hex>`, and is renamed to `t3/<slug>` by default. It is stored at launch. A launched thread does not re-read it from git. Live status views follow HEAD. Stored-branch views, PR discovery, and the post-run PR refresh do not.
3. `scripts[].runOnWorktreeCreate` is a boolean. Setup runs in the worktree with `T3CODE_PROJECT_ROOT` and `T3CODE_WORKTREE_PATH`. It runs from imported project actions, not straight from t3.json. Schema: `https://t3.codes/schema/t3.json`.
4. Claude: `~/.claude/skills`, `<cwd>/.claude/skills`, `--add-dir` roots, and enabled plugins from `installed_plugins.json`. Cursor, Antigravity, and Fx read `.agents/skills`. Codex, OpenCode, Grok, and Pi ask the provider.
5. `delegate_task` `isolation` is `shared` by default or `worktree`. Nesting works with no enforced depth limit. `existing_worktree` takes any path in `git worktree list`. `t3_thread_wait` is as listed.
6. Only `T3CODE_THREAD_ID` marks a thread, and only for Claude and Codex shells. No agent gets a worktree path variable.
7. The README says very early, expect bugs, mostly no contributions.

# Not checked

- Whether a delegated child, which has no `initialMessage` in the launch sense, gets its branch renamed. I did not trace how `delegated_task.request` calls launch.
- The exact component behind the diff panel. I inferred it reads the cwd status.
- Which providers run on `provider-acp`, and so get `T3_ACP_MCP_*`.
- Skill discovery for Kiro, Muse, and generic ACP registry agents.
- Whether the sidebar shows the stored branch or live status. `SidebarThreadRow.tsx` reads `thread.branch`, but I did not read the file.
- Whether the server rejects unknown t3.json keys at parse time. The published schema forbids them, but the decode path was not tested.
- Mobile app behaviour.
