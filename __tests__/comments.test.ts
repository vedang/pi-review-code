import assert from "node:assert/strict";
import test from "node:test";

import {
  REVIEW_COMMENT_ENTRY_TYPE,
  getReviewCommentsForRun,
  normalizeAddReviewCommentInput,
  registerAddReviewCommentTool,
} from "../src/comments.js";

type ToolExecute = (
  toolCallId: string,
  params: unknown,
  signal: AbortSignal | undefined,
  onUpdate: unknown,
  ctx: unknown,
) => Promise<unknown>;

type RegisteredReviewTool = {
  name: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  execute: ToolExecute;
};

function executeTool(execute: ToolExecute, params: unknown): Promise<unknown> {
  return execute("call-1", params, undefined, undefined, {});
}

function commentEntry(data: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "custom",
    customType: REVIEW_COMMENT_ENTRY_TYPE,
    data,
  };
}

test("normalizes add_review_comment input", () => {
  const result = normalizeAddReviewCommentInput({
    priority: "P2",
    comment: "  Leak file handle  ",
    references: [{ filePath: " ./src\\file.ts ", startLine: 10, endLine: 10 }],
  });

  assert.deepEqual(result, {
    value: {
      priority: "P2",
      comment: "Leak file handle",
      references: [{ filePath: "src/file.ts", startLine: 10, endLine: 10 }],
    },
  });
});

test("validates add_review_comment required fields and references", () => {
  assert.deepEqual(
    normalizeAddReviewCommentInput({ priority: "P9", comment: "x" }),
    { error: "priority must be one of P0, P1, P2, or P3." },
  );
  assert.deepEqual(
    normalizeAddReviewCommentInput({ priority: "P1", comment: "" }),
    {
      error: "comment must be non-empty.",
    },
  );
  assert.deepEqual(
    normalizeAddReviewCommentInput({
      priority: "P1",
      comment: "x",
      references: [{ filePath: "src/a.ts", startLine: 9, endLine: 8 }],
    }),
    {
      error:
        "Each reference must include a non-empty filePath, integer startLine >= 1, and integer endLine >= startLine when provided.",
    },
  );
});

test("registerAddReviewCommentTool persists comments tied to active review run", async () => {
  let registeredTool: RegisteredReviewTool | undefined;
  const appended: Array<{ customType: string; data: unknown }> = [];

  registerAddReviewCommentTool(
    {
      registerTool: (tool: RegisteredReviewTool) => {
        registeredTool = tool;
      },
      appendEntry: (customType: string, data: unknown) => {
        appended.push({ customType, data });
      },
    } as never,
    {
      getState: () => ({
        version: 1,
        activeKind: "review",
        runId: "run-123",
        targetHint: "origin/main",
        reviewPrompt: "Review current diff",
      }),
      createId: () => "comment-1",
      now: () => 1234,
    },
  );

  assert.ok(registeredTool);
  assert.equal(registeredTool.name, "add_review_comment");
  assert.equal(
    registeredTool.promptSnippet,
    "Record one actionable review finding with priority and optional file/line references.",
  );
  assert.deepEqual(registeredTool.promptGuidelines, [
    "Use add_review_comment exactly once per actionable finding during a pi-review-code review run.",
    "Set priority in the priority field only; do not prefix comment text with P0/P1/P2/P3.",
    "Do not call add_review_comment when no actionable finding exists.",
  ]);

  const result = await executeTool(registeredTool.execute, {
    priority: "P1",
    comment: "Possible null dereference",
    references: [{ filePath: "src/a.ts", startLine: 42 }],
  });

  assert.deepEqual(appended, [
    {
      customType: REVIEW_COMMENT_ENTRY_TYPE,
      data: {
        version: 1,
        id: "comment-1",
        runId: "run-123",
        priority: "P1",
        comment: "Possible null dereference",
        references: [{ filePath: "src/a.ts", startLine: 42 }],
        createdAt: 1234,
        targetHint: "origin/main",
      },
    },
  ]);
  assert.deepEqual(result, {
    content: [
      { type: "text", text: "Recorded review comment comment-1 (P1)." },
    ],
    details: appended[0]?.data,
  });
});

test("add_review_comment throws while no review run is active", async () => {
  let execute: ToolExecute | undefined;

  registerAddReviewCommentTool(
    {
      registerTool: (tool: { execute: ToolExecute }) => {
        execute = tool.execute;
      },
      appendEntry: () => {},
    } as never,
    { getState: () => ({ version: 1, activeKind: null }) },
  );

  const registeredExecute = execute;
  assert.ok(registeredExecute);
  await assert.rejects(
    () => executeTool(registeredExecute, { priority: "P1", comment: "x" }),
    /inactive review run/,
  );
});

test("getReviewCommentsForRun filters and ignores malformed persisted comments", () => {
  const comments = getReviewCommentsForRun(
    {
      sessionManager: {
        getEntries: () => [
          commentEntry({
            version: 1,
            id: "good-1",
            runId: "run-1",
            priority: "P1",
            comment: "one",
            references: [],
            createdAt: 1,
          }),
          commentEntry({
            version: 1,
            id: "other-run",
            runId: "run-2",
            priority: "P1",
            comment: "two",
            references: [],
            createdAt: 2,
          }),
          commentEntry({
            version: 1,
            id: "bad-reference",
            runId: "run-1",
            priority: "P2",
            comment: "bad",
            references: [{}],
            createdAt: 3,
          }),
        ],
      },
    } as never,
    "run-1",
  );

  assert.deepEqual(
    comments.map((comment) => comment.id),
    ["good-1"],
  );
});
