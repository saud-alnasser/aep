---

---

# Question

At pingdotgg/t3code `main` on 2026-11-04, what can an agent running inside T3 Code do through T3's own tools: launch threads, delegate, wait and read and send, bind and change workspaces and branches, detect T3 from its environment, and see T3's MCP tools?

# Sources

- T3 Code source at commit `9e85538535c8553901351112ab02dd1dd62db5ee` (`9e85538535c8`), the head of `main` at 2026-11-04 13:50Z. `git describe` gives `v0.1.8-nightly.20261104.4165-2`. `apps/server/package.json` still says `0.1.7`. Every path below is at this commit. Permalink form: `https://github.com/pingdotgg/t3code/blob/9e85538535c8553901351112ab02dd1dd62db5ee/<path>#L<n>`.
- Read from a blobless clone. Only TypeScript was read. No docs were used as evidence.
- Builds on `.aep/efforts/64-runtime-surfaces/evidence/research/t3code-runtime.md` (read at `8b44f42b14c8`). Findings there are not repeated.

## What changed since `8b44f42b14c8`

Two commits:

- `7f782b4d6d` test(evals): measure how agents get secrets only the user has (#30256).
- `9e85538535` feat(server): agents ask for secrets through request_secret instead of chat (#30257).

Code changes in the areas below are limited to `request_secret` (a new `value` field, a `note` on unsaved results, `anthropic/alwaysLoad` meta) and one sentence added to the `delegate_task` description: "No secrets in `task`." (`apps/server/src/mcp/toolkits/orchestrator/tools.ts#L86-L97`, `#L198-L210`; `packages/contracts/src/orchestratorMcp.ts#L732-L781`). Nothing in launch, delegation, wait, worktree, branch, environment, or MCP registration moved. Citations in the earlier file still hold, except that lines in `orchestrator/tools.ts` after L86 and in `orchestratorMcp.ts` after L728 shifted.

# Findings

## 1. `t3_thread_launch`

**Verdict: the caller picks provider and model, title (required), first prompt, attachments, runtime and interaction modes, workspace, and project. Modes default to the caller's and cannot exceed them. The thread is top-level and gets its own sidebar row. No tool focuses or opens it in the UI.**

Source:

- Parameters (`apps/server/src/mcp/toolkits/project/tools.ts#L124-L179`): `environmentId?`, `projectId?`, `scratch?`, `title` (required, trimmed non-empty), `modelSelection?`, `runtimeMode?`, `interactionMode?`, `workspaceStrategy?`, `message?` (max 120000 chars, "First prompt. Omit it and `attachments` for idle."), `attachments?` (max 8, pending uploads only), `clientRequestId?`, `delegatedFrom?` (linked environments only). Result: `threadId`, `link?`, `projectId`, `modelSelection`, `runId | null`, `status | null`.
- `modelSelection` is `{ instanceId, model, options? }` (`packages/contracts/src/modelSelection.ts#L9-L13`). Order of choice: input, then a replayed launch's model, then the caller thread's model, then project defaults when there is no calling thread (`apps/server/src/mcp/toolkits/project/handlers.ts#L188-L210`).
- Modes: `RuntimeMode` is `approval-required`, `auto-accept-edits`, `auto`, `full-access`. Default is `full-access` (`packages/contracts/src/providerPolicy.ts#L25-L32`). `startsThreads` resolves each requested mode against the caller's limits (`apps/server/src/mcp/McpToolAccess.ts#L231-L259`). The limits are the calling thread's own modes (`apps/server/src/mcp/threadAccess.ts#L75-L112`). A broader mode fails with `runtime_mode_escalation_denied`. An inherited mode the target provider does not offer steps down. An explicit one is refused (`apps/server/src/mcp/delegatedTaskModes.ts#L36-L88`; launch applies this at `handlers.ts#L211-L225`). A managed-policy ceiling also applies (`apps/server/src/orchestration-v2/RuntimePolicy.ts#L150-L192`).
- The server's runtime policy carries only `runtimeMode`, `interactionMode`, `cwd` (the thread's `worktreePath`, else the project root), and the managed ceiling. It sets no `approvalPolicy` or `sandboxPolicy` (`RuntimePolicy.ts#L162-L192`). The override layer that sets those is used only by a test harness (`RuntimePolicy.ts#L198-L225`; caller `apps/server/src/orchestration-v2/testkit/ProviderReplayHarness.ts#L300`).
- Claude mapping (`apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L2569-L2615`): `plan` interaction gives `plan`. Otherwise `approval-required` gives `default`, `auto-accept-edits` gives `acceptEdits`, `auto` gives `auto`, `full-access` gives `bypassPermissions`. Bypass falls to `auto` or `default` where Claude disables it (`#L2636-L2646`).
- Codex mapping (`apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts#L717-L752`): `approval-required` is approval `untrusted`, sandbox `readOnly`. `auto-accept-edits` is `on-request`, `workspaceWrite`. `auto` is `on-request` with auto review, `workspaceWrite`. `full-access` is `never`, `dangerFullAccess`.
- Cursor turns its sandbox on unless the mode is `full-access` (`packages/provider-cursor/src/server/adapter.ts#L195-L198`).
- Sidebar: the launch dispatches `thread.create` with no parent lineage (`apps/server/src/orchestration-v2/ThreadLaunchService.ts#L933-L953`). The sidebar hides only `subagent` and side-chat lineages (`packages/contracts/src/orchestrationV2.ts#L163-L164`; `apps/web/src/components/Sidebar.logic.ts#L590-L638`). It does not filter on `createdBy: "agent"` or `creationSource: "mcp"`.
- Focus: no MCP tool navigates a client. I listed every `Tool.make` under `apps/server/src/mcp/toolkits/`. None opens or focuses a thread. The result's `link` is `<t3-thread://v2/<environmentId>/<threadId>>`, or a hosted URL when the client has one (`apps/server/src/mcp/McpInvocationContext.ts#L140-L147`; `packages/shared/src/threadLinks.ts#L7-L10`, `#L113-L117`, `#L126-L129`).
- The tool returns before the workspace exists. Preparation runs in a background fiber (`ThreadLaunchService.ts#L789-L833`).

Interpretation:

- A child on another provider at full access runs Claude with `bypassPermissions` and Codex with `dangerFullAccess`. Only the caller's own mode bounds it.
- `t3_thread_organize` can `pin` or `mark_unread` the new thread (`apps/server/src/mcp/toolkits/thread/tools.ts#L32-L65`). That changes the sidebar. It does not focus anything.
- Observation, weak: I found no OS protocol registration for `t3-thread://` in `apps/desktop/src`. So an agent probably cannot focus the UI by opening the link from a shell.

## 2. `delegate_task`

**Verdict: the caller picks provider, model, and options. The child's last non-empty assistant message comes back as `summary`, and a finished child wakes the parent. No read-only mode exists. `isolation` is only `shared` or `worktree`. A `worktree` child's worktree is not removed when the task ends.**

Source:

- Input (`packages/contracts/src/orchestratorMcp.ts#L168-L196`): `task` (required), `target?`, `title?`, `role?`, `isolation?` (`shared` default, `worktree`), `mode?` (`async` default, `wait`), `timeoutMs?`, `clientRequestId?`, `runtimeMode?`, `interactionMode?`.
- `target` (`#L96-L126`): `providerInstanceId?`, `driverKind?`, `model?`, `options?`, `environmentId?` (linked machine), `projectId?` (only with `environmentId`).
- `role` is `implementation`, `research`, `review`, `design`, `test`, `general` (`#L138-L145`). It only prefixes the prompt: "Act as the <role> sub-agent for this task." (`apps/server/src/mcp/delegatedTaskModes.ts#L91-L95`).
- `runtimeMode` description: "Omit unless the user asks for a supervised child. Narrow modes pause for human approval, not read-only. Above yours is rejected." (`orchestratorMcp.ts#L189-L194`). Child modes are resolved against the parent's (`apps/server/src/mcp/OrchestratorMcpService.ts#L2414-L2422`).
- Result (`orchestratorMcp.ts#L204-L240`): `taskId`, `childThreadId`, `link?`, `status`, `workState`, `summary`, `latestTerminalSummary`, `hasPendingQuestion`, `pendingApproval`, `waitTimedOut`, `next?`, and others. Async results carry `next`: "Completion wakes this thread, so end your turn. Do not wait on it or poll it." (`#L200-L201`).
- `summary` is `task.result`, else the result run's text (`OrchestratorMcpService.ts#L1570-L1575`, `#L1619`). That text is the latest non-empty assistant message in the run (`packages/provider-core/src/server/subagentProjection.ts#L179-L210`).
- Async delegation wakes the parent on every child terminal. `wait` wakes only if the parent settled first (`OrchestratorMcpService.ts#L2471-L2474`, `#L2524-L2557`).
- `shared`: the child thread copies the parent thread record, so it has the parent's `branch` and `worktreePath` (`subagentProjection.ts#L52-L101`; `apps/server/src/orchestration-v2/Orchestrator.ts#L7800-L7816`).
- `worktree`: `{ type: "worktree", baseRef: <parent HEAD sha>, startFromOrigin: false }`, with no branch (`OrchestratorMcpService.ts#L2423-L2452`). Preparation passes the task text as the initial message (`ThreadLaunchService.ts#L1123-L1165`). So the child's temporary branch is renamed like any launched thread (`#L482-L571`). This closes an open item from the earlier file.
- The child is a `subagent` lineage. It has no sidebar row of its own and shows under its parent (`Sidebar.logic.ts#L594-L616`).
- After the task: the server removes worktrees only on a failed or cancelled preparation (`ThreadLaunchService.ts#L689-L722`), in `t3_worktree_handoff` rollback, and through the client's `removeWorktree` RPC (`apps/server/src/ws.ts#L3120`). The web client offers removal when the last thread using a worktree is deleted (`apps/web/src/hooks/useThreadActions.ts#L479-L538`). Automatic cleanup rules all default off: `worktreeOnDelete`, `worktreeOnMerge`, `worktreeUnchanged` false, day limits null (`packages/contracts/src/settings.ts#L1168-L1178`). Cleanup keeps any path outside the managed worktree folder (`apps/server/src/storageCleanup.ts#L898`).

Interpretation:

- The nearest thing to no-write is `interactionMode: "plan"`. For Claude it gives permission mode `plan`, with writes sent to the approval callback (`ClaudeAdapterV2.ts#L2571-L2573`, `#L2662-L2670`). That is supervised, not refused. Codex `approval-required` is a `readOnly` sandbox with `untrusted` approval, which also asks the user. Neither is a non-interactive read-only mode.
- With defaults, a `worktree` child's worktree and branch stay on disk until a person deletes the thread and confirms, or turns on a cleanup rule.

## 3. Waiting, listing, reading, sending

**Verdict: `t3_thread_wait`, `t3_thread_list`, `t3_thread_read`, `t3_thread_send`, `t3_thread_interrupt`, and `t3_thread_search` exist. No MCP tool answers "which live thread owns this worktree path". The answer has to be built from `t3_thread_read` on each thread.**

Source:

- `t3_thread_list` (`apps/server/src/mcp/toolkits/orchestrator/tools.ts#L225-L237`; input `orchestratorMcp.ts#L330-L343`): `environmentId?`, `projectId?`, `allProjects?`, `statuses?`, `titleContains?`, `settled?`, `snoozed?`, `includeSubagents?` (default true, `OrchestratorMcpService.ts#L2958`), `cursor?`, `limit?` (max 100). Each item (`orchestratorMcp.ts#L355-L379`) has `status`, `latestRunId`, provider, model, modes, PRs, lineage. **Items carry no `branch` or `worktreePath`.**
- `t3_thread_read` (`tools.ts#L239-L252`; input `orchestratorMcp.ts#L406-L422`): `threadId`, `view` (`messages` default, `activity`), `afterPosition?`, `limit?`, `runLimit?`, `maxCharsPerItem?`, `itemId?`, `textOffset?`. The detail has `status`, `activeRunId`, `branch`, `worktreePath`, `archived`, `pendingRequestCount`, and more (`#L425-L456`). Items page forward from position -1, oldest first (`OrchestratorMcpService.ts#L2999-L3012`).
- Thread status is the active run's status, else the latest run's, else `idle` (`OrchestratorMcpService.ts#L842`). Run statuses: `preparing`, `queued`, `starting`, `running`, `waiting`, `completed`, `interrupted`, `failed`, `cancelled`, `rolled_back` (`packages/contracts/src/orchestrationV2.ts#L590-L601`).
- `t3_thread_send` (`tools.ts#L271-L282`; `orchestratorMcp.ts#L501-L519`): `threadId`, `message`, `mode?` (`auto`, `queue`, `steer`, `restart`), `clientRequestId?`. "The target cannot run with broader modes than yours." A send to a finished child starts a fresh task and returns `taskId`.
- `t3_thread_wait` (`tools.ts#L284-L296`; `orchestratorMcp.ts#L521-L544`): unchanged from the earlier file.
- `t3_thread_interrupt` (`orchestratorMcp.ts#L546-L570`): `stop: true` acts like the Stop button and also stops the thread's delegates.
- `t3_thread_search` searches active threads by title, branch, PR, project, then text. It skips subagent threads and says "Not exhaustive." (`apps/server/src/mcp/toolkits/thread/tools.ts#L192-L217`).
- `t3_worktree_list` lists branch refs and checkout paths for a thread's workspace, from git (`apps/server/src/mcp/toolkits/worktree/tools.ts#L61-L84`). It says nothing about threads.
- A worktree-to-threads query exists only as a client RPC, `orchestration.getWorktreeThreadIds` (`packages/contracts/src/orchestrationV2.ts#L3583`, `#L3707-L3771`). The web client uses it before offering to delete a worktree (`useThreadActions.ts#L485-L498`). It is not an MCP tool.
- `existing_worktree` launch checks only that the path is in `git worktree list` (`project/handlers.ts#L48-L66`). It does not check whether another thread already uses it.

Interpretation:

- To find the owner of a path: page `t3_thread_list` (with `allProjects` if needed), then `t3_thread_read` each candidate with a small `limit`, and match `worktreePath`. Treat `preparing` through `waiting` as live.
- To read a thread's last message there is no tail option. Page forward with `afterPosition`, or for a delegated task use `task_status`.

## 4. `worktree` and `existing_worktree` with a named `branch`

**Verdict: `worktree` with an existing `branch` fails. T3 never checks out an existing branch for this strategy. `existing_worktree` with `branch` only records the name; it runs no git command.**

Source:

- `worktree`: the launch passes the branch as `newRefName` (`ThreadLaunchService.ts#L374-L381`, `#L438-L459`). `createWorktree` first runs `git branch --no-track -- <branch> <start>` (`apps/server/src/vcs/GitVcsDriverCore.ts#L4244-L4252`, `#L3818-L3830`), then `git worktree add -- <path> <branch>` (`#L4253`). `git branch` fails when the branch exists. The branch is deleted on error only when `worktree add` itself fails (`#L4291-L4301`), not when `git branch` fails.
- The MCP handler checks only `baseRef` before accepting (`project/handlers.ts#L153-L171`; `ThreadLaunchService.ts#L262-L292`). The tool returns success. The failure then lands on the run as `prepared-run.fail`, class `validation_error`. With no first message it is only logged (`ThreadLaunchService.ts#L738-L772`, `#L820-L831`).
- The thread is created with `branch` set to the requested name before preparation (`ThreadLaunchService.ts#L922`, `#L942`). On failure the cleanup resets metadata only if a worktree was created (`#L689-L722`).
- `t3_worktree_handoff` behaves the same way. It refuses an existing branch before doing anything: "Branch '…' already exists…" (`apps/server/src/mcp/WorktreeMcpService.ts#L191-L212`).
- `existing_worktree`: `branch = requestedBranch ?? null` and `worktreePath` is the given path (`ThreadLaunchService.ts#L379-L385`). It is stored with `thread.metadata.update` (`#L469-L479`). No checkout and no check against the worktree's HEAD happen. The setup action still runs, because `worktreePath` is not null (`#L584-L608`).
- If the recorded branch matches the temporary pattern (`t3/<8 hex>` and kin) and there is a first message, T3 renames it in that worktree (`#L482-L499`).

Interpretation:

- To run a thread on an existing branch, create or reuse the worktree outside T3, then launch with `existing_worktree` and pass `branch` equal to what that worktree has checked out. T3 will trust the value.
- Omitting `branch` with `existing_worktree` stores `branch: null`. Branch-based features (PR discovery, post-run PR refresh, `t3_worktree_status.branch`) then have no branch. I did not trace each of them with a null branch.
- Never pass a `t3/<8 hex>` name with `existing_worktree`. T3 would rename the branch.
- A failed `worktree` launch on an existing branch leaves a thread that names that branch with no worktree.

## 5. Changing a thread's stored branch after launch

**Verdict: no MCP tool can change the branch of a thread that already has a worktree. The stored branch changes only through T3's own launch rename, `t3_worktree_handoff` on a thread with no worktree, and the UI.**

Source:

- `t3_thread_update` description: "Workspace and branch cannot change here." It builds only title commands (`orchestrator/tools.ts#L254-L269`; `apps/server/src/mcp/ThreadMetadataMcpService.ts#L62-L83`).
- `t3_worktree_handoff` sets a new branch and worktree only when the thread has none. It fails with `already_in_worktree` otherwise (`worktree/tools.ts#L28-L41`; `WorktreeMcpService.ts#L157-L170`, `#L296-L304`).
- `t3_thread_configure` changes provider, model, and options only (`thread/tools.ts#L153-L163`).
- The command `thread.metadata.update` takes `branch`, `worktreePath`, `expectedBranch`, `expectedWorktreePath`, `expectedEmpty` (`orchestrationV2.ts#L3045-L3060`). The orchestrator rejects it when the expected values differ (`Orchestrator.ts#L3211-L3232`). Server-side callers: launch and its rename (`ThreadLaunchService.ts#L469-L571`), launch cleanup (`#L712-L721`), handoff, the title tool, and usage-limit recovery.
- UI paths: the branch picker switches a ref in the thread's checkout and then writes `branch` and `worktreePath` for a server thread. It needs the orchestration-operate scope (`apps/web/src/components/BranchToolbarBranchSelector.tsx#L170-L214`, `#L396-L445`). Git actions run from T3's panel write the branch after the action (`apps/web/src/components/GitActionsControl.tsx#L1025-L1032`). The client command is `updateThreadMetadata` (`packages/client-runtime/src/operations/commands.ts#L609-L635`).
- One server path re-reads HEAD: a newly created child thread whose branch is still temporary (`apps/server/src/orchestration-v2/ProviderEventIngestor.ts#L744-L762`).

Interpretation:

- For an agent, a launched thread's branch is fixed once the rename finishes. A `git switch` inside the worktree does not update it (as the earlier file found).
- A person can change it from the branch picker.

## 6. Environment in the provider process

**Verdict: `T3CODE_THREAD_ID` (Claude process, Codex shells) and `CLAUDE_CODE_ENTRYPOINT=t3-code` (Claude) are the markers T3 sets. ACP-based providers get `T3_ACP_MCP_*`. Pi gets `T3_MCP_*`. No agent process gets a project id, worktree path, or T3 home from T3.**

Source:

- Claude: base env is the host env plus `CLAUDE_CODE_ENTRYPOINT: "t3-code"`, unless the user's Claude settings `env` sets another entrypoint (`apps/server/src/provider/Drivers/ClaudeHome.ts#L69-L88`; used by the V2 adapter at `ClaudeAdapterV2.ts#L11863-L11868`). Each query adds `T3CODE_THREAD_ID: <threadId>` (`ClaudeAdapterV2.ts#L996-L1005`; name at `apps/server/src/preview/PortScanner.ts#L70`). MCP credentials go over stdin, not env (`ClaudeAdapterV2.ts#L996`).
- Codex: `shell_environment_policy.set.T3CODE_THREAD_ID` per thread, so it is in the shells Codex runs, not in the app-server env (`CodexAdapterV2.ts#L1406-L1409`).
- ACP providers (`provider-acp`): `T3_ACP_MCP_ENDPOINT`, `T3_ACP_MCP_AUTHORIZATION`, `T3_ACP_MCP_NODE`, `T3_ACP_MCP_ENTRYPOINT` (`packages/provider-acp/src/server/adapter.ts#L848-L853`). This env is applied to ACP terminals (`#L1725-L1760`) and, for registry agents, to the spawn env (`packages/provider-acp-registry/src/server/adapter.ts#L161-L165`). Packages that use `provider-acp`: Fx, Grok, Kiro, the ACP registry, and the Antigravity driver (imports found in `packages/provider-{fx,grok,kiro}/src/server/adapter.ts`, `packages/provider-acp-registry/src/server/`, `apps/server/src/provider/Drivers/AntigravityDriver.ts`). This closes an open item from the earlier file.
- Pi: `T3_MCP_URL`, `T3_MCP_BEARER_TOKEN`, `T3_PI_RUNTIME_MODE`, `T3_PI_MCP_EXTENSION_PATH` (`packages/provider-pi/src/server/mcpInjection.ts`, unchanged).
- OpenCode: one server per instance. Its env adds `OPENCODE_SERVER_PASSWORD` and `OPENCODE_CONFIG_CONTENT` only (`packages/provider-opencode/src/server/OpenCodeRuntime.ts#L528-L541`).
- Cursor and Muse: I found no `T3*` variable set for the agent. Muse gets only device-tool env when device tools are on (`packages/provider-muse/src/server/adapter.ts#L1676-L1689`; `packages/provider-core/src/server/mcpSession.ts#L16-L30`).
- `T3CODE_PROJECT_ROOT` and `T3CODE_WORKTREE_PATH` are set only for project scripts, not agents (`packages/shared/src/projectScripts.ts#L40-L53`).
- `T3CODE_HOME`: T3 sets none for agents. The desktop strips it from the WSL backend's env (`apps/desktop/src/backend/DesktopBackendConfiguration.ts#L642-L661`). It reaches an agent only if it was in the server's own environment.

Interpretation:

- Under T3 at all: `T3CODE_THREAD_ID` (Claude, Codex shells), `T3_ACP_MCP_ENDPOINT` (ACP providers' terminals), or `T3_MCP_URL` (Pi). Cursor, OpenCode, and Muse agents show no T3 marker.
- Which provider: `CLAUDE_CODE_ENTRYPOINT=t3-code` points to Claude. `T3CODE_THREAD_ID` without it points to Codex. `T3_ACP_MCP_*` points to an ACP provider but not which one. `T3_PI_RUNTIME_MODE` points to Pi.
- Not established: whether Claude Code passes `CLAUDE_CODE_ENTRYPOINT` unchanged to the shells it runs.

## 7. Opening a worktree, and importing one from the UI

**Verdict: the UI opens the thread's checkout in an editor or file manager, and has a built-in terminal that starts there. No "Open in terminal app" option exists. The branch picker can bind a thread to an existing worktree. I found no MCP tool for either.**

Source:

- "Open in" picker: `shell.openInEditor` with `cwd` = the thread's `worktreePath`, else the project root (`apps/web/src/components/chat/OpenInPicker.tsx#L232-L275`; `apps/web/src/components/ChatView.tsx#L1610-L1650`; `packages/shared/src/projectScripts.ts#L31-L38`). Targets are editors (Cursor, VS Code, Zed, JetBrains IDEs, and others) and `file-manager` (`packages/contracts/src/editor.ts#L17-L152`).
- The built-in terminal opens with `cwd` = that same checkout (`apps/web/src/components/chat/useChatTerminalActions.ts#L219-L240`).
- Binding to an existing worktree: when the picked branch is checked out in a worktree, the picker reuses it and sets the thread's `worktreePath` to it (`apps/web/src/components/BranchToolbar.logic.ts#L249-L282`; `BranchToolbarBranchSelector.tsx#L396-L408`). For a server thread it also stops the running session when the worktree changes (`#L181-L186`).

Interpretation:

- A person can attach an AEP-made worktree to a thread by picking its branch in the branch picker. An agent does the same with `t3_thread_launch` and `existing_worktree`.

## 8. How T3 exposes its MCP tools

**Verdict: one HTTP MCP server, registered in each provider as `t3-code`. A Claude Code agent sees `mcp__t3-code__<tool>`. Every V2 thread gets it. Only browser, device, link, and two PR tools are conditional.**

Source:

- The server is named "T3 Code" at path `/mcp` and serves every toolkit (`apps/server/src/mcp/McpHttpServer.ts#L1185-L1208`).
- Claude: `mcpServers["t3-code"]`, type `http`, timeout 65 min. `allowedTools` adds `mcp__t3-code__*`, or a read-only list in a read-only sandbox (`ClaudeAdapterV2.ts#L1754-L1808`).
- Codex: `mcp_servers.t3-code` with `t3_thread_wait` disabled, plus `mcp_servers.t3-code-direct` that carries only `t3_thread_wait` (`CodexAdapterV2.ts#L1379-L1420`).
- Cursor `"t3-code"` http (`packages/provider-cursor/src/server/adapter.ts#L202-L217`). OpenCode `client.mcp.add({ name: "t3-code" })` (`packages/provider-opencode/src/server/adapter.ts#L969-L980`). ACP `t3-code` over a stdio bridge or HTTP (`packages/provider-acp/src/server/adapter.ts#L821-L846`).
- Every provider session gets a credential with `orchestration`, `worktree`, `pull-requests`. `preview` and `device` follow the user's agent-access settings (`apps/server/src/orchestration-v2/ProviderSessionManager.ts#L441-L503`). The only switch that skips MCP is `configureMcp: false`, set only by a test harness (`#L445`; `testkit/ProviderReplayHarness.ts#L384`).
- Hidden tools: `t3_environment_links`, `t3_environment_link`, `t3_environment_unlink` while linked environments are off (`orchestrator/tools.ts#L322`, `#L336`, `#L350`). `watch_pull_request` and `unwatch_pull_request` for subagent threads (`apps/server/src/mcp/toolkits/pullRequests/tools.ts#L398`, `#L412`; gate at `McpInvocationContext.ts#L158-L169`).
- Tool names a Claude agent can see, as `mcp__t3-code__<name>`: orchestrator `orchestrator_capabilities`, `delegate_task`, `task_status`, `task_cancel`, `t3_workflow_stop`, `t3_background_wait`, `schedule_task`, `list_scheduled_tasks`, `delete_scheduled_task`, `request_secret`, `create_threads`, `t3_thread_list`, `t3_thread_read`, `t3_thread_update`, `t3_thread_send`, `t3_thread_wait`, `t3_thread_interrupt`, `t3_environment_links`, `t3_environment_link`, `t3_environment_unlink`. Project `t3_thread_launch`, `t3_project_list`, `t3_project_read`, `t3_project_create`, `t3_project_update`, `t3_project_delete`, `t3_project_clone`. Thread `t3_thread_organize`, `t3_queue`, `t3_pending_request`, `t3_thread_configure`, `t3_thread_transfer`, `t3_thread_search`, `run_scheduled_task_now`. Worktree `t3_worktree_handoff`, `t3_worktree_status`, `t3_worktree_list`. Pull requests `link_pull_request`, `link_pull_requests`, `unlink_pull_request`, `unlink_pull_requests`, `list_thread_pull_requests`, `watch_pull_request`, `unwatch_pull_request`, `write_pull_request_guides`, `read_pull_request_guide`. Attachments `t3_attachment_prepare_upload`, `t3_attachment_discard`, `t3_thread_send_attachments`. Environment `t3_environment_read`, `t3_environment_preferences_update`. Previews `t3_preview_list`, `t3_preview_close`, `preview_*` (status, open, dialog, navigate, resize, set_appearance, snapshot, act, evaluate, wait_for, recording_start, recording_stop). Device `device_list`, `device_open`, `device_screenshot`, `device_close`. HTML `html_preview`, `html_render`. (All from `Tool.make` in `apps/server/src/mcp/toolkits/*/tools.ts`.)
- Claude Code may defer MCP tools behind ToolSearch. Only `request_secret` carries `anthropic/alwaysLoad` (`orchestrator/tools.ts#L209-L210`).

Interpretation:

- An agent in any T3 thread can call `t3_thread_launch`, `delegate_task`, and the rest without setup. A Claude agent may have to load them through ToolSearch first.
- Delegated children get the same tools, minus PR watch.

# Facts AEP can rely on (at `9e85538535c8`)

1. `t3_thread_launch` takes `title` (required), `modelSelection { instanceId, model, options? }`, `message`, `runtimeMode`, `interactionMode`, `workspaceStrategy`, `projectId`, `scratch`, `attachments`, `clientRequestId`.
2. A launched thread's modes default to the caller's and can never be broader. The default runtime mode is `full-access`.
3. A launched thread is top-level and has its own sidebar row. No tool focuses it in the UI.
4. The launch call returns before the worktree exists. Workspace failures land on the run later.
5. `workspaceStrategy: { type: "worktree", branch }` with an existing branch fails at `git branch`. The thread still records that branch name.
6. `existing_worktree` accepts any path in the project's `git worktree list`, records `branch` as given (or null), runs no git command, runs the setup action, and does not check for other threads on that path.
7. A `t3/<8 hex>` branch passed with `existing_worktree` and a message gets renamed.
8. No MCP tool changes a thread's branch once it has a worktree. `t3_worktree_handoff` refuses an existing branch and a thread that already has a worktree.
9. `delegate_task` picks provider and model through `target`. It returns the child's last assistant message as `summary`, and a finished child wakes the parent.
10. `delegate_task` has no read-only mode. Narrow modes ask a human.
11. A `shared` child shares the parent's checkout and branch. A `worktree` child gets a new worktree from the parent's HEAD with its own `t3/` branch, renamed like any thread. Nothing removes it when the task ends.
12. `t3_thread_read` returns `branch`, `worktreePath`, and status. `t3_thread_list` does not return branch or path.
13. Thread status is the latest run's status, or `idle` with no runs.
14. `T3CODE_THREAD_ID` is set for Claude and in Codex shells. `CLAUDE_CODE_ENTRYPOINT=t3-code` is set for Claude unless the user's Claude settings override it.
15. T3's MCP server is `t3-code` in every provider. Claude sees `mcp__t3-code__<tool>`. It is on in every thread.

# Could not establish

- Whether Claude Code keeps `CLAUDE_CODE_ENTRYPOINT=t3-code` in the shells it runs.
- How PR discovery, post-run refresh, and the sidebar behave when an `existing_worktree` thread has `branch: null`.
- The exact git error text and how the UI shows a failed `worktree` launch on an existing branch. Inferred from `git branch` behaviour, not run.
- Whether the desktop registers `t3-thread://` with the OS. I found no registration, but did not trace every startup path.
- Whether tool calls are refused, not just hidden, when a capability is missing. I traced issuance, not every handler.
- Cursor and Muse could set variables through code I did not read (their SDKs).
- Nothing was run. Every finding is from reading the source.
