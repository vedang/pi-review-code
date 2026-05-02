import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  SessionBeforeTreeEvent,
} from "@mariozechner/pi-coding-agent";

import {
  REVIEW_DIFF_AGAINST_USAGE,
  REVIEW_FIX_USAGE,
  REVIEW_PR_USAGE,
  buildReviewCommandFromInput,
  buildReviewDiffAgainstCommandFromInput,
  buildReviewPrCommandFromInput,
  parseReviewArgs,
  parseReviewDiffAgainstArgs,
  parseReviewFixArgs,
  parseReviewPrArgs,
} from "./command.js";
import type {
  PiReviewThinkingLevel,
  ReviewPromptDraftGenerationResult,
} from "./draft.js";
import { buildReviewFixPrompt } from "./prompts.js";
import type {
  ReviewPromptDraftOptions,
  ReviewPromptDraftRequest,
} from "./prompts.js";
import {
  type AddReviewCommentReference,
  REVIEW_COMMENT_PRIORITIES,
  REVIEW_STATE_VERSION,
  type ResolvedReviewTarget,
  type ReviewComment,
  type ReviewFixRunInfo,
  type ReviewFixSelector,
  type ReviewTarget,
} from "./types.js";

export const REVIEW_ANCHOR_MESSAGE_TYPE = "pi-review-code:anchor";
export const REVIEW_PROMPT_ENTRY_TYPE = "pi-review-code:prompt";
export const REVIEW_SUMMARY_ENTRY_TYPE = "pi-review-code:review-summary";
export const REVIEW_FIX_SUMMARY_ENTRY_TYPE =
  "pi-review-code:review-fix-summary";

export type BuildReviewBranchSummaryInput = {
  runId: string;
  targetHint: string;
  reviewPrompt: string;
  comments: ReviewComment[];
  completedAt: number;
};

export type ReviewBranchSummaryDetails = {
  kind: "review";
  runId: string;
  targetHint: string;
  reviewPrompt: string;
  completedAt: number;
  comments: ReviewComment[];
};

export type ReviewBranchSummary = {
  summary: string;
  details: ReviewBranchSummaryDetails;
};

export type ReviewPromptMessageDetails = {
  kind: "prompt";
  mode: "review" | "fix";
  runId: string;
  targetHint: string;
  reviewPrompt: string;
  originModelProvider: string;
  originModelId: string;
  originThinkingLevel: string;
  sourceReviewRunId?: string;
  commentIds?: string[];
};

export type BuildFixBranchSummaryInput = {
  runId: string;
  sourceReviewRunId: string;
  targetHint: string;
  fixPrompt: string;
  comments: ReviewComment[];
  agentSummary: string;
  completedAt: number;
};

export type FixBranchSummaryDetails = {
  kind: "fix";
  runId: string;
  sourceReviewRunId: string;
  targetHint: string;
  fixPrompt: string;
  completedAt: number;
  comments: ReviewComment[];
  agentSummary: string;
};

export type FixBranchSummary = {
  summary: string;
  details: FixBranchSummaryDetails;
};

export type ReviewSummaryForFix = {
  runId: string;
  targetHint: string;
  reviewPrompt: string;
  completedAt: number;
  comments: ReviewComment[];
};

export type ReviewFindingForFixList = {
  reviewRunId: string;
  targetHint: string;
  completedAt: number;
  comment: ReviewComment;
};

export type ReviewFixWidgetFinding = {
  reviewRunId: string;
  targetHint: string;
  completedAt: number;
  comment: ReviewComment;
  fixed: boolean;
};

export type ReviewFixWidgetData =
  | {
      ok: true;
      reviewRunId: string;
      targetHint: string;
      completedAt: number;
      findings: ReviewFixWidgetFinding[];
    }
  | {
      ok: false;
      reason: "no-review-findings";
      findings: [];
    };

export type ReviewSessionBeforeTreeResult = {
  summary: {
    summary: string;
    details: ReviewBranchSummaryDetails | FixBranchSummaryDetails;
  };
};
type ReviewInputWidgetKind = "review" | "diff-against" | "pr";

type ReviewInputWidgetConfig = {
  kind: ReviewInputWidgetKind;
  title: string;
  helpText: string;
  primaryLabel: string;
  primaryPlaceholder: string;
  contextLabel: string;
  initialPrimaryValue?: string;
  initialContext?: string;
};

type ReviewInputWidgetResult =
  | {
      submitted: true;
      primaryValue: string;
      reviewContext?: string;
    }
  | {
      submitted: false;
    };

type ShowInputWidget = (
  ctx: ExtensionCommandContext,
  config: ReviewInputWidgetConfig,
) => Promise<ReviewInputWidgetResult>;

const REVIEW_WIDGET_HELP_TEXT = "Usage:\n  /review <review request>";
const REVIEW_WIDGET_PRIMARY_LABEL = "what do I review?";
const REVIEW_WIDGET_PRIMARY_PLACEHOLDER =
  "Describe the code, behavior, or risk to review.";
const REVIEW_WIDGET_CONTEXT_LABEL = "any context I should be aware of?";

const REVIEW_DIFF_AGAINST_WIDGET_PRIMARY_LABEL = "ref:";
const REVIEW_DIFF_AGAINST_WIDGET_PRIMARY_PLACEHOLDER =
  "Enter ref or change id.";
const REVIEW_PR_WIDGET_PRIMARY_LABEL = "pr:";
const REVIEW_PR_WIDGET_PRIMARY_PLACEHOLDER =
  "Enter GitHub URL, GitLab URL, or PR number.";

