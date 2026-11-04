---

---

# Question

Under the Claude Code bash sandbox, when the working directory is a linked git worktree outside the main checkout, can a sandboxed command commit, and can it write into the main checkout?

# Sources

The official Claude Code documentation, read on 2026-11-04 by a documentation agent:

- https://code.claude.com/docs/en/sandboxing
- https://code.claude.com/docs/en/settings-reference#sandbox-path-prefixes
- https://code.claude.com/docs/en/sandboxing#repository-settings-under-an-admin-required-sandbox
- https://code.claude.com/docs/en/sandboxing#the-unsandboxed-retry-escape-hatch

# Findings

- Sandboxed commands may write to the working directory, a per-user temp directory, and any directory added with `--add-dir`, `/add-dir`, or `permissions.additionalDirectories` (sandboxing).
- When the working directory is a linked git worktree, the sandbox also allows writes to the main repository's shared `.git`, so `git commit` updates refs and the index. Writes to `hooks/` and `config` in it stay denied (sandboxing). The docs do not say whether this depends on where the worktree sits.
- `sandbox.filesystem.allowWrite` takes an array of paths. `/` or `//` is absolute, `~/` is home, and no prefix is the project root in project settings (settings reference).
- `permissions.additionalDirectories` and `--add-dir` widen the sandbox write set as well as the file tools, except under an admin-required sandbox, where a repository's settings do not grant sandbox writes (admin-required section).
- A refused command may be retried outside the sandbox. Who approves the retry depends on the permission mode, and `sandbox.allowUnsandboxedCommands: false` disables the retry (escape hatch section).

# Conclusion

A run in a T3 Code worktree under `~/.t3/worktrees/` can commit on its branch with the sandbox on. `aep dispatch` from there writes child worktrees into the main checkout's `.aep/worktrees/`, which is outside the working directory, so it is refused unless the main checkout is added through `permissions.additionalDirectories` or `sandbox.filesystem.allowWrite`. Not tested here: native Windows has no sandbox.
