import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import {
  REVIEW_META_RESULT_ENTRY_TYPE,
  REVIEW_STATE_VERSION,
  type ReviewMetaResult,
} from "./types.js";

export { REVIEW_META_RESULT_ENTRY_TYPE };

export const SET_REVIEW_PROMPT_TOOL_NAME = "set_review_prompt";

const setReviewPromptSchema = Type.Object({
  runId: Type.String({ minLength: 1 }),
  reviewPrompt: Type.String({ minLength: 1 }),
  summary: Type.Optional(Type.String()),
});

type NormalizedSetReviewPromptInput = {
  runId: string;
  reviewPrompt: string;
  summary?: string;
};

export type SetReviewPromptNormalizeResult =
  | { value: NormalizedSetReviewPromptInput }
  | { error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readRequiredTrimmedString(
  raw: Record<string, unknown>,
  key: "reviewPrompt" | "runId",
): { value: string } | { error: string } {
  const value = raw[key];
  if (typeof value !== "string") {
    return { error: `${key} must be non-empty.` };
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { error: `${key} must be non-empty.` };
  }

  return { value: trimmed };
}

function readOptionalSummary(
  raw: Record<string, unknown>,
): { value?: string } | { error: string } {
  const summary = raw.summary;
  if (summary === undefined) {
    return {};
  }

  if (typeof summary !== "string") {
    return { error: "summary must be a string when provided." };
  }

  const trimmed = summary.trim();
  return trimmed.length === 0 ? {} : { value: trimmed };
}

export function normalizeSetReviewPromptInput(
  raw: unknown,
): SetReviewPromptNormalizeResult {
  if (!isRecord(raw)) {
    return { error: "runId must be non-empty." };
  }

  const runId = readRequiredTrimmedString(raw, "runId");
  if ("error" in runId) {
    return runId;
  }

  const reviewPrompt = readRequiredTrimmedString(raw, "reviewPrompt");
  if ("error" in reviewPrompt) {
    return reviewPrompt;
  }

  const summary = readOptionalSummary(raw);
  if ("error" in summary) {
    return summary;
  }

  return {
    value: {
      runId: runId.value,
      reviewPrompt: reviewPrompt.value,
      ...(summary.value === undefined ? {} : { summary: summary.value }),
    },
  };
}

export type SetReviewPromptSourceState =
  | {
      activeKind: "meta";
      runId: string;
      targetHint: string;
    }
  | { activeKind: "review" | "fix" | null };

export type SetReviewPromptSource = {
  getState: () => SetReviewPromptSourceState;
  now?: () => number;
};

export function registerSetReviewPromptTool(
  pi: Pick<ExtensionAPI, "registerTool" | "appendEntry">,
  source: SetReviewPromptSource,
): void {
  const now = source.now ?? (() => Date.now());

  pi.registerTool<typeof setReviewPromptSchema, ReviewMetaResult>({
    name: SET_REVIEW_PROMPT_TOOL_NAME,
    label: "Set review prompt",
    description:
      "Record the finalized review prompt produced by a pi-review-code meta-pass.",
    promptSnippet:
      "Set the finalized prompt for the upcoming pi-review-code review run.",
    promptGuidelines: [
      "Use set_review_prompt exactly once during a pi-review-code review prompt meta-pass.",
      "Set runId to the exact meta-pass run ID provided in the prompt.",
      "Put the complete self-contained final review instructions in reviewPrompt.",
      "Do not call set_review_prompt outside the meta-pass.",
    ],
    parameters: setReviewPromptSchema,
    execute: async (_toolCallId, params) => {
      const normalized = normalizeSetReviewPromptInput(params);

      if ("error" in normalized) {
        throw new Error(normalized.error);
      }

      const state = source.getState();
      if (state.activeKind !== "meta") {
        throw new Error(
          "Cannot use set_review_prompt during an inactive review prompt meta-pass.",
        );
      }

      if (normalized.value.runId !== state.runId) {
        throw new Error(
          `set_review_prompt runId ${normalized.value.runId} does not match active meta-pass run ${state.runId}.`,
        );
      }

      const data: ReviewMetaResult = {
        version: REVIEW_STATE_VERSION,
        runId: normalized.value.runId,
        targetHint: state.targetHint,
        reviewPrompt: normalized.value.reviewPrompt,
        ...(normalized.value.summary === undefined
          ? {}
          : { summary: normalized.value.summary }),
        createdAt: now(),
      };

      pi.appendEntry(REVIEW_META_RESULT_ENTRY_TYPE, data);

      return {
        content: [
          {
            type: "text",
            text: `Recorded review prompt for ${data.runId}.`,
          },
        ],
        details: data,
      };
    },
  });
}

function readMetaResultData(
  raw: unknown,
  runId: string,
): ReviewMetaResult | undefined {
  if (!isRecord(raw) || raw.version !== REVIEW_STATE_VERSION) {
    return undefined;
  }

  if (
    typeof raw.runId !== "string" ||
    raw.runId !== runId ||
    typeof raw.targetHint !== "string" ||
    typeof raw.reviewPrompt !== "string" ||
    raw.reviewPrompt.trim().length === 0 ||
    typeof raw.createdAt !== "number" ||
    !Number.isFinite(raw.createdAt)
  ) {
    return undefined;
  }

  const summary = raw.summary;
  if (summary !== undefined && typeof summary !== "string") {
    return undefined;
  }

  const trimmedSummary = summary?.trim();

  return {
    version: REVIEW_STATE_VERSION,
    runId: raw.runId,
    targetHint: raw.targetHint,
    reviewPrompt: raw.reviewPrompt.trim(),
    ...(trimmedSummary === undefined || trimmedSummary.length === 0
      ? {}
      : { summary: trimmedSummary }),
    createdAt: raw.createdAt,
  };
}

export function getReviewMetaResultForRun(
  context: {
    sessionManager: {
      getEntries: () => unknown[];
    };
  },
  runId: string,
): ReviewMetaResult | undefined {
  const entries: unknown[] = context.sessionManager.getEntries();
  if (!Array.isArray(entries) || entries.length === 0) {
    return undefined;
  }

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (
      !isRecord(entry) ||
      entry.type !== "custom" ||
      entry.customType !== REVIEW_META_RESULT_ENTRY_TYPE
    ) {
      continue;
    }

    const data = readMetaResultData(entry.data, runId);
    if (data !== undefined) {
      return data;
    }
  }

  return undefined;
}
