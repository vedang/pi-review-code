import assert from "node:assert/strict";
import test from "node:test";

import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

import {
  REVIEW_ANCHOR_MESSAGE_TYPE,
  REVIEW_PROMPT_ENTRY_TYPE,
  REVIEW_SUMMARY_ENTRY_TYPE,
  buildReviewBranchSummary,
  createReviewFlowController,
} from "../src/flow.js";
import type { ResolvedReviewTarget, ReviewComment } from "../src/types.js";

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

type HarnessOptions = {
  hasUI?: boolean;
  model?: { provider: string; id: string } | null;
  editorResult?: string | undefined;
  draftOk?: boolean;
  navigateResults?: Array<{ cancelled: boolean } | Error>;
  target?: ResolvedReviewTarget;
  initialLeafId?: string | null;
  anchorLeafId?: string;
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
  const clearedRuns: unknown[] = [];
  const editorInputs: Array<{ title: string; initialValue: string }> = [];
  const resolvedTargets: unknown[] = [];
  const draftRequests: unknown[] = [];
  const draftOptions: unknown[] = [];

  const target = options.target ?? promptTarget();
  const draftOk = options.draftOk ?? true;
  const navigateResults = [...(options.navigateResults ?? [])];
  const anchorLeafId = options.anchorLeafId ?? "leaf-anchor";
  let leafId =
    options.initialLeafId === undefined ? "leaf-origin" : options.initialLeafId;

  const controller = createReviewFlowController({
    pi: {
      sendUserMessage: (message: string) => {
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
      startReviewRun: (_ctx: unknown, state: unknown) => {
        startedRuns.push(state);
      },
      clearActiveRun: (ctx: unknown) => {
        clearedRuns.push(ctx);
      },
    },
    resolveTarget: async (reviewTarget) => {
      resolvedTargets.push(reviewTarget);
      return target;
    },
    buildDraftRequest: (resolvedTarget, options) => {
      draftRequests.push(resolvedTarget);
      draftOptions.push(options);
      return { systemPrompt: "system", userPrompt: "packet" };
    },
    generateDraft: async (request) => {
      assert.deepEqual(request, {
        systemPrompt: "system",
        userPrompt: "packet",
      });
      return draftOk
        ? { ok: true, draft: "Generated review prompt" }
        : { ok: false, error: "LLM unavailable" };
    },
    getCommentsForRun: () => [comment()],
    createRunId: () => "review-1",
    getNow: () => 456,
    getThinkingLevel: () => "high",
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
    clearedRuns,
    editorInputs,
    resolvedTargets,
    draftRequests,
    draftOptions,
  };
}

test("review flow launches branch after human submits generated prompt", async () => {
  const harness = createHarness({ editorResult: "Edited review prompt" });

  await harness.controller.handleReviewCommand(
    "review auth boundaries",
    harness.ctx,
  );

  assert.deepEqual(harness.notifications, [
    { message: "Generating review prompt draft…", level: "info" },
    { message: "Review branch started: review-1", level: "info" },
  ]);
  assert.equal(harness.editorInputs.length, 1);
  assert.deepEqual(harness.editorInputs[0], {
    title: "Edit review prompt",
    initialValue: "Generated review prompt",
  });
  assert.deepEqual(harness.sentUserMessages, ["Edited review prompt"]);
  assert.deepEqual(harness.resolvedTargets, [
    {
      kind: "prompt",
      prompt: "review auth boundaries",
      targetHint: "review auth boundaries",
    },
  ]);
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
  assert.equal(harness.draftRequests.length, 1);
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
  assert.deepEqual(harness.sentUserMessages, ["Edited review prompt"]);
  assert.deepEqual(harness.startedRuns, [
    {
      runId: "review-1",
      originLeafId: "leaf-anchor",
      targetHint: "review auth boundaries",
      reviewPrompt: "Edited review prompt",
      originModelProvider: "anthropic",
      originModelId: "claude-sonnet",
      originThinkingLevel: "high",
    },
  ]);
});

test("review flow launches PR review after resolving PR metadata", async () => {
  const selector = "https://github.com/owner/repo/pull/123";
  const harness = createHarness({
    editorResult: "Edited PR review prompt",
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

  await harness.controller.handleReviewPrCommand(selector, harness.ctx);

  assert.deepEqual(harness.resolvedTargets, [
    { kind: "pr", selector, targetHint: selector },
  ]);
  assert.deepEqual(harness.draftRequests, [
    {
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
  ]);
  assert.deepEqual(harness.sentUserMessages, ["Edited PR review prompt"]);
  assert.deepEqual(harness.startedRuns, [
    {
      runId: "review-1",
      originLeafId: "leaf-origin",
      targetHint: selector,
      reviewPrompt: "Edited PR review prompt",
      originModelProvider: "anthropic",
      originModelId: "claude-sonnet",
      originThinkingLevel: "high",
    },
  ]);
});

test("review flow passes resolved diff text to prompt draft builder", async () => {
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
        args: ["--no-pager", "diff", "origin/main"],
      },
    ],
  };
  const harness = createHarness({ editorResult: "Edited prompt", target });

  await harness.controller.handleReviewDiffAgainstCommand(
    "origin/main",
    harness.ctx,
  );

  assert.deepEqual(harness.draftRequests, [target]);
  assert.deepEqual(harness.draftOptions, [
    { diffText: "diff --git a/src/auth.ts b/src/auth.ts\n+rotateToken();" },
  ]);
});

test("review flow cancels cleanly when editor returns undefined", async () => {
  const harness = createHarness({ editorResult: undefined });

  await harness.controller.handleReviewCommand(
    "review auth boundaries",
    harness.ctx,
  );

  assert.deepEqual(harness.sentUserMessages, []);
  assert.deepEqual(harness.startedRuns, []);
  assert.deepEqual(harness.notifications.at(-1), {
    message: "Review cancelled before branch launch.",
    level: "info",
  });
});

test("review flow fails closed when LLM draft generation fails", async () => {
  const harness = createHarness({ draftOk: false });

  await harness.controller.handleReviewCommand(
    "review auth boundaries",
    harness.ctx,
  );

  assert.deepEqual(harness.sentUserMessages, []);
  assert.deepEqual(harness.startedRuns, []);
  assert.deepEqual(harness.notifications.at(-1), {
    message: "LLM unavailable",
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

  await harness.controller.handleReviewCommand(
    "review auth boundaries",
    harness.ctx,
  );

  assert.equal(harness.sentMessages.length, 1);
  assert.equal(harness.sentMessages[0]?.customType, REVIEW_PROMPT_ENTRY_TYPE);
  assert.equal(harness.sentMessages[0]?.content, "Review prompt review-1");
  assert.equal(harness.sentMessages[0]?.display, true);
  assert.deepEqual(harness.sentMessages[0]?.details, {
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

  assert.equal(harness.sentMessages.length, 2);
  assert.equal(harness.sentMessages[1]?.customType, REVIEW_SUMMARY_ENTRY_TYPE);
  assert.equal(harness.sentMessages[1]?.display, true);
  assert.match(
    JSON.stringify(harness.sentMessages[1]?.details),
    /Token refresh can race/,
  );
});

test("review flow collapses active branch on agent end with custom summary", async () => {
  const harness = createHarness({ editorResult: "Edited review prompt" });

  await harness.controller.handleReviewCommand(
    "review auth boundaries",
    harness.ctx,
  );
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

  await harness.controller.handleReviewCommand(
    "review auth boundaries",
    harness.ctx,
  );
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
    navigateResults: [{ cancelled: true }, { cancelled: false }],
  });

  await harness.controller.handleReviewCommand(
    "review auth boundaries",
    harness.ctx,
  );
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
      new Error("tree navigation failed"),
      { cancelled: false },
    ],
  });

  await harness.controller.handleReviewCommand(
    "review auth boundaries",
    harness.ctx,
  );
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

  await harness.controller.handleReviewCommand(
    "review auth boundaries",
    harness.ctx,
  );
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

  await harness.controller.handleReviewCommand(
    "review auth boundaries",
    harness.ctx,
  );
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
