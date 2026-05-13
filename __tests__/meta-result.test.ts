import assert from "node:assert/strict";
import test from "node:test";

import {
  REVIEW_META_RESULT_ENTRY_TYPE,
  getReviewMetaResultForRun,
  normalizeSetReviewPromptInput,
  registerSetReviewPromptTool,
} from "../src/meta-result.js";

type ToolExecute = (
  toolCallId: string,
  params: unknown,
  signal: AbortSignal | undefined,
  onUpdate: unknown,
  ctx: unknown,
) => Promise<unknown>;

type RegisteredReviewPromptTool = {
  name: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  execute: ToolExecute;
};

function executeTool(execute: ToolExecute, params: unknown): Promise<unknown> {
  return execute("call-1", params, undefined, undefined, {});
}

function metaResultEntry(
  data: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: "custom",
    customType: REVIEW_META_RESULT_ENTRY_TYPE,
    data,
  };
}

test("normalizes set_review_prompt input", () => {
  const result = normalizeSetReviewPromptInput({
    runId: "  meta-1  ",
    reviewPrompt: "  Review auth carefully  ",
    summary: "  Checked auth paths  ",
  });

  assert.deepEqual(result, {
    value: {
      runId: "meta-1",
      reviewPrompt: "Review auth carefully",
      summary: "Checked auth paths",
    },
  });
});

test("validates set_review_prompt required fields", () => {
  assert.deepEqual(
    normalizeSetReviewPromptInput({ runId: "", reviewPrompt: "x" }),
    { error: "runId must be non-empty." },
  );
  assert.deepEqual(
    normalizeSetReviewPromptInput({ runId: "meta-1", reviewPrompt: "" }),
    { error: "reviewPrompt must be non-empty." },
  );
  assert.deepEqual(
    normalizeSetReviewPromptInput({
      runId: "meta-1",
      reviewPrompt: "x",
      summary: 123,
    }),
    { error: "summary must be a string when provided." },
  );
});

test("registerSetReviewPromptTool persists prompt tied to active meta run", async () => {
  let registeredTool: RegisteredReviewPromptTool | undefined;
  const appended: Array<{ customType: string; data: unknown }> = [];

  registerSetReviewPromptTool(
    {
      registerTool: (tool: RegisteredReviewPromptTool) => {
        registeredTool = tool;
      },
      appendEntry: (customType: string, data: unknown) => {
        appended.push({ customType, data });
      },
    } as never,
    {
      getState: () => ({
        version: 1,
        activeKind: "meta",
        runId: "meta-1",
        targetHint: "origin/main",
        metaPrompt: "Create review prompt",
      }),
      now: () => 1234,
    },
  );

  assert.ok(registeredTool);
  assert.equal(registeredTool.name, "set_review_prompt");
  assert.equal(
    registeredTool.promptSnippet,
    "Set the finalized prompt for the upcoming pi-review-code review run.",
  );
  assert.deepEqual(registeredTool.promptGuidelines, [
    "Use set_review_prompt exactly once during a pi-review-code review prompt meta-pass.",
    "Set runId to the exact meta-pass run ID provided in the prompt.",
    "Put the complete self-contained final review instructions in reviewPrompt.",
    "Do not call set_review_prompt outside the meta-pass.",
  ]);

  const result = await executeTool(registeredTool.execute, {
    runId: " meta-1 ",
    reviewPrompt: " Review the auth diff. ",
    summary: " Looked at auth/session code. ",
  });

  assert.deepEqual(appended, [
    {
      customType: REVIEW_META_RESULT_ENTRY_TYPE,
      data: {
        version: 1,
        runId: "meta-1",
        targetHint: "origin/main",
        reviewPrompt: "Review the auth diff.",
        summary: "Looked at auth/session code.",
        createdAt: 1234,
      },
    },
  ]);
  assert.deepEqual(result, {
    content: [{ type: "text", text: "Recorded review prompt for meta-1." }],
    details: appended[0]?.data,
  });
});

test("set_review_prompt rejects inactive or mismatched meta runs", async () => {
  let execute: ToolExecute | undefined;

  registerSetReviewPromptTool(
    {
      registerTool: (tool: { execute: ToolExecute }) => {
        execute = tool.execute;
      },
      appendEntry: () => {},
    } as never,
    { getState: () => ({ version: 1, activeKind: "review" }) },
  );

  const registeredExecute = execute;
  assert.ok(registeredExecute);
  await assert.rejects(
    () =>
      executeTool(registeredExecute, {
        runId: "meta-1",
        reviewPrompt: "Review diff",
      }),
    /inactive review prompt meta-pass/,
  );

  registerSetReviewPromptTool(
    {
      registerTool: (tool: { execute: ToolExecute }) => {
        execute = tool.execute;
      },
      appendEntry: () => {},
    } as never,
    {
      getState: () => ({
        version: 1,
        activeKind: "meta",
        runId: "meta-1",
        targetHint: "origin/main",
      }),
    },
  );

  const mismatchedRunExecute = execute;
  assert.ok(mismatchedRunExecute);
  await assert.rejects(
    () =>
      executeTool(mismatchedRunExecute, {
        runId: "meta-2",
        reviewPrompt: "Review diff",
      }),
    /does not match active meta-pass run meta-1/,
  );
});

test("getReviewMetaResultForRun returns latest valid persisted prompt", () => {
  const result = getReviewMetaResultForRun(
    {
      sessionManager: {
        getEntries: () => [
          metaResultEntry({
            version: 1,
            runId: "meta-1",
            targetHint: "origin/main",
            reviewPrompt: "first",
            summary: "old",
            createdAt: 1,
          }),
          metaResultEntry({
            version: 1,
            runId: "meta-2",
            targetHint: "origin/main",
            reviewPrompt: "other",
            createdAt: 2,
          }),
          metaResultEntry({
            version: 1,
            runId: "meta-1",
            targetHint: "origin/main",
            reviewPrompt: "",
            createdAt: 3,
          }),
          metaResultEntry({
            version: 1,
            runId: "meta-1",
            targetHint: "origin/main",
            reviewPrompt: "latest",
            createdAt: 4,
          }),
        ],
      },
    } as never,
    "meta-1",
  );

  assert.deepEqual(result, {
    version: 1,
    runId: "meta-1",
    targetHint: "origin/main",
    reviewPrompt: "latest",
    createdAt: 4,
  });
});
