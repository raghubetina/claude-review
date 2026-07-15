# Claude Review Runtime Interface

## Review scopes

```text
claude-review.mjs                              working tree, current repository
claude-review.mjs working                     staged, unstaged, and untracked work
claude-review.mjs branch [base]               merge-base-to-HEAD branch change
claude-review.mjs commit [ref]                one commit, default HEAD
claude-review.mjs range <from>..<to>          explicit two-dot range
claude-review.mjs repo                        whole repository
claude-review.mjs again                       previous scope in the active session
claude-review.mjs new [scope]                 new session, then review
claude-review.mjs reset                       forget active session; retain artifacts
```

Put custom focus or follow-up feedback after `--`:

```text
claude-review.mjs branch main -- Focus on authorization and tenant isolation
claude-review.mjs again -- The callback API is intentionally retained for compatibility
```

The runtime also accepts trailing focus text without `--` when unambiguous.

## Options

```text
--dir <path>                 target another repository
--model <model>              explicitly select and persist a model for this session
--effort <level>             low, medium, high, xhigh, or max; default max
--include-working            add local changes to branch, commit, or range scope
--background                 start a persistent background job
--wait                       explicitly run in the foreground
--timeout-minutes <number>   hard timeout; default 30
```

## Job controls

```text
claude-review.mjs status [job-id] [--dir <path>]
claude-review.mjs result [job-id] [--dir <path>]
claude-review.mjs cancel [job-id] [--dir <path>]
```

When no job ID is supplied, operate on the latest applicable job.

## Important mappings

- “Review what I have changed” → `working`
- “Review this branch against main” → `branch main`
- “Review the last commit” → `commit HEAD`
- “Review commit abc123” → `commit abc123`
- “Review everything since v1.2” → `range v1.2..HEAD`
- “Review the architecture/codebase” → `repo`
- “Review it again” → `again`
- “Start over with Claude” → `new`
- “Forget that review thread” → `reset`
- “Run it while we keep working” → `--background`