const REVIEW_WIDGET_CANCELLED_MESSAGE = "Review cancelled.";
const REVIEW_NO_ACTIVE_MODEL_ERROR =
  "Cannot start review: no active model is selected.";

const REVIEW_WIDGET_INVALID_ARGS_ERROR =
  "Cannot start review: invalid command arguments.";

const REVIEW_WIDGET_BASE_TITLE = "Start review";

const REVIEW_DIFF_AGAINST_WIDGET = {
  kind: "diff-against" as const,
  helpText: REVIEW_DIFF_AGAINST_USAGE,
  primaryLabel: REVIEW_DIFF_AGAINST_WIDGET_PRIMARY_LABEL,
  primaryPlaceholder: REVIEW_DIFF_AGAINST_WIDGET_PRIMARY_PLACEHOLDER,
  contextLabel: REVIEW_WIDGET_CONTEXT_LABEL,
};

const REVIEW_PR_WIDGET = {
  kind: "pr" as const,
  helpText: REVIEW_PR_USAGE,
  primaryLabel: REVIEW_PR_WIDGET_PRIMARY_LABEL,
  primaryPlaceholder: REVIEW_PR_WIDGET_PRIMARY_PLACEHOLDER,
  contextLabel: REVIEW_WIDGET_CONTEXT_LABEL,
};

const REVIEW_WIDGET_BASE = {
  kind: "review" as const,
  helpText: REVIEW_WIDGET_HELP_TEXT,
  primaryLabel: REVIEW_WIDGET_PRIMARY_LABEL,
  primaryPlaceholder: REVIEW_WIDGET_PRIMARY_PLACEHOLDER,
  contextLabel: REVIEW_WIDGET_CONTEXT_LABEL,
};

const REVIEW_COMMENT_PRIORITY_SET = new Set<ReviewComment["priority"]>(
  REVIEW_COMMENT_PRIORITIES,
);

function formatReference(reference: {
  filePath: string;
  startLine: number;
  endLine?: number;
}): string {
  if (
    reference.endLine !== undefined &&
    reference.endLine !== reference.startLine
  ) {
    return `${reference.filePath}:${reference.startLine}-${reference.endLine}`;
  }

  return `${reference.filePath}:${reference.startLine}`;
}

export function buildReviewBranchSummary(
  input: BuildReviewBranchSummaryInput,
): ReviewBranchSummary {
  const findingLines =
    input.comments.length === 0
      ? ["No findings recorded."]
      : input.comments.map((comment) => {
          const referenceText =
            comment.references.length === 0
              ? ""
              : ` (${comment.references.map(formatReference).join(", ")})`;

          return `- ${comment.priority} ${comment.id}${referenceText}: ${comment.comment}`;
        });

  return {
    summary: [
      `pi-review-code review ${input.runId}`,
      `Target: ${input.targetHint}`,
      `Prompt: ${input.reviewPrompt}`,
      "",
      ...findingLines,
    ].join("\n"),
    details: {
      kind: "review",
      runId: input.runId,
      targetHint: input.targetHint,
      reviewPrompt: input.reviewPrompt,
      completedAt: input.completedAt,
      comments: input.comments,
    },
  };
}

export function buildFixBranchSummary(
  input: BuildFixBranchSummaryInput,
): FixBranchSummary {
  const findingLines =
    input.comments.length === 0
      ? ["No findings were selected for this fix run."]
      : input.comments.map((comment) => {
          const referenceText =
            comment.references.length === 0
              ? ""
              : ` (${comment.references.map(formatReference).join(", ")})`;

          return `- ${comment.priority} ${comment.id}${referenceText}: ${comment.comment}`;
        });

  return {
    summary: [
      `pi-review-code review-fix ${input.runId}`,
      `Source review: ${input.sourceReviewRunId}`,
      `Target: ${input.targetHint}`,
      `Prompt: ${input.fixPrompt}`,
      "",
      ...findingLines,
      "",
      `Agent summary: ${input.agentSummary}`,
    ].join("\n"),
    details: {
      kind: "fix",
      runId: input.runId,
      sourceReviewRunId: input.sourceReviewRunId,
      targetHint: input.targetHint,
      fixPrompt: input.fixPrompt,
      completedAt: input.completedAt,
      comments: input.comments,
      agentSummary: input.agentSummary,
    },
  };
}

function formatUnfixedReviewFindingsText({
  totalFindings,
  unfixed,
}: {
  totalFindings: number;
  unfixed: ReviewFindingForFixList[];
}): string {
  if (totalFindings === 0) {
    return "No review findings found.";
  }

  if (unfixed.length === 0) {
    return "All review findings have been fixed.";
  }

  const findingsByRun = new Map<string, ReviewFindingForFixList[]>();

  for (const finding of unfixed) {
    const key = finding.reviewRunId;
    const bucket = findingsByRun.get(key);
    if (bucket === undefined) {
      findingsByRun.set(key, [finding]);
    } else {
      bucket.push(finding);
    }
  }

  const lines = ["Unfixed review findings:", ""];

  for (const [reviewRunId, findings] of findingsByRun) {
    lines.push(`Review ${reviewRunId}`);
    if (findings.length === 0) {
      continue;
    }

    lines.push(`Target: ${findings[0]?.targetHint ?? ""}`);

    for (const finding of findings) {
      const referenceText =
        finding.comment.references.length === 0
          ? ""
          : ` (${finding.comment.references.map(formatReference).join(", ")})`;
      lines.push(
        `- ${finding.comment.priority} ${finding.comment.id} (${reviewRunId}:${finding.comment.id})${referenceText}: ${finding.comment.comment}`,
      );
    }

    lines.push("");
  }

  lines.push("Use /review-fix finding <finding-id> [<finding-id> ...]");

  return lines.join("\n").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((block) => {
      if (!isRecord(block) || block.type !== "text") {
        return "";
      }

      return typeof block.text === "string" ? block.text : "";
    })
    .join("");
}

