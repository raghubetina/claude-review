import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  REVIEW_SCHEMA,
  parseArguments,
  parseClaudeOutput,
  resolveRepository,
  resolveScope
} from "../plugins/claude-review/skills/claude-review/scripts/claude-review.mjs";

const TEST_ROOT = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME = path.resolve(TEST_ROOT, "../plugins/claude-review/skills/claude-review/scripts/claude-review.mjs");
const FAKE_CLAUDE = path.resolve(TEST_ROOT, "fixtures/fake-claude.mjs");

function command(binary, args, options = {}) {
  const result = spawnSync(binary, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    timeout: options.timeout ?? 20_000
  });
  if (options.allowFailure !== true && result.status !== 0) {
    throw new Error(`${binary} failed: ${result.stderr || result.stdout}`);
  }
  return result;
}

function git(repo, ...args) {
  return command("git", ["-C", repo, ...args]).stdout.trim();
}

function createRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "claude-review-test-"));
  command("git", ["init", "-b", "main", repo]);
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Claude Review Test");
  fs.writeFileSync(path.join(repo, "example.txt"), "first\n", "utf8");
  git(repo, "add", "example.txt");
  git(repo, "commit", "-m", "initial");
  return repo;
}

function reviewEnv(logPath, extra = {}) {
  return {
    ...process.env,
    CLAUDE_REVIEW_CLAUDE_BIN: FAKE_CLAUDE,
    FAKE_CLAUDE_LOG: logPath,
    ...extra
  };
}

function runReview(repo, args = [], extraEnv = {}) {
  const logPath = path.join(repo, "fake-claude.jsonl");
  const result = command(process.execPath, [RUNTIME, "--dir", repo, ...args], {
    cwd: repo,
    env: reviewEnv(logPath, extraEnv),
    allowFailure: extraEnv.FAKE_CLAUDE_FAIL === "1",
    timeout: 30_000
  });
  return { result, logPath };
}

function calls(logPath) {
  return fs.readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
}

function sessions(repo) {
  const root = path.join(repo, "tmp", "claude_reviews");
  return fs.readdirSync(root)
    .filter((name) => /^\d{3}-/.test(name))
    .sort()
    .map((name) => ({ name, directory: path.join(root, name), session: JSON.parse(fs.readFileSync(path.join(root, name, "session.json"), "utf8")) }));
}

test.before(() => fs.chmodSync(FAKE_CLAUDE, 0o755));

test("parseArguments defaults to working at max effort", () => {
  const parsed = parseArguments([]);
  assert.equal(parsed.action, "working");
  assert.equal(parsed.options.effort, "max");
  assert.equal(parsed.options.model, null);
});

test("parseArguments preserves natural focus and job IDs", () => {
  const branch = parseArguments(["branch", "main", "focus", "on", "auth"]);
  assert.equal(branch.scopeArgument, "main");
  assert.equal(branch.focus, "focus on auth");
  const again = parseArguments(["again", "--", "callback", "is", "public"]);
  assert.equal(again.focus, "callback is public");
  const status = parseArguments(["status", "review-123"]);
  assert.equal(status.jobId, "review-123");
  assert.equal(status.focus, "");
});

test("parseArguments rejects contradictory execution options", () => {
  assert.throws(() => parseArguments(["--wait", "--background"]), /either --background or --wait/);
  assert.throws(() => parseArguments(["working", "--include-working"]), /not valid/);
  assert.throws(() => parseArguments(["range", "HEAD"]), /form <from>\.\.<to>/);
});

test("parseClaudeOutput accepts single envelopes and transcript arrays", () => {
  const result = {
    type: "result",
    is_error: false,
    session_id: "session-1",
    structured_output: { verdict: "approve", summary: "ok", findings: [], residual_risk: "none" }
  };
  assert.equal(parseClaudeOutput(JSON.stringify(result)).sessionId, "session-1");
  assert.equal(parseClaudeOutput(JSON.stringify([{ type: "system" }, result])).structured.verdict, "approve");
});

test("review schema omits a draft URI rejected by Claude Code", () => {
  assert.equal("$schema" in REVIEW_SCHEMA, false);
});

