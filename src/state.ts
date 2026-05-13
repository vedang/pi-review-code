import { SET_REVIEW_PROMPT_TOOL_NAME } from "./meta-result.js";
import {
  REVIEW_STATE_ENTRY_TYPE,
  REVIEW_STATE_VERSION,
  type ReviewActiveState,
  type ReviewFixState,
  type ReviewFixStateStart,
  type ReviewInactiveState,
  type ReviewMetaState,
  type ReviewMetaStateStart,
  type ReviewRunTargetInfo,
  type ReviewState,
  type ReviewStateStart,
} from "./types.js";

export { REVIEW_STATE_ENTRY_TYPE };

const ADD_REVIEW_COMMENT_TOOL_NAME = "add_review_comment";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasString(value: Record<string, unknown>, key: string): boolean {
  const raw = value[key];
  return typeof raw === "string" && raw.length > 0;
}

function readOptionalTrimmedString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const raw = value[key];
  if (typeof raw !== "string") {
    return undefined;
  }

  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const RUN_TARGET_STATE_KEYS = [
  "runId",
  "originLeafId",
  "targetHint",
  "originModelProvider",
  "originModelId",
  "originThinkingLevel",
] as const;

function readRunTargetInfo(
  raw: Record<string, unknown>,
): ReviewRunTargetInfo | undefined {
  if (!RUN_TARGET_STATE_KEYS.every((key) => hasString(raw, key))) {
    return undefined;
  }

  return {
    runId: String(raw.runId),
    originLeafId: String(raw.originLeafId),
    targetHint: String(raw.targetHint),
    originModelProvider: String(raw.originModelProvider),
    originModelId: String(raw.originModelId),
    originThinkingLevel: String(raw.originThinkingLevel),
  };
}

function withStateVersion(value: ReviewRunTargetInfo): ReviewRunTargetInfo & {
  version: typeof REVIEW_STATE_VERSION;
} {
  return {
    version: REVIEW_STATE_VERSION,
    runId: value.runId,
    originLeafId: value.originLeafId,
    targetHint: value.targetHint,
    originModelProvider: value.originModelProvider,
    originModelId: value.originModelId,
    originThinkingLevel: value.originThinkingLevel,
  };
}

function readStateData(raw: unknown): ReviewState | undefined {
  if (!isRecord(raw) || raw.version !== REVIEW_STATE_VERSION) {
    return undefined;
  }

  if (raw.activeKind === null) {
    return { version: REVIEW_STATE_VERSION, activeKind: null };
  }

  if (
    raw.activeKind !== "meta" &&
    raw.activeKind !== "review" &&
    raw.activeKind !== "fix"
  ) {
    return undefined;
  }

  const runTargetInfo = readRunTargetInfo(raw);
  if (runTargetInfo === undefined) {
    return undefined;
  }

  const baseState = withStateVersion(runTargetInfo);

  if (raw.activeKind === "meta") {
    if (!hasString(raw, "metaPrompt")) {
      return undefined;
    }

    return {
      ...baseState,
      activeKind: "meta",
      metaPrompt: String(raw.metaPrompt),
    };
  }

  if (!hasString(raw, "reviewPrompt")) {
    return undefined;
  }

  const reviewState = {
    ...baseState,
    reviewPrompt: String(raw.reviewPrompt),
  };

  if (raw.activeKind === "review") {
    return { ...reviewState, activeKind: "review" };
  }

  if (!hasString(raw, "sourceReviewRunId") || !Array.isArray(raw.commentIds)) {
    return undefined;
  }

  const commentIds = raw.commentIds.filter(
    (commentId): commentId is string =>
      typeof commentId === "string" && commentId.length > 0,
  );
  if (commentIds.length !== raw.commentIds.length) {
    return undefined;
  }

  const fixContext = readOptionalTrimmedString(raw, "fixContext");

  return {
    ...reviewState,
    activeKind: "fix",
    sourceReviewRunId: String(raw.sourceReviewRunId),
    commentIds,
    ...(fixContext === undefined ? {} : { fixContext }),
  };
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
  startMetaRun: (ctx: { hasUI: boolean }, state: ReviewMetaStateStart) => void;
  startReviewRun: (ctx: { hasUI: boolean }, state: ReviewStateStart) => void;
  startFixRun: (ctx: { hasUI: boolean }, state: ReviewFixStateStart) => void;
  clearActiveRun: (ctx: { hasUI: boolean }) => void;
  refresh: (ctx: {
    hasUI: boolean;
    sessionManager: {
      getEntries: () => unknown[];
    };
  }) => void;
};

function toMetaStateValue(value: ReviewMetaStateStart): ReviewMetaState {
  return {
    ...withStateVersion(value),
    activeKind: "meta",
    metaPrompt: value.metaPrompt,
  };
}

function toReviewStateValue(value: ReviewStateStart): ReviewActiveState {
  return {
    ...withStateVersion(value),
    activeKind: "review",
    reviewPrompt: value.reviewPrompt,
  };
}

function toFixStateValue(value: ReviewFixStateStart): ReviewFixState {
  const fixContext = value.fixContext?.trim();

  return {
    ...withStateVersion(value),
    activeKind: "fix",
    reviewPrompt: value.reviewPrompt,
    sourceReviewRunId: value.sourceReviewRunId,
    commentIds: [...value.commentIds],
    ...(fixContext === undefined || fixContext.length === 0
      ? {}
      : { fixContext }),
  };
}

const EXTENSION_OWNED_TOOL_NAMES: ReadonlySet<string> = new Set([
  ADD_REVIEW_COMMENT_TOOL_NAME,
  SET_REVIEW_PROMPT_TOOL_NAME,
]);

function computeActiveTools(
  activeTools: string[],
  state: ReviewState,
): string[] {
  const filteredTools = activeTools.filter(
    (toolName) => !EXTENSION_OWNED_TOOL_NAMES.has(toolName),
  );

  if (state.activeKind === "meta") {
    return [...filteredTools, SET_REVIEW_PROMPT_TOOL_NAME];
  }

  if (state.activeKind === "review") {
    return [...filteredTools, ADD_REVIEW_COMMENT_TOOL_NAME];
  }

  return filteredTools;
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
    startMetaRun(
      _ctx: { hasUI: boolean },
      nextRun: ReviewMetaStateStart,
    ): void {
      state = toMetaStateValue(nextRun);
      runtime.appendEntry(REVIEW_STATE_ENTRY_TYPE, state);
      syncTools(state);
    },
    startReviewRun(_ctx: { hasUI: boolean }, nextRun: ReviewStateStart): void {
      state = toReviewStateValue(nextRun);
      runtime.appendEntry(REVIEW_STATE_ENTRY_TYPE, state);
      syncTools(state);
    },
    startFixRun(_ctx: { hasUI: boolean }, nextRun: ReviewFixStateStart): void {
      state = toFixStateValue(nextRun);
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
      state = getLatestReviewState(ctx);
      syncTools(state);
    },
  };
}