function extractAssistantSummary(event: unknown): string {
  if (!isRecord(event) || !Array.isArray(event.messages)) {
    return "";
  }

  for (let index = event.messages.length - 1; index >= 0; index -= 1) {
    const message = event.messages[index];
    if (!isRecord(message) || message.role !== "assistant") {
      continue;
    }

    return extractTextContent(message.content).trim();
  }

  return "";
}

function isValidPriority(value: unknown): value is ReviewComment["priority"] {
  return (
    typeof value === "string" &&
    REVIEW_COMMENT_PRIORITY_SET.has(value as ReviewComment["priority"])
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function parseReference(value: unknown): AddReviewCommentReference | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const filePath =
    typeof value.filePath === "string" ? value.filePath.trim() : "";
  const startLine = value.startLine;
  const endLine = value.endLine;

  if (filePath.length === 0 || !isPositiveInteger(startLine)) {
    return undefined;
  }

  if (endLine !== undefined) {
    if (!isPositiveInteger(endLine) || endLine < startLine) {
      return undefined;
    }

    return { filePath, startLine, endLine };
  }

  return { filePath, startLine };
}

function parseReferences(
  value: unknown,
): AddReviewCommentReference[] | undefined {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const references: AddReviewCommentReference[] = [];

  for (const raw of value) {
    const parsed = parseReference(raw);
    if (parsed === undefined) {
      return undefined;
    }
    references.push(parsed);
  }

  return references;
}

function parseReviewComment(value: unknown): ReviewComment | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const comment = value.comment;
  const createdAt = value.createdAt;
  const references = parseReferences(value.references);
  if (
    value.version !== REVIEW_STATE_VERSION ||
    typeof value.id !== "string" ||
    value.id.trim().length === 0 ||
    typeof value.runId !== "string" ||
    value.runId.trim().length === 0 ||
    !isValidPriority(value.priority) ||
    typeof comment !== "string" ||
    comment.trim().length === 0 ||
    typeof createdAt !== "number" ||
    !Number.isFinite(createdAt) ||
    references === undefined
  ) {
    return undefined;
  }

  const rawTargetHint = value.targetHint;

  return {
    version: REVIEW_STATE_VERSION,
    id: value.id,
    runId: value.runId,
    priority: value.priority,
    comment,
    references,
    createdAt,
    targetHint: typeof rawTargetHint === "string" ? rawTargetHint : "",
  };
}

type ParsedReviewSummaryForFix = ReviewSummaryForFix & { order: number };

type ParsedFixSummaryForFix = {
  sourceReviewRunId: string;
  commentIds: string[];
  order: number;
};

function parseReviewSummaryForFixEntry(
  value: unknown,
  order: number,
): ParsedReviewSummaryForFix | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (
    value.type !== "custom" ||
    value.customType !== REVIEW_SUMMARY_ENTRY_TYPE
  ) {
    return undefined;
  }

  const data = isRecord(value.data) ? value.data : undefined;
  if (data === undefined || !isRecord(data.details)) {
    return undefined;
  }

  const details = data.details;
  const rawRunId = details.runId;
  const rawTargetHint = details.targetHint;
  const rawReviewPrompt = details.reviewPrompt;
  const rawCompletedAt = details.completedAt;

  if (
    typeof details.kind !== "string" ||
    details.kind !== "review" ||
    typeof rawRunId !== "string" ||
    rawRunId.trim().length === 0 ||
    typeof rawTargetHint !== "string" ||
    typeof rawReviewPrompt !== "string" ||
    typeof rawCompletedAt !== "number" ||
    !Number.isFinite(rawCompletedAt)
  ) {
    return undefined;
  }

  const commentsRaw = Array.isArray(details.comments) ? details.comments : [];
  const comments: ReviewComment[] = [];

  for (const raw of commentsRaw) {
    const parsedComment = parseReviewComment(raw);
    if (parsedComment !== undefined && parsedComment.runId === rawRunId) {
      comments.push(parsedComment);
    }
  }

  return {
    runId: rawRunId,
    targetHint: rawTargetHint,
    reviewPrompt: rawReviewPrompt,
    completedAt: rawCompletedAt,
    comments,
    order,
  };
}

function parseFixSummaryForFixEntry(
  value: unknown,
  order: number,
): ParsedFixSummaryForFix | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (
    value.type !== "custom" ||
    value.customType !== REVIEW_FIX_SUMMARY_ENTRY_TYPE
  ) {
    return undefined;
  }

  const data = isRecord(value.data) ? value.data : undefined;
  if (data === undefined || !isRecord(data.details)) {
    return undefined;
  }

  const details = data.details;
  const rawSourceReviewRunId = details.sourceReviewRunId;

  if (
    typeof details.kind !== "string" ||
    details.kind !== "fix" ||
    typeof details.runId !== "string" ||
    details.runId.trim().length === 0 ||
    typeof rawSourceReviewRunId !== "string" ||
    rawSourceReviewRunId.trim().length === 0 ||
    typeof details.targetHint !== "string" ||
    typeof details.fixPrompt !== "string" ||
    typeof details.completedAt !== "number" ||
    !Number.isFinite(details.completedAt) ||
    typeof details.agentSummary !== "string"
  ) {
    return undefined;
  }

  const commentsRaw = Array.isArray(details.comments) ? details.comments : [];
  const commentIds: string[] = [];

  for (const raw of commentsRaw) {
    const parsedComment = parseReviewComment(raw);
    if (
      parsedComment !== undefined &&
      parsedComment.runId === rawSourceReviewRunId
    ) {
      commentIds.push(parsedComment.id);
    }
  }

  return {
    sourceReviewRunId: rawSourceReviewRunId,
    commentIds,
    order,
  };
}

