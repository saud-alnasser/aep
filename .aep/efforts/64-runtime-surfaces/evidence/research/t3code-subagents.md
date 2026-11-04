---

---

# Question

At pingdotgg/t3code `main` on 2026-11-04, how can an AEP effort's tickets run as sub-agents of one T3 Code thread? The effort thread should have one sidebar row. The tickets should show in that thread's own sub-agent view. Each ticket builds in its own AEP worktree, outside the thread's `worktreePath`. Several tickets build at once.

Four questions:

1. Does T3 show a Claude Code agent's own sub-agents (the Agent tool, foreground and background) as that thread's sub-agents? What does the user see? The same for Codex, if cheap.
2. Can a `delegate_task` child build outside its thread's `worktreePath` by absolute paths? What in T3 would stop, corrupt, or fight it?
3. Can anything at head start a `subagent`-lineage child whose workspace is an existing worktree path?
4. What does the parent see of a running child in each mechanism? Can several run at once? Is there a limit?

# Sources

- T3 Code source at commit `9e85538535c8553901351112ab02dd1dd62db5ee` (`9e85538535c8`). A fresh blobless clone on 2026-11-04 found this commit still the head of `main`. Committed 2026-11-04T09:50:14-04:00.
- **Nothing changed since `9e85538535c8`.** `git log 9e85538535c8..origin/main` is empty.
- Permalink form: `https://github.com/pingdotgg/t3code/blob/9e85538535c8553901351112ab02dd1dd62db5ee/<path>#L<a>-L<b>`. Below, `<base>` stands for `https://github.com/pingdotgg/t3code/blob/9e85538535c8553901351112ab02dd1dd62db5ee`.
- Only TypeScript was read, plus the name of one test. Nothing was run.
- Builds on `t3code-orchestration.md` and `claude-code-continuation.md` in this folder. Their findings are not re-derived. Claude Code behaviour (permission modes, `cd`, sub-agent cwd) comes from `claude-code-continuation.md` and `claude-code-sandbox.md`.

# Findings

## 1. Claude Code's own sub-agents under T3

**Verdict: yes. T3 turns each Claude Code sub-agent, foreground or background, into a child thread with `subagent` lineage under the thread that started it. It has no sidebar row. The user sees it in the thread's details panel and in the thread's timeline, with live status, elapsed time, progress, result, and a full transcript one click away. A running one can be stopped from there. Codex sub-agents get the same child-thread treatment.**

Source:

- The adapter reacts to the SDK `system/task_started` message. Every task type except `local_bash` goes to `updateClaudeSubagentNode` with status `running`. A backgrounded one (`is_backgrounded: true`) is also recorded in `backgroundedSubagentTaskIds` (`<base>/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L9054-L9151`). The only excluded kind is `local_bash` (`#L2936-L2939`, `#L2987-L2989`).
- On first sight `updateClaudeSubagentNode` emits `app_thread.created` with `makeSubagentChildThread(...)`, `createdBy: "agent"`, `creationSource: "provider"`. Then it emits `node.updated` (kind `subagent`), `subagent.updated` (origin `provider_native`), the prompt as the child's first user message, and a `subagent` turn item on the parent (`ClaudeAdapterV2.ts#L6559-L6822`).
- `makeSubagentChildThread` copies the parent thread record and sets `lineage.relationshipToParent: "subagent"` and `parentThreadId` (`<base>/packages/provider-core/src/server/subagentProjection.ts#L52-L101`). **So the child records the parent's `branch` and `worktreePath`, whatever directory it actually writes to.**
- The ingestor turns `app_thread.created` into `thread.created` and `subagent.updated` into a stored domain event (`<base>/apps/server/src/orchestration-v2/ProviderEventIngestor.ts#L464-L495`, `#L552-L561`).
- Transcript: SDK frames that carry a `parent_tool_use_id` are routed to the matching child thread. Assistant text becomes child messages (`ClaudeAdapterV2.ts#L9448-L9495`). Thinking becomes reasoning items (`#L9449-L9463`, `#L7189-L7230`). Tool calls become tool items in the child (`#L7043-L7056`, `#L7126-L7144`). Frames that arrive before their `task_started` are held, up to 64 owners and 256 frames each (`#L9015-L9043`, `#L4276-L4277`).
- Background sub-agents: the test name "streams a background subagent's work while the root turn is idle" asserts assistant text in the child thread (`<base>/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.test.ts#L12427-L12560`).
- Progress: `task_progress` sets `progress` on the node (`ClaudeAdapterV2.ts#L9173-L9196`). It is skipped when the task is in T3's background-task roster (`#L9175-L9186`, `#L5261-L5264`).
- End: a foreground sub-agent settles from its Agent tool result (`#L9341-L9377`). A background one settles only from `task_notification`, whose `summary` becomes the result (`#L9361-L9367`, `#L9267-L9286`). The result is also posted as the child's last assistant message if not already shown (`#L6829-L6852`).
- Sidebar: subagent and side-chat threads have no sidebar row. An open one maps to its nearest listed ancestor (`<base>/apps/web/src/components/Sidebar.logic.ts#L590-L612`).
- Details panel: `ThreadRelationshipsPanel` is in the thread details panel (`<base>/apps/web/src/components/chat/ThreadDetailsPanel.tsx#L252-L259`). Each subagent row shows a provider icon, the title, a status label or elapsed time, and a hover card with model, status, progress, and result (`<base>/apps/web/src/components/chat/ThreadRelationshipsControl.tsx#L646-L760`). It covers both origins, `app_owned` and `provider_native`. Stop is offered for a running `provider_native` Claude sub-agent with a strong native ref (`#L671-L681`, `#L610-L624`). Clicking a row opens the child thread in the same chat (`#L555-L562`).
- Timeline: a `subagent` turn item renders as a collapsible "N subagents" group with live members and elapsed time (`<base>/apps/web/src/components/chat/TimelineV2EventRow.tsx#L22`, `#L60-L134`; `<base>/apps/web/src/components/chat/MessagesTimeline.tsx#L1425`).
- Codex: a Codex native sub-agent gets a `provider_native` subagent record, its own provider thread, and a child thread from `makeSubagentChildThread` (`<base>/apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts#L2932-L2975`). Other adapters call the same helper: ACP, Cursor, Muse, OpenCode (`packages/provider-*/src/server/adapter.ts`, found by grep).

