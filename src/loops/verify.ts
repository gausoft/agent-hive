/**
 * Independent verifier — the "grader" of the loop.
 *
 * Rule: the maker is never the grader. Verification is either
 *   1. Objective: a shell command (tests/lint) whose exit code decides, or
 *   2. Model-based: an ephemeral session on a DIFFERENT (review) model that
 *      must answer with a strict PASS/FAIL verdict on the diff.
 *
 * Returns a verdict plus feedback the runner can feed back to the maker for
 * the next iteration.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createEphemeralSession } from "../sessions/manager.js";

const execFileAsync = promisify(execFile);

export interface VerifyResult {
  verdict: "pass" | "fail";
  feedback: string;
  method: "command" | "model";
}

const VERDICT_PROMPT = `You are an independent verifier for a coding task. You did NOT write this code.
Your only job is to decide whether the work satisfies the task. Be strict: if the diff
does not clearly accomplish the task, or introduces a bug or security issue, FAIL it.

Task:
{{TASK}}

Diff produced:
\`\`\`diff
{{DIFF}}
\`\`\`

Answer in EXACTLY this format:
VERDICT: PASS or FAIL
FEEDBACK: <one paragraph: if FAIL, the specific problems to fix; if PASS, one sentence why>`;

/** Objective verification: run the repo's verify command, exit code decides. */
async function verifyByCommand(
  repoDir: string,
  command: string
): Promise<VerifyResult> {
  try {
    const { stdout, stderr } = await execFileAsync("sh", ["-c", command], {
      cwd: repoDir,
      timeout: 10 * 60 * 1000,
      maxBuffer: 5 * 1024 * 1024,
    });
    return {
      verdict: "pass",
      feedback: (stdout + stderr).slice(-2000),
      method: "command",
    };
  } catch (err: any) {
    const out = `${err.stdout ?? ""}${err.stderr ?? ""}`.slice(-4000);
    return {
      verdict: "fail",
      feedback: `Verify command failed (${command}):\n${out || err.message}`,
      method: "command",
    };
  }
}

/** Model-based verification on a diff, using the (cheap) review model. */
async function verifyByModel(
  taskPrompt: string,
  diff: string,
  options: { provider: string; reviewModel?: string }
): Promise<VerifyResult> {
  const session = await createEphemeralSession({
    provider: options.provider,
    model: options.reviewModel,
  });

  let text = "";
  const unsub = session.subscribe((event: any) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent?.type === "text_delta"
    ) {
      text += event.assistantMessageEvent.delta;
    }
  });

  try {
    await session.prompt(
      VERDICT_PROMPT.replace("{{TASK}}", taskPrompt).replace(
        "{{DIFF}}",
        diff.slice(0, 200_000)
      )
    );
  } finally {
    unsub();
    try {
      session.dispose();
    } catch {
      // ignore
    }
  }

  const pass = /VERDICT:\s*PASS/i.test(text);
  const feedback =
    text.match(/FEEDBACK:\s*([\s\S]*)/i)?.[1]?.trim() || text.trim();
  return { verdict: pass ? "pass" : "fail", feedback, method: "model" };
}

/**
 * Verify a task's work. Prefers the objective command when configured;
 * falls back to an independent model verdict on the diff.
 * An empty diff always fails (nothing was produced).
 */
export async function verifyTask(opts: {
  repoDir: string;
  taskPrompt: string;
  diff: string;
  verifyCommand: string | null;
  provider: string;
  reviewModel?: string;
}): Promise<VerifyResult> {
  if (opts.verifyCommand) {
    return verifyByCommand(opts.repoDir, opts.verifyCommand);
  }
  if (!opts.diff || opts.diff.trim().length === 0) {
    return {
      verdict: "fail",
      feedback: "No changes were produced for this task.",
      method: "model",
    };
  }
  return verifyByModel(opts.taskPrompt, opts.diff, {
    provider: opts.provider,
    reviewModel: opts.reviewModel,
  });
}
