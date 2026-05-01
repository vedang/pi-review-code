import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import {
  REVIEW_COMMENT_ENTRY_TYPE,
  REVIEW_COMMENT_PRIORITIES,
  REVIEW_STATE_VERSION,
  type ReviewComment,
  type ReviewCommentPriority,
} from "./types";

export { REVIEW_COMMENT_ENTRY_TYPE };

const ADD_REVIEW_COMMENT_TOOL_NAME = "add_review_comment";
const REFERENCE_ERROR =
  "Each reference must include a non-empty filePath, integer startLine >= 1, and integer endLine >= startLine when provided.";

const REVIEW_COMMENT_PRIORITY_SET = new Set<ReviewCommentPriority>(
  REVIEW_COMMENT_PRIORITIES,
);

const addReviewCommentSchema = Type.Object({
  priority: Type.Union([
    Type.Literal("P0"),
    Type.Literal("P1"),
    Type.Literal("P2"),
    Type.Literal("P3"),
  ]),
  comment: Type.String({ minLength: 1 }),
  references: Type.Optional(
    Type.Array(
      Type.Object({
        filePath: Type.String({ minLength: 1 }),
        startLine: Type.Integer({ minimum: 1 }),
        endLine: Type.Optional(Type.Integer({ minimum: 1 })),
      }),
    ),
  ),
});

