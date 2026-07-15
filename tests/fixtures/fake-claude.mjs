#!/usr/bin/env node

import fs from "node:fs";
import process from "node:process";

if (process.argv.includes("--version")) {
  process.stdout.write("2.1.210 (Claude Code)\n");
  process.exit(0);
}

let input = "";
for await (const chunk of process.stdin) input += chunk.toString();

const args = process.argv.slice(2);
const valueAfter = (option) => {
  const index = args.indexOf(option);
  return index >= 0 ? args[index + 1] : null;
};
const sessionId = valueAfter("--resume") || valueAfter("--session-id") || "missing-session";
const model = valueAfter("--model") || "claude-default";
const logPath = process.env.FAKE_CLAUDE_LOG;
if (logPath) {
  fs.appendFileSync(logPath, `${JSON.stringify({ args, input, cwd: process.cwd(), sessionId, model })}\n`, "utf8");
}

const delay = Number(process.env.FAKE_CLAUDE_DELAY_MS || 0);
if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

if (process.env.FAKE_CLAUDE_FAIL === "1") {
  process.stderr.write("simulated Claude failure\n");
  process.exit(2);
}

const structured = {
  verdict: "needs-attention",
  summary: "One material issue found.",
  findings: [
    {
      severity: "high",
      title: "Example defect",
      body: "The fake reviewer found a deterministic defect.",
      file: "example.txt",
      line_start: 1,
      line_end: 1,
      confidence: 0.95,
      recommendation: "Fix the example."
    }
  ],
  residual_risk: "The fake reviewer did not execute tests."
};

process.stdout.write(`${JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  session_id: sessionId,
  result: JSON.stringify(structured),
  structured_output: structured,
  modelUsage: { [model]: { inputTokens: 1, outputTokens: 1 } }
})}\n`);