function chooseLatestReviewSummary(
  a: ParsedReviewSummaryForFix,
  b: ParsedReviewSummaryForFix,
): ParsedReviewSummaryForFix {
  if (a.completedAt > b.completedAt) {
    return a;
  }

  if (a.completedAt < b.completedAt) {
    return b;
  }

  return a.order > b.order ? a : b;
}

function firstCommentForFindingId(
  summary: ParsedReviewSummaryForFix,
  findingId: string,
): ReviewComment | undefined {
  return summary.comments.find((comment) => comment.id === findingId);
}

function reviewFindingKey(reviewRunId: string, findingId: string): string {
  return `${reviewRunId}:${findingId}`;
}

export function listUnfixedReviewFindings(entries: unknown[]): {
  totalFindings: number;
  unfixed: ReviewFindingForFixList[];
} {
  const reviewsByRunId = new Map<string, ParsedReviewSummaryForFix>();
  const fixedFindingKeys = new Set<string>();

  for (let index = 0; index < entries.length; index += 1) {
    const review = parseReviewSummaryForFixEntry(entries[index], index);
    if (review !== undefined) {
      const existing = reviewsByRunId.get(review.runId);
      reviewsByRunId.set(
        review.runId,
        existing === undefined
          ? review
          : chooseLatestReviewSummary(review, existing),
      );
      continue;
    }

    const fix = parseFixSummaryForFixEntry(entries[index], index);
    if (fix === undefined) {
      continue;
    }

    for (const commentId of fix.commentIds) {
      fixedFindingKeys.add(reviewFindingKey(fix.sourceReviewRunId, commentId));
    }
  }

  const reviews = Array.from(reviewsByRunId.values()).sort((a, b) => {
    if (a.completedAt !== b.completedAt) {
      return b.completedAt - a.completedAt;
    }

    return b.order - a.order;
  });

  const totalFindings = reviews.reduce(
    (count, review) => count + review.comments.length,
    0,
  );
  const unfixed: ReviewFindingForFixList[] = [];

  for (const review of reviews) {
    for (const comment of review.comments) {
      if (fixedFindingKeys.has(reviewFindingKey(review.runId, comment.id))) {
        continue;
      }

      unfixed.push({
        reviewRunId: review.runId,
        targetHint: review.targetHint,
        completedAt: review.completedAt,
        comment,
      });
    }
  }

  return { totalFindings, unfixed };
}

export function selectReviewSummaryForFix(
  entries: unknown[],
  selector: ReviewFixSelector,
): ReviewSummaryForFix | undefined {
  if (selector.kind === "help") {
    return undefined;
  }

  const findingCandidates: ParsedReviewSummaryForFix[] = [];
  const candidates: ParsedReviewSummaryForFix[] = [];

  for (let index = 0; index < entries.length; index += 1) {
    const parsed = parseReviewSummaryForFixEntry(entries[index], index);
    if (parsed === undefined) {
      continue;
    }

    if (parsed.comments.length === 0) {
      continue;
    }

    switch (selector.kind) {
      case "latest":
        candidates.push(parsed);
        break;

      case "run-id":
        if (parsed.runId === selector.runId) {
          candidates.push(parsed);
        }
        break;

      case "finding-id": {
        const finding = firstCommentForFindingId(parsed, selector.findingId);
        if (finding === undefined) {
          break;
        }

        candidates.push({ ...parsed, comments: [finding] });
        break;
      }

      case "list":
        break;

      case "finding-ids": {
        const findingComments: ReviewComment[] = [];
        let hasAllFindings = selector.findingIds.length > 0;

        for (const findingId of selector.findingIds) {
          const finding = firstCommentForFindingId(parsed, findingId);
          if (finding === undefined) {
            hasAllFindings = false;
            break;
          }
          findingComments.push(finding);
        }

        if (hasAllFindings) {
          candidates.push({ ...parsed, comments: findingComments });
        }
        break;
      }

      default: {
        const finding = firstCommentForFindingId(parsed, selector.id);
        if (finding !== undefined) {
          findingCandidates.push({ ...parsed, comments: [finding] });
          break;
        }

        if (parsed.runId === selector.id) {
          candidates.push(parsed);
        }
      }
    }
  }

  const selectedCandidates =
    selector.kind === "id" && findingCandidates.length > 0
      ? findingCandidates
      : candidates;

  if (selectedCandidates.length === 0) {
    return undefined;
  }

  const selected = selectedCandidates.reduce(
    (best, candidate) => chooseLatestReviewSummary(candidate, best),
    selectedCandidates[0],
  );

  return {
    runId: selected.runId,
    targetHint: selected.targetHint,
    reviewPrompt: selected.reviewPrompt,
    completedAt: selected.completedAt,
    comments: selected.comments,
  };
}