export type AddReviewCommentNormalizeResult =
  | {
      value: {
        priority: ReviewCommentPriority;
        comment: string;
        references: Array<{
          filePath: string;
          startLine: number;
          endLine?: number;
        }>;
      };
    }
  | {
      error: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeFilePath(filePath: string): string {
  return filePath.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function isValidPriority(value: unknown): value is ReviewCommentPriority {
  if (typeof value !== "string") {
    return false;
  }

  return REVIEW_COMMENT_PRIORITY_SET.has(value as ReviewCommentPriority);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function normalizeReference(raw: unknown):
  | {
      value: { filePath: string; startLine: number; endLine?: number };
    }
  | { error: string } {
  if (!isRecord(raw)) {
    return { error: REFERENCE_ERROR };
  }

  if (typeof raw.filePath !== "string") {
    return { error: REFERENCE_ERROR };
  }

  const filePath = normalizeFilePath(raw.filePath);

  if (filePath.length === 0) {
    return { error: REFERENCE_ERROR };
  }

  const startLineRaw = raw.startLine;
  const endLineRaw = raw.endLine;

  if (!isPositiveInteger(startLineRaw)) {
    return { error: REFERENCE_ERROR };
  }

  if (endLineRaw !== undefined && !isPositiveInteger(endLineRaw)) {
    return { error: REFERENCE_ERROR };
  }

  if (endLineRaw !== undefined && endLineRaw < startLineRaw) {
    return { error: REFERENCE_ERROR };
  }

  return {
    value:
      endLineRaw === undefined
        ? { filePath, startLine: startLineRaw }
        : { filePath, startLine: startLineRaw, endLine: endLineRaw },
  };
}

export function normalizeAddReviewCommentInput(
  raw: unknown,
): AddReviewCommentNormalizeResult {
  if (!isRecord(raw)) {
    return { error: "priority must be one of P0, P1, P2, or P3." };
  }

  const priority = raw.priority;
  if (!isValidPriority(priority)) {
    return { error: "priority must be one of P0, P1, P2, or P3." };
  }

  if (typeof raw.comment !== "string") {
    return { error: "comment must be non-empty." };
  }

  const comment = raw.comment.trim();
  if (comment.length === 0) {
    return { error: "comment must be non-empty." };
  }

  if (raw.references === undefined) {
    return { value: { priority, comment, references: [] } };
  }

  if (!Array.isArray(raw.references)) {
    return { error: REFERENCE_ERROR };
  }

  const references: Array<{
    filePath: string;
    startLine: number;
    endLine?: number;
  }> = [];

  for (const reference of raw.references) {
    const normalizedReference = normalizeReference(reference);

    if ("error" in normalizedReference) {
      return normalizedReference;
    }

    references.push(normalizedReference.value);
  }

  return { value: { priority, comment, references } };
}

export type AddReviewCommentSourceState =
  | {
      activeKind: "review";
      runId: string;
      targetHint: string;
    }
  | { activeKind: "fix" | null };

export type AddReviewCommentSource = {
  getState: () => AddReviewCommentSourceState;
  createId?: () => string;
  now?: () => number;
};

export function registerAddReviewCommentTool(
  pi: Pick<ExtensionAPI, "registerTool" | "appendEntry">,
  source: AddReviewCommentSource,
): void {
  const createId = source.createId ?? (() => crypto.randomUUID());
  const now = source.now ?? (() => Date.now());

  pi.registerTool<typeof addReviewCommentSchema, ReviewComment>({
    name: ADD_REVIEW_COMMENT_TOOL_NAME,
    label: "Add review comment",
    description:
      "Record one review finding with priority and location references.",
    promptSnippet:
      "Record one actionable review finding with priority and optional file/line references.",
    promptGuidelines: [
      "Use add_review_comment exactly once per actionable finding during a pi-review-code review run.",
      "Set priority in the priority field only; do not prefix comment text with P0/P1/P2/P3.",
      "Do not call add_review_comment when no actionable finding exists.",
    ],
    parameters: addReviewCommentSchema,
    execute: async (_toolCallId, params) => {
      const normalized = normalizeAddReviewCommentInput(params);

      if ("error" in normalized) {
        throw new Error(normalized.error);
      }

      const state = source.getState();
      if (state.activeKind !== "review") {
        throw new Error(
          "Cannot use add_review_comment during an inactive review run.",
        );
      }

      const data: ReviewComment = {
        version: REVIEW_STATE_VERSION,
        id: createId(),
        runId: state.runId,
        priority: normalized.value.priority,
        comment: normalized.value.comment,
        references: normalized.value.references,
        createdAt: now(),
        targetHint: state.targetHint,
      };

      pi.appendEntry(REVIEW_COMMENT_ENTRY_TYPE, data);

      return {
        content: [
          {
            type: "text",
            text: `Recorded review comment ${data.id} (${data.priority}).`,
          },
        ],
        details: data,
      };
    },
  });
}

export function getReviewCommentsForRun(
  context: {
    sessionManager: {
      getEntries: () => unknown[];
    };
  },
  runId: string,
): ReviewComment[] {
  const entries: unknown[] = context.sessionManager.getEntries();
  if (!Array.isArray(entries) || entries.length === 0) {
    return [];
  }

  const comments: ReviewComment[] = [];

  for (const entry of entries) {
    if (
      !isRecord(entry) ||
      entry.type !== "custom" ||
      entry.customType !== REVIEW_COMMENT_ENTRY_TYPE
    ) {
      continue;
    }

    const data = isRecord(entry.data) ? entry.data : undefined;
    if (data === undefined || data.version !== REVIEW_STATE_VERSION) {
      continue;
    }

    const id = data.id;
    const commentRunId = data.runId;
    const priority = data.priority;
    const comment = data.comment;
    const createdAt = data.createdAt;

    if (
      typeof id !== "string" ||
      typeof commentRunId !== "string" ||
      commentRunId !== runId
    ) {
      continue;
    }

    if (
      !isValidPriority(priority) ||
      typeof comment !== "string" ||
      comment.trim().length === 0 ||
      typeof createdAt !== "number" ||
      !Number.isFinite(createdAt)
    ) {
      continue;
    }

    const referencesRaw = data.references;
    if (!Array.isArray(referencesRaw)) {
      continue;
    }

    const references: Array<{
      filePath: string;
      startLine: number;
      endLine?: number;
    }> = [];
    let validReferences = true;

    for (const rawReference of referencesRaw) {
      const normalizedReference = normalizeReference(rawReference);
      if ("error" in normalizedReference) {
        validReferences = false;
        break;
      }

      references.push(normalizedReference.value);
    }

    if (!validReferences) {
      continue;
    }

    comments.push({
      version: REVIEW_STATE_VERSION,
      id,
      runId: commentRunId,
      priority,
      comment,
      references,
      createdAt,
      targetHint: typeof data.targetHint === "string" ? data.targetHint : "",
    });
  }

  return comments;
}