test("resolveScope handles working, branch, commit, range, and repo scopes", () => {
  const repo = createRepo();
  const first = git(repo, "rev-parse", "HEAD");
  git(repo, "checkout", "-b", "feature");
  fs.writeFileSync(path.join(repo, "example.txt"), "second\n", "utf8");
  git(repo, "add", "example.txt");
  git(repo, "commit", "-m", "feature change");
  const second = git(repo, "rev-parse", "HEAD");
  fs.writeFileSync(path.join(repo, "untracked.txt"), "local\n", "utf8");

  assert.equal(resolveScope(repo, "working").untracked_files[0], "untracked.txt");
  assert.equal(resolveScope(repo, "branch", "main").merge_base, first);
  assert.equal(resolveScope(repo, "commit", "HEAD").commit, second);
  assert.equal(resolveScope(repo, "range", "main..HEAD").from, first);
  assert.equal(resolveScope(repo, "repo").kind, "repo");
});

test("working and repo scopes support an unborn branch", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "claude-review-unborn-"));
  command("git", ["init", "-b", "main", repo]);
  fs.writeFileSync(path.join(repo, "new.txt"), "uncommitted\n", "utf8");
  assert.equal(resolveScope(repo, "working").head, null);
  assert.equal(resolveScope(repo, "repo").head, null);
  assert.throws(() => resolveScope(repo, "branch", "main"), /requires at least one commit/);
});

test("foreground review creates ignored artifacts and uses hardened max-effort invocation", () => {
  const repo = createRepo();
  fs.writeFileSync(path.join(repo, "example.txt"), "changed\n", "utf8");
  fs.writeFileSync(path.join(repo, "new.txt"), "new\n", "utf8");
  const { result, logPath } = runReview(repo, ["working", "--", "focus on correctness"]);

  assert.match(result.stdout, /Status: completed/);
  assert.match(result.stdout, /Example defect/);
  const invocation = calls(logPath)[0];
  assert.equal(invocation.cwd, resolveRepository(repo));
  assert.ok(invocation.args.includes("dontAsk"));
  assert.ok(invocation.args.includes("Read,Glob,Grep"));
  assert.ok(!invocation.args.some((argument) => argument.includes("Bash")));
  assert.ok(invocation.args.includes("user"));
  assert.ok(invocation.args.includes("--strict-mcp-config"));
  assert.equal(invocation.args[invocation.args.indexOf("--effort") + 1], "max");
  assert.ok(invocation.args.includes("--session-id"));
  assert.ok(!invocation.args.includes("--model"));
  assert.match(invocation.input, /focus on correctness/);
  assert.match(invocation.input, /-first/);
  assert.match(invocation.input, /\+changed/);

  const task = sessions(repo)[0];
  assert.equal(task.session.review_count, 1);
  assert.ok(fs.readdirSync(task.directory).some((name) => /^001-working\.md$/.test(name)));
  assert.equal(git(repo, "check-ignore", "tmp/claude_reviews/001-probe"), "tmp/claude_reviews/001-probe");
  assert.doesNotMatch(fs.existsSync(path.join(repo, ".gitignore")) ? fs.readFileSync(path.join(repo, ".gitignore"), "utf8") : "", /claude_reviews/);
});

test("again resumes the exact session and forwards feedback", () => {
  const repo = createRepo();
  fs.writeFileSync(path.join(repo, "example.txt"), "changed\n", "utf8");
  const first = runReview(repo);
  runReview(repo, ["again", "--", "Do not repeat the callback finding"]);
  const invocations = calls(first.logPath);
  assert.equal(invocations.length, 2);
  assert.ok(invocations[1].args.includes("--resume"));
  assert.equal(invocations[1].sessionId, invocations[0].sessionId);
  assert.match(invocations[1].input, /Do not repeat the callback finding/);
  assert.equal(sessions(repo)[0].session.review_count, 2);
});