Interpretation:

- A Claude Code effort thread that starts ticket builders with its own Agent tool gets them listed under the thread, not in the sidebar.
- The child's recorded `worktreePath` is the parent's. That field is wrong for a builder that writes into an AEP ticket worktree. I found no T3 action on a provider-native child's `worktreePath` beyond what follows from the parent's thread (provider-native children have no runs of their own, so no checkpoint). See Q2.
- Codex transcript routing for its sub-agents was not traced beyond child-thread creation.

## 2. A `delegate_task` child building outside its `worktreePath`

**Verdict: nothing in T3 blocks it at `full-access`. T3 starts the child's provider in the thread's `worktreePath` and confines nothing itself. The limits come from the provider's own mode: at `full-access`, Claude runs `bypassPermissions` and Codex runs `dangerFullAccess`, so absolute paths work. At narrower modes, Codex's `workspaceWrite` sandbox and Claude's `acceptEdits` stop or prompt on writes outside the cwd. T3's checkpoints, diffs, reverts, and post-run refreshes all act on the `worktreePath` only. So they neither see nor touch a ticket worktree.**

Source, by concern:

- **cwd.** The runtime policy's `cwd` is the thread's `worktreePath`, else the project root (earlier file; `RuntimePolicy.ts#L162-L192`). The Claude query gets `cwd` and `additionalDirectories = [cwd, attachmentsDir, any --add-dir launch args]` (`<base>/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L1671-L1678`, call at `#L10508-L10516`). A Claude Bash `cd` outside the working directories does not persist (`claude-code-continuation.md`, Q2).
- **Sandbox or permission mode.** T3 sets no Claude sandbox. `sandboxPolicy` is read only if the runtime policy carries one (`ClaudeAdapterV2.ts#L2551-L2558`), and the server never sets it (earlier file). Permission modes map from runtime mode as the earlier file says. Codex `auto-accept-edits` and `auto` use `workspaceWrite` with no writable roots added; `full-access` uses `dangerFullAccess` (`<base>/apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts#L717-L756`).
- **Checkpoints.** Each run's checkpoint scope has `cwd` = runtime cwd, else the thread's `worktreePath` (`<base>/apps/server/src/orchestration-v2/Orchestrator.ts#L2051-L2058`, `#L6059-L6067`; `<base>/apps/server/src/orchestration-v2/CheckpointService.ts#L174-L200`). Capture writes a commit and ref from a temporary index in the git common dir. It does not touch the working tree or the real index (`<base>/apps/server/src/vcs/GitVcsDriver.ts#L900-L970`). Capture is serialised per `cwd` by a keyed lock (`CheckpointService.ts#L243-L245`, `#L347-L349`).
- **Diffs.** A turn's file list is the numstat diff between the scope's previous and new checkpoint refs, minus git imports (`CheckpointService.ts#L436-L469`). It covers the scope `cwd` only.
- **Reverts.** File restore is refused unless the thread's checkout is isolated. Any other live thread whose path or session cwd overlaps makes it "shared", with the message "File restore requires an isolated worktree…" (`<base>/apps/server/src/orchestration-v2/CheckpointRestoreSafety.ts#L9-L106`). It is checked at rollback and at admission (`<base>/apps/server/src/orchestration-v2/CheckpointRollbackService.ts#L239`; `Orchestrator.ts#L12082-L12101`).
- **Several `shared` children in one worktree.** Each `shared` child is its own thread with its own provider session. Its `worktreePath` and `branch` are the parent's (earlier file; `Orchestrator.ts#L7800-L7816`). Each child run captures its own checkpoint of that same `cwd`.
- **Post-run work.** After a run, T3 captures the checkpoint, then refreshes workspace entries, local VCS status, and PR status for the scope `cwd` (`<base>/apps/server/src/orchestration-v2/RunFinalizationService.ts#L57-L125`). The PR sweep looks up PRs by the thread's `worktreePath` and `branch` (`<base>/apps/server/src/orchestration-v2/ThreadPullRequestService.ts#L160-L197`). It skips subagent children in the periodic sweep: "Subagent children refresh after their own runs" (`#L133-L139`). Settle scripts run in a settled thread's `worktreePath` (`<base>/apps/server/src/orchestration-v2/ThreadSettlementService.ts#L590-L614`). For a provider-native child with a temporary branch, the ingestor re-reads HEAD in its `worktreePath` (`ProviderEventIngestor.ts#L736-L762`).

