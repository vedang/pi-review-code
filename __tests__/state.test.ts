import assert from "node:assert/strict";
import test from "node:test";

import {
  REVIEW_STATE_ENTRY_TYPE,
  createInactiveReviewState,
  createReviewStateManager,
  getLatestReviewState,
} from "../src/state";

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

test("review state manager persists review run and enables comment tool", () => {
  let activeTools = ["read", "bash"];
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

  manager.startReviewRun({ hasUI: false } as never, {
    originLeafId: "leaf-1",
    runId: "run-1",
    targetHint: "origin/main",
    reviewPrompt: "Review diff",
    originModelProvider: "anthropic",
    originModelId: "claude-sonnet",
    originThinkingLevel: "high",
  });

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

test("review state manager persists fix run and disables comment tool", () => {
  let activeTools = ["read", "add_review_comment", "bash"];
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

  manager.startFixRun({ hasUI: false } as never, {
    originLeafId: "leaf-2",
    runId: "fix-1",
    targetHint: "origin/main",
    reviewPrompt: "Fix review comments",
    originModelProvider: "anthropic",
    originModelId: "claude-sonnet",
    originThinkingLevel: "medium",
    sourceReviewRunId: "review-1",
    commentIds: ["comment-1", "comment-2"],
  });

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
  });
});

test("review state manager clears active run and disables comment tool", () => {
  let activeTools = ["read", "add_review_comment", "bash"];
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
  let activeTools = ["read", "add_review_comment"];
  const setActiveToolsCalls: string[][] = [];
  const manager = createReviewStateManager({
    appendEntry: () => {},
    getActiveTools: () => activeTools,
    setActiveTools: (nextTools: string[]) => {
      setActiveToolsCalls.push(nextTools);
      activeTools = nextTools;
    },
  } as never);

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
