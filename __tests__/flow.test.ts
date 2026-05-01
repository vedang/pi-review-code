import assert from "node:assert/strict";
import test from "node:test";

import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

import {
  REVIEW_SUMMARY_ENTRY_TYPE,
  buildReviewBranchSummary,
  createReviewFlowController,
} from "../src/flow";
import type { ResolvedReviewTarget, ReviewComment } from "../src/types";

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
};

function createHarness(options: HarnessOptions = {}) {
  const notifications: Array<{ message: string; level: string }> = [];
  const sentUserMessages: string[] = [];
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

  const target = promptTarget();
  const draftOk = options.draftOk ?? true;
  const navigateResults = [...(options.navigateResults ?? [])];

  const controller = createReviewFlowController({
    pi: {
      sendUserMessage: (message: string) => {
        sentUserMessages.push(message);
      },
      appendEntry: (customType: string, data: unknown) => {
        appended.push({ customType, data });
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
    buildDraftRequest: (resolvedTarget) => {
      draftRequests.push(resolvedTarget);
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
      getLeafId: () => "leaf-origin",
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
    appended,
    navigateCalls,
    startedRuns,
    clearedRuns,
    editorInputs,
    resolvedTargets,
    draftRequests,
  };
}

test("review flow launches branch after human submits generated prompt", async () => {
  const harness = createHarness({ editorResult: "Edited review prompt" });

  await harness.controller.handleReviewCommand(
    "prompt review auth boundaries",
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

test("review flow cancels cleanly when editor returns undefined", async () => {
  const harness = createHarness({ editorResult: undefined });

  await harness.controller.handleReviewCommand(
    "prompt review auth boundaries",
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
    "prompt review auth boundaries",
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
    "prompt review auth boundaries",
    harness.ctx,
  );

  assert.deepEqual(harness.sentUserMessages, []);
  assert.deepEqual(harness.notifications, []);
  assert.deepEqual(harness.startedRuns, []);
});

test("review flow requires active model", async () => {
  const harness = createHarness({ model: null });

  await harness.controller.handleReviewCommand(
    "prompt review auth boundaries",
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

test("review flow collapses active branch on agent end with custom summary", async () => {
  const harness = createHarness({ editorResult: "Edited review prompt" });

  await harness.controller.handleReviewCommand(
    "prompt review auth boundaries",
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
    "prompt review auth boundaries",
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
    "prompt review auth boundaries",
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
    "prompt review auth boundaries",
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
    "prompt review auth boundaries",
    harness.ctx,
  );
  await harness.controller.handleAgentEnd(harness.reviewAgentEndEvent, {
    sessionManager: harness.ctx.sessionManager,
  } as never);

  const result = await harness.controller.handleSessionBeforeTree({
    preparation: {
      label: "review:review-1",
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
