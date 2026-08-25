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

Every review result prints its session ID. To resume that exact active session with a new scope after the branch
identity changes, including when an exact-commit review worktree advances to a descendant, pass:

```text
claude-review.mjs --resume-session <session-id> range <prior-head>..<current-head> [-- focus]
```

The selected session must remain active in the same working-tree root and use a clean checkout with a committed
scope (`branch`, `commit`, `range`, or `repo`); working scope and `--include-working` are rejected. It must have a
completed review whose stored scope and HEAD identify the same recorded commit tip, keep that tip as an ancestor of
the current HEAD, and target a new scope whose committed tip equals that HEAD. No other active session may already
own the destination checkout identity. A successful resume follows the current checkout identity. A sibling linked
worktree has separate session storage. Pass the ID again after each
detached HEAD change, and leave that working tree untouched until the resumed review finishes. The runtime samples
its named-or-detached identity, HEAD, and cleanliness before invoking Claude and before applying the result; these
samples apply only to explicit `--resume-session` reviews, and cannot detect a transient change restored between
them. Background execution may overlap work in another checkout.

Once a Claude process starts, any error, timeout, cancellation, worker death, checkout mismatch, malformed result,
or persistence failure that prevents its result from being applied retires the plugin session at its last accepted
scope and HEAD. Cancellation ends continuity. `again` then reports why it cannot resume, while an ordinary review
starts a new isolated session and reports the transition. Review the unapplied delta; optional continuity does not
require a broader replay. `again` normally repeats the selected session's previous scope definition; use an explicit
range for a focused delta. Use `new` when history, review scope, or intended context should not continue.

Put custom focus or follow-up feedback after `--`:

```text
claude-review.mjs branch main -- Focus on authorization and tenant isolation
claude-review.mjs again -- The callback API is intentionally retained for compatibility
```

The runtime also accepts trailing focus text without `--` when unambiguous.

## Options

```text
--dir <path>                 target another repository
--resume-session <id>        resume this repository's prior active session
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
- “Continue session X over only these fixes” → `--resume-session X range PRIOR_HEAD..HEAD`
- “Start over with Claude” → `new`
- “Forget that review thread” → `reset`
- “Run it while we keep working” → `--background`