export function buildReviewFixWidgetData(
  entries: unknown[],
): ReviewFixWidgetData {
  const fixedFindingKeys = new Set<string>();
  let latestReviewSummary: ParsedReviewSummaryForFix | undefined;

  for (let index = 0; index < entries.length; index += 1) {
    const review = parseReviewSummaryForFixEntry(entries[index], index);
    if (review !== undefined) {
      if (review.comments.length > 0) {
        latestReviewSummary =
          latestReviewSummary === undefined
            ? review
            : chooseLatestReviewSummary(review, latestReviewSummary);
      }
      continue;
    }

    const fix = parseFixSummaryForFixEntry(entries[index], index);
    if (fix === undefined) {
      continue;
    }

    for (const commentId of fix.commentIds) {
      fixedFindingKeys.add(reviewFindingKey(fix.sourceReviewRunId, commentId));
    }
  }

  if (latestReviewSummary === undefined) {
    return {
      ok: false,
      reason: "no-review-findings",
      findings: [],
    };
  }

  return {
    ok: true,
    reviewRunId: latestReviewSummary.runId,
    targetHint: latestReviewSummary.targetHint,
    completedAt: latestReviewSummary.completedAt,
    findings: latestReviewSummary.comments.map((comment) => ({
      reviewRunId: latestReviewSummary.runId,
      targetHint: latestReviewSummary.targetHint,
      completedAt: latestReviewSummary.completedAt,
      comment,
      fixed: fixedFindingKeys.has(
        reviewFindingKey(latestReviewSummary.runId, comment.id),
      ),
    })),
  };
}

type ReviewFlowController = {
  handleReviewCommand: (
    args: string,
    ctx: ExtensionCommandContext,
  ) => Promise<void>;
  handleReviewDiffAgainstCommand: (
    args: string,
    ctx: ExtensionCommandContext,
  ) => Promise<void>;
  handleReviewPrCommand: (
    args: string,
    ctx: ExtensionCommandContext,
  ) => Promise<void>;
  handleReviewFixCommand: (
    args: string,
    ctx: ExtensionCommandContext,
  ) => Promise<void>;
  handleAgentEnd: (event: unknown, ctx: ExtensionContext) => Promise<void>;
  handleSessionBeforeTree: (
    event: Pick<SessionBeforeTreeEvent, "preparation">,
  ) => Promise<ReviewSessionBeforeTreeResult | undefined>;
};

type ResolveTarget = (target: ReviewTarget) => Promise<ResolvedReviewTarget>;

type GenerateDraft = (
  request: ReviewPromptDraftRequest,
  context: {
    model: NonNullable<ExtensionCommandContext["model"]>;
    modelRegistry: ExtensionCommandContext["modelRegistry"];
    thinkingLevel: PiReviewThinkingLevel;
    signal?: AbortSignal;
  },
) => Promise<ReviewPromptDraftGenerationResult>;

type GetCommentsForRun = (
  context: { sessionManager: ExtensionContext["sessionManager"] },
  runId: string,
) => ReviewComment[];

type ReviewFlowStateManager = {
  startReviewRun: (ctx: { hasUI: boolean }, state: ReviewRunInfo) => void;
  startFixRun?: (ctx: { hasUI: boolean }, state: ReviewFixRunInfo) => void;
  clearActiveRun: (ctx: { hasUI: boolean }) => void;
};

type ReviewFlowRuntime = Pick<ExtensionAPI, "appendEntry" | "sendUserMessage"> &
  Partial<Pick<ExtensionAPI, "sendMessage">>;

type ReviewFlowDependencies = {
  pi: ReviewFlowRuntime;
  stateManager: ReviewFlowStateManager;
  resolveTarget: ResolveTarget;
  buildDraftRequest: (
    target: ResolvedReviewTarget,
    options?: ReviewPromptDraftOptions,
  ) => ReviewPromptDraftRequest;
  generateDraft: GenerateDraft;
  getCommentsForRun: GetCommentsForRun;
  getThinkingLevel: () => PiReviewThinkingLevel;
  createRunId: () => string;
  getNow: () => number;
  showInputWidget?: ShowInputWidget;
};

type ReviewRunInfo = {
  runId: string;
  originLeafId: string;
  targetHint: string;
  reviewPrompt: string;
  originModelProvider: string;
  originModelId: string;
  originThinkingLevel: string;
};

type ActiveReviewRun = ReviewRunInfo & {
  kind: "review";
  commandCtx: ExtensionCommandContext;
};

type ActiveFixRun = ReviewFixRunInfo & {
  kind: "fix";
  commandCtx: ExtensionCommandContext;
  selectedComments: ReviewComment[];
};

const REVIEW_SUMMARY_ENTRY = "review";
const REVIEW_FIX_SUMMARY_ENTRY = "review-fix";

type ActiveReviewRunState = ActiveReviewRun | ActiveFixRun;

type PendingSummary = {
  runId: string;
  targetId: string;
  summary: ReviewBranchSummary | FixBranchSummary;
};

function agentEndMatchesRun(
  event: unknown,
  run: ActiveReviewRunState,
): boolean {
  if (!isRecord(event) || !Array.isArray(event.messages)) {
    return false;
  }

  const expectedPrompt = run.reviewPrompt.trim();

  return event.messages.some((message) => {
    if (!isRecord(message) || message.role !== "user") {
      return false;
    }

    return extractTextContent(message.content).trim() === expectedPrompt;
  });
}

function getLeafId(ctx: ExtensionCommandContext): string | null {
  return ctx.sessionManager.getLeafId();
}

function ensureOriginLeafId(
  ctx: ExtensionCommandContext,
  runtime: ReviewFlowRuntime,
): string | null {
  const existingLeafId = getLeafId(ctx);
  if (existingLeafId !== null) {
    return existingLeafId;
  }

  runtime.sendMessage?.(
    {
      customType: REVIEW_ANCHOR_MESSAGE_TYPE,
      content: "pi-review-code review anchor",
      display: false,
      details: { purpose: "Anchor empty session before review branch." },
    },
    { triggerTurn: false },
  );

  return getLeafId(ctx);
}

