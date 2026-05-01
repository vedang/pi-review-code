import {
  REVIEW_STATE_ENTRY_TYPE,
  REVIEW_STATE_VERSION,
  type ReviewActiveRunInfo,
  type ReviewActiveState,
  type ReviewInactiveState,
  type ReviewState,
  type ReviewStateStart,
} from "./types";

export { REVIEW_STATE_ENTRY_TYPE };

const ADD_REVIEW_COMMENT_TOOL_NAME = "add_review_comment";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasString(value: Record<string, unknown>, key: string): boolean {
  const raw = value[key];
  return typeof raw === "string" && raw.length > 0;
}

function readStateData(raw: unknown): ReviewState | undefined {
  if (!isRecord(raw) || raw.version !== REVIEW_STATE_VERSION) {
    return undefined;
  }

  if (raw.activeKind === null) {
    return { version: REVIEW_STATE_VERSION, activeKind: null };
  }

  if (raw.activeKind !== "review") {
    return undefined;
  }

  if (
    hasString(raw, "runId") &&
    hasString(raw, "originLeafId") &&
    hasString(raw, "targetHint") &&
    hasString(raw, "reviewPrompt") &&
    hasString(raw, "originModelProvider") &&
    hasString(raw, "originModelId") &&
    hasString(raw, "originThinkingLevel")
  ) {
    return {
      version: REVIEW_STATE_VERSION,
      activeKind: "review",
      runId: String(raw.runId),
      originLeafId: String(raw.originLeafId),
      targetHint: String(raw.targetHint),
      reviewPrompt: String(raw.reviewPrompt),
      originModelProvider: String(raw.originModelProvider),
      originModelId: String(raw.originModelId),
      originThinkingLevel: String(raw.originThinkingLevel),
    };
  }

  return undefined;
}

export function createInactiveReviewState(): ReviewInactiveState {
  return {
    version: REVIEW_STATE_VERSION,
    activeKind: null,
  };
}

export function getLatestReviewState(context: {
  sessionManager: {
    getEntries: () => unknown[];
  };
}): ReviewState {
  const entries = context.sessionManager.getEntries();
  if (!Array.isArray(entries) || entries.length === 0) {
    return createInactiveReviewState();
  }

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!isRecord(entry)) {
      continue;
    }

    if (
      entry.type !== "custom" ||
      entry.customType !== REVIEW_STATE_ENTRY_TYPE
    ) {
      continue;
    }

    const state = readStateData(entry.data);
    if (state !== undefined) {
      return state;
    }
  }

  return createInactiveReviewState();
}

export type ReviewStateRuntime = {
  appendEntry: (customType: string, data?: unknown) => void;
  getActiveTools: () => string[];
  setActiveTools: (toolNames: string[]) => void;
};

export type ReviewStateManager = {
  getState: () => ReviewState;
  startReviewRun: (ctx: { hasUI: boolean }, state: ReviewStateStart) => void;
  clearActiveRun: (ctx: { hasUI: boolean }) => void;
  refresh: (ctx: {
    hasUI: boolean;
    sessionManager: {
      getEntries: () => unknown[];
    };
  }) => void;
};

function toReviewStateValue(
  value: ReviewStateStart | ReviewActiveRunInfo,
): ReviewActiveState {
  return {
    version: REVIEW_STATE_VERSION,
    activeKind: "review",
    runId: value.runId,
    originLeafId: value.originLeafId,
    targetHint: value.targetHint,
    reviewPrompt: value.reviewPrompt,
    originModelProvider: value.originModelProvider,
    originModelId: value.originModelId,
    originThinkingLevel: value.originThinkingLevel,
  };
}

function computeActiveTools(
  activeTools: string[],
  state: ReviewState,
): string[] {
  const filteredTools = activeTools.filter(
    (toolName) => toolName !== ADD_REVIEW_COMMENT_TOOL_NAME,
  );

  if (state.activeKind !== "review") {
    return filteredTools;
  }

  return [...filteredTools, ADD_REVIEW_COMMENT_TOOL_NAME];
}

export function createReviewStateManager(
  runtime: ReviewStateRuntime,
): ReviewStateManager {
  let state: ReviewState = createInactiveReviewState();

  function syncTools(nextState: ReviewState): void {
    const currentTools = runtime.getActiveTools();
    const desiredTools = computeActiveTools(currentTools, nextState);
    runtime.setActiveTools(desiredTools);
  }

  return {
    getState(): ReviewState {
      return state;
    },
    startReviewRun(_ctx: { hasUI: boolean }, nextRun: ReviewStateStart): void {
      state = toReviewStateValue(nextRun);
      runtime.appendEntry(REVIEW_STATE_ENTRY_TYPE, state);
      syncTools(state);
    },
    clearActiveRun(_ctx: { hasUI: boolean }): void {
      state = createInactiveReviewState();
      runtime.appendEntry(REVIEW_STATE_ENTRY_TYPE, state);
      syncTools(state);
    },
    refresh(ctx: {
      hasUI: boolean;
      sessionManager: {
        getEntries: () => unknown[];
      };
    }): void {
      state = getLatestReviewState({
        sessionManager: {
          getEntries: () => ctx.sessionManager.getEntries(),
        },
      });
      syncTools(state);
    },
  };
}
