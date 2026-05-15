import assert from "node:assert/strict";
import test from "node:test";

import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

import {
  REVIEW_ANCHOR_MESSAGE_TYPE,
  REVIEW_META_PROMPT_ENTRY_TYPE,
  REVIEW_META_SUMMARY_ENTRY_TYPE,
  REVIEW_PROMPT_ENTRY_TYPE,
  REVIEW_SUMMARY_ENTRY_TYPE,
  buildReviewBranchSummary,
  createReviewFlowController,
} from "../src/flow.js";
import type {
  ResolvedReviewTarget,
  ReviewComment,
  ReviewMetaResult,
  ReviewState,
} from "../src/types.js";

function promptTarget(): ResolvedReviewTarget {
  return {
    kind: "prompt",
    targetHint: "review auth boundaries",
    prompt: "review auth boundaries",
    commandHints: [{ label: "Search codebase", command: "rg", args: ["auth"] }],
  };
}

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
    runId: "meta-1",
    originLeafId: "leaf-meta",
    targetHint: "origin/main",
    metaPrompt: "Create review prompt",
    originModelProvider: "anthropic",
    originModelId: "claude-sonnet",
    originThinkingLevel: "high",
  };
}

function activeFixState(): ReviewState {
  return {
    version: 1,
    activeKind: "fix",
    runId: "fix-1",
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

type InputWidgetResult =
  | {
      submitted: true;
      kind: "review" | "diff-against" | "pr";
      primaryValue: string;
      reviewContext?: string;
    }
  | { submitted: false };

type InputWidgetCall = {
  title: string;
  helpText: string;
  initialKind?: string;
  initialPrimaryValue?: string;
  initialContext?: string;
};

type HarnessOptions = {
  hasUI?: boolean;
  model?: { provider: string; id: string } | null;
  editorResult?: string | undefined;
  navigateResults?: Array<{ cancelled: boolean } | Error>;
  target?: ResolvedReviewTarget;
  reviewGuidelines?: string;
  reviewGuidelinesError?: Error;
  initialLeafId?: string | null;
  anchorLeafId?: string;
  inputWidgetResult?: InputWidgetResult;
  activeState?: ReviewState;
  inputWidgetDelay?: Promise<void>;
  metaResult?: ReviewMetaResult;
  runIds?: string[];
  sendUserMessageErrorAt?: number;
};

function createHarness(options: HarnessOptions = {}) {
  const notifications: Array<{ message: string; level: string }> = [];
  const sentUserMessages: string[] = [];
  const sentMessages: Array<{
    customType?: string;
    content?: unknown;
    display?: boolean;
    details?: unknown;
    options?: unknown;
  }> = [];
  const appended: Array<{ customType: string; data: unknown }> = [];
  const navigateCalls: Array<{
    targetId: string;
    options: { summarize?: boolean; label?: string };
  }> = [];
  const startedRuns: unknown[] = [];
  const startedMetaRuns: unknown[] = [];
  const clearedRuns: unknown[] = [];
  const editorInputs: Array<{ title: string; initialValue: string }> = [];
  const inputWidgetCalls: InputWidgetCall[] = [];
  const resolvedTargets: unknown[] = [];
  const reviewGuidelineReads: number[] = [];
  let sentUserMessageAttempts = 0;
  let metaResult = options.metaResult;
  let currentState: ReviewState = options.activeState ?? {
    version: 1,
    activeKind: null,
  };

  const target = options.target ?? promptTarget();
  const navigateResults = [...(options.navigateResults ?? [])];
  const runIds = [...(options.runIds ?? ["meta-1", "review-1", "fix-1"])];
  const anchorLeafId = options.anchorLeafId ?? "leaf-anchor";
  let leafId =
    options.initialLeafId === undefined ? "leaf-origin" : options.initialLeafId;

  const controller = createReviewFlowController({
    pi: {
      sendUserMessage: (message: string) => {
        sentUserMessageAttempts += 1;
        if (sentUserMessageAttempts === options.sendUserMessageErrorAt) {
          throw new Error("send failed");
        }
        sentUserMessages.push(message);
      },
      appendEntry: (customType: string, data: unknown) => {
        appended.push({ customType, data });
      },
      sendMessage: (
        message: {
          customType?: string;
          content?: unknown;
          display?: boolean;
          details?: unknown;
        },
        sendOptions?: unknown,
      ) => {
        sentMessages.push({ ...message, options: sendOptions });
        if (
          message.customType === REVIEW_ANCHOR_MESSAGE_TYPE &&
          leafId === null &&
          sendOptions !== undefined
        ) {
          leafId = anchorLeafId;
        }
      },
    },
    stateManager: {
      getState: () => currentState,
      startMetaRun: (_ctx, state) => {
        startedMetaRuns.push(state);
        currentState = { version: 1, activeKind: "meta", ...state };
      },
      startReviewRun: (_ctx, state) => {
        startedRuns.push(state);
        currentState = { version: 1, activeKind: "review", ...state };
      },
      clearActiveRun: (ctx: unknown) => {
        clearedRuns.push(ctx);
        currentState = { version: 1, activeKind: null };
      },
    },
    resolveTarget: async (reviewTarget) => {
      resolvedTargets.push(reviewTarget);
      return target;
    },
    readReviewGuidelines: async () => {
      reviewGuidelineReads.push(1);
      if (options.reviewGuidelinesError !== undefined) {
        throw options.reviewGuidelinesError;
      }
      return options.reviewGuidelines;
    },
    getCommentsForRun: () => [comment()],
    getMetaResultForRun: () => metaResult,
    createRunId: () => runIds.shift() ?? "run-extra",
    getNow: () => 456,
    getThinkingLevel: () => "high",
    ...(options.inputWidgetResult === undefined
      ? {}
      : {
          showInputWidget: async (_ctx: unknown, config: InputWidgetCall) => {
            inputWidgetCalls.push(config);
            await options.inputWidgetDelay;
            return options.inputWidgetResult ?? { submitted: false };
          },
        }),
  });

  const ctx = {
    hasUI: options.hasUI ?? true,
    model:
      options.model === null
        ? undefined
        : (options.model ?? { provider: "anthropic", id: "claude-sonnet" }),
    modelRegistry: { registry: true },
    sessionManager: {
      getLeafId: () => leafId,
      getEntries: () => [],
    },
    waitForIdle: async () => {},
    isIdle: () => true,
    hasPendingMessages: () => false,
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
      editor: async (title: string, initialValue: string) => {
        editorInputs.push({ title, initialValue });
        return options.editorResult;
      },
    },
  } as unknown as ExtensionCommandContext;

  const reviewAgentEndEvent = {
    messages: [{ role: "user", content: "Edited review prompt" }],
  };

  return {
    controller,
    reviewAgentEndEvent,
    ctx,
    notifications,
    sentUserMessages,
    sentMessages,
    appended,
    navigateCalls,
    startedRuns,
    startedMetaRuns,
    clearedRuns,
    editorInputs,
    inputWidgetCalls,
    resolvedTargets,
    reviewGuidelineReads,
    setMetaResult: (nextMetaResult: ReviewMetaResult | undefined) => {
      metaResult = nextMetaResult;
    },
  };
}

function reviewMetaResult(
  overrides: Partial<ReviewMetaResult> = {},
): ReviewMetaResult {
  return {
    version: 1,
    runId: "meta-1",
    targetHint: "review auth boundaries",
    reviewPrompt: "Generated rich review prompt",
    summary: "Checked auth boundaries and token refresh risk.",
    createdAt: 234,
    ...overrides,
  };
}

async function flushScheduledWork(times = 5): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

async function completeMetaPass(
  harness: ReturnType<typeof createHarness>,
): Promise<void> {
  const metaPrompt = harness.sentUserMessages[0];
  assert.equal(typeof metaPrompt, "string");
  harness.setMetaResult(reviewMetaResult());

  await harness.controller.handleBeforeAgentStart(
    {
      type: "before_agent_start",
      prompt: metaPrompt,
      systemPrompt: "base system",
    },
    harness.ctx,
  );
  await harness.controller.handleAgentEnd(
    { messages: [{ role: "user", content: metaPrompt }] },
    { sessionManager: harness.ctx.sessionManager } as never,
  );
  await flushScheduledWork();
}

async function startReviewThroughMeta(
  harness: ReturnType<typeof createHarness>,
  args = "review auth boundaries",
): Promise<void> {
  await harness.controller.handleReviewCommand(args, harness.ctx);
  await completeMetaPass(harness);
}

function resetCollapseArtifacts(
  harness: ReturnType<typeof createHarness>,
): void {
  harness.navigateCalls.length = 0;
  harness.appended.length = 0;
  harness.clearedRuns.length = 0;
}

function assertStartedMetaPass(
  harness: ReturnType<typeof createHarness>,
  originLeafId = "leaf-origin",
): void {
  assert.equal(harness.startedMetaRuns.length, 1);
  assert.match(harness.sentUserMessages[0] ?? "", /Review prompt meta-pass/);
  assert.match(harness.sentUserMessages[0] ?? "", /Run ID: meta-1/);
  assert.deepEqual(harness.startedMetaRuns[0], {
    runId: "meta-1",
    originLeafId,
    targetHint: "review auth boundaries",
    metaPrompt: harness.sentUserMessages[0],
    originModelProvider: "anthropic",
    originModelId: "claude-sonnet",
    originThinkingLevel: "high",
  });
}

test("review flow starts meta-pass before human prompt editor", async () => {
  const harness = createHarness({ editorResult: "Edited review prompt" });

  await harness.controller.handleReviewCommand(
    "review auth boundaries",
    harness.ctx,
  );

  assert.deepEqual(harness.notifications, [
    { message: "Starting review prompt meta-pass: meta-1", level: "info" },
  ]);
  assert.deepEqual(harness.editorInputs, []);
  assert.deepEqual(harness.startedRuns, []);
  assert.deepEqual(harness.resolvedTargets, [
    {
      kind: "prompt",
      prompt: "review auth boundaries",
      targetHint: "review auth boundaries",
    },
  ]);
  assertStartedMetaPass(harness);
});

test("review flow rejects a second review while a run is active", async () => {
  const harness = createHarness({ editorResult: "Edited review prompt" });

  await harness.controller.handleReviewCommand(
    "review auth boundaries",
    harness.ctx,
  );
  await harness.controller.handleReviewCommand(
    "review auth boundaries again",
    harness.ctx,
  );

  assert.equal(harness.sentUserMessages.length, 1);
  assert.equal(harness.startedMetaRuns.length, 1);
  assert.deepEqual(harness.notifications.at(-1), {
    message:
      "Cannot start review: pi-review-code review prompt meta-pass meta-1 is still active.",
    level: "error",
  });
});

test("review flow rejects persisted meta and fix runs before widget", async () => {
  for (const [activeState, message] of [
    [
      activeMetaState(),
      "Cannot start review: pi-review-code review prompt meta-pass meta-1 is still active.",
    ],
    [
      activeFixState(),
      "Cannot start review: pi-review-code review-fix fix-1 is still active.",
    ],
  ] as const) {
    const harness = createHarness({
      activeState,
      inputWidgetResult: {
        submitted: true,
        kind: "review",
        primaryValue: "review auth boundaries",
      },
    });

    await harness.controller.handleReviewCommand("", harness.ctx);

    assert.deepEqual(harness.inputWidgetCalls, []);
    assert.deepEqual(harness.sentUserMessages, []);
    assert.deepEqual(harness.startedRuns, []);
    assert.deepEqual(harness.notifications, [{ message, level: "error" }]);
  }
});

test("before agent start ignores non-meta review state", async () => {
  for (const activeState of [undefined, activeFixState()] as const) {
    const harness = createHarness({ activeState });

    const result = await harness.controller.handleBeforeAgentStart(
      {
        type: "before_agent_start",
        prompt: "Create review prompt",
        systemPrompt: "base system",
      },
      harness.ctx,
    );

    assert.equal(result, undefined);
    assert.deepEqual(harness.clearedRuns, []);
    assert.deepEqual(harness.notifications, []);
  }
});

test("before agent start injects meta system prompt for exact meta prompt", async () => {
  const harness = createHarness({ activeState: activeMetaState() });

  const result = await harness.controller.handleBeforeAgentStart(
    {
      type: "before_agent_start",
      prompt: "Create review prompt",
      systemPrompt: "base system",
    },
    harness.ctx,
  );

  assert.ok(result, "expected meta system prompt injection");
  assert.match(result.systemPrompt ?? "", /^base system\n\n/);
  assert.match(result.systemPrompt ?? "", /review prompt meta-pass/);
  assert.match(result.systemPrompt ?? "", /meta-1/);
  assert.match(result.systemPrompt ?? "", /Do not modify source files/);
  assert.deepEqual(harness.clearedRuns, []);
  assert.deepEqual(harness.notifications, []);
});

test("before agent start abandons meta state for unrelated prompt", async () => {
  const harness = createHarness({ activeState: activeMetaState() });

  const result = await harness.controller.handleBeforeAgentStart(
    {
      type: "before_agent_start",
      prompt: "Unrelated manual question",
      systemPrompt: "base system",
    },
    harness.ctx,
  );

  assert.equal(result, undefined);
  assert.equal(harness.clearedRuns.length, 1);
  assert.deepEqual(harness.notifications, [
    {
      message:
        "Abandoned pi-review-code review prompt meta-pass meta-1: next turn did not match the meta-pass prompt.",
      level: "warning",
    },
  ]);
});

test("tool call guard blocks direct file mutation during meta-pass", async () => {
  const harness = createHarness({ activeState: activeMetaState() });

  const editResult = await harness.controller.handleToolCall(
    {
      type: "tool_call",
      toolName: "edit",
      toolCallId: "tool-1",
      input: { path: "src/auth.ts" },
    },
    harness.ctx,
  );
  const writeResult = await harness.controller.handleToolCall(
    {
      type: "tool_call",
      toolName: "write",
      toolCallId: "tool-2",
      input: { path: "src/auth.ts" },
    },
    harness.ctx,
  );
  const readResult = await harness.controller.handleToolCall(
    {
      type: "tool_call",
      toolName: "read",
      toolCallId: "tool-3",
      input: { path: "src/auth.ts" },
    },
    harness.ctx,
  );

  assert.deepEqual(editResult, {
    block: true,
    reason:
      "pi-review-code review prompt meta-pass meta-1 is read-only; edit is blocked. Use read/search/browser tools, then call set_review_prompt.",
  });
  assert.deepEqual(writeResult, {
    block: true,
    reason:
      "pi-review-code review prompt meta-pass meta-1 is read-only; write is blocked. Use read/search/browser tools, then call set_review_prompt.",
  });
  assert.equal(readResult, undefined);
  assert.deepEqual(harness.notifications, [
    {
      message: editResult.reason,
      level: "warning",
    },
    {
      message: writeResult.reason,
      level: "warning",
    },
  ]);
});

test("tool call guard ignores mutation tools outside meta-pass", async () => {
  for (const activeState of [undefined, activeFixState()] as const) {
    const harness = createHarness({ activeState });

    const result = await harness.controller.handleToolCall(
      {
        type: "tool_call",
        toolName: "edit",
        toolCallId: "tool-1",
        input: { path: "src/auth.ts" },
      },
      harness.ctx,
    );

    assert.equal(result, undefined);
    assert.deepEqual(harness.notifications, []);
  }
});

test("review flow rejects overlapping launch while widget is pending", async () => {
  let releaseWidget: () => void = () => {};
  const inputWidgetDelay = new Promise<void>((resolve) => {
    releaseWidget = resolve;
  });
  const harness = createHarness({
    editorResult: "Edited review prompt",
    inputWidgetDelay,
    inputWidgetResult: {
      submitted: true,
      kind: "review",
      primaryValue: "review auth boundaries",
    },
  });

  const firstLaunch = harness.controller.handleReviewCommand("", harness.ctx);
  await Promise.resolve();

  await harness.controller.handleReviewCommand("", harness.ctx);

  assert.equal(harness.inputWidgetCalls.length, 1);
  assert.deepEqual(harness.notifications[0], {
    message:
      "Cannot start review: pi-review-code review launch is already in progress.",
    level: "error",
  });
  assert.deepEqual(harness.sentUserMessages, []);

  releaseWidget();
  await firstLaunch;

  assert.equal(harness.sentUserMessages.length, 1);
  assertStartedMetaPass(harness);
});

test("review flow prompts for target and context before launching", async () => {
  const harness = createHarness({
    editorResult: "Edited review prompt",
    inputWidgetResult: {
      submitted: true,
      kind: "review",
      primaryValue: "review auth boundaries",
      reviewContext: "Focus on token refresh races.",
    },
    target: {
      ...promptTarget(),
      reviewContext: "Focus on token refresh races.",
    },
  });

  await harness.controller.handleReviewCommand("", harness.ctx);

  assert.equal(harness.inputWidgetCalls.length, 1);
  assert.deepEqual(harness.inputWidgetCalls[0], {
    title: "Start review",
    helpText:
      "Usage:\n  /review [target or request]\n  choose review type in the widget",
  });
  assert.deepEqual(harness.resolvedTargets, [
    {
      kind: "prompt",
      prompt: "review auth boundaries",
      targetHint: "review auth boundaries",
      reviewContext: "Focus on token refresh races.",
    },
  ]);
  assert.match(
    harness.sentUserMessages[0] ?? "",
    /Focus on token refresh races\./,
  );
});

test("review flow pre-fills widget from command args", async () => {
  const harness = createHarness({
    editorResult: "Edited review prompt",
    inputWidgetResult: {
      submitted: true,
      kind: "review",
      primaryValue: "review auth boundaries",
    },
  });

  await harness.controller.handleReviewCommand(
    "review auth boundaries",
    harness.ctx,
  );

  assert.equal(
    harness.inputWidgetCalls[0]?.initialPrimaryValue,
    "review auth boundaries",
  );
  assert.deepEqual(harness.resolvedTargets, [
    {
      kind: "prompt",
      prompt: "review auth boundaries",
      targetHint: "review auth boundaries",
    },
  ]);
});

test("review flow preselects widget modes from /review args", async () => {
  const prHarness = createHarness({
    inputWidgetResult: { submitted: false },
  });

  await prHarness.controller.handleReviewCommand(
    "https://github.com/owner/repo/pull/123",
    prHarness.ctx,
  );

  assert.equal(prHarness.inputWidgetCalls[0]?.initialKind, "pr");
  assert.equal(
    prHarness.inputWidgetCalls[0]?.initialPrimaryValue,
    "https://github.com/owner/repo/pull/123",
  );

  const explicitPrHarness = createHarness({
    inputWidgetResult: { submitted: false },
  });

  await explicitPrHarness.controller.handleReviewCommand(
    "pr https://github.com/owner/repo/pull/123",
    explicitPrHarness.ctx,
  );

  assert.equal(explicitPrHarness.inputWidgetCalls[0]?.initialKind, "pr");
  assert.equal(
    explicitPrHarness.inputWidgetCalls[0]?.initialPrimaryValue,
    "https://github.com/owner/repo/pull/123",
  );

  const diffHarness = createHarness({
    inputWidgetResult: { submitted: false },
  });

  await diffHarness.controller.handleReviewCommand(
    "diff-against origin/main",
    diffHarness.ctx,
  );

  assert.equal(diffHarness.inputWidgetCalls[0]?.initialKind, "diff-against");
  assert.equal(
    diffHarness.inputWidgetCalls[0]?.initialPrimaryValue,
    "origin/main",
  );

  const refHarness = createHarness({
    inputWidgetResult: { submitted: false },
  });

  await refHarness.controller.handleReviewCommand(
    "origin/main",
    refHarness.ctx,
  );

  assert.equal(refHarness.inputWidgetCalls[0]?.initialKind, "review");
  assert.equal(
    refHarness.inputWidgetCalls[0]?.initialPrimaryValue,
    "origin/main",
  );
});

test("review flow converts widget selector modes to review targets", async () => {
  const diffHarness = createHarness({
    editorResult: "Edited diff prompt",
    inputWidgetResult: {
      submitted: true,
      kind: "diff-against",
      primaryValue: "origin/main",
      reviewContext: "Only review auth middleware changes.",
    },
  });

  await diffHarness.controller.handleReviewCommand("", diffHarness.ctx);

  assert.equal(diffHarness.inputWidgetCalls[0]?.initialKind, undefined);
  assert.deepEqual(diffHarness.resolvedTargets, [
    {
      kind: "diff-against",
      ref: "origin/main",
      targetHint: "origin/main",
      reviewContext: "Only review auth middleware changes.",
    },
  ]);

  const prHarness = createHarness({
    editorResult: "Edited PR prompt",
    inputWidgetResult: {
      submitted: true,
      kind: "pr",
      primaryValue: "123",
      reviewContext: "Regression report says logout is flaky.",
    },
  });

  await prHarness.controller.handleReviewCommand("123", prHarness.ctx);

  assert.equal(prHarness.inputWidgetCalls[0]?.initialKind, "pr");
  assert.equal(prHarness.inputWidgetCalls[0]?.initialPrimaryValue, "123");
  assert.deepEqual(prHarness.resolvedTargets, [
    {
      kind: "pr",
      selector: "123",
      targetHint: "123",
      reviewContext: "Regression report says logout is flaky.",
    },
  ]);
});

test("review flow cancels before target resolution when widget is dismissed", async () => {
  const harness = createHarness({
    inputWidgetResult: { submitted: false },
  });

  await harness.controller.handleReviewCommand(
    "review auth boundaries",
    harness.ctx,
  );

  assert.equal(harness.inputWidgetCalls.length, 1);
  assert.deepEqual(harness.resolvedTargets, []);
  assert.deepEqual(harness.sentUserMessages, []);
  assert.deepEqual(harness.notifications, [
    { message: "Review cancelled.", level: "info" },
  ]);
});

test("review flow checks active model before showing widget", async () => {
  const harness = createHarness({
    model: null,
    inputWidgetResult: {
      submitted: true,
      kind: "review",
      primaryValue: "review auth boundaries",
    },
  });

  await harness.controller.handleReviewCommand("", harness.ctx);

  assert.deepEqual(harness.inputWidgetCalls, []);
  assert.deepEqual(harness.sentUserMessages, []);
  assert.deepEqual(harness.notifications, [
    {
      message: "Cannot start review: no active model is selected.",
      level: "error",
    },
  ]);
});

test("review flow anchors an empty session before branch launch", async () => {
  const harness = createHarness({
    initialLeafId: null,
    editorResult: "Edited review prompt",
  });

  await harness.controller.handleReviewCommand(
    "review auth boundaries",
    harness.ctx,
  );

  assert.equal(harness.sentMessages[0]?.customType, REVIEW_ANCHOR_MESSAGE_TYPE);
  assert.equal(harness.sentMessages[0]?.display, false);
  assert.deepEqual(harness.sentMessages[0]?.options, { triggerTurn: false });
  assertStartedMetaPass(harness, "leaf-anchor");
});

test("review flow launches PR meta-pass after resolving PR metadata", async () => {
  const selector = "https://github.com/owner/repo/pull/123";
  const harness = createHarness({
    editorResult: "Edited PR review prompt",
    inputWidgetResult: {
      submitted: true,
      kind: "pr",
      primaryValue: selector,
    },
    target: {
      kind: "pr",
      targetHint: selector,
      selector,
      files: ["src/auth.ts"],
      commandHints: [
        {
          label: "Show PR diff",
          command: "gh",
          args: ["pr", "diff", selector],
        },
      ],
      provider: "github",
      number: 123,
      title: "Fix auth",
      body: "Tighten auth checks.",
      url: selector,
      author: "alice",
      baseRefName: "main",
      headRefName: "auth-fix",
      existingNotes: ["bob: existing concern"],
    },
  });

  await harness.controller.handleReviewCommand(selector, harness.ctx);

  assert.deepEqual(harness.resolvedTargets, [
    { kind: "pr", selector, targetHint: selector },
  ]);
  assert.match(harness.sentUserMessages[0] ?? "", /Tighten auth checks\./);
  assert.match(harness.sentUserMessages[0] ?? "", /bob: existing concern/);
  assert.match(
    JSON.stringify(harness.startedMetaRuns[0]),
    new RegExp(selector),
  );
});

test("review flow passes resolved diff text to meta prompt", async () => {
  const target: ResolvedReviewTarget = {
    kind: "diff-against",
    targetHint: "origin/main",
    ref: "origin/main",
    files: ["src/auth.ts"],
    diffStat: "1 file changed",
    diffText: "diff --git a/src/auth.ts b/src/auth.ts\n+rotateToken();",
    commandHints: [
      {
        label: "Show full diff",
        command: "git",
        args: ["--no-pager", "diff", "origin/main...HEAD"],
      },
    ],
  };
  const harness = createHarness({
    editorResult: "Edited prompt",
    inputWidgetResult: {
      submitted: true,
      kind: "diff-against",
      primaryValue: "origin/main",
    },
    target,
  });

  await harness.controller.handleReviewCommand("origin/main", harness.ctx);

  assert.match(
    harness.sentUserMessages[0] ?? "",
    /diff --git a\/src\/auth\.ts b\/src\/auth\.ts\n\+rotateToken\(\);/,
  );
});

test("review flow passes REVIEW_GUIDELINES.md content to meta prompt", async () => {
  const harness = createHarness({
    editorResult: "Edited prompt",
    reviewGuidelines: "Require tests for changed behavior.",
  });

  await harness.controller.handleReviewCommand(
    "review auth boundaries",
    harness.ctx,
  );

  assert.deepEqual(harness.reviewGuidelineReads, [1]);
  assert.match(
    harness.sentUserMessages[0] ?? "",
    /Require tests for changed behavior\./,
  );
});

test("review flow aborts when repository guidelines cannot be read", async () => {
  const harness = createHarness({
    editorResult: "Edited prompt",
    reviewGuidelinesError: new Error("REVIEW_GUIDELINES.md is too large"),
  });

  await harness.controller.handleReviewCommand(
    "review auth boundaries",
    harness.ctx,
  );

  assert.deepEqual(harness.reviewGuidelineReads, [1]);
  assert.deepEqual(harness.sentUserMessages, []);
  assert.deepEqual(harness.notifications, [
    { message: "REVIEW_GUIDELINES.md is too large", level: "error" },
  ]);
});

test("review flow cancels cleanly when editor returns undefined", async () => {
  const harness = createHarness({ editorResult: undefined });

  await harness.controller.handleReviewCommand(
    "review auth boundaries",
    harness.ctx,
  );
  await completeMetaPass(harness);

  assert.equal(harness.sentUserMessages.length, 1);
  assert.deepEqual(harness.startedRuns, []);
  assert.deepEqual(harness.notifications.at(-1), {
    message: "Review cancelled before branch launch.",
    level: "info",
  });
});

test("review flow fails closed when meta-pass omits result tool", async () => {
  const harness = createHarness();

  await harness.controller.handleReviewCommand(
    "review auth boundaries",
    harness.ctx,
  );

  const metaPrompt = harness.sentUserMessages[0] ?? "";
  await harness.controller.handleBeforeAgentStart(
    {
      type: "before_agent_start",
      prompt: metaPrompt,
      systemPrompt: "base system",
    },
    harness.ctx,
  );
  await harness.controller.handleAgentEnd(
    { messages: [{ role: "user", content: metaPrompt }] },
    { sessionManager: harness.ctx.sessionManager } as never,
  );
  await flushScheduledWork();

  assert.equal(harness.sentUserMessages.length, 1);
  assert.deepEqual(harness.startedRuns, []);
  assert.equal(harness.clearedRuns.length, 1);
  assert.deepEqual(harness.notifications.at(-1), {
    message:
      "Review prompt meta-pass meta-1 ended without set_review_prompt; review was not started.",
    level: "error",
  });
});

test("session_before_tree returns pending meta summary in Pi event shape", async () => {
  const harness = createHarness({ editorResult: "Edited review prompt" });

  await startReviewThroughMeta(harness);

  const result = await harness.controller.handleSessionBeforeTree({
    preparation: {
      label: "review-meta:meta-1",
      targetId: "leaf-origin",
      userWantsSummary: true,
    },
  } as never);

  assert.match(
    result?.summary?.summary ?? "",
    /pi-review-code review prompt meta-pass meta-1/,
  );
  assert.match(result?.summary?.summary ?? "", /Generated rich review prompt/);
  assert.equal(result?.summary?.details?.kind, "meta");
});

test("review flow clears meta state when meta collapse is cancelled", async () => {
  const harness = createHarness({
    editorResult: "Edited review prompt",
    navigateResults: [{ cancelled: true }],
  });

  await harness.controller.handleReviewCommand(
    "review auth boundaries",
    harness.ctx,
  );
  await completeMetaPass(harness);

  assert.deepEqual(harness.editorInputs, []);
  assert.deepEqual(harness.startedRuns, []);
  assert.equal(harness.clearedRuns.length, 1);
  assert.deepEqual(harness.appended, []);
  assert.deepEqual(harness.notifications.at(-1), {
    message:
      "Review prompt meta-pass meta-1 collapse cancelled; review was not started.",
    level: "error",
  });

  const summary = await harness.controller.handleSessionBeforeTree({
    preparation: {
      label: "review-meta:meta-1",
      targetId: "leaf-origin",
      userWantsSummary: true,
    },
  } as never);
  assert.equal(summary, undefined);
});

test("review flow clears meta state when meta collapse throws", async () => {
  const harness = createHarness({
    editorResult: "Edited review prompt",
    navigateResults: [new Error("tree navigation failed")],
  });

  await harness.controller.handleReviewCommand(
    "review auth boundaries",
    harness.ctx,
  );
  await completeMetaPass(harness);

  assert.deepEqual(harness.editorInputs, []);
  assert.deepEqual(harness.startedRuns, []);
  assert.equal(harness.clearedRuns.length, 1);
  assert.deepEqual(harness.appended, []);
  assert.deepEqual(harness.notifications.at(-1), {
    message:
      "Review prompt meta-pass meta-1 collapse failed: tree navigation failed",
    level: "error",
  });
});

test("review flow starts final review after completed meta-pass", async () => {
  const harness = createHarness({ editorResult: "Edited review prompt" });

  await startReviewThroughMeta(harness);

  assert.deepEqual(harness.navigateCalls, [
    {
      targetId: "leaf-origin",
      options: { summarize: true, label: "review-meta:meta-1" },
    },
  ]);
  assert.deepEqual(harness.editorInputs, [
    {
      title: "Edit review prompt",
      initialValue: "Generated rich review prompt",
    },
  ]);
  assert.deepEqual(harness.sentUserMessages.slice(1), ["Edited review prompt"]);
  assert.deepEqual(harness.startedRuns, [
    {
      runId: "review-1",
      originLeafId: "leaf-origin",
      targetHint: "review auth boundaries",
      reviewPrompt: "Edited review prompt",
      originModelProvider: "anthropic",
      originModelId: "claude-sonnet",
      originThinkingLevel: "high",
    },
  ]);
});

test("review flow clears partial review state when handoff send fails", async () => {
  const harness = createHarness({
    editorResult: "Edited review prompt",
    sendUserMessageErrorAt: 2,
  });

  await startReviewThroughMeta(harness);

  assert.equal(harness.sentUserMessages.length, 1);
  assert.match(harness.sentUserMessages[0] ?? "", /Review prompt meta-pass/);
  assert.equal(harness.startedRuns.length, 1);
  assert.equal(harness.clearedRuns.length, 2);
  assert.deepEqual(harness.notifications.at(-1), {
    message: "Review prompt handoff failed after meta-pass meta-1: send failed",
    level: "error",
  });
});

test("review flow rejects non-interactive command contexts", async () => {
  const harness = createHarness({ hasUI: false });

  await harness.controller.handleReviewCommand(
    "review auth boundaries",
    harness.ctx,
  );

  assert.deepEqual(harness.sentUserMessages, []);
  assert.deepEqual(harness.notifications, []);
  assert.deepEqual(harness.startedRuns, []);
});

test("review flow requires active model", async () => {
  const harness = createHarness({ model: null });

  await harness.controller.handleReviewCommand(
    "review auth boundaries",
    harness.ctx,
  );

  assert.deepEqual(harness.sentUserMessages, []);
  assert.deepEqual(harness.notifications, [
    {
      message: "Cannot start review: no active model is selected.",
      level: "error",
    },
  ]);
});

test("review flow emits custom prompt and summary messages for renderers", async () => {
  const harness = createHarness({ editorResult: "Edited review prompt" });

  await startReviewThroughMeta(harness);

  assert.equal(harness.sentMessages.length, 3);
  assert.equal(
    harness.sentMessages[0]?.customType,
    REVIEW_META_PROMPT_ENTRY_TYPE,
  );
  assert.equal(
    harness.sentMessages[0]?.content,
    "Review prompt meta-pass meta-1",
  );
  assert.equal(
    harness.sentMessages[1]?.customType,
    REVIEW_META_SUMMARY_ENTRY_TYPE,
  );
  assert.equal(harness.sentMessages[1]?.content, "Review prompt ready meta-1.");
  assert.equal(harness.sentMessages[2]?.customType, REVIEW_PROMPT_ENTRY_TYPE);
  assert.equal(harness.sentMessages[2]?.content, "Review prompt review-1");
  assert.equal(harness.sentMessages[2]?.display, true);
  assert.deepEqual(harness.sentMessages[2]?.details, {
    kind: "prompt",
    mode: "review",
    runId: "review-1",
    targetHint: "review auth boundaries",
    reviewPrompt: "Edited review prompt",
    originModelProvider: "anthropic",
    originModelId: "claude-sonnet",
    originThinkingLevel: "high",
  });

  await harness.controller.handleAgentEnd(harness.reviewAgentEndEvent, {
    sessionManager: harness.ctx.sessionManager,
  } as never);

  assert.equal(harness.sentMessages.length, 4);
  assert.equal(harness.sentMessages[3]?.customType, REVIEW_SUMMARY_ENTRY_TYPE);
  assert.equal(
    harness.sentMessages[3]?.content,
    "Review findings review-1 completed with 1 finding.",
  );
  assert.equal(harness.sentMessages[3]?.display, true);
  assert.match(
    JSON.stringify(harness.sentMessages[3]?.details),
    /Token refresh can race/,
  );
});

test("review flow collapses active branch on agent end with custom summary", async () => {
  const harness = createHarness({ editorResult: "Edited review prompt" });

  await startReviewThroughMeta(harness);
  resetCollapseArtifacts(harness);
  await harness.controller.handleAgentEnd(harness.reviewAgentEndEvent, {
    sessionManager: harness.ctx.sessionManager,
  } as never);

  assert.deepEqual(harness.navigateCalls, [
    {
      targetId: "leaf-origin",
      options: { summarize: true, label: "review:review-1" },
    },
  ]);
  assert.deepEqual(harness.clearedRuns, [harness.ctx]);
  assert.equal(harness.appended.length, 1);
  assert.equal(harness.appended[0]?.customType, REVIEW_SUMMARY_ENTRY_TYPE);
  assert.match(
    JSON.stringify(harness.appended[0]?.data),
    /Token refresh can race/,
  );
});

test("review flow ignores unrelated agent_end events", async () => {
  const harness = createHarness({ editorResult: "Edited review prompt" });

  await startReviewThroughMeta(harness);
  resetCollapseArtifacts(harness);
  await harness.controller.handleAgentEnd(
    { messages: [{ role: "user", content: "Unrelated prompt" }] },
    { sessionManager: harness.ctx.sessionManager } as never,
  );

  assert.deepEqual(harness.navigateCalls, []);
  assert.deepEqual(harness.clearedRuns, []);
  assert.deepEqual(harness.appended, []);

  await harness.controller.handleAgentEnd(harness.reviewAgentEndEvent, {
    sessionManager: harness.ctx.sessionManager,
  } as never);

  assert.equal(harness.navigateCalls.length, 1);
  assert.equal(harness.clearedRuns.length, 1);
});

test("review flow keeps active state when collapse is cancelled", async () => {
  const harness = createHarness({
    editorResult: "Edited review prompt",
    navigateResults: [
      { cancelled: false },
      { cancelled: true },
      { cancelled: false },
    ],
  });

  await startReviewThroughMeta(harness);
  resetCollapseArtifacts(harness);
  await harness.controller.handleAgentEnd(harness.reviewAgentEndEvent, {
    sessionManager: harness.ctx.sessionManager,
  } as never);

  assert.equal(harness.navigateCalls.length, 1);
  assert.deepEqual(harness.clearedRuns, []);
  assert.deepEqual(harness.appended, []);

  await harness.controller.handleAgentEnd(harness.reviewAgentEndEvent, {
    sessionManager: harness.ctx.sessionManager,
  } as never);

  assert.equal(harness.navigateCalls.length, 2);
  assert.equal(harness.clearedRuns.length, 1);
  assert.equal(harness.appended.length, 1);
});

test("review flow keeps active state when collapse throws", async () => {
  const harness = createHarness({
    editorResult: "Edited review prompt",
    navigateResults: [
      { cancelled: false },
      new Error("tree navigation failed"),
      { cancelled: false },
    ],
  });

  await startReviewThroughMeta(harness);
  resetCollapseArtifacts(harness);
  await harness.controller.handleAgentEnd(harness.reviewAgentEndEvent, {
    sessionManager: harness.ctx.sessionManager,
  } as never);

  assert.equal(harness.navigateCalls.length, 1);
  assert.deepEqual(harness.clearedRuns, []);
  assert.deepEqual(harness.appended, []);

  await harness.controller.handleAgentEnd(harness.reviewAgentEndEvent, {
    sessionManager: harness.ctx.sessionManager,
  } as never);

  assert.equal(harness.navigateCalls.length, 2);
  assert.equal(harness.clearedRuns.length, 1);
  assert.equal(harness.appended.length, 1);
});

test("session_before_tree returns pending review summary in Pi event shape", async () => {
  const harness = createHarness({ editorResult: "Edited review prompt" });

  await startReviewThroughMeta(harness);
  resetCollapseArtifacts(harness);
  await harness.controller.handleAgentEnd(harness.reviewAgentEndEvent, {
    sessionManager: harness.ctx.sessionManager,
  } as never);

  const result = await harness.controller.handleSessionBeforeTree({
    preparation: {
      label: "review:review-1",
      targetId: "leaf-origin",
      userWantsSummary: true,
    },
  } as never);

  assert.match(
    result?.summary?.summary ?? "",
    /pi-review-code review review-1/,
  );
  assert.match(result?.summary?.summary ?? "", /Token refresh can race/);
  assert.equal(result?.summary?.details?.kind, "review");
});

test("session_before_tree ignores review summary for mismatched target", async () => {
  const harness = createHarness({ editorResult: "Edited review prompt" });

  await startReviewThroughMeta(harness);
  resetCollapseArtifacts(harness);
  await harness.controller.handleAgentEnd(harness.reviewAgentEndEvent, {
    sessionManager: harness.ctx.sessionManager,
  } as never);

  const wrongTarget = await harness.controller.handleSessionBeforeTree({
    preparation: {
      label: "review:review-1",
      targetId: "unrelated-leaf",
      userWantsSummary: true,
    },
  } as never);

  assert.equal(wrongTarget, undefined);

  const rightTarget = await harness.controller.handleSessionBeforeTree({
    preparation: {
      label: "review:review-1",
      targetId: "leaf-origin",
      userWantsSummary: true,
    },
  } as never);

  assert.match(
    rightTarget?.summary?.summary ?? "",
    /pi-review-code review review-1/,
  );
});

test("review branch summary formats findings with references", () => {
  const summary = buildReviewBranchSummary({
    runId: "review-1",
    targetHint: "review auth boundaries",
    reviewPrompt: "Edited review prompt",
    comments: [comment()],
    completedAt: 456,
  });

  assert.match(summary.summary, /pi-review-code review review-1/);
  assert.match(summary.summary, /P1 comment-1/);
  assert.match(summary.summary, /src\/auth\.ts:42-45/);
  assert.equal(summary.details.kind, "review");
  assert.equal(summary.details.comments.length, 1);
});