Interpretation:

- A ticket worktree is outside every path above. T3 will not diff it, revert it, refresh it, or run scripts in it. Its changes do not show in the child's checkpoint card.
- Writes the child makes inside the shared `worktreePath` do show. They also show in every sibling's turn diff, because each diff spans the whole checkout. File restore will be refused for them.
- The one material risk is mode. At `auto` or `auto-accept-edits`, a Codex child cannot write a ticket worktree without escalation, and a Claude child prompts (acceptEdits) or goes to the classifier (auto) per Claude Code's docs. At `full-access` both proceed.

## 3. A `subagent`-lineage child on an existing worktree path

**Verdict: no MCP tool can do it at head.**

Source:

- `delegate_task`: `isolation` is `shared` or `worktree`. The handler builds only `{ type: "worktree", baseRef: <parent HEAD>, startFromOrigin: false }` (`<base>/apps/server/src/mcp/OrchestratorMcpService.ts#L2423-L2452`). Input schema as in the earlier file (`<base>/packages/contracts/src/orchestratorMcp.ts#L168-L196`).
- `t3_thread_launch`: `thread.create` always sets `lineage.parentThreadId: null`, `relationshipToParent: null` (`Orchestrator.ts#L2844-L2848`). `delegatedFrom` is kept only when the server stamped a `linkOrigin` (`#L2840-L2843`). It is stripped from client commands (`<base>/apps/server/src/orchestration-v2/ThreadManagementService.ts#L77-L86`). The tool says it is "Set by a linked environment launching its agent's delegated task here; ignored otherwise" (`<base>/apps/server/src/mcp/toolkits/project/tools.ts#L154-L155`). It has no hide-from-sidebar option.
- `create_threads` (listed in the earlier file, not examined there): "Create new top-level threads in this checkout. Not delegation." Request fields are `prompt`, `title`, `target`, `runtimeMode`, `interactionMode`. No workspace field (`<base>/apps/server/src/mcp/toolkits/orchestrator/tools.ts#L212-L223`; `orchestratorMcp.ts#L261-L277`). It records each thread on the parent's timeline with `thread.created.record` (`OrchestratorMcpService.ts#L2910-L2924`), but the threads are top-level.
- Below MCP: the server command `delegated_task.request` takes an optional `workspaceStrategy` of the full launch type, which includes `existing_worktree` (`<base>/packages/contracts/src/orchestrationV2.ts#L3319-L3335`, `#L654-L670`). It is not in the internal-only list (`#L3375` onward). The WebSocket `dispatchCommand` RPC forwards client commands (`<base>/apps/server/src/ws.ts#L1999-L2030`). Only the MCP handler sends this command in the server and web sources (grep).

Interpretation:

- The data model supports a delegated child with `existing_worktree`. Only the MCP surface does not expose it. A T3 client holding WebSocket credentials might send it. An agent gets an MCP credential, not a WebSocket one (earlier file, §8).

## 4. What the parent sees, and concurrency

**Verdict:**