function extractLabelPrefix(label: string): string | undefined {
  if (label.startsWith("review-fix:")) {
    return REVIEW_FIX_SUMMARY_ENTRY;
  }

  if (label.startsWith("review:")) {
    return REVIEW_SUMMARY_ENTRY;
  }

  return undefined;
}

function buildPromptMessageContent(
  details: ReviewPromptMessageDetails,
): string {
  const label =
    details.mode === "review" ? "Review prompt" : "Review-fix prompt";
  return `${label} ${details.runId}`;
}

function sendPromptMessage(
  runtime: ReviewFlowRuntime,
  details: ReviewPromptMessageDetails,
): void {
  runtime.sendMessage?.({
    customType: REVIEW_PROMPT_ENTRY_TYPE,
    content: buildPromptMessageContent(details),
    display: true,
    details,
  });
}

function buildSummaryMessageContent(
  summary: ReviewBranchSummary | FixBranchSummary,
): string {
  const count = summary.details.comments.length;
  const findingText = `${count} finding${count === 1 ? "" : "s"}`;

  if (summary.details.kind === "review") {
    return `Review findings ${summary.details.runId} completed with ${findingText}.`;
  }

  return `Review-fix ${summary.details.runId} completed for ${findingText}.`;
}

function sendSummaryMessage(
  runtime: ReviewFlowRuntime,
  summary: ReviewBranchSummary | FixBranchSummary,
): void {
  runtime.sendMessage?.({
    customType:
      summary.details.kind === "review"
        ? REVIEW_SUMMARY_ENTRY_TYPE
        : REVIEW_FIX_SUMMARY_ENTRY_TYPE,
    content: buildSummaryMessageContent(summary),
    display: true,
    details: summary.details,
  });
}

