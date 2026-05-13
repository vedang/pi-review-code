import assert from "node:assert/strict";
import test from "node:test";

import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { REVIEW_FIX_USAGE } from "../src/command.js";
import {
  REVIEW_FIX_SUMMARY_ENTRY_TYPE,
  REVIEW_PROMPT_ENTRY_TYPE,
  REVIEW_SUMMARY_ENTRY_TYPE,
  buildFixBranchSummary,
  buildReviewFixWidgetData,
  createReviewFlowController,
} from "../src/flow.js";
import { buildReviewFixPrompt } from "../src/prompts.js";
import type {
  ReviewFixWidgetConfig,
  ReviewFixWidgetResult,
} from "../src/review-fix-widget.js";
import type { ReviewComment, ReviewState } from "../src/types.js";

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

function activeMetaState(): ReviewState {
  return {
    version: 1,
    activeKind: "meta",
    runId: "meta-active",
    originLeafId: "leaf-meta",
    targetHint: "origin/main",
    metaPrompt: "Create review prompt",
    originModelProvider: "anthropic",
    originModelId: "claude-sonnet",
    originThinkingLevel: "high",
  };
}

function activeReviewState(): ReviewState {
  return {
    version: 1,
    activeKind: "review",
    runId: "review-active",
    originLeafId: "leaf-review",
    targetHint: "origin/main",
    reviewPrompt: "Review diff",
    originModelProvider: "anthropic",
    originModelId: "claude-sonnet",
    originThinkingLevel: "high",
  };
}

