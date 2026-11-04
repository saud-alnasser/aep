---

---

# Question

What does Claude Code offer that lets an AEP agent, started in the main checkout, find an effort's worktree and keep working there with no human step? The worktree is either AEP's own `.aep/worktrees/<effort>/_run` or a T3 Code worktree under `~/.t3/worktrees/<repo>/t3-<hex>`.

This builds on `.aep/efforts/64-runtime-surfaces/evidence/research/claude-code-sandbox.md` (branch `64-runtime-surfaces`). It does not repeat that file.

# Scope of the evidence

- Docs: code.claude.com/docs, fetched as Markdown on 2026-11-04. Page URLs below drop the `.md` suffix.
- Changelog: `https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md`, top entry 2.1.318, fetched 2026-11-04.
- Observed: one Claude Code 2.1.318 session on native Windows 11, started from the CLI (not from T3 Code). Observed facts are labelled "Observed".
- T3 Code is a third-party app. No Anthropic doc names it. Nothing here says how T3 Code launches Claude Code.

---

# Q1. `additionalDirectories`, `allowWrite`, path expansion, plugins, and team settings

**Verdict.** `sandbox.filesystem.allowWrite` expands `~/` only. No doc says any of these keys expands `$HOME` or other environment variables. A plugin cannot contribute either key. The team file is `.claude/settings.json`. Claude Code reads it from the session's primary working directory. A linked worktree has its own checked-out copy of that file. Trust for a worktree is keyed on the main checkout.

**Sources**

- `https://code.claude.com/docs/en/settings-reference#sandbox-path-prefixes`: in `allowWrite`, `denyWrite`, `denyRead`, `allowRead`, `/` is absolute, `~/` is "relative to home directory", and `./` or no prefix is the project root in project settings or `~/.claude` in user settings. `//path` also works.
- `https://code.claude.com/docs/en/settings-reference#sandbox-filesystem-allowwrite`: on Linux and WSL2 only a trailing `/**` wildcard works in `allowWrite`. Entries merge across scopes. Entries from repository settings are left out while `blockReadsOutsideWorkingDirectories` is on, and under an admin-required sandbox.
- `https://code.claude.com/docs/en/settings-reference#sandbox-filesystem`: `Edit(...)` allow rules are added to `allowWrite`.
- `https://code.claude.com/docs/en/permissions#read-and-edit` (table near "`~/path` | Path from home directory"): Read and Edit rules accept `~/`.
- `https://code.claude.com/docs/en/settings-reference#permissions-additionaldirectories`: type "array of directory paths"; example `"../docs/"`. No prefix table. It does not say what a relative entry resolves against. Project entries apply only after workspace trust.
- Changelog 1.0.42: "Added tilde (`~`) expansion support to `/add-dir` command". No entry found that adds `~` or env-var expansion to the `additionalDirectories` key.
- Searched settings-reference, permissions, and sandboxing for "expand", `$HOME`, `${`. No env-var expansion is documented for these keys.
- `https://code.claude.com/docs/en/plugins/components#default-settings` and `https://code.claude.com/docs/en/plugins-reference` (Fields, `settings`): a plugin's `settings.json` applies only `agent` and `subagentStatusLine`. "every other key is dropped."
- `https://code.claude.com/docs/en/settings#settings-files-and-who-they-affect`: `.claude/settings.json` is the shared project file. "In a git repository, commit it so teammates get it."
- `https://code.claude.com/docs/en/settings#where-claude-code-keeps-the-local-file-in-a-git-repository`: Claude Code reads the shared `.claude/settings.json` "from the session's primary working directory". In a worktree, `settings.local.json` lives at the main checkout's root. Exception: on Windows (and some other cases) the local file stays with `.claude/settings.json` in the worktree.
- `https://code.claude.com/docs/en/permissions#project-allow-rules-and-workspace-trust`: "In a worktree, it uses the main checkout's root" for trust.
- `https://code.claude.com/docs/en/worktrees#what-worktrees-share-with-the-main-checkout`: project-scope plugins from the main checkout load in its worktrees. This holds for `--worktree` and `git worktree add` worktrees. Desktop-app worktree sessions read settings and hooks from the main checkout root instead.
- `https://code.claude.com/docs/en/permissions#additional-directories-grant-file-access-not-configuration`: `additionalDirectories` grants file access only. It loads no configuration from the directory. `--add-dir` and `/add-dir` load skills, commands, agents, and `enabledPlugins`/`extraKnownMarketplaces` from it.
- `https://code.claude.com/docs/en/settings-reference#permissions-blockreadsoutsideworkingdirectories`: directories added only in repository settings do not count as working directories for the read block.