export function createReviewFlowController(
  dependencies: ReviewFlowDependencies,
): ReviewFlowController {
  let activeRun: ActiveReviewRunState | null = null;
  const pendingSummaries = new Map<string, PendingSummary>();

  async function launchReview(
    target: ReviewTarget,
    ctx: ExtensionCommandContext,
  ) {
    const model = ctx.model;
    if (model === undefined) {
      ctx.ui.notify(
        "Cannot start review: no active model is selected.",
        "error",
      );
      return;
    }

    await ctx.waitForIdle();

    const originLeafId = ensureOriginLeafId(ctx, dependencies.pi);
    if (originLeafId === null) {
      ctx.ui.notify("Cannot start review: no current branch leaf id.", "error");
      return;
    }

    let resolvedTarget: ResolvedReviewTarget;
    try {
      resolvedTarget = await dependencies.resolveTarget(target);
    } catch (error) {
      ctx.ui.notify(
        error instanceof Error
          ? error.message
          : "Failed to resolve review target.",
        "error",
      );
      return;
    }

    const thinkingLevel = dependencies.getThinkingLevel();
    const draftOptions =
      resolvedTarget.kind === "diff-against" &&
      resolvedTarget.diffText !== undefined
        ? { diffText: resolvedTarget.diffText }
        : undefined;

    const draftRequest = dependencies.buildDraftRequest(
      resolvedTarget,
      draftOptions,
    );
    ctx.ui.notify("Generating review prompt draft…", "info");

    const draft = await dependencies.generateDraft(draftRequest, {
      model,
      modelRegistry: ctx.modelRegistry,
      thinkingLevel,
      signal: ctx.signal,
    });

    if (!draft.ok) {
      ctx.ui.notify(draft.error, "error");
      return;
    }

    const editedPrompt = await ctx.ui.editor("Edit review prompt", draft.draft);
    if (editedPrompt === undefined) {
      ctx.ui.notify("Review cancelled before branch launch.", "info");
      return;
    }

    const runInfo: ReviewRunInfo = {
      runId: dependencies.createRunId(),
      originLeafId,
      targetHint: resolvedTarget.targetHint,
      reviewPrompt: editedPrompt,
      originModelProvider: model.provider,
      originModelId: model.id,
      originThinkingLevel: thinkingLevel,
    };

    dependencies.stateManager.startReviewRun(ctx, runInfo);
    activeRun = { ...runInfo, kind: "review", commandCtx: ctx };
    sendPromptMessage(dependencies.pi, {
      kind: "prompt",
      mode: "review",
      runId: runInfo.runId,
      targetHint: runInfo.targetHint,
      reviewPrompt: runInfo.reviewPrompt,
      originModelProvider: runInfo.originModelProvider,
      originModelId: runInfo.originModelId,
      originThinkingLevel: runInfo.originThinkingLevel,
    });

    ctx.ui.notify(`Review branch started: ${runInfo.runId}`, "info");
    dependencies.pi.sendUserMessage(editedPrompt);
  }

  type ReviewCommandParser = (args: string) => { target: ReviewTarget };
  type ReviewWidgetSpec = {
    template: {
      kind: ReviewInputWidgetKind;
      helpText: string;
      primaryLabel: string;
      primaryPlaceholder: string;
      contextLabel: string;
    };
    extractInitialPrimaryValue: (command: { target: ReviewTarget }) => string;
    buildTargetFromInput: (input: {
      primaryValue: string;
      reviewContext?: string;
    }) => ReviewTarget;
  };

  function buildWidgetConfig(
    template: ReviewWidgetSpec["template"],
    initialPrimaryValue?: string,
    initialContext?: string,
  ): ReviewInputWidgetConfig {
    const config: ReviewInputWidgetConfig = {
      ...template,
      title: REVIEW_WIDGET_BASE_TITLE,
    };

    if (initialPrimaryValue !== undefined) {
      config.initialPrimaryValue = initialPrimaryValue;
    }

    if (initialContext !== undefined) {
      config.initialContext = initialContext;
    }

    return config;
  }

  function getErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
  }

  function createReviewCommandHandler(
    parser: ReviewCommandParser,
    widgetSpec: ReviewWidgetSpec,
  ) {
    return async (
      args: string,
      ctx: ExtensionCommandContext,
    ): Promise<void> => {
      if (!ctx.hasUI) {
        return;
      }

      if (dependencies.showInputWidget === undefined) {
        let command: { target: ReviewTarget };
        try {
          command = parser(args);
        } catch (error) {
          ctx.ui.notify(
            getErrorMessage(error, REVIEW_WIDGET_INVALID_ARGS_ERROR),
            "error",
          );
          return;
        }

        await launchReview(command.target, ctx);
        return;
      }

      if (ctx.model === undefined) {
        ctx.ui.notify(REVIEW_NO_ACTIVE_MODEL_ERROR, "error");
        return;
      }

      let initialPrimaryValue: string | undefined;
      if (args.trim().length > 0) {
        let command: { target: ReviewTarget };
        try {
          command = parser(args);
        } catch (error) {
          ctx.ui.notify(
            getErrorMessage(error, REVIEW_WIDGET_INVALID_ARGS_ERROR),
            "error",
          );
          return;
        }

        try {
          initialPrimaryValue = widgetSpec.extractInitialPrimaryValue(command);
        } catch (error) {
          ctx.ui.notify(
            getErrorMessage(error, REVIEW_WIDGET_INVALID_ARGS_ERROR),
            "error",
          );
          return;
        }
      }

      const input = await dependencies.showInputWidget(
        ctx,
        buildWidgetConfig(widgetSpec.template, initialPrimaryValue, undefined),
      );
      if (input.submitted === false) {
        ctx.ui.notify(REVIEW_WIDGET_CANCELLED_MESSAGE, "info");
        return;
      }

      let target: ReviewTarget;
      try {
        target = widgetSpec.buildTargetFromInput(input);
      } catch (error) {
        ctx.ui.notify(
          getErrorMessage(error, REVIEW_WIDGET_INVALID_ARGS_ERROR),
          "error",
        );
        return;
      }

      await launchReview(target, ctx);
    };
  }

  const handleReviewCommand = createReviewCommandHandler(parseReviewArgs, {
    template: REVIEW_WIDGET_BASE,
    extractInitialPrimaryValue: (command) => {
      if (command.target.kind !== "prompt") {
        throw new Error(REVIEW_WIDGET_INVALID_ARGS_ERROR);
      }

      return command.target.prompt;
    },
    buildTargetFromInput: (input) =>
      buildReviewCommandFromInput({
        prompt: input.primaryValue,
        reviewContext: input.reviewContext,
      }).target,
  });

  const handleReviewDiffAgainstCommand = createReviewCommandHandler(
    parseReviewDiffAgainstArgs,
    {
      template: REVIEW_DIFF_AGAINST_WIDGET,
      extractInitialPrimaryValue: (command) => {
        if (command.target.kind !== "diff-against") {
          throw new Error(REVIEW_WIDGET_INVALID_ARGS_ERROR);
        }

        return command.target.ref;
      },
      buildTargetFromInput: (input) =>
        buildReviewDiffAgainstCommandFromInput({
          ref: input.primaryValue,
          reviewContext: input.reviewContext,
        }).target,
    },
  );

  const handleReviewPrCommand = createReviewCommandHandler(parseReviewPrArgs, {
    template: REVIEW_PR_WIDGET,
    extractInitialPrimaryValue: (command) => {
      if (command.target.kind !== "pr") {
        throw new Error(REVIEW_WIDGET_INVALID_ARGS_ERROR);
      }

      return command.target.selector;
    },
    buildTargetFromInput: (input) =>
      buildReviewPrCommandFromInput({
        selector: input.primaryValue,
        reviewContext: input.reviewContext,
      }).target,
  });

  async function startFixRunIfSupported(
    ctx: ExtensionCommandContext,
    runInfo: ReviewFixRunInfo,
  ) {
    if (dependencies.stateManager.startFixRun !== undefined) {
      dependencies.stateManager.startFixRun(ctx, runInfo);
      return;
    }

    dependencies.stateManager.startReviewRun(ctx, {
      runId: runInfo.runId,
      originLeafId: runInfo.originLeafId,
      targetHint: runInfo.targetHint,
      reviewPrompt: runInfo.reviewPrompt,
      originModelProvider: runInfo.originModelProvider,
      originModelId: runInfo.originModelId,
      originThinkingLevel: runInfo.originThinkingLevel,
    });
  }

  async function handleReviewFixCommand(
    args: string,
    ctx: ExtensionCommandContext,
  ) {
    if (!ctx.hasUI) {
      return;
    }

    let command: ReturnType<typeof parseReviewFixArgs>;
    try {
      command = parseReviewFixArgs(args);
    } catch (error) {
      ctx.ui.notify(
        error instanceof Error ? error.message : "Cannot start review-fix.",
        "error",
      );
      return;
    }

    if (command.selector.kind === "help") {
      ctx.ui.notify(REVIEW_FIX_USAGE, "info");
      return;
    }

    if (command.selector.kind === "list") {
      const listResult = listUnfixedReviewFindings(
        ctx.sessionManager.getEntries(),
      );
      ctx.ui.notify(formatUnfixedReviewFindingsText(listResult), "info");
      return;
    }

    const model = ctx.model;
    if (model === undefined) {
      ctx.ui.notify(
        "Cannot start review-fix: no active model is selected.",
        "error",
      );
      return;
    }

    await ctx.waitForIdle();

    const originLeafId = getLeafId(ctx);
    if (originLeafId === null) {
      ctx.ui.notify(
        "Cannot start review-fix: no current branch leaf id.",
        "error",
      );
      return;
    }

    const selectedSummary = selectReviewSummaryForFix(
      ctx.sessionManager.getEntries(),
      command.selector,
    );

    if (selectedSummary === undefined) {
      ctx.ui.notify(
        "Cannot start review-fix: no completed review with comments found.",
        "error",
      );
      return;
    }

    const fixPrompt = buildReviewFixPrompt({
      reviewRunId: selectedSummary.runId,
      targetHint: selectedSummary.targetHint,
      comments: selectedSummary.comments,
    });

    const thinkingLevel = dependencies.getThinkingLevel();
    const fixRunInfo: ReviewFixRunInfo = {
      runId: dependencies.createRunId(),
      originLeafId,
      targetHint: selectedSummary.targetHint,
      reviewPrompt: fixPrompt,
      originModelProvider: model.provider,
      originModelId: model.id,
      originThinkingLevel: thinkingLevel,
      sourceReviewRunId: selectedSummary.runId,
      commentIds: selectedSummary.comments.map((comment) => comment.id),
    };

    await startFixRunIfSupported(ctx, fixRunInfo);

    activeRun = {
      ...fixRunInfo,
      kind: "fix",
      commandCtx: ctx,
      selectedComments: selectedSummary.comments,
    };
    sendPromptMessage(dependencies.pi, {
      kind: "prompt",
      mode: "fix",
      runId: fixRunInfo.runId,
      targetHint: fixRunInfo.targetHint,
      reviewPrompt: fixRunInfo.reviewPrompt,
      originModelProvider: fixRunInfo.originModelProvider,
      originModelId: fixRunInfo.originModelId,
      originThinkingLevel: fixRunInfo.originThinkingLevel,
      sourceReviewRunId: fixRunInfo.sourceReviewRunId,
      commentIds: fixRunInfo.commentIds,
    });

    ctx.ui.notify(`Fix branch started: ${fixRunInfo.runId}`, "info");
    dependencies.pi.sendUserMessage(fixPrompt);
  }

  return {
    handleReviewCommand,
    handleReviewDiffAgainstCommand,
    handleReviewPrCommand,
    handleReviewFixCommand,
    async handleAgentEnd(event, ctx): Promise<void> {
      if (activeRun === null) {
        return;
      }

      const run = activeRun;
      if (!agentEndMatchesRun(event, run)) {
        return;
      }

      const comments =
        run.kind === "review"
          ? dependencies.getCommentsForRun(
              { sessionManager: ctx.sessionManager },
              run.runId,
            )
          : run.selectedComments;

      let summary: ReviewBranchSummary | FixBranchSummary;
      if (run.kind === "review") {
        summary = buildReviewBranchSummary({
          runId: run.runId,
          targetHint: run.targetHint,
          reviewPrompt: run.reviewPrompt,
          comments,
          completedAt: dependencies.getNow(),
        });
      } else {
        summary = buildFixBranchSummary({
          runId: run.runId,
          sourceReviewRunId: run.sourceReviewRunId,
          targetHint: run.targetHint,
          fixPrompt: run.reviewPrompt,
          comments: run.selectedComments,
          agentSummary: extractAssistantSummary(event),
          completedAt: dependencies.getNow(),
        });
      }

      pendingSummaries.set(run.runId, {
        runId: run.runId,
        targetId: run.originLeafId,
        summary,
      });

      let collapseResult: { cancelled: boolean };
      const collapseLabel =
        run.kind === "review"
          ? `${REVIEW_SUMMARY_ENTRY}:${run.runId}`
          : `${REVIEW_FIX_SUMMARY_ENTRY}:${run.runId}`;

      try {
        collapseResult = await run.commandCtx.navigateTree(run.originLeafId, {
          summarize: true,
          label: collapseLabel,
        });
      } catch {
        return;
      }

      if (collapseResult.cancelled) {
        return;
      }

      const summaryEntryType =
        run.kind === "review"
          ? REVIEW_SUMMARY_ENTRY_TYPE
          : REVIEW_FIX_SUMMARY_ENTRY_TYPE;

      dependencies.pi.appendEntry(summaryEntryType, summary);
      sendSummaryMessage(dependencies.pi, summary);
      activeRun = null;
      dependencies.stateManager.clearActiveRun(run.commandCtx);
    },

    async handleSessionBeforeTree(event) {
      if (event.preparation.userWantsSummary === false) {
        return undefined;
      }

      const label = event.preparation.label;
      if (typeof label !== "string") {
        return undefined;
      }

      const prefix = extractLabelPrefix(label);
      if (prefix === undefined) {
        return undefined;
      }

      const runId = label.slice(`${prefix}:`.length);
      const pending = pendingSummaries.get(runId);
      if (pending === undefined) {
        return undefined;
      }

      const targetId = event.preparation.targetId;
      if (typeof targetId !== "string" || targetId !== pending.targetId) {
        return undefined;
      }

      pendingSummaries.delete(runId);

      return {
        summary: {
          summary: pending.summary.summary,
          details: pending.summary.details,
        },
      };
    },
  };
}
