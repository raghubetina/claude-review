# Claude Review

Ask Claude Code to review exact Git scopes from Codex. Reviews are read-only, default to maximum reasoning effort, can run in the background, and can optionally resume the same Claude session as code changes.

## Requirements

- Codex with plugin support
- Claude Code 2.1.205 or newer, installed and authenticated
- Node.js 18.18 or newer
- Git

## Install

From GitHub:

```sh
codex plugin marketplace add raghubetina/claude-review
codex plugin add claude-review@claude-review
```

During local development:

```sh
codex plugin marketplace add /absolute/path/to/claude-review
codex plugin add claude-review@claude-review
```

After installation, start a new Codex process. In Codex CLI, invoke the skill
with `$claude-review`; `/claude-review` is not a slash command. In the ChatGPT
desktop app, fully quit and reopen the app so it rescans local marketplaces.

## Use

Ask naturally or invoke `$claude-review` explicitly:

```text
Use $claude-review to review my working changes.
Use $claude-review to review this branch against main.
Use $claude-review to review the last commit, focusing on authorization.
Use $claude-review to review ../another-repo in the background.
Use $claude-review to review it again. The callback API is intentionally retained for compatibility.
Use $claude-review to continue session SESSION_ID over only PRIOR_HEAD..HEAD.
```

Supported scopes are `working` (the default), `branch [base]`, `commit [ref]`, `range <from>..<to>`, and `repo`.
`again` repeats the previous scope in the current branch session. `--resume-session <session-id>` is the explicit
exact-scope path for resuming an active session when branch identity changes. It requires a clean, committed scope;
the stored tip must remain an ancestor of the current HEAD, the requested scope tip must equal that HEAD, and no
other active session may own the destination checkout identity. Only this explicit-resume path samples the
checkout's named-or-detached identity, HEAD, and cleanliness before invoking Claude and before applying the result.
Leave that checkout untouched while the review runs; a transient change restored between samples cannot be detected.

Once a Claude process starts, any error, timeout, cancellation, worker death, checkout mismatch, malformed result,
or persistence failure that prevents its result from being applied retires the plugin session at its last accepted
scope and HEAD. Cancellation therefore ends continuity. `again` explains why a retired session cannot resume; an
ordinary review starts a new isolated session and reports that transition. Review only the unapplied delta—session
continuity is optional and losing it does not justify replaying a broader scope. `new` starts a fresh session, and
`reset` forgets the active session without deleting its artifacts.

Background reviews support `status`, `result`, and `cancel`.

Codex chooses foreground or background execution from the surrounding workflow unless the user specifies one.
A healthy review is allowed to finish without an additional agent-side timeout merely because it is quiet or
long-running.

## Review artifacts

Each reviewed repository gets an ignored `tmp/claude_reviews/` directory containing sequenced review artifacts, session metadata, and background-job state. If necessary, the plugin adds `tmp/claude_reviews/` to Git's local `info/exclude`; it does not modify the repository's tracked `.gitignore`.

Claude receives a bounded, secret-filtered Git context over stdin and only the `Read`, `Glob`, and `Grep` tools. The runtime does not grant Claude Bash, write, or network tools.

## Develop

```sh
npm test
```

The test suite uses disposable Git repositories and a fake Claude executable. It covers scope resolution, automatic
and explicit session resumption, advancing detached review worktrees, same-SHA checkout identity changes, retired
sessions, background jobs, cancellation, pre- and post-application worker recovery, legacy job state, large diffs,
history replacement, failures, and safe invocation arguments.

After installing a development build, verify real cached-skill discovery from a fresh Codex process without starting a Claude review:

```sh
codex exec --ephemeral --sandbox read-only --cd /path/to/a/git/repository \
  'Use $claude-review to run only the bundled runtime help. Do not run a review. Report the absolute installed script path.'
```

The reported path should be under Codex's plugin cache rather than the source checkout, and the output should begin with `Claude Review`.
