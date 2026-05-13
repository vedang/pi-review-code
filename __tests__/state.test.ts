import assert from "node:assert/strict";
import test from "node:test";

import {
  REVIEW_STATE_ENTRY_TYPE,
  createInactiveReviewState,
  createReviewStateManager,
  getLatestReviewState,
} from "../src/state.js";

function createStateManagerHarness(initialTools: string[]) {
  let activeTools = [...initialTools];
  const setActiveToolsCalls: string[][] = [];
  const appended: Array<{ customType: string; data: unknown }> = [];
  const manager = createReviewStateManager({
    appendEntry: (customType: string, data: unknown) =>
      appended.push({ customType, data }),
    getActiveTools: () => activeTools,
    setActiveTools: (nextTools: string[]) => {
      setActiveToolsCalls.push(nextTools);
      activeTools = nextTools;
    },
  } as never);

  return { manager, setActiveToolsCalls, appended };
}

function metaRunStart() {
  return {
    originLeafId: "leaf-meta",
    runId: "meta-1",
    targetHint: "origin/main",
    metaPrompt: "Create review prompt",
    originModelProvider: "anthropic",
    originModelId: "claude-sonnet",
    originThinkingLevel: "high",
  };
}

function reviewRunStart() {
  return {
    originLeafId: "leaf-1",
    runId: "run-1",
    targetHint: "origin/main",
    reviewPrompt: "Review diff",
    originModelProvider: "anthropic",
    originModelId: "claude-sonnet",
    originThinkingLevel: "high",
  };
}

function fixRunStart(
  overrides: Partial<ReturnType<typeof baseFixRunStart>> = {},
) {
  return { ...baseFixRunStart(), ...overrides };
}

function baseFixRunStart() {
  return {
    originLeafId: "leaf-2",
    runId: "fix-1",
    targetHint: "origin/main",
    reviewPrompt: "Fix review comments",
    originModelProvider: "anthropic",
    originModelId: "claude-sonnet",
    originThinkingLevel: "medium",
    sourceReviewRunId: "review-1",
    commentIds: ["comment-1", "comment-2"],
    fixContext: "Focus the auth edge case.",
  };
}

test("createInactiveReviewState returns versioned inactive state", () => {
  assert.deepEqual(createInactiveReviewState(), {
    version: 1,
    activeKind: null,
  });
});

test("getLatestReviewState returns inactive state by default", () => {
  const state = getLatestReviewState({
    sessionManager: { getEntries: () => [] },
  } as never);

  assert.deepEqual(state, { version: 1, activeKind: null });
});

test("getLatestReviewState prefers latest valid persisted state", () => {
  const state = getLatestReviewState({
    sessionManager: {
      getEntries: () => [
        {
          type: "custom",
          customType: REVIEW_STATE_ENTRY_TYPE,
          data: { nope: true },
        },
        {
          type: "custom",
          customType: REVIEW_STATE_ENTRY_TYPE,
          data: {
            version: 1,
            activeKind: "review",
            runId: "run-1",
            targetHint: "origin/main",
            reviewPrompt: "Review diff",
          },
        },
        {
          type: "custom",
          customType: REVIEW_STATE_ENTRY_TYPE,
          data: { version: 1, activeKind: null },
        },
      ],
    },
  } as never);

  assert.deepEqual(state, { version: 1, activeKind: null });
});

test("getLatestReviewState reconstructs persisted meta state", () => {
  const state = getLatestReviewState({
    sessionManager: {
      getEntries: () => [
        {
          type: "custom",
          customType: REVIEW_STATE_ENTRY_TYPE,
          data: {
            version: 1,
            activeKind: "meta",
            originLeafId: "leaf-meta",
            runId: "meta-1",
            targetHint: "origin/main",
            metaPrompt: "Create review prompt",
            originModelProvider: "anthropic",
            originModelId: "claude-sonnet",
            originThinkingLevel: "high",
          },
        },
      ],
    },
  } as never);

  assert.deepEqual(state, {
    version: 1,
    activeKind: "meta",
    originLeafId: "leaf-meta",
    runId: "meta-1",
    targetHint: "origin/main",
    metaPrompt: "Create review prompt",
    originModelProvider: "anthropic",
    originModelId: "claude-sonnet",
    originThinkingLevel: "high",
  });
});

test("review state manager persists meta run and enables prompt tool", () => {
  const { manager, setActiveToolsCalls, appended } = createStateManagerHarness([
    "read",
    "set_review_prompt",
    "add_review_comment",
    "bash",
  ]);

  manager.startMetaRun({ hasUI: false } as never, metaRunStart());

  assert.deepEqual(setActiveToolsCalls, [
    ["read", "bash", "set_review_prompt"],
  ]);
  assert.deepEqual(appended, [
    {
      customType: REVIEW_STATE_ENTRY_TYPE,
      data: {
        version: 1,
        activeKind: "meta",
        originLeafId: "leaf-meta",
        runId: "meta-1",
        targetHint: "origin/main",
        metaPrompt: "Create review prompt",
        originModelProvider: "anthropic",
        originModelId: "claude-sonnet",
        originThinkingLevel: "high",
      },
    },
  ]);
  assert.deepEqual(manager.getState(), appended[0]?.data);
});

