import assert from "node:assert/strict";
import test from "node:test";

import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

import { REVIEW_FIX_USAGE } from "../src/command.js";
import {
  REVIEW_FIX_SUMMARY_ENTRY_TYPE,
  REVIEW_PROMPT_ENTRY_TYPE,
  REVIEW_SUMMARY_ENTRY_TYPE,
  buildFixBranchSummary,
  createReviewFlowController,
  listUnfixedReviewFindings,
  selectReviewSummaryForFix,
} from "../src/flow.js";
import { buildReviewFixPrompt } from "../src/prompts.js";
import { REVIEW_STATE_ENTRY_TYPE } from "../src/state.js";
import type { ReviewComment } from "../src/types.js";

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

function reviewSummaryEntry(
  runId: string,
  comments: ReviewComment[],
  options: { completedAt?: number; targetHint?: string } = {},
) {
  return {
    type: "custom",
    customType: REVIEW_SUMMARY_ENTRY_TYPE,
    data: {
      summary: `pi-review-code review ${runId}`,
      details: {
        kind: "review",
        runId,
        targetHint: options.targetHint ?? "review auth boundaries",
        reviewPrompt: "Review auth boundaries",
        completedAt: options.completedAt ?? (runId === "review-2" ? 200 : 100),
        comments,
      },
    },
  };
}

function fixSummaryEntry(
  runId: string,
  sourceReviewRunId: string,
  comments: ReviewComment[],
) {
  return {
    type: "custom",
    customType: REVIEW_FIX_SUMMARY_ENTRY_TYPE,
    data: buildFixBranchSummary({
      runId,
      sourceReviewRunId,
      targetHint: "review auth boundaries",
      fixPrompt: "Fix prompt",
      comments,
      agentSummary: "Fixed selected findings.",
      completedAt: 300,
    }),
  };
}

function assertSelectedSummary(
  selected: ReturnType<typeof selectReviewSummaryForFix>,
  expectedRunId: string,
  expectedCommentIds: string[],
): void {
  assert.equal(selected?.runId, expectedRunId);
  assert.deepEqual(
    selected?.comments.map((item) => item.id),
    expectedCommentIds,
  );
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

  assertSelectedSummary(selected, "review-2", ["new"]);
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

  assertSelectedSummary(selected, "review-1", ["one"]);
});

test("selectReviewSummaryForFix can select one finding by id", () => {
  const selected = selectReviewSummaryForFix(
    [
      reviewSummaryEntry("review-1", [
        comment({ id: "finding-one", runId: "review-1" }),
        comment({ id: "finding-two", runId: "review-1" }),
      ]),
      reviewSummaryEntry("review-2", [
        comment({ id: "finding-three", runId: "review-2" }),
      ]),
    ],
    { kind: "finding-id", findingId: "finding-two" },
  );

  assertSelectedSummary(selected, "review-1", ["finding-two"]);
});

test("selectReviewSummaryForFix can select multiple findings in requested order", () => {
  const selected = selectReviewSummaryForFix(
    [
      reviewSummaryEntry("review-1", [
        comment({ id: "finding-a", runId: "review-1" }),
        comment({ id: "finding-b", runId: "review-1" }),
        comment({ id: "finding-c", runId: "review-1" }),
      ]),
    ],
    { kind: "finding-ids", findingIds: ["finding-c", "finding-a"] },
  );

  assertSelectedSummary(selected, "review-1", ["finding-c", "finding-a"]);
});

test("selectReviewSummaryForFix rejects multiple findings when one id is missing", () => {
  const selected = selectReviewSummaryForFix(
    [
      reviewSummaryEntry("review-1", [
        comment({ id: "finding-a", runId: "review-1" }),
        comment({ id: "finding-c", runId: "review-1" }),
      ]),
    ],
    { kind: "finding-ids", findingIds: ["finding-c", "finding-b"] },
  );

  assert.equal(selected, undefined);
});

test("selectReviewSummaryForFix rejects multiple findings split across reviews", () => {
  const selected = selectReviewSummaryForFix(
    [
      reviewSummaryEntry("review-1", [
        comment({ id: "finding-a", runId: "review-1" }),
      ]),
      reviewSummaryEntry("review-2", [
        comment({ id: "finding-b", runId: "review-2" }),
      ]),
    ],
    { kind: "finding-ids", findingIds: ["finding-a", "finding-b"] },
  );

  assert.equal(selected, undefined);
});

test("selectReviewSummaryForFix treats ambiguous id as finding before run", () => {
  const selected = selectReviewSummaryForFix(
    [
      reviewSummaryEntry("review-1", [
        comment({ id: "review-2", runId: "review-1" }),
      ]),
      reviewSummaryEntry("review-2", [
        comment({ id: "other", runId: "review-2" }),
      ]),
    ],
    { kind: "id", id: "review-2" },
  );

  assertSelectedSummary(selected, "review-1", ["review-2"]);
});

