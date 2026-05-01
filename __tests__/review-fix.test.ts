import assert from "node:assert/strict";
import test from "node:test";

import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

import {
  REVIEW_FIX_SUMMARY_ENTRY_TYPE,
  REVIEW_PROMPT_ENTRY_TYPE,
  REVIEW_SUMMARY_ENTRY_TYPE,
  buildFixBranchSummary,
  createReviewFlowController,
  selectReviewSummaryForFix,
} from "../src/flow";
import { buildReviewFixPrompt } from "../src/prompts";
import type { ReviewComment } from "../src/types";

function comment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    version: 1,
    id: "comment-1",
    runId: "review-1",
    priority: "P1",
    comment: "Token refresh can race with logout.",
    references: [{ filePath: "src/auth.ts", startLine: 42, endLine: 45 }],
    createdAt: 123,
    targetHint: "review auth boundaries",
    ...overrides,
  };
}

function reviewSummaryEntry(runId: string, comments: ReviewComment[]) {
  return {
    type: "custom",
    customType: REVIEW_SUMMARY_ENTRY_TYPE,
    data: {
      summary: `pi-review-code review ${runId}`,
      details: {
        kind: "review",
        runId,
        targetHint: "review auth boundaries",
        reviewPrompt: "Review auth boundaries",
        completedAt: runId === "review-2" ? 200 : 100,
        comments,
      },
    },
  };
}

test("selectReviewSummaryForFix chooses latest completed review with comments", () => {
  const selected = selectReviewSummaryForFix(
    [
      reviewSummaryEntry("review-1", [
        comment({ id: "old", runId: "review-1" }),
      ]),
      reviewSummaryEntry("review-empty", []),
      reviewSummaryEntry("review-2", [
        comment({ id: "new", runId: "review-2" }),
      ]),
    ],
    { kind: "latest" },
  );

  assert.equal(selected?.runId, "review-2");
  assert.deepEqual(
    selected?.comments.map((item) => item.id),
    ["new"],
  );
});

test("selectReviewSummaryForFix finds explicit review run", () => {
  const selected = selectReviewSummaryForFix(
    [
      reviewSummaryEntry("review-1", [
        comment({ id: "one", runId: "review-1" }),
      ]),
      reviewSummaryEntry("review-2", [
        comment({ id: "two", runId: "review-2" }),
      ]),
    ],
    { kind: "run-id", runId: "review-1" },
  );

  assert.equal(selected?.runId, "review-1");
  assert.deepEqual(
    selected?.comments.map((item) => item.id),
    ["one"],
  );
});

test("buildReviewFixPrompt lists review comments one by one with refs", () => {
  const prompt = buildReviewFixPrompt({
    reviewRunId: "review-1",
    targetHint: "review auth boundaries",
    comments: [
      comment(),
      comment({
        id: "comment-2",
        priority: "P2",
        comment: "Logout leaves stale cache.",
        references: [{ filePath: "src/cache.ts", startLine: 10 }],
      }),
    ],
  });

  assert.match(prompt, /Fix findings from pi-review-code review review-1/);
  assert.match(prompt, /1\. \[P1\] comment-1/);
  assert.match(prompt, /src\/auth\.ts:42-45/);
  assert.match(prompt, /2\. \[P2\] comment-2/);
  assert.match(prompt, /src\/cache\.ts:10/);
  assert.match(prompt, /Work through comments in order/);
  assert.match(prompt, /Final response must include/);
});

type HarnessOptions = {
  hasUI?: boolean;
  model?: { provider: string; id: string } | null;
  entries?: unknown[];
  navigateResults?: Array<{ cancelled: boolean } | Error>;
};