test("new creates a fresh session and reset preserves its artifacts", () => {
  const repo = createRepo();
  fs.writeFileSync(path.join(repo, "example.txt"), "changed\n", "utf8");
  runReview(repo);
  runReview(repo, ["new", "working"]);
  const taskEntries = sessions(repo);
  assert.equal(taskEntries.length, 2);
  assert.notEqual(taskEntries[0].session.session_id, taskEntries[1].session.session_id);
  assert.equal(taskEntries.filter(({ session }) => session.active).length, 1);
  const reset = runReview(repo, ["reset"]).result;
  assert.match(reset.stdout, /Reset active/);
  assert.equal(sessions(repo).filter(({ session }) => session.active).length, 0);
});

test("background review can be observed through status and result", async () => {
  const repo = createRepo();
  fs.writeFileSync(path.join(repo, "example.txt"), "changed\n", "utf8");
  const logPath = path.join(repo, "fake-claude.jsonl");
  const started = command(process.execPath, [RUNTIME, "--dir", repo, "working", "--background"], {
    cwd: repo,
    env: reviewEnv(logPath, { FAKE_CLAUDE_DELAY_MS: "150" })
  });
  const id = started.stdout.match(/Claude review job: (\S+)/)?.[1];
  assert.ok(id);

  let status;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    status = command(process.execPath, [RUNTIME, "status", id, "--dir", repo]).stdout;
    if (status.includes("Status: completed")) break;
  }
  assert.match(status, /Status: completed/);
  const result = command(process.execPath, [RUNTIME, "result", id, "--dir", repo]).stdout;
  assert.match(result, /Example defect/);
});

test("a second review cannot create a stuck job for an active session", async () => {
  const repo = createRepo();
  fs.writeFileSync(path.join(repo, "example.txt"), "changed\n", "utf8");
  const logPath = path.join(repo, "fake-claude.jsonl");
  const started = command(process.execPath, [RUNTIME, "--dir", repo, "working", "--background"], {
    cwd: repo,
    env: reviewEnv(logPath, { FAKE_CLAUDE_DELAY_MS: "1000" })
  });
  const id = started.stdout.match(/Claude review job: (\S+)/)?.[1];
  assert.ok(id);
  const duplicate = command(process.execPath, [RUNTIME, "--dir", repo, "working"], {
    cwd: repo,
    env: reviewEnv(logPath),
    allowFailure: true
  });
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, new RegExp(`job ${id} is already`));
  const jobs = fs.readdirSync(path.join(repo, "tmp", "claude_reviews", "jobs")).filter((name) => name.endsWith(".json"));
  assert.equal(jobs.length, 1);
  command(process.execPath, [RUNTIME, "cancel", id, "--dir", repo]);
});

test("a stale queued job that crashed before recording a PID self-heals", () => {
  const repo = createRepo();
  fs.writeFileSync(path.join(repo, "example.txt"), "changed\n", "utf8");
  runReview(repo);
  const task = sessions(repo)[0];
  const jobsDirectory = path.join(repo, "tmp", "claude_reviews", "jobs");
  const originalJob = fs.readdirSync(jobsDirectory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(fs.readFileSync(path.join(jobsDirectory, name), "utf8")))
    .find((job) => job.status === "completed");
  const stalePath = path.join(jobsDirectory, "review-stale.json");
  fs.writeFileSync(stalePath, `${JSON.stringify({
    version: 1,
    id: "review-stale",
    status: "queued",
    pid: null,
    created_at: "2000-01-01T00:00:00.000Z",
    updated_at: "2000-01-01T00:00:00.000Z",
    repo_root: repo,
    task_directory: originalJob.task_directory,
    scope: { kind: "working" }
  })}\n`, "utf8");
  runReview(repo, ["again"]);
  const stale = JSON.parse(fs.readFileSync(stalePath, "utf8"));
  assert.equal(stale.status, "failed");
  assert.match(stale.error, /worker exited/);
});