test("selectReviewSummaryForFix falls back to run for ambiguous id", () => {
  const selected = selectReviewSummaryForFix(
    [
      reviewSummaryEntry("review-1", [
        comment({ id: "finding-one", runId: "review-1" }),
        comment({ id: "finding-two", runId: "review-1" }),
      ]),
      reviewSummaryEntry("review-2", [
        comment({ id: "finding-three", runId: "review-2" }),
      ]),
    ],
    { kind: "id", id: "review-1" },
  );

  assertSelectedSummary(selected, "review-1", ["finding-one", "finding-two"]);
});

test("listUnfixedReviewFindings hides findings from completed fix summaries", () => {
  const findingA = comment({ id: "finding-a", runId: "review-1" });
  const findingB = comment({ id: "finding-b", runId: "review-1" });
  const findingC = comment({ id: "finding-c", runId: "review-1" });

  const result = listUnfixedReviewFindings([
    reviewSummaryEntry("review-1", [findingA, findingB, findingC]),
    fixSummaryEntry("fix-1", "review-1", [findingA, findingC]),
  ]);

  assert.equal(result.totalFindings, 3);
  assert.deepEqual(
    result.unfixed.map((item) => item.comment.id),
    ["finding-b"],
  );
  assert.equal(result.unfixed[0]?.reviewRunId, "review-1");
});

test("listUnfixedReviewFindings orders newest reviews first", () => {
  const result = listUnfixedReviewFindings([
    reviewSummaryEntry("review-1", [comment({ id: "old", runId: "review-1" })]),
    reviewSummaryEntry("review-2", [comment({ id: "new", runId: "review-2" })]),
  ]);

  assert.deepEqual(
    result.unfixed.map((item) => `${item.reviewRunId}:${item.comment.id}`),
    ["review-2:new", "review-1:old"],
  );
});

test("listUnfixedReviewFindings keys fixed findings by review run", () => {
  const first = comment({ id: "same-id", runId: "review-1" });
  const second = comment({ id: "same-id", runId: "review-2" });

  const result = listUnfixedReviewFindings([
    reviewSummaryEntry("review-1", [first]),
    reviewSummaryEntry("review-2", [second]),
    fixSummaryEntry("fix-1", "review-1", [first]),
  ]);

  assert.equal(result.totalFindings, 2);
  assert.deepEqual(
    result.unfixed.map((item) => `${item.reviewRunId}:${item.comment.id}`),
    ["review-2:same-id"],
  );
});

test("listUnfixedReviewFindings ignores malformed fix summaries", () => {
  const finding = comment({ id: "finding-a", runId: "review-1" });

  const result = listUnfixedReviewFindings([
    reviewSummaryEntry("review-1", [finding]),
    {
      type: "custom",
      customType: REVIEW_FIX_SUMMARY_ENTRY_TYPE,
      data: {
        details: {
          kind: "fix",
          runId: "fix-1",
          sourceReviewRunId: 123,
          targetHint: "review auth boundaries",
          fixPrompt: "Fix prompt",
          completedAt: 300,
          comments: [finding],
          agentSummary: "Fixed selected findings.",
        },
      },
    },
  ]);

  assert.equal(result.totalFindings, 1);
  assert.deepEqual(
    result.unfixed.map((item) => item.comment.id),
    ["finding-a"],
  );
});

test("listUnfixedReviewFindings ignores active fix state without summary", () => {
  const finding = comment({ id: "finding-a", runId: "review-1" });

  const result = listUnfixedReviewFindings([
    reviewSummaryEntry("review-1", [finding]),
    {
      type: "custom",
      customType: REVIEW_STATE_ENTRY_TYPE,
      data: {
        version: 1,
        activeKind: "fix",
        runId: "fix-1",
        originLeafId: "leaf-fix-origin",
        targetHint: "review auth boundaries",
        reviewPrompt: "Fix prompt",
        originModelProvider: "anthropic",
        originModelId: "claude-sonnet",
        originThinkingLevel: "medium",
        sourceReviewRunId: "review-1",
        commentIds: ["finding-a"],
      },
    },
  ]);

  assert.equal(result.totalFindings, 1);
  assert.deepEqual(
    result.unfixed.map((item) => item.comment.id),
    ["finding-a"],
  );
});

test("listUnfixedReviewFindings dedupes review summaries by newest completion", () => {
  const stale = comment({ id: "stale", runId: "review-1" });
  const fresh = comment({ id: "fresh", runId: "review-1" });

  const result = listUnfixedReviewFindings([
    reviewSummaryEntry("review-1", [stale], { completedAt: 100 }),
    reviewSummaryEntry("review-1", [fresh], { completedAt: 200 }),
  ]);

  assert.equal(result.totalFindings, 1);
  assert.deepEqual(
    result.unfixed.map((item) => item.comment.id),
    ["fresh"],
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
  const waitForIdleCalls: number[] = [];
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
    waitForIdle: async () => {
      waitForIdleCalls.push(1);
    },
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
    waitForIdleCalls,
  };
}

function assertFixRunStarted(
  harness: ReturnType<typeof createHarness>,
  expectedCommentIds: string[],
): void {
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
      commentIds: expectedCommentIds,
    },
  ]);
}