test("review state manager persists review run and enables comment tool", () => {
  const { manager, setActiveToolsCalls, appended } = createStateManagerHarness([
    "read",
    "set_review_prompt",
    "bash",
  ]);

  manager.startReviewRun({ hasUI: false } as never, reviewRunStart());

  assert.deepEqual(setActiveToolsCalls, [
    ["read", "bash", "add_review_comment"],
  ]);
  assert.deepEqual(appended, [
    {
      customType: REVIEW_STATE_ENTRY_TYPE,
      data: {
        version: 1,
        activeKind: "review",
        originLeafId: "leaf-1",
        runId: "run-1",
        targetHint: "origin/main",
        reviewPrompt: "Review diff",
        originModelProvider: "anthropic",
        originModelId: "claude-sonnet",
        originThinkingLevel: "high",
      },
    },
  ]);
});

test("review state manager does not drop built-in tools while swapping review tools", () => {
  const { manager, setActiveToolsCalls } = createStateManagerHarness([
    "read",
    "edit",
    "write",
    "set_review_prompt",
  ]);

  manager.startReviewRun({ hasUI: false } as never, {
    ...reviewRunStart(),
    runId: "review-1",
  });
  manager.clearActiveRun({ hasUI: false } as never);

  assert.deepEqual(setActiveToolsCalls, [
    ["read", "edit", "write", "add_review_comment"],
    ["read", "edit", "write"],
  ]);
});

test("review state manager persists fix run and disables review tools", () => {
  const { manager, setActiveToolsCalls, appended } = createStateManagerHarness([
    "read",
    "set_review_prompt",
    "add_review_comment",
    "bash",
  ]);

  manager.startFixRun({ hasUI: false } as never, fixRunStart());

  assert.deepEqual(setActiveToolsCalls, [["read", "bash"]]);
  assert.deepEqual(appended, [
    {
      customType: REVIEW_STATE_ENTRY_TYPE,
      data: {
        version: 1,
        activeKind: "fix",
        originLeafId: "leaf-2",
        runId: "fix-1",
        targetHint: "origin/main",
        reviewPrompt: "Fix review comments",
        originModelProvider: "anthropic",
        originModelId: "claude-sonnet",
        originThinkingLevel: "medium",
        sourceReviewRunId: "review-1",
        commentIds: ["comment-1", "comment-2"],
        fixContext: "Focus the auth edge case.",
      },
    },
  ]);
  assert.deepEqual(manager.getState(), appended[0]?.data);
});

test("getLatestReviewState reconstructs persisted fix state", () => {
  const state = getLatestReviewState({
    sessionManager: {
      getEntries: () => [
        {
          type: "custom",
          customType: REVIEW_STATE_ENTRY_TYPE,
          data: {
            version: 1,
            activeKind: "fix",
            originLeafId: "leaf-2",
            runId: "fix-1",
            targetHint: "origin/main",
            reviewPrompt: "Fix review comments",
            originModelProvider: "anthropic",
            originModelId: "claude-sonnet",
            originThinkingLevel: "medium",
            sourceReviewRunId: "review-1",
            commentIds: ["comment-1"],
            fixContext: "Use minimal changes.",
          },
        },
      ],
    },
  } as never);

  assert.deepEqual(state, {
    version: 1,
    activeKind: "fix",
    originLeafId: "leaf-2",
    runId: "fix-1",
    targetHint: "origin/main",
    reviewPrompt: "Fix review comments",
    originModelProvider: "anthropic",
    originModelId: "claude-sonnet",
    originThinkingLevel: "medium",
    sourceReviewRunId: "review-1",
    commentIds: ["comment-1"],
    fixContext: "Use minimal changes.",
  });
});

test("review state manager omits blank fix context", () => {
  const { manager, appended } = createStateManagerHarness(["read"]);

  manager.startFixRun(
    { hasUI: false } as never,
    fixRunStart({ commentIds: ["comment-1"], fixContext: "  \n\t  " }),
  );

  assert.deepEqual(appended[0]?.data, {
    version: 1,
    activeKind: "fix",
    originLeafId: "leaf-2",
    runId: "fix-1",
    targetHint: "origin/main",
    reviewPrompt: "Fix review comments",
    originModelProvider: "anthropic",
    originModelId: "claude-sonnet",
    originThinkingLevel: "medium",
    sourceReviewRunId: "review-1",
    commentIds: ["comment-1"],
  });
});

test("review state manager clears active run and disables review tools", () => {
  const { manager, setActiveToolsCalls, appended } = createStateManagerHarness([
    "read",
    "set_review_prompt",
    "add_review_comment",
    "bash",
  ]);

  manager.clearActiveRun({ hasUI: false } as never);

  assert.deepEqual(setActiveToolsCalls, [["read", "bash"]]);
  assert.deepEqual(appended, [
    {
      customType: REVIEW_STATE_ENTRY_TYPE,
      data: { version: 1, activeKind: null },
    },
  ]);
});

test("review state manager refreshes persisted inactive state", () => {
  const { manager, setActiveToolsCalls } = createStateManagerHarness([
    "read",
    "set_review_prompt",
    "add_review_comment",
  ]);

  manager.refresh({
    hasUI: false,
    sessionManager: {
      getEntries: () => [
        {
          type: "custom",
          customType: REVIEW_STATE_ENTRY_TYPE,
          data: { version: 1, activeKind: null },
        },
      ],
    },
  } as never);

  assert.deepEqual(setActiveToolsCalls, [["read"]]);
  assert.deepEqual(manager.getState(), { version: 1, activeKind: null });
});