function createHarness(options: HarnessOptions = {}) {
  const notifications: Array<{ message: string; level: string }> = [];
  const sentUserMessages: string[] = [];
  const sentMessages: Array<{
    customType?: string;
    content?: unknown;
    display?: boolean;
    details?: unknown;
  }> = [];
  const appended: Array<{ customType: string; data: unknown }> = [];
  const navigateCalls: Array<{
    targetId: string;
    options: { summarize?: boolean; label?: string };
  }> = [];
  const startedFixRuns: unknown[] = [];
  const clearedRuns: unknown[] = [];
  const navigateResults = [...(options.navigateResults ?? [])];

  const entries = options.entries ?? [
    reviewSummaryEntry("review-1", [comment({ runId: "review-1" })]),
  ];

  const controller = createReviewFlowController({
    pi: {
      sendUserMessage: (message: string) => {
        sentUserMessages.push(message);
      },
      appendEntry: (customType: string, data: unknown) => {
        appended.push({ customType, data });
      },
      sendMessage: (message: {
        customType?: string;
        content?: unknown;
        display?: boolean;
        details?: unknown;
      }) => {
        sentMessages.push(message);
      },
    },
    stateManager: {
      startReviewRun: () => {},
      startFixRun: (_ctx: unknown, state: unknown) => {
        startedFixRuns.push(state);
      },
      clearActiveRun: (ctx: unknown) => {
        clearedRuns.push(ctx);
      },
    },
    resolveTarget: async () => {
      throw new Error("unused");
    },
    buildDraftRequest: () => {
      throw new Error("unused");
    },
    generateDraft: async () => {
      throw new Error("unused");
    },
    getCommentsForRun: () => [],
    createRunId: () => "fix-1",
    getNow: () => 456,
    getThinkingLevel: () => "medium",
  });

  const ctx = {
    hasUI: options.hasUI ?? true,
    model:
      options.model === null
        ? undefined
        : (options.model ?? { provider: "anthropic", id: "claude-sonnet" }),
    sessionManager: {
      getLeafId: () => "leaf-fix-origin",
      getEntries: () => entries,
    },
    waitForIdle: async () => {},
    navigateTree: async (
      targetId: string,
      navOptions: { summarize?: boolean; label?: string },
    ) => {
      navigateCalls.push({ targetId, options: navOptions });
      const nextResult = navigateResults.shift();
      if (nextResult instanceof Error) {
        throw nextResult;
      }
      return nextResult ?? { cancelled: false };
    },
    ui: {
      notify: (message: string, level: string) => {
        notifications.push({ message, level });
      },
    },
  } as unknown as ExtensionCommandContext;

  const createFixAgentEndEvent = () => ({
    messages: [
      { role: "user", content: sentUserMessages[0] ?? "" },
      {
        role: "assistant",
        content:
          "Fixed comment-1 by serializing token refresh. Tests: make test passed.",
      },
    ],
  });

  return {
    controller,
    createFixAgentEndEvent,
    ctx,
    notifications,
    sentUserMessages,
    sentMessages,
    appended,
    navigateCalls,
    startedFixRuns,
    clearedRuns,
  };
}

test("review-fix launches fix branch for latest review comments", async () => {
  const harness = createHarness();

  await harness.controller.handleReviewFixCommand("latest", harness.ctx);

  assert.equal(harness.sentUserMessages.length, 1);
  assert.match(harness.sentUserMessages[0] ?? "", /comment-1/);
  assert.deepEqual(harness.startedFixRuns, [
    {
      runId: "fix-1",
      originLeafId: "leaf-fix-origin",
      targetHint: "review auth boundaries",
      reviewPrompt: harness.sentUserMessages[0],
      originModelProvider: "anthropic",
      originModelId: "claude-sonnet",
      originThinkingLevel: "medium",
      sourceReviewRunId: "review-1",
      commentIds: ["comment-1"],
    },
  ]);
  assert.deepEqual(harness.notifications, [
    { message: "Fix branch started: fix-1", level: "info" },
  ]);
});

test("review-fix reports missing review summary without launching", async () => {
  const harness = createHarness({ entries: [] });

  await harness.controller.handleReviewFixCommand("latest", harness.ctx);

  assert.deepEqual(harness.sentUserMessages, []);
  assert.deepEqual(harness.startedFixRuns, []);
  assert.deepEqual(harness.notifications, [
    {
      message:
        "Cannot start review-fix: no completed review with comments found.",
      level: "error",
    },
  ]);
});