test("review-fix without arguments shows help without launching", async () => {
  const harness = createHarness();

  await harness.controller.handleReviewFixCommand("", harness.ctx);

  assert.deepEqual(harness.sentUserMessages, []);
  assert.deepEqual(harness.startedFixRuns, []);
  assert.deepEqual(harness.notifications, [
    { message: REVIEW_FIX_USAGE, level: "info" },
  ]);
});

test("review-fix list shows unfixed findings without model or branch launch", async () => {
  const fixed = comment({
    id: "finding-fixed",
    runId: "review-1",
    priority: "P1",
    comment: "Already fixed race.",
  });
  const open = comment({
    id: "finding-open",
    runId: "review-1",
    priority: "P2",
    comment: "Logout leaves stale cache.",
    references: [{ filePath: "src/cache.ts", startLine: 10 }],
  });
  const harness = createHarness({
    model: null,
    entries: [
      reviewSummaryEntry("review-1", [fixed, open]),
      fixSummaryEntry("fix-1", "review-1", [fixed]),
    ],
  });

  await harness.controller.handleReviewFixCommand("list", harness.ctx);

  assert.deepEqual(harness.waitForIdleCalls, []);
  assert.deepEqual(harness.sentUserMessages, []);
  assert.deepEqual(harness.startedFixRuns, []);
  assert.equal(harness.notifications.length, 1);
  assert.equal(harness.notifications[0]?.level, "info");

  const message = harness.notifications[0]?.message ?? "";
  assert.match(message, /Unfixed review findings/);
  assert.match(message, /Review review-1/);
  assert.match(message, /Target: review auth boundaries/);
  assert.match(message, /P2 finding-open/);
  assert.match(message, /src\/cache\.ts:10/);
  assert.match(message, /Logout leaves stale cache\./);
  assert.match(
    message,
    /Use \/review-fix finding <finding-id> \[<finding-id> \.\.\.\]/,
  );
  assert.doesNotMatch(message, /finding-fixed/);
});

test("review-fix list reports all-fixed and no-findings distinctly", async () => {
  const fixed = comment({ id: "finding-fixed", runId: "review-1" });
  const allFixedHarness = createHarness({
    entries: [
      reviewSummaryEntry("review-1", [fixed]),
      fixSummaryEntry("fix-1", "review-1", [fixed]),
    ],
  });

  await allFixedHarness.controller.handleReviewFixCommand(
    "list",
    allFixedHarness.ctx,
  );

  assert.deepEqual(allFixedHarness.notifications, [
    { message: "All review findings have been fixed.", level: "info" },
  ]);

  const noFindingsHarness = createHarness({ entries: [] });

  await noFindingsHarness.controller.handleReviewFixCommand(
    "list",
    noFindingsHarness.ctx,
  );

  assert.deepEqual(noFindingsHarness.notifications, [
    { message: "No review findings found.", level: "info" },
  ]);
});

test("review-fix launches fix branch for latest review comments", async () => {
  const harness = createHarness();

  await harness.controller.handleReviewFixCommand("latest", harness.ctx);

  assert.equal(harness.sentUserMessages.length, 1);
  assert.match(harness.sentUserMessages[0] ?? "", /comment-1/);
  assertFixRunStarted(harness, ["comment-1"]);
  assert.deepEqual(harness.notifications, [
    { message: "Fix branch started: fix-1", level: "info" },
  ]);
});

test("review-fix launches fix branch for one finding id", async () => {
  const harness = createHarness({
    entries: [
      reviewSummaryEntry("review-1", [
        comment({ id: "finding-one", runId: "review-1" }),
        comment({
          id: "finding-two",
          runId: "review-1",
          comment: "Logout leaves stale cache.",
        }),
      ]),
    ],
  });

  await harness.controller.handleReviewFixCommand("finding-two", harness.ctx);

  assert.equal(harness.sentUserMessages.length, 1);
  assert.doesNotMatch(harness.sentUserMessages[0] ?? "", /finding-one/);
  assert.match(harness.sentUserMessages[0] ?? "", /finding-two/);
  assertFixRunStarted(harness, ["finding-two"]);
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
      targetId: "leaf-fix-origin",
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

test("session_before_tree ignores review-fix summary for mismatched target", async () => {
  const harness = createHarness();

  await harness.controller.handleReviewFixCommand("latest", harness.ctx);
  await harness.controller.handleAgentEnd(harness.createFixAgentEndEvent(), {
    sessionManager: harness.ctx.sessionManager,
  } as never);

  const wrongTarget = await harness.controller.handleSessionBeforeTree({
    preparation: {
      label: "review-fix:fix-1",
      targetId: "unrelated-leaf",
      userWantsSummary: true,
    },
  } as never);

  assert.equal(wrongTarget, undefined);

  const rightTarget = await harness.controller.handleSessionBeforeTree({
    preparation: {
      label: "review-fix:fix-1",
      targetId: "leaf-fix-origin",
      userWantsSummary: true,
    },
  } as never);

  assert.match(
    rightTarget?.summary?.summary ?? "",
    /pi-review-code review-fix fix-1/,
  );
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