**Interpretation**

- A T3 Code worktree is a separate checkout. Its `.claude/settings.json` is whatever its branch holds. A committed file therefore reaches it. An uncommitted edit in the main checkout does not.
- Because only `~/` is documented, a portable entry for `~/.t3/worktrees` has to be written with `~/`. `$HOME/...` and `%USERPROFILE%` are undocumented.

---

# Q2. Moving the session's working directory mid-session

**Verdict.** The model has one documented way to move the whole session: the `EnterWorktree` tool with a `path`. It accepts an existing worktree of the current repository. A path outside `.claude/worktrees/` always prompts the user. Only `bypassPermissions` mode skips that prompt. `/cd` and `/add-dir` are user commands; the model cannot call them. A Bash `cd` persists only inside the working directories.

**Sources**

- `https://code.claude.com/docs/en/tools-reference#enterworktree-tool-behavior`: "Given a `path`, it switches into an existing worktree instead of creating a new one." On first entry the target "may be a worktree of the current repository". "A `path` outside `.claude/worktrees/` prompts for your approval before entering." From inside a worktree session, only the `path` form is available, and the target must be under `.claude/worktrees/`. The same holds for a subagent with a pinned working directory. The tool is removed when `blockWritesOutsideWorkingDirectories` is on.
- `https://code.claude.com/docs/en/worktrees#ask-claude-to-create-a-worktree`: "An `EnterWorktree` permission rule or choosing 'don't ask again' doesn't suppress this prompt; only `bypassPermissions` mode skips it." The move carries "the session's working directory, write access, and project configuration such as `CLAUDE.md` and settings".
- Changelog: 2.1.105 "Added `path` parameter to the `EnterWorktree` tool to switch into an existing worktree of the current repository". 2.1.206 "`EnterWorktree` now asks for confirmation before entering a git worktree outside the project's `.claude/worktrees/` directory".
- `https://code.claude.com/docs/en/worktrees#how-claude-code-enforces-isolation`: while isolated in a worktree, Claude Code blocks Edit/Write into the main checkout, commands whose cwd is the main checkout, and git redirected into it (`git -C`, `--git-dir`, `GIT_DIR`, `cd` then git). A `cp` or shell redirect into the main checkout is not refused by these checks.
- `https://code.claude.com/docs/en/worktrees#resume-a-worktree-session`: entering or exiting a git-created worktree moves the transcript to the new directory's project storage.
- `https://code.claude.com/docs/en/permissions#cd`: "`Cd` is not a model-invocable tool: Claude can't call it, and the rules apply only when you run `/cd` yourself."
- `https://code.claude.com/docs/en/permissions#move-the-session-to-another-directory`: `/cd <path>` keeps the conversation and applies the new directory's settings, hooks, MCP servers, plugins, skills, and agents (v2.1.246+). `${CLAUDE_PROJECT_DIR}` stays at the start directory.
- `https://code.claude.com/docs/en/commands` (`/add-dir`, `/cd` rows) and `https://code.claude.com/docs/en/commands` intro: "A command is only recognized at the start of your message."
- `https://code.claude.com/docs/en/tools-reference#what-persists-between-commands`: a Bash `cd` carries over only inside the project directory or an additional working directory. Outside, Claude Code resets and appends `Shell cwd was reset to <dir>`. Subagents never carry over `cd`.
- `https://code.claude.com/docs/en/permission-modes#auto-approve-file-edits-with-acceptedits-mode`: auto-approval of edits covers the working directory and `additionalDirectories` only. Paths outside still prompt.
- `https://code.claude.com/docs/en/permission-modes#the-first-read-outside-the-working-directories`: in auto mode the first Read/Grep/Glob outside the working directories prompts once, in interactive sessions only.
- `https://code.claude.com/docs/en/permission-modes#how-auto-mode-evaluates-actions`: outside the working directory, edits go to allow rules or the classifier.
- `https://code.claude.com/docs/en/hooks#permission-update-entries`: a `PermissionRequest` hook may return `updatedPermissions` with `addDirectories` (destination `session`, `localSettings`, `projectSettings`, or `userSettings`).
- `https://code.claude.com/docs/en/hooks#directoryadded`: an SDK host can add a working directory mid-session with the `register_repo_root` control request.
- Sandbox writes: see the prior file. Sandboxed commands write only to the working directory, temp, added directories, and `allowWrite`.