function activeFixState(): ReviewState {
  return {
    version: 1,
    activeKind: "fix",
    runId: "fix-active",
    originLeafId: "leaf-fix",
    targetHint: "origin/main",
    reviewPrompt: "Fix review comments",
    originModelProvider: "anthropic",
    originModelId: "claude-sonnet",
    originThinkingLevel: "medium",
    sourceReviewRunId: "review-1",
    commentIds: ["comment-1"],
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

test("buildReviewFixWidgetData lists all reviews with open findings newest first", () => {
  const oldFinding = comment({ id: "old", runId: "review-1" });
  const first = comment({ id: "first", runId: "review-2" });
  const second = comment({ id: "second", runId: "review-2" });

  const result = buildReviewFixWidgetData([
    reviewSummaryEntry("review-1", [oldFinding], { completedAt: 100 }),
    reviewSummaryEntry("review-2", [first, second], {
      completedAt: 200,
      targetHint: "review cache boundaries",
    }),
  ]);

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(result.reviewRunId, undefined);
  assert.equal(result.targetHint, undefined);
  assert.equal(result.completedAt, undefined);
  assert.deepEqual(
    result.findings.map((item) => item.comment.id),
    ["first", "second", "old"],
  );
  assert.deepEqual(
    result.findings.map((item) => item.fixed),
    [false, false, false],
  );
  assert.deepEqual(
    result.findings.map((item) => item.reviewRunId),
    ["review-2", "review-2", "review-1"],
  );
  assert.deepEqual(
    result.findings.map((item) => item.targetHint),
    [
      "review cache boundaries",
      "review cache boundaries",
      "review auth boundaries",
    ],
  );
  assert.deepEqual(
    result.findings.map((item) => item.completedAt),
    [200, 200, 100],
  );
});

test("buildReviewFixWidgetData marks fixed findings for a visible review", () => {
  const fixed = comment({ id: "fixed", runId: "review-1" });
  const open = comment({ id: "open", runId: "review-1" });

  const result = buildReviewFixWidgetData([
    reviewSummaryEntry("review-1", [fixed, open]),
    fixSummaryEntry("fix-1", "review-1", [fixed]),
  ]);

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.deepEqual(
    result.findings.map((item) => [item.comment.id, item.fixed]),
    [
      ["fixed", true],
      ["open", false],
    ],
  );
});

test("buildReviewFixWidgetData keys fixed findings by review run", () => {
  const olderSameId = comment({ id: "same-id", runId: "review-1" });
  const latestSameId = comment({ id: "same-id", runId: "review-2" });

  const result = buildReviewFixWidgetData([
    reviewSummaryEntry("review-1", [olderSameId], { completedAt: 100 }),
    reviewSummaryEntry("review-2", [latestSameId], { completedAt: 200 }),
    fixSummaryEntry("fix-1", "review-1", [olderSameId]),
  ]);

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.deepEqual(
    result.findings.map((item) => [
      item.reviewRunId,
      item.comment.id,
      item.fixed,
    ]),
    [["review-2", "same-id", false]],
  );
});

test("buildReviewFixWidgetData skips newer reviews with only fixed findings", () => {
  const oldOpen = comment({ id: "old-open", runId: "review-1" });
  const newFixed = comment({ id: "new-fixed", runId: "review-2" });

  const result = buildReviewFixWidgetData([
    reviewSummaryEntry("review-1", [oldOpen], { completedAt: 100 }),
    reviewSummaryEntry("review-2", [newFixed], { completedAt: 200 }),
    fixSummaryEntry("fix-1", "review-2", [newFixed]),
  ]);

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(result.reviewRunId, "review-1");
  assert.deepEqual(
    result.findings.map((item) => [
      item.reviewRunId,
      item.comment.id,
      item.fixed,
    ]),
    [["review-1", "old-open", false]],
  );
});

test("buildReviewFixWidgetData returns empty reason when no review findings exist", () => {
  const result = buildReviewFixWidgetData([
    reviewSummaryEntry("review-empty", [], { completedAt: 200 }),
    { type: "custom", customType: REVIEW_SUMMARY_ENTRY_TYPE, data: {} },
  ]);

  assert.deepEqual(result, {
    ok: false,
    reason: "no-review-findings",
    findings: [],
  });
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
  entriesSequence?: unknown[][];
  leafId?: string | null;
  fixWidgetResult?: ReviewFixWidgetResult;
  showFixWidget?: false;
  navigateResults?: Array<{ cancelled: boolean } | Error>;
  activeState?: ReviewState;
  fixWidgetDelay?: Promise<void>;
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
  const fixWidgetConfigs: ReviewFixWidgetConfig[] = [];
  const navigateResults = [...(options.navigateResults ?? [])];
  let currentState: ReviewState = options.activeState ?? {
    version: 1,
    activeKind: null,
  };

  const entries = options.entries ?? [
    reviewSummaryEntry("review-1", [comment({ runId: "review-1" })]),
  ];
  const entriesSequence = options.entriesSequence;
  let getEntriesCallCount = 0;
  const getEntries = () => {
    if (entriesSequence === undefined) {
      return entries;
    }

    const index = Math.min(getEntriesCallCount, entriesSequence.length - 1);
    getEntriesCallCount += 1;
    return entriesSequence[index] ?? [];
  };

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
      getState: () => currentState,
      startReviewRun: (_ctx, state) => {
        currentState = { version: 1, activeKind: "review", ...state };
      },
      startFixRun: (_ctx, state) => {
        startedFixRuns.push(state);
        currentState = { version: 1, activeKind: "fix", ...state };
      },
      clearActiveRun: (ctx: unknown) => {
        clearedRuns.push(ctx);
        currentState = { version: 1, activeKind: null };
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
    ...(options.showFixWidget === false
      ? {}
      : {
          showFixWidget: async (
            _ctx: ExtensionCommandContext,
            config: ReviewFixWidgetConfig,
          ) => {
            fixWidgetConfigs.push(config);
            await options.fixWidgetDelay;
            return (
              options.fixWidgetResult ?? {
                submitted: true,
                reviewRunId: "review-1",
                findingIds: ["comment-1"],
              }
            );
          },
        }),
  });

  const ctx = {
    hasUI: options.hasUI ?? true,
    model:
      options.model === null
        ? undefined
        : (options.model ?? { provider: "anthropic", id: "claude-sonnet" }),
    sessionManager: {
      getLeafId: () =>
        options.leafId === undefined ? "leaf-fix-origin" : options.leafId,
      getEntries,
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
    fixWidgetConfigs,
  };
}

function assertFixRunStarted(
  harness: ReturnType<typeof createHarness>,
  expectedCommentIds: string[],
  options: {
    sourceReviewRunId?: string;
    targetHint?: string;
    fixContext?: string;
  } = {},
): void {
  assert.deepEqual(harness.startedFixRuns, [
    {
      runId: "fix-1",
      originLeafId: "leaf-fix-origin",
      targetHint: options.targetHint ?? "review auth boundaries",
      reviewPrompt: harness.sentUserMessages[0],
      originModelProvider: "anthropic",
      originModelId: "claude-sonnet",
      originThinkingLevel: "medium",
      sourceReviewRunId: options.sourceReviewRunId ?? "review-1",
      commentIds: expectedCommentIds,
      ...(options.fixContext === undefined
        ? {}
        : { fixContext: options.fixContext }),
    },
  ]);
}

test("review-fix rejects launch while any pi-review-code run is active", async () => {
  for (const [activeState, message] of [
    [
      activeMetaState(),
      "Cannot start review-fix: pi-review-code review prompt meta-pass meta-active is still active.",
    ],
    [
      activeReviewState(),
      "Cannot start review-fix: pi-review-code review review-active is still active.",
    ],
    [
      activeFixState(),
      "Cannot start review-fix: pi-review-code review-fix fix-active is still active.",
    ],
  ] as const) {
    const harness = createHarness({ activeState });

    await harness.controller.handleReviewFixCommand("", harness.ctx);

    assert.deepEqual(harness.fixWidgetConfigs, []);
    assert.deepEqual(harness.waitForIdleCalls, []);
    assert.deepEqual(harness.sentUserMessages, []);
    assert.deepEqual(harness.startedFixRuns, []);
    assert.deepEqual(harness.notifications, [{ message, level: "error" }]);
  }
});

test("review-fix rejects overlapping launch while widget is pending", async () => {
  let releaseWidget: () => void = () => {};
  const fixWidgetDelay = new Promise<void>((resolve) => {
    releaseWidget = resolve;
  });
  const harness = createHarness({ fixWidgetDelay });

  const firstLaunch = harness.controller.handleReviewFixCommand(
    "",
    harness.ctx,
  );
  await Promise.resolve();

  await harness.controller.handleReviewFixCommand("", harness.ctx);

  assert.equal(harness.fixWidgetConfigs.length, 1);
  assert.deepEqual(harness.notifications[0], {
    message:
      "Cannot start review-fix: pi-review-code review-fix launch is already in progress.",
    level: "error",
  });
  assert.deepEqual(harness.sentUserMessages, []);

  releaseWidget();
  await firstLaunch;

  assert.equal(harness.startedFixRuns.length, 1);
  assert.equal(harness.sentUserMessages.length, 1);
});

test("review-fix without arguments opens widget before model validation", async () => {
  const harness = createHarness({
    model: null,
    fixWidgetResult: { submitted: false },
  });

  await harness.controller.handleReviewFixCommand("", harness.ctx);

  assert.equal(harness.fixWidgetConfigs.length, 1);
  assert.equal(harness.fixWidgetConfigs[0]?.reviewRunId, "review-1");
  assert.deepEqual(
    harness.fixWidgetConfigs[0]?.findings.map((finding) => finding.id),
    ["comment-1"],
  );
  assert.deepEqual(harness.waitForIdleCalls, []);
  assert.deepEqual(harness.sentUserMessages, []);
  assert.deepEqual(harness.startedFixRuns, []);
  assert.deepEqual(harness.notifications, [
    { message: "Review-fix cancelled.", level: "info" },
  ]);
});

test("review-fix without widget dependency shows fix usage", async () => {
  const harness = createHarness({ showFixWidget: false });

  await harness.controller.handleReviewFixCommand("", harness.ctx);

  assert.deepEqual(harness.fixWidgetConfigs, []);
  assert.deepEqual(harness.sentUserMessages, []);
  assert.deepEqual(harness.startedFixRuns, []);
  assert.deepEqual(harness.notifications, [
    { message: REVIEW_FIX_USAGE, level: "info" },
  ]);
});

test("review-fix rejects nonblank arguments with widget guidance", async () => {
  const harness = createHarness();

  await harness.controller.handleReviewFixCommand("latest", harness.ctx);

  assert.deepEqual(harness.fixWidgetConfigs, []);
  assert.deepEqual(harness.waitForIdleCalls, []);
  assert.deepEqual(harness.sentUserMessages, []);
  assert.deepEqual(harness.startedFixRuns, []);
  assert.deepEqual(harness.notifications, [
    {
      message: "Run /review-fix and select findings in the widget.",
      level: "info",
    },
  ]);
});

test("review-fix opens empty widget when no completed review findings exist", async () => {
  const harness = createHarness({
    entries: [],
    fixWidgetResult: { submitted: false },
  });

  await harness.controller.handleReviewFixCommand("", harness.ctx);

  assert.equal(harness.fixWidgetConfigs.length, 1);
  assert.equal(harness.fixWidgetConfigs[0]?.reviewRunId, undefined);
  assert.deepEqual(harness.fixWidgetConfigs[0]?.findings, []);
  assert.deepEqual(harness.sentUserMessages, []);
  assert.deepEqual(harness.startedFixRuns, []);
  assert.deepEqual(harness.notifications, [
    { message: "Review-fix cancelled.", level: "info" },
  ]);
});

test("review-fix passes multiline stored review comments to widget unchanged", async () => {
  const multilineComment =
    "Token refresh can race with logout.\nBecause logout clears the active session before refresh settles.\nFix: serialize refresh and clear pending promises.";
  const harness = createHarness({
    entries: [
      reviewSummaryEntry("review-1", [
        comment({ id: "multiline", comment: multilineComment }),
      ]),
    ],
    fixWidgetResult: { submitted: false },
  });

  await harness.controller.handleReviewFixCommand("", harness.ctx);

  assert.equal(
    harness.fixWidgetConfigs[0]?.findings[0]?.comment,
    multilineComment,
  );
});

test("review-fix widget displays all open review findings newest first", async () => {
  const harness = createHarness({
    entries: [
      reviewSummaryEntry("review-1", [
        comment({ id: "old", runId: "review-1" }),
      ]),
      reviewSummaryEntry(
        "review-2",
        [comment({ id: "new", runId: "review-2" })],
        { completedAt: 200, targetHint: "review cache boundaries" },
      ),
    ],
    fixWidgetResult: { submitted: false },
  });

  await harness.controller.handleReviewFixCommand("", harness.ctx);

  assert.equal(harness.fixWidgetConfigs.length, 1);
  assert.equal(harness.fixWidgetConfigs[0]?.reviewRunId, undefined);
  assert.equal(harness.fixWidgetConfigs[0]?.targetHint, undefined);
  assert.deepEqual(
    harness.fixWidgetConfigs[0]?.findings.map((finding) => finding.id),
    ["new", "old"],
  );
  assert.deepEqual(
    harness.fixWidgetConfigs[0]?.findings.map((finding) => finding.reviewRunId),
    ["review-2", "review-1"],
  );
  assert.deepEqual(
    harness.fixWidgetConfigs[0]?.findings.map((finding) => finding.targetHint),
    ["review cache boundaries", "review auth boundaries"],
  );
});

test("review-fix widget submit launches fix branch for selected findings", async () => {
  const harness = createHarness({
    entries: [
      reviewSummaryEntry("review-1", [
        comment({ id: "finding-one", runId: "review-1" }),
        comment({
          id: "finding-two",
          runId: "review-1",
          comment: "Logout leaves stale cache.",
        }),
        comment({
          id: "finding-three",
          runId: "review-1",
          comment: "Metrics export drops labels.",
        }),
      ]),
    ],
    fixWidgetResult: {
      submitted: true,
      reviewRunId: "review-1",
      findingIds: ["finding-one", "finding-two"],
    },
  });

  await harness.controller.handleReviewFixCommand("", harness.ctx);

  assert.equal(harness.sentUserMessages.length, 1);
  assert.match(harness.sentUserMessages[0] ?? "", /finding-one/);
  assert.match(harness.sentUserMessages[0] ?? "", /finding-two/);
  assert.doesNotMatch(harness.sentUserMessages[0] ?? "", /finding-three/);
  assertFixRunStarted(harness, ["finding-one", "finding-two"]);
  assert.deepEqual(harness.notifications, [
    { message: "Fix branch started: fix-1", level: "info" },
  ]);
  assert.equal(harness.sentMessages.length, 1);
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
    commentIds: ["finding-one", "finding-two"],
  });
});

test("review-fix widget submit checks active model after selection", async () => {
  const harness = createHarness({
    model: null,
    fixWidgetResult: {
      submitted: true,
      reviewRunId: "review-1",
      findingIds: ["comment-1"],
    },
  });

  await harness.controller.handleReviewFixCommand("", harness.ctx);

  assert.equal(harness.fixWidgetConfigs.length, 1);
  assert.deepEqual(harness.waitForIdleCalls, []);
  assert.deepEqual(harness.sentUserMessages, []);
  assert.deepEqual(harness.startedFixRuns, []);
  assert.deepEqual(harness.notifications, [
    {
      message: "Cannot start review-fix: no active model is selected.",
      level: "error",
    },
  ]);
});

test("review-fix widget submit checks current leaf after selection", async () => {
  const harness = createHarness({
    leafId: null,
    fixWidgetResult: {
      submitted: true,
      reviewRunId: "review-1",
      findingIds: ["comment-1"],
    },
  });

  await harness.controller.handleReviewFixCommand("", harness.ctx);

  assert.deepEqual(harness.waitForIdleCalls, [1]);
  assert.deepEqual(harness.sentUserMessages, []);
  assert.deepEqual(harness.startedFixRuns, []);
  assert.deepEqual(harness.notifications, [
    {
      message: "Cannot start review-fix: no current branch leaf id.",
      level: "error",
    },
  ]);
});

test("review-fix widget result revalidates submitted review run", async () => {
  const oldFinding = comment({ id: "old", runId: "review-1" });
  const newFinding = comment({ id: "new", runId: "review-2" });
  const harness = createHarness({
    entriesSequence: [
      [reviewSummaryEntry("review-1", [oldFinding], { completedAt: 100 })],
      [
        reviewSummaryEntry("review-1", [oldFinding], { completedAt: 100 }),
        reviewSummaryEntry("review-2", [newFinding], { completedAt: 200 }),
      ],
    ],
    fixWidgetResult: {
      submitted: true,
      reviewRunId: "review-1",
      findingIds: ["old"],
    },
  });

  await harness.controller.handleReviewFixCommand("", harness.ctx);

  assert.equal(harness.sentUserMessages.length, 1);
  assert.match(harness.sentUserMessages[0] ?? "", /old/);
  assert.doesNotMatch(harness.sentUserMessages[0] ?? "", /new/);
  assertFixRunStarted(harness, ["old"]);
});

test("review-fix rejects stale widget finding after submit", async () => {
  const harness = createHarness({
    entriesSequence: [
      [
        reviewSummaryEntry("review-1", [
          comment({ id: "finding-one", runId: "review-1" }),
        ]),
      ],
      [
        reviewSummaryEntry("review-1", [
          comment({ id: "finding-two", runId: "review-1" }),
        ]),
      ],
    ],
    fixWidgetResult: {
      submitted: true,
      reviewRunId: "review-1",
      findingIds: ["finding-one"],
    },
  });

  await harness.controller.handleReviewFixCommand("", harness.ctx);

  assert.deepEqual(harness.sentUserMessages, []);
  assert.deepEqual(harness.startedFixRuns, []);
  assert.deepEqual(harness.notifications, [
    {
      message:
        "Cannot start review-fix: selected findings are no longer available.",
      level: "error",
    },
  ]);
});

test("review-fix rejects when newer same-run summary has no findings", async () => {
  const staleFinding = comment({ id: "finding-one", runId: "review-1" });
  const harness = createHarness({
    entriesSequence: [
      [reviewSummaryEntry("review-1", [staleFinding], { completedAt: 100 })],
      [
        reviewSummaryEntry("review-1", [staleFinding], { completedAt: 100 }),
        reviewSummaryEntry("review-1", [], { completedAt: 200 }),
      ],
    ],
    fixWidgetResult: {
      submitted: true,
      reviewRunId: "review-1",
      findingIds: ["finding-one"],
    },
  });

  await harness.controller.handleReviewFixCommand("", harness.ctx);

  assert.deepEqual(harness.sentUserMessages, []);
  assert.deepEqual(harness.startedFixRuns, []);
  assert.deepEqual(harness.notifications, [
    {
      message:
        "Cannot start review-fix: selected findings are no longer available.",
      level: "error",
    },
  ]);
});

test("review-fix rejects already-fixed widget finding after submit", async () => {
  const finding = comment({ id: "finding-one", runId: "review-1" });
  const harness = createHarness({
    entriesSequence: [
      [reviewSummaryEntry("review-1", [finding])],
      [
        reviewSummaryEntry("review-1", [finding]),
        fixSummaryEntry("fix-1", "review-1", [finding]),
      ],
    ],
    fixWidgetResult: {
      submitted: true,
      reviewRunId: "review-1",
      findingIds: ["finding-one"],
    },
  });

  await harness.controller.handleReviewFixCommand("", harness.ctx);

  assert.deepEqual(harness.sentUserMessages, []);
  assert.deepEqual(harness.startedFixRuns, []);
  assert.deepEqual(harness.notifications, [
    {
      message:
        "Cannot start review-fix: selected findings are no longer available.",
      level: "error",
    },
  ]);
});

test("review-fix propagates widget context through run metadata and summary", async () => {
  const harness = createHarness({
    fixWidgetResult: {
      submitted: true,
      reviewRunId: "review-1",
      findingIds: ["comment-1"],
      fixContext: "Prioritize logout races.",
    },
  });

  await harness.controller.handleReviewFixCommand("", harness.ctx);

  assert.match(
    harness.sentUserMessages[0] ?? "",
    /Additional human context for this fix loop:/,
  );
  assert.match(harness.sentUserMessages[0] ?? "", /Prioritize logout races\./);
  assertFixRunStarted(harness, ["comment-1"], {
    fixContext: "Prioritize logout races.",
  });
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
    fixContext: "Prioritize logout races.",
  });

  await harness.controller.handleAgentEnd(harness.createFixAgentEndEvent(), {
    sessionManager: harness.ctx.sessionManager,
  } as never);

  assert.equal(harness.sentMessages.length, 2);
  assert.deepEqual(
    (harness.sentMessages[1]?.details as { fixContext?: string } | undefined)
      ?.fixContext,
    "Prioritize logout races.",
  );
});

test("review-fix emits custom prompt and summary messages for renderers", async () => {
  const harness = createHarness();

  await harness.controller.handleReviewFixCommand("", harness.ctx);

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

  await harness.controller.handleReviewFixCommand("", harness.ctx);
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

  await harness.controller.handleReviewFixCommand("", harness.ctx);
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

  await harness.controller.handleReviewFixCommand("", harness.ctx);
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