- **`delegate_task`:** the parent gets `taskId`, `childThreadId`, `status`, `workState`, and on completion `summary` (the child's last non-empty assistant message). Async children wake the parent on every terminal. Several can run at once. I found no count limit. Each call needs an active parent run.
- **Claude Code Agent tool:** the parent agent sees what Claude Code gives it: the tool result for a foreground sub-agent, and `task_notification` for a background one. T3 adds a wake notification when a background sub-agent ends while the parent is idle. T3 sets no count limit.

Source:

- `delegate_task` result fields, wake rules, and `summary` source: earlier file §2 (`orchestratorMcp.ts#L204-L240`; `OrchestratorMcpService.ts#L2471-L2474`; `subagentProjection.ts#L179-L210`). `task_status` description: "Do not call it on a running task before its completion wakes you. `workState`: working, waiting_for_children, result_available… `summary`: final result." (`orchestrator/tools.ts#L99-L111`).
- Active parent required: "Delegated tasks require an active run owned by this MCP provider session." (`OrchestratorMcpService.ts#L2387-L2399`).
- No limit: the only constants in `OrchestratorMcpService.ts` cap waits, lists, and reads (`#L132-L144`). A grep for concurrency, depth, or count caps on delegation or runs in `apps/server/src` and `packages/contracts/src` found none. `create_threads` caps one call at 20 threads (`orchestratorMcp.ts#L270-L276`).
- Claude background wake: a backgrounded sub-agent's `task_notification` records a wake report `{ kind: "subagent", label, outcome, childThreadId }` (`ClaudeAdapterV2.ts#L9243-L9254`). When Claude Code wakes the idle thread, T3 offers a continuation with a notification built from those reports (`#L8223-L8251`; `<base>/packages/provider-core/src/server/notification.ts#L12-L21`).
- `t3_background_wait` keeps a Claude thread in Working while named background tasks run: "Pass its task ID after starting it… Claude only." Up to 20 ids per call (`orchestrator/tools.ts#L140-L157`).
- The user's view of both kinds is the same panel and timeline group (Q1).

Interpretation:

- Under `delegate_task`, the parent must stay inside a turn to start children, then end its turn. The wake brings it back per child.
- Under the Agent tool, background builders return through Claude Code's own notification. That works the same with or without T3.

# Facts AEP can rely on (at `9e85538535c8`)

1. `main` has not moved since `9e85538535c8`.
2. A Claude Code sub-agent started by the Agent tool, foreground or background, becomes a `subagent`-lineage child thread under its parent. Only `local_bash` tasks are excluded.
3. That child has no sidebar row. It shows in the parent's details panel and timeline with status, elapsed time, progress, result, a Stop action while running, and its transcript (prompt, assistant text, thinking, tool calls).
4. A provider-native child records the parent's `branch` and `worktreePath`, regardless of where it writes.
5. Codex native sub-agents also become `subagent`-lineage child threads.
6. T3 starts a delegated child's provider with `cwd` = the thread's `worktreePath`. T3 adds no write confinement of its own.
7. At `full-access`, Claude runs `bypassPermissions` and Codex runs `dangerFullAccess`. Absolute-path writes outside the `worktreePath` proceed. At narrower modes, Codex's `workspaceWrite` blocks them and Claude prompts or classifies them.
8. Checkpoints, turn diffs, file restore, post-run status refreshes, PR lookups, and settle scripts act on the `worktreePath` only. A ticket worktree outside it is neither shown nor changed by them.
9. Checkpoint capture uses a temporary index and does not modify the working tree or the real index.
10. `shared` children of one thread all share the parent's checkout. Each one's turn diff spans the whole checkout. File restore is refused there.
11. No MCP tool starts a `subagent`-lineage child on an existing worktree. `delegate_task` offers only `shared` and a new `worktree`. `t3_thread_launch` and `create_threads` make top-level threads.
12. The server command `delegated_task.request` does accept `existing_worktree`, but only the MCP handler sends it, and the handler never does.
13. `delegate_task` needs an active parent run, returns `summary`, wakes the parent per child, and has no count limit I could find.
14. A finished background Claude sub-agent produces a T3 wake notification naming the child thread.

# Could not establish

- Whether Claude Code's SDK, as T3 starts it, loads the user's own sandbox settings. T3 sets no `settingSources` on the query; the SDK default was not checked.
- Whether `task_progress` updates reach a background Claude sub-agent's progress text. T3 skips progress for tasks in its background roster; I did not confirm whether sub-agents enter that roster.
- Codex sub-agent transcript routing past child-thread creation.
- Whether a `delegated_task.request` sent over the WebSocket with `existing_worktree` would prepare correctly, and whether any agent process can obtain a WebSocket credential.
- Whether settle scripts skip shared checkouts. The comment says so; the code read does not show the check.
- Claude Code's own limit on concurrent background sub-agents. Out of T3's code.
- Nothing was run. Every finding is from reading the source.