test("review-fix emits custom prompt and summary messages for renderers", async () => {
  const harness = createHarness();

  await harness.controller.handleReviewFixCommand("latest", harness.ctx);

  assert.equal(harness.sentMessages.length, 1);
  assert.equal(harness.sentMessages[0]?.customType, REVIEW_PROMPT_ENTRY_TYPE);
  assert.equal(harness.sentMessages[0]?.content, "Review-fix prompt fix-1");
  assert.equal(harness.sentMessages[0]?.display, true);
  assert.deepEqual(harness.sentMessages[0]?.details, {
    kind: "prompt",
    mode: "fix",
    runId: "fix-1",
    targetHint: "review auth boundaries",
    reviewPrompt: harness.sentUserMessages[0],
    originModelProvider: "anthropic",
    originModelId: "claude-sonnet",
    originThinkingLevel: "medium",
    sourceReviewRunId: "review-1",
    commentIds: ["comment-1"],
  });

  await harness.controller.handleAgentEnd(harness.createFixAgentEndEvent(), {
    sessionManager: harness.ctx.sessionManager,
  } as never);

  assert.equal(harness.sentMessages.length, 2);
  assert.equal(
    harness.sentMessages[1]?.customType,
    REVIEW_FIX_SUMMARY_ENTRY_TYPE,
  );
  assert.equal(harness.sentMessages[1]?.display, true);
  assert.match(JSON.stringify(harness.sentMessages[1]?.details), /comment-1/);
});

test("review-fix collapses active fix branch with custom summary", async () => {
  const harness = createHarness();

  await harness.controller.handleReviewFixCommand("latest", harness.ctx);
  await harness.controller.handleAgentEnd(harness.createFixAgentEndEvent(), {
    sessionManager: harness.ctx.sessionManager,
  } as never);

  assert.deepEqual(harness.navigateCalls, [
    {
      targetId: "leaf-fix-origin",
      options: { summarize: true, label: "review-fix:fix-1" },
    },
  ]);
  assert.equal(harness.appended.length, 1);
  assert.equal(harness.appended[0]?.customType, REVIEW_FIX_SUMMARY_ENTRY_TYPE);
  assert.match(JSON.stringify(harness.appended[0]?.data), /comment-1/);
  assert.deepEqual(harness.clearedRuns, [harness.ctx]);
});

test("session_before_tree returns pending review-fix summary", async () => {
  const harness = createHarness();

  await harness.controller.handleReviewFixCommand("latest", harness.ctx);
  await harness.controller.handleAgentEnd(harness.createFixAgentEndEvent(), {
    sessionManager: harness.ctx.sessionManager,
  } as never);

  const result = await harness.controller.handleSessionBeforeTree({
    preparation: {
      label: "review-fix:fix-1",
      userWantsSummary: true,
    },
  } as never);

  assert.match(
    result?.summary?.summary ?? "",
    /pi-review-code review-fix fix-1/,
  );
  assert.match(result?.summary?.summary ?? "", /comment-1/);
  assert.equal(result?.summary?.details?.kind, "fix");
});

test("fix branch summary includes source review and agent result", () => {
  const summary = buildFixBranchSummary({
    runId: "fix-1",
    sourceReviewRunId: "review-1",
    targetHint: "review auth boundaries",
    fixPrompt: "Fix prompt",
    comments: [comment()],
    agentSummary: "Fixed comment-1 and ran make test.",
    completedAt: 456,
  });

  assert.match(summary.summary, /pi-review-code review-fix fix-1/);
  assert.match(summary.summary, /Source review: review-1/);
  assert.match(summary.summary, /comment-1/);
  assert.match(summary.summary, /Fixed comment-1/);
  assert.equal(summary.details.kind, "fix");
});