**Interpretation**

- Both target locations are outside `.claude/worktrees/`. So `EnterWorktree` into either one prompts the user, unless the session runs in `bypassPermissions`.
- A T3 Code worktree is a `git worktree add` of the same repository, so it should qualify as "a worktree of the current repository". AEP's `_run` qualifies only if it is a git worktree. Not tested.
- Without a move, the model can still work on another directory through absolute paths in file tools and `git -C`. Each such action meets the permission mode and, for Bash, the sandbox write set.
- The docs do not say whether a `PreToolUse` or `PermissionRequest` hook "allow" skips the `EnterWorktree` out-of-tree prompt. The worktrees page names only `bypassPermissions`.

---

# Q3. `SessionStart` hooks

**Verdict.** Input carries `session_id`, `cwd`, `transcript_path`, `source` (`startup`, `resume`, `clear`, `compact`, `fork`), and more. Output can add `additionalContext`, a `systemMessage` for the user, `sessionTitle`, `watchPaths`, `reloadSkills`, and, in `-p` mode only, `initialUserMessage`. Default timeout is 600 seconds. A hook cannot change the session's directory. It can only tell the model things in text.

**Sources**

- `https://code.claude.com/docs/en/hooks#sessionstart`: fires on new and resumed sessions. Matchers `startup`, `resume`, `clear`, `compact`, `fork`. Only `command` and `mcp_tool` types. Hooks run in the background at launch; Claude's first response waits for them.
- `https://code.claude.com/docs/en/hooks#sessionstart-input`: `source`, optional `model`, `agent_type`, `session_title`. On resume/fork: `seconds_since_last_response`, `context_tokens`, `prompt_cache_likely_expired`, `estimated_cache_write_usd`.
- `https://code.claude.com/docs/en/hooks#common-input-fields`: `session_id`, `prompt_id`, `transcript_path`, `cwd`, `scratchpad_dir`, `permission_mode` (not on all events), `effort`, `hook_event_name`. A hook process inherits the parent environment.
- `https://code.claude.com/docs/en/hooks#sessionstart-decision-control`: `additionalContext`, `initialUserMessage` ("in non-interactive mode with the `-p` flag"), `sessionTitle`, `watchPaths`, `reloadSkills`. Plain stdout is also added as context.
- `https://code.claude.com/docs/en/hooks#json-output`: universal `systemMessage` is a "Warning message shown to the user". Each string is capped at 10,000 characters.
- `https://code.claude.com/docs/en/hooks#add-context-for-claude`: context is wrapped in a system reminder. "Write the text as factual statements rather than imperative system instructions." Imperative "out-of-band system commands can trigger Claude's prompt-injection defenses".
- `https://code.claude.com/docs/en/hooks#common-fields`: default `timeout` 600 s for `command`, `http`, `mcp_tool`.
- `https://code.claude.com/docs/en/hooks#exit-code-2-behavior-per-event`: `SessionStart` cannot block.
- `https://code.claude.com/docs/en/hooks#persist-environment-variables`: `CLAUDE_ENV_FILE` lets the hook set variables for later Bash commands. Not available to hooks run in PowerShell, including Windows without Git Bash.
- `https://code.claude.com/docs/en/hooks#hook-locations`: plugin `hooks/hooks.json` runs "When plugin is enabled". Plugin hooks also run inside subagents.
- `https://code.claude.com/docs/en/plugins/install`: user scope means "enabled for you in every project on this machine", stored in `~/.claude/settings.json`. Terminal, desktop app, and VS Code share these files.
- `https://code.claude.com/docs/en/hooks#workspace-trust`: in interactive sessions hooks from settings files wait for workspace trust. `-p` and SDK sessions treat the folder as trusted.
- `https://code.claude.com/docs/en/headless#start-faster-with-bare-mode`: `--bare` skips hooks and installed plugins.
- `https://code.claude.com/docs/en/hooks#reference-scripts-by-path`: `${CLAUDE_PROJECT_DIR}` is the root where the session started. The `cwd` input field follows `EnterWorktree` and `cd`.
- The current plugin hook (`src/adapters/claude/hooks/check-version.mjs`) already returns `additionalContext` and reads `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PROJECT_DIR`.

**Interpretation**