test("large tracked diffs are truncated instead of failing the review", { timeout: 30_000 }, () => {
  const repo = createRepo();
  const bigPath = path.join(repo, "big.txt");
  fs.writeFileSync(bigPath, `${"a".repeat(9 * 1024 * 1024)}\n`, "utf8");
  git(repo, "add", "big.txt");
  git(repo, "commit", "-m", "large baseline");
  fs.writeFileSync(bigPath, `${"b".repeat(9 * 1024 * 1024)}\n`, "utf8");
  const { result, logPath } = runReview(repo);
  assert.equal(result.status, 0);
  assert.match(calls(logPath)[0].input, /(Diff|Context) truncated at 8388608 bytes/);
});

test("cancellation records a consistent cancelled artifact", async () => {
  const repo = createRepo();
  fs.writeFileSync(path.join(repo, "example.txt"), "changed\n", "utf8");
  const logPath = path.join(repo, "fake-claude.jsonl");
  const started = command(process.execPath, [RUNTIME, "--dir", repo, "working", "--background"], {
    cwd: repo,
    env: reviewEnv(logPath, { FAKE_CLAUDE_DELAY_MS: "5000" })
  });
  const id = started.stdout.match(/Claude review job: (\S+)/)?.[1];
  assert.ok(id);
  await new Promise((resolve) => setTimeout(resolve, 100));
  command(process.execPath, [RUNTIME, "cancel", id, "--dir", repo]);

  let job;
  const jobFile = path.join(repo, "tmp", "claude_reviews", "jobs", `${id}.json`);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    job = JSON.parse(fs.readFileSync(jobFile, "utf8"));
    if (job.status === "cancelled" && job.artifact) break;
  }
  assert.equal(job.status, "cancelled");
  assert.equal(job.error, "Cancelled by user.");
  assert.ok(job.artifact);
  const artifact = fs.readFileSync(job.artifact, "utf8");
  assert.match(artifact, /Status: cancelled/);
  assert.match(artifact, /Cancelled by user/);
});

test("again without an active review does not leak an empty task", () => {
  const repo = createRepo();
  fs.writeFileSync(path.join(repo, "example.txt"), "changed\n", "utf8");
  const result = command(process.execPath, [RUNTIME, "--dir", repo, "again"], {
    cwd: repo,
    env: reviewEnv(path.join(repo, "fake-claude.jsonl")),
    allowFailure: true
  });
  assert.notEqual(result.status, 0);
  const root = path.join(repo, "tmp", "claude_reviews");
  assert.equal(fs.readdirSync(root).filter((name) => /^\d{3}-/.test(name)).length, 0);
});

test("unrelated replacement history starts a fresh branch session", () => {
  const repo = createRepo();
  fs.writeFileSync(path.join(repo, "example.txt"), "changed\n", "utf8");
  runReview(repo);
  git(repo, "checkout", "--orphan", "replacement");
  git(repo, "rm", "-rf", ".");
  fs.writeFileSync(path.join(repo, "replacement.txt"), "replacement\n", "utf8");
  git(repo, "add", "replacement.txt");
  git(repo, "commit", "-m", "replacement history");
  git(repo, "branch", "-M", "main");
  fs.writeFileSync(path.join(repo, "replacement.txt"), "changed replacement\n", "utf8");
  runReview(repo);
  const taskEntries = sessions(repo);
  assert.equal(taskEntries.length, 2);
  assert.equal(taskEntries[0].session.active, false);
  assert.equal(taskEntries[1].session.active, true);
});

test("skill contract points to its bundled runtime", () => {
  const skillDirectory = path.resolve(TEST_ROOT, "../plugins/claude-review/skills/claude-review");
  const skill = fs.readFileSync(path.join(skillDirectory, "SKILL.md"), "utf8");
  assert.match(skill, /\$SKILL_DIR\/scripts\/claude-review\.mjs/);
  assert.ok(fs.existsSync(path.join(skillDirectory, "scripts", "claude-review.mjs")));
});

test("Claude failures produce a failed artifact and actionable status", () => {
  const repo = createRepo();
  fs.writeFileSync(path.join(repo, "example.txt"), "changed\n", "utf8");
  const { result } = runReview(repo, [], { FAKE_CLAUDE_FAIL: "1" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /simulated Claude failure/);
  const task = sessions(repo)[0];
  assert.ok(fs.existsSync(path.join(task.directory, "failed")));
});