- A user-scope AEP plugin's `SessionStart` hook should run in any Claude Code session on the machine that loads user plugins. That excludes `--bare` runs. Whether T3 Code passes `--bare`, `--setting-sources`, or uses the Agent SDK with other settings sources is not established.
- A hook can name the worktree path in `additionalContext`. The model may then act on it. Nothing makes the model obey. The docs advise factual phrasing over commands.
- No doc says whether `initialUserMessage` expands a `/skill` command. Not established.

---

# Q4. `SessionEnd`, `Stop`, `PreCompact`, `UserPromptSubmit`

**Verdict.** All four get the common fields, including `session_id` and `cwd`. All are command processes, so they can write files. `Stop`, `PreCompact`, and `UserPromptSubmit` can block. `SessionEnd` cannot, and has a 1.5-second budget.

**Sources**

- `https://code.claude.com/docs/en/hooks#sessionend`: input `reason` (`clear`, `resume`, `logout`, `prompt_input_exit`, `other`). No decision control. JSON output discarded. 1.5 s default budget; per-hook `timeout` raises it up to 60 s, but "Timeouts set on plugin-provided hooks don't raise the budget." `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS` overrides.
- `https://code.claude.com/docs/en/hooks#stop`: fires when the main agent finishes a response; not on user interrupt. Input `stop_hook_active`, `last_assistant_message`, `background_tasks`, `session_crons`. `decision: "block"` with `reason`, or `additionalContext`, keeps Claude going. Capped at 8 consecutive continuations (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`).
- `https://code.claude.com/docs/en/hooks#precompact`: matchers `manual`, `auto`. Input `trigger`, `custom_instructions`. Exit 2 or `decision: "block"` blocks compaction. `systemMessage` and `continue` discarded.
- `https://code.claude.com/docs/en/hooks#postcompact`: input includes `compact_summary`. No decision control.
- `https://code.claude.com/docs/en/hooks#userpromptsubmit`: also fires on scheduled tasks, background subagents reporting back, and messages from other sessions. Input `prompt`, `session_title`. Default timeout 30 s. Output `decision: "block"`, `additionalContext`, `sessionTitle`. Plain stdout becomes context.
- `https://code.claude.com/docs/en/sandboxing` ("The sandbox covers shell commands only. ... hooks run outside it") and `https://code.claude.com/docs/en/hooks#directoryadded` ("Hook commands themselves run unsandboxed").
- `https://code.claude.com/docs/en/hooks#cwdchanged`: fires when a main-conversation shell command changes directory. Input `old_cwd`, `new_cwd`. Cannot block. Can set `CLAUDE_ENV_FILE` variables and `watchPaths`.
- `https://code.claude.com/docs/en/hooks#sessionstart`: `compact` source re-runs `SessionStart` after compaction, so its context is re-added.

**Interpretation**

- Hooks run outside the sandbox with the user's permissions. A hook can therefore write state into the main checkout even when sandboxed Bash cannot.

---

# Q5. Environment variables

**Verdict.** Documented: `CLAUDECODE=1`, `CLAUDE_CODE_CHILD_SESSION=1`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_PID`, `CLAUDE_EFFORT`, `CLAUDE_ENV_FILE`, messaging socket and token. `CLAUDE_PROJECT_DIR` is documented for hooks and stdio MCP servers, not for Bash. `CLAUDE_CODE_ENTRYPOINT` exists but is undocumented. No variable that names a host app such as T3 Code is documented.

**Sources**

- `https://code.claude.com/docs/en/env-vars`:
  - `CLAUDECODE`: "Set to `1` in subprocesses Claude Code spawns (Bash and PowerShell tools, tmux sessions, hook commands, status line commands, stdio MCP server subprocesses). IDE extensions also set this in their integrated terminals."
  - `CLAUDE_CODE_CHILD_SESSION`: set to `1` in Bash, PowerShell, Monitor, hook, and status-line subprocesses. "only set by Claude Code itself".
  - `CLAUDE_CODE_SESSION_ID`: set in Bash, PowerShell, hook, and stdio MCP subprocesses. Matches hook `session_id`. Updated on `/clear`.
  - `CLAUDE_PID`, `CLAUDE_EFFORT`, `CLAUDE_ENV_FILE`, `CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`, `CLAUDE_CODE_BRIDGE_SESSION_ID` (Remote Control only), `CLAUDE_CODE_REMOTE_SESSION_ID` (cloud only).
  - `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST`: "Set by host platforms that embed Claude Code". It controls provider routing. It does not name the host.
- `https://code.claude.com/docs/en/hooks#reference-scripts-by-path`: `${CLAUDE_PROJECT_DIR}` for hooks and stdio MCP servers. Changelog 1.0.58 (hooks) and 2.1.139 (MCP servers).
- `https://code.claude.com/docs/en/hooks#common-input-fields` (end): `$CLAUDE_CODE_REMOTE` is `"true"` in remote web environments.
- Changelog: "Set `AI_AGENT` environment variable for subprocesses so `gh` can attribute traffic to Claude Code". Changelog 2.1.152 adds the session entrypoint as an OpenTelemetry attribute; the variable itself is not documented.
- Observed (2.1.318, native Windows, CLI launch, inside a Bash tool call of a subagent): `CLAUDECODE=1`, `CLAUDE_CODE_CHILD_SESSION=1`, `CLAUDE_CODE_SESSION_ID=<uuid>`, `CLAUDE_PID`, `CLAUDE_EFFORT`, `CLAUDE_CODE_ENTRYPOINT=cli`, `CLAUDE_CODE_EXECPATH=<path to claude.exe>`, `CLAUDE_CODE_SESSION_ATTENDED=1`, `AI_AGENT=claude-code_2-1-318_agent`, `CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`. `CLAUDE_PROJECT_DIR` was absent from the Bash environment.

**Interpretation**

- `CLAUDE_CODE_ENTRYPOINT` may differ under other launchers (for example an SDK). Its values are undocumented, so it is weak evidence of the host.
- T3 Code may set its own variables. That is outside these sources.

---

# Q6. Sub-agents

**Verdict.** `isolation: "worktree"` always makes a fresh temporary worktree. It takes no path or branch. The Agent tool has no working-directory parameter. A subagent starts in the main conversation's current directory, and its `cd` does not persist. A `WorktreeCreate` hook replaces how the worktree is made and returns its path. Background is the default; `SendMessage` reaches a running or finished subagent by ID or name.

**Sources**

- `https://code.claude.com/docs/en/sub-agents#write-subagent-files`: "A subagent starts in the main conversation's current working directory. Within a subagent, `cd` commands don't persist".
- `https://code.claude.com/docs/en/sub-agents#supported-frontmatter-fields` (`isolation` row): "run the subagent in a temporary git worktree ... branched by default from your default branch". Cleaned up if no changes.
- `https://code.claude.com/docs/en/worktrees#choose-the-base-branch`: `worktree.baseRef` is `"fresh"` or `"head"`. "You can't set `worktree.baseRef` to a branch name."
- `https://code.claude.com/docs/en/hooks#agent` (PreToolUse input for Agent): fields `prompt`, `description`, `subagent_type`, `model`. No cwd field listed.
- `https://code.claude.com/docs/en/permissions#match-by-input-parameter`: `Agent(isolation:worktree)` is a matchable parameter.
- Observed: this session's Agent tool schema offers `isolation` values `worktree` and `remote`, and no cwd parameter.
- `https://code.claude.com/docs/en/hooks#worktreecreate`: fires for `isolation: "worktree"`, `--worktree`, `EnterWorktree` creation, background sessions. Input `name`. Command hook prints the path as the last stdout line. Claude Code refuses paths with `.`/`..` or symlinks below the repo root. The docs describe "the created worktree directory". They do not say whether returning an existing directory is allowed.
- `https://code.claude.com/docs/en/worktrees#claude-code-refuses-to-use-a-worktree`: an identity check runs "whether Claude Code is creating the worktree, entering an existing one, or reusing one".
- `https://code.claude.com/docs/en/tools-reference#enterworktree-tool-behavior`: a subagent with a pinned directory may use `EnterWorktree` only with a path under `.claude/worktrees/`.
- `https://code.claude.com/docs/en/sub-agents#run-subagents-in-foreground-or-background`: subagents start in the background by default. Background subagents surface permission prompts in the main session.
- `https://code.claude.com/docs/en/sub-agents#resume-subagents`: `SendMessage` with agent ID or name resumes a completed or stopped subagent. Messages from the launcher count as task direction, never as user approval.
- `https://code.claude.com/docs/en/cross-session-messaging`: `SendMessage` can also reach other local Claude Code sessions when messaging is enabled.

**Interpretation**

- A subagent can be pointed at an existing worktree only by its prompt (absolute paths, `git -C`). Its permissions and sandbox then judge each action.
- Using a `WorktreeCreate` hook to hand back an existing worktree is not documented either way. Not tested.

---

# Q7. Resuming work in another directory

**Verdict.** Sessions are stored per project directory. `--resume <id>` works from any directory and searches the current repo and its worktrees first. `--continue` picks the latest session for the launch directory. A session that ended inside a Claude-entered worktree resumes back into that worktree. None of this moves a running session.

**Sources**

- `https://code.claude.com/docs/en/sessions#resume-a-session`: `--continue` "Reopens the most recent session in the current directory". `--resume <name>`, `--resume <transcript-path>`, `--from-pr`.
- `https://code.claude.com/docs/en/sessions#resume-by-session-id-or-name`: `claude --resume <session-id>` "from any directory". Search order: current project and its git worktrees, then every other project.
- `https://code.claude.com/docs/en/sessions#sessions-in-other-worktrees-and-projects`: a session from another worktree of the same repo "resumes it in place". Unrelated project: copies a `cd` and resume command to the clipboard.
- `https://code.claude.com/docs/en/sessions#what-a-resumed-session-restores`: `--add-dir` and `/add-dir` directories are not restored. Settings files are re-read.
- `https://code.claude.com/docs/en/worktrees#resume-a-worktree-session`: a session that ended inside a worktree returns to it, interactively, with `-p`, and in the SDK. Launching from inside a `git worktree add` worktree's subdirectory can decline; launch from the main checkout.
- `https://code.claude.com/docs/en/sessions#where-transcripts-are-stored`: `~/.claude/projects/<project>/<session-id>.jsonl`, `<project>` derived from the working directory path.
- `https://code.claude.com/docs/en/hooks#sessionstart`: resume fires `SessionStart` with `source: "resume"`.

---

# Summary: facts AEP can rely on

1. Plugin hooks in `hooks/hooks.json` run whenever the plugin is enabled; user scope enables it in every project on the machine (hooks, plugins/install).
2. `SessionStart` fires on `startup`, `resume`, `clear`, `compact`, `fork`, and receives `session_id`, `cwd`, `source` (hooks#sessionstart).
3. A `SessionStart` hook can add up to 10,000 characters of `additionalContext`, show a `systemMessage`, set a title, and reload skills. It cannot block or move the session (hooks#sessionstart-decision-control).
4. Hooks run outside the sandbox, as the user (sandboxing; hooks#directoryadded).
5. `${CLAUDE_PROJECT_DIR}` is fixed at the start directory; the hook `cwd` field follows `EnterWorktree` and `cd` (hooks#reference-scripts-by-path).
6. `EnterWorktree` with `path` enters an existing worktree of the current repository (tools-reference; changelog 2.1.105).
7. Any `EnterWorktree` target outside `.claude/worktrees/` prompts the user; no permission rule suppresses it; only `bypassPermissions` skips it (worktrees; changelog 2.1.206).
8. `/cd` and `/add-dir` are user-only; the model cannot invoke them (permissions#cd; commands).
9. A Bash `cd` persists only inside working directories; subagent `cd` never persists (tools-reference).
10. `isolation: "worktree"` always creates a fresh worktree from `fresh` or `head`; no path or branch input; the Agent tool has no cwd parameter (sub-agents; worktrees).
11. `sandbox.filesystem.allowWrite` supports `~/`, absolute `/` or `//`, and project-relative paths; Edit allow rules feed into it (settings-reference).
12. Plugins cannot set `permissions` or `sandbox` keys; only `agent` and `subagentStatusLine` (plugins/components).
13. Shared `.claude/settings.json` is read from the session's primary working directory; trust in a worktree is keyed on the main checkout (settings; permissions).
14. `CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SESSION_ID` are set in Bash and hook processes (env-vars).
15. `--resume <session-id>` works from any directory; a session ended inside a worktree resumes into it (sessions; worktrees).

# Not established

1. Whether `additionalDirectories` expands `~` or env vars, and what relative entries resolve against.
2. Whether any of these keys expands `$HOME` or `%USERPROFILE%`.
3. Whether a `PreToolUse` or `PermissionRequest` hook "allow" removes the `EnterWorktree` out-of-tree prompt.
4. Whether a `WorktreeCreate` hook may return an existing worktree path.
5. Whether `initialUserMessage` expands a slash command or skill.
6. How T3 Code launches Claude Code: CLI flags, `--bare`, Agent SDK, setting sources, permission mode, or environment variables. Hence whether the AEP plugin's hooks run there.
7. The meaning and value set of `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_SESSION_ATTENDED`, `CLAUDE_CODE_EXECPATH`.
8. Whether AEP's `.aep/worktrees/<effort>/_run` passes the `EnterWorktree` identity check. Nothing was run.
