import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  SessionBeforeTreeEvent,
  ToolCallEvent,
  ToolCallEventResult,
} from "@mariozechner/pi-coding-agent";

import {
  REVIEW_FIX_USAGE,
  buildReviewCommandFromInput,
  buildReviewDiffAgainstCommandFromInput,
  buildReviewPrCommandFromInput,
  parseReviewArgs,
  parseUnifiedReviewArgs,
} from "./command.js";
import type { PiReviewThinkingLevel } from "./draft.js";
import type { ReviewPromptDraftOptions } from "./prompts.js";
import {
  buildReviewFixPrompt,
  buildReviewMetaPassPrompt,
  buildReviewMetaSystemPrompt,
} from "./prompts.js";
import type {
  ReviewFixWidgetConfig,
  ReviewFixWidgetResult,
} from "./review-fix-widget.js";
import {
  type AddReviewCommentReference,
  REVIEW_COMMENT_PRIORITIES,
  REVIEW_STATE_VERSION,
  type ResolvedReviewTarget,
  type ReviewActiveRunInfo,
  type ReviewComment,
  type ReviewFixRunInfo,
  type ReviewMetaResult,
  type ReviewMetaRunInfo,
  type ReviewState,
  type ReviewTarget,
} from "./types.js";

export const REVIEW_ANCHOR_MESSAGE_TYPE = "pi-review-code:anchor";
export const REVIEW_PROMPT_ENTRY_TYPE = "pi-review-code:prompt";
export const REVIEW_SUMMARY_ENTRY_TYPE = "pi-review-code:review-summary";
export const REVIEW_FIX_SUMMARY_ENTRY_TYPE =
  "pi-review-code:review-fix-summary";
export const REVIEW_META_PROMPT_ENTRY_TYPE = "pi-review-code:meta-prompt";
export const REVIEW_META_SUMMARY_ENTRY_TYPE = "pi-review-code:meta-summary";

type ReviewPromptRunDetails = Omit<ReviewActiveRunInfo, "originLeafId">;
type ReviewMetaPromptRunDetails = Omit<ReviewMetaRunInfo, "originLeafId">;

export type ReviewMetaPromptMessageDetails = ReviewMetaPromptRunDetails & {
  kind: "meta-prompt";
};

export type BuildReviewMetaBranchSummaryInput = {
  runId: string;
  targetHint: string;
  metaPrompt: string;
  result: ReviewMetaResult;
  completedAt: number;
};

export type ReviewMetaBranchSummaryDetails = {
  kind: "meta";
  runId: string;
  targetHint: string;
  metaPrompt: string;
  reviewPrompt: string;
  completedAt: number;
  summary?: string;
};

export type ReviewMetaBranchSummary = {
  summary: string;
  details: ReviewMetaBranchSummaryDetails;
};

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

export type ReviewPromptMessageDetails = ReviewPromptRunDetails & {
  kind: "prompt";
  mode: "review" | "fix";
  sourceReviewRunId?: string;
  commentIds?: string[];
  fixContext?: string;
};

export type BuildFixBranchSummaryInput = {
  runId: string;
  sourceReviewRunId: string;
  targetHint: string;
  fixPrompt: string;
  comments: ReviewComment[];
  agentSummary: string;
  completedAt: number;
  fixContext?: string;
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
  fixContext?: string;
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
      findings: ReviewFixWidgetFinding[];
      reviewRunId?: string;
      targetHint?: string;
      completedAt?: number;
    }
  | {
      ok: false;
      reason: "no-review-findings";
      findings: [];
    };

export type ReviewSessionBeforeTreeResult = {
  summary: {
    summary: string;
    details:
      | ReviewMetaBranchSummaryDetails
      | ReviewBranchSummaryDetails
      | FixBranchSummaryDetails;
  };
};
type ReviewInputWidgetKind = "review" | "diff-against" | "pr";

type ReviewInputWidgetConfig = {
  title: string;
  helpText: string;
  initialKind?: ReviewInputWidgetKind;
  initialPrimaryValue?: string;
  initialContext?: string;
};

type ReviewInputWidgetResult =
  | {
      submitted: true;
      kind: ReviewInputWidgetKind;
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

type ShowFixWidget = (
  ctx: ExtensionCommandContext,
  config: ReviewFixWidgetConfig,
) => Promise<ReviewFixWidgetResult>;

const REVIEW_WIDGET_HELP_TEXT =
  "Usage:\n  /review [target or request]\n  choose review type in the widget";
const REVIEW_WIDGET_CANCELLED_MESSAGE = "Review cancelled.";
const REVIEW_FIX_WIDGET_CANCELLED_MESSAGE = "Review-fix cancelled.";
const REVIEW_NO_ACTIVE_MODEL_ERROR =
  "Cannot start review: no active model is selected.";

const REVIEW_WIDGET_INVALID_ARGS_ERROR =
  "Cannot start review: invalid command arguments.";

const REVIEW_WIDGET_BASE_TITLE = "Start review";

const REVIEW_FIX_WIDGET_TITLE = "Start review fix";
const REVIEW_FIX_WIDGET_HELP_TEXT =
  "Select unfixed findings from completed reviews and start a focused fix run.";
const REVIEW_FIX_BARE_HELP_MESSAGE =
  "Run /review-fix and select findings in the widget.";
const REVIEW_FIX_REVALIDATE_ERROR =
  "Cannot start review-fix: selected findings are no longer available.";

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

function normalizeOptionalText(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function withFixContext(fixContext?: string): { fixContext?: string } {
  const normalized = normalizeOptionalText(fixContext);
  return normalized === undefined ? {} : { fixContext: normalized };
}

export function buildReviewMetaBranchSummary(
  input: BuildReviewMetaBranchSummaryInput,
): ReviewMetaBranchSummary {
  const summaryLines = [
    `pi-review-code review prompt meta-pass ${input.runId}`,
    `Target: ${input.targetHint}`,
    `Meta prompt: ${input.metaPrompt}`,
    "",
    `Generated review prompt: ${input.result.reviewPrompt}`,
  ];

  const normalizedSummary = normalizeOptionalText(input.result.summary);
  if (normalizedSummary !== undefined) {
    summaryLines.push("", `Meta-pass summary: ${normalizedSummary}`);
  }

  return {
    summary: summaryLines.join("\n"),
    details: {
      kind: "meta",
      runId: input.runId,
      targetHint: input.targetHint,
      metaPrompt: input.metaPrompt,
      reviewPrompt: input.result.reviewPrompt,
      completedAt: input.completedAt,
      ...(normalizedSummary === undefined
        ? {}
        : { summary: normalizedSummary }),
    },
  };
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

  const fixContextDetails = withFixContext(input.fixContext);
  const fixContextLine =
    fixContextDetails.fixContext === undefined
      ? []
      : ["", `Fix context: ${fixContextDetails.fixContext}`];
  const summaryLines = [
    `pi-review-code review-fix ${input.runId}`,
    `Source review: ${input.sourceReviewRunId}`,
    `Target: ${input.targetHint}`,
    `Prompt: ${input.fixPrompt}`,
    ...fixContextLine,
    "",
    ...findingLines,
    "",
    `Agent summary: ${input.agentSummary}`,
  ];

  return {
    summary: summaryLines.join("\n"),
    details: {
      kind: "fix",
      runId: input.runId,
      sourceReviewRunId: input.sourceReviewRunId,
      targetHint: input.targetHint,
      fixPrompt: input.fixPrompt,
      completedAt: input.completedAt,
      comments: input.comments,
      agentSummary: input.agentSummary,
      ...fixContextDetails,
    },
  };
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

function reviewFindingKey(reviewRunId: string, findingId: string): string {
  return `${reviewRunId}:${findingId}`;
}

type ReviewFixEntryScan = {
  reviews: ParsedReviewSummaryForFix[];
  fixedFindingKeys: Set<string>;
};

function scanReviewFixEntries(entries: unknown[]): ReviewFixEntryScan {
  const reviews: ParsedReviewSummaryForFix[] = [];
  const fixedFindingKeys = new Set<string>();

  for (let index = 0; index < entries.length; index += 1) {
    const review = parseReviewSummaryForFixEntry(entries[index], index);
    if (review !== undefined) {
      reviews.push(review);
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

  return { reviews, fixedFindingKeys };
}

function sortReviewSummariesByRecency(
  reviews: ParsedReviewSummaryForFix[],
): ParsedReviewSummaryForFix[] {
  return [...reviews].sort((a, b) => {
    if (a.completedAt > b.completedAt) {
      return -1;
    }

    if (a.completedAt < b.completedAt) {
      return 1;
    }

    return b.order - a.order;
  });
}

export function buildReviewFixWidgetData(
  entries: unknown[],
): ReviewFixWidgetData {
  const { reviews, fixedFindingKeys } = scanReviewFixEntries(entries);
  const sortedReviews = sortReviewSummariesByRecency(reviews);
  const dedupedReviews: ParsedReviewSummaryForFix[] = [];
  const reviewedRunIds = new Set<string>();

  for (const review of sortedReviews) {
    if (reviewedRunIds.has(review.runId)) {
      continue;
    }

    reviewedRunIds.add(review.runId);
    dedupedReviews.push(review);
  }

  const findings: ReviewFixWidgetFinding[] = [];
  for (const review of dedupedReviews) {
    for (const comment of review.comments) {
      findings.push({
        reviewRunId: review.runId,
        targetHint: review.targetHint,
        completedAt: review.completedAt,
        comment,
        fixed: fixedFindingKeys.has(reviewFindingKey(review.runId, comment.id)),
      });
    }
  }

  const openReviewRunIds = new Set(
    findings
      .filter((finding) => !finding.fixed)
      .map((finding) => finding.reviewRunId),
  );

  const visibleFindings = findings.filter((finding) =>
    openReviewRunIds.has(finding.reviewRunId),
  );
  if (visibleFindings.length === 0) {
    return {
      ok: false,
      reason: "no-review-findings",
      findings: [],
    };
  }

  const reviewRunIds = new Set(
    visibleFindings.map((finding) => finding.reviewRunId),
  );
  const hasSingleReviewRun = reviewRunIds.size === 1;
  const firstVisibleFinding = visibleFindings[0];

  return {
    ok: true,
    findings: visibleFindings,
    ...(hasSingleReviewRun
      ? {
          reviewRunId: firstVisibleFinding?.reviewRunId,
          targetHint: firstVisibleFinding?.targetHint,
          completedAt: firstVisibleFinding?.completedAt,
        }
      : {}),
  };
}

type ReviewFlowController = {
  handleReviewCommand: (
    args: string,
    ctx: ExtensionCommandContext,
  ) => Promise<void>;

  handleReviewFixCommand: (
    args: string,
    ctx: ExtensionCommandContext,
  ) => Promise<void>;
  handleBeforeAgentStart: (
    event: { prompt: string; systemPrompt: string; type?: string },
    ctx: ExtensionContext,
  ) => Promise<{ systemPrompt: string } | undefined>;
  handleToolCall: (
    event: ToolCallEvent,
    ctx: ExtensionContext,
  ) => ToolCallEventResult | undefined;
  handleAgentEnd: (event: unknown, ctx: ExtensionContext) => Promise<void>;
  handleSessionBeforeTree: (
    event: Pick<SessionBeforeTreeEvent, "preparation">,
  ) => Promise<ReviewSessionBeforeTreeResult | undefined>;
};

type ResolveTarget = (target: ReviewTarget) => Promise<ResolvedReviewTarget>;

type GetCommentsForRun = (
  context: { sessionManager: ExtensionContext["sessionManager"] },
  runId: string,
) => ReviewComment[];

type ReviewFlowStateManager = {
  getState: () => ReviewState;
  startMetaRun: (ctx: { hasUI: boolean }, state: ReviewMetaRunInfo) => void;
  startReviewRun: (ctx: { hasUI: boolean }, state: ReviewActiveRunInfo) => void;
  startFixRun?: (ctx: { hasUI: boolean }, state: ReviewFixRunInfo) => void;
  clearActiveRun: (ctx: { hasUI: boolean }) => void;
};

type ReviewFlowRuntime = Pick<ExtensionAPI, "appendEntry" | "sendUserMessage"> &
  Partial<Pick<ExtensionAPI, "sendMessage">>;

type ReviewFlowDependencies = {
  pi: ReviewFlowRuntime;
  stateManager: ReviewFlowStateManager;
  resolveTarget: ResolveTarget;
  readReviewGuidelines?: () => Promise<string | undefined>;
  getCommentsForRun: GetCommentsForRun;
  getMetaResultForRun: (
    context: { sessionManager: ExtensionContext["sessionManager"] },
    runId: string,
  ) => ReviewMetaResult | undefined;
  getThinkingLevel: () => PiReviewThinkingLevel;
  createRunId: () => string;
  getNow: () => number;
  showInputWidget?: ShowInputWidget;
  showFixWidget?: ShowFixWidget;
};

type ReviewLaunchContext = {
  model: NonNullable<ExtensionCommandContext["model"]>;
  originLeafId: string;
  resolvedTarget: ResolvedReviewTarget;
  promptOptions: ReviewPromptDraftOptions;
  thinkingLevel: PiReviewThinkingLevel;
};

type ActiveMetaRun = ReviewMetaRunInfo & {
  kind: "meta";
  commandCtx: ExtensionCommandContext;
  launchContext: ReviewLaunchContext;
  owned: boolean;
};

type ActiveReviewRun = ReviewActiveRunInfo & {
  kind: "review";
  commandCtx: ExtensionCommandContext;
};

type ActiveFixRun = ReviewFixRunInfo & {
  kind: "fix";
  commandCtx: ExtensionCommandContext;
  selectedComments: ReviewComment[];
};

const REVIEW_META_SUMMARY_ENTRY = "review-meta";
const REVIEW_SUMMARY_ENTRY = "review";
const REVIEW_FIX_SUMMARY_ENTRY = "review-fix";

type ActiveReviewRunState = ActiveMetaRun | ActiveReviewRun | ActiveFixRun;
type ActiveReviewCompletionRunState = ActiveReviewRun | ActiveFixRun;

type PendingSummary = {
  runId: string;
  targetId: string;
  summary: ReviewMetaBranchSummary | ReviewBranchSummary | FixBranchSummary;
};

function agentEndMatchesPrompt(
  event: unknown,
  expectedPrompt: string,
): boolean {
  if (!isRecord(event) || !Array.isArray(event.messages)) {
    return false;
  }

  const normalizedExpectedPrompt = expectedPrompt.trim();

  return event.messages.some((message) => {
    if (!isRecord(message) || message.role !== "user") {
      return false;
    }

    return (
      extractTextContent(message.content).trim() === normalizedExpectedPrompt
    );
  });
}

function agentEndMatchesRun(
  event: unknown,
  run: ActiveReviewCompletionRunState,
): boolean {
  return agentEndMatchesPrompt(event, run.reviewPrompt);
}

function agentEndMatchesMetaRun(event: unknown, run: ActiveMetaRun): boolean {
  return agentEndMatchesPrompt(event, run.metaPrompt);
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
  if (label.startsWith("review-meta:")) {
    return REVIEW_META_SUMMARY_ENTRY;
  }

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

function buildMetaPromptMessageContent(
  details: ReviewMetaPromptMessageDetails,
): string {
  return `Review prompt meta-pass ${details.runId}`;
}

function sendMetaPromptMessage(
  runtime: ReviewFlowRuntime,
  details: ReviewMetaPromptMessageDetails,
): void {
  runtime.sendMessage?.({
    customType: REVIEW_META_PROMPT_ENTRY_TYPE,
    content: buildMetaPromptMessageContent(details),
    display: true,
    details,
  });
}

function buildSummaryMessageContent(
  summary: ReviewMetaBranchSummary | ReviewBranchSummary | FixBranchSummary,
): string {
  if (summary.details.kind === "meta") {
    return `Review prompt ready ${summary.details.runId}.`;
  }

  const count = summary.details.comments.length;
  const findingText = `${count} finding${count === 1 ? "" : "s"}`;

  if (summary.details.kind === "review") {
    return `Review findings ${summary.details.runId} completed with ${findingText}.`;
  }

  return `Review-fix ${summary.details.runId} completed for ${findingText}.`;
}

function sendSummaryMessage(
  runtime: ReviewFlowRuntime,
  summary: ReviewMetaBranchSummary | ReviewBranchSummary | FixBranchSummary,
): void {
  const summaryEntryType = {
    meta: REVIEW_META_SUMMARY_ENTRY_TYPE,
    review: REVIEW_SUMMARY_ENTRY_TYPE,
    fix: REVIEW_FIX_SUMMARY_ENTRY_TYPE,
  }[summary.details.kind];

  runtime.sendMessage?.({
    customType: summaryEntryType,
    content: buildSummaryMessageContent(summary),
    display: true,
    details: summary.details,
  });
}

export function createReviewFlowController(
  dependencies: ReviewFlowDependencies,
): ReviewFlowController {
  let activeRun: ActiveReviewRunState | null = null;
  let pendingLaunch: "review" | "review-fix" | null = null;
  const pendingSummaries = new Map<string, PendingSummary>();

  type BlockingRun =
    | { kind: "meta" | "review" | "fix"; runId: string }
    | { kind: "review-launch" | "review-fix-launch" };

  const BLOCKING_RUN_LABELS = {
    meta: "review prompt meta-pass",
    review: "review",
    fix: "review-fix",
    "review-launch": "review launch",
    "review-fix-launch": "review-fix launch",
  } as const satisfies Record<BlockingRun["kind"], string>;

  function getBlockingActiveRun(): BlockingRun | undefined {
    const state = dependencies.stateManager.getState();
    if (state.activeKind !== null) {
      return { kind: state.activeKind, runId: state.runId };
    }

    if (activeRun !== null) {
      return { kind: activeRun.kind, runId: activeRun.runId };
    }

    if (pendingLaunch !== null) {
      return { kind: `${pendingLaunch}-launch` };
    }

    return undefined;
  }

  function describeBlockingRun(blockingRun: BlockingRun): string {
    const label = BLOCKING_RUN_LABELS[blockingRun.kind];
    if ("runId" in blockingRun) {
      return `${label} ${blockingRun.runId} is still active.`;
    }

    return `${label} is already in progress.`;
  }

  async function withPendingLaunch(
    launch: NonNullable<typeof pendingLaunch>,
    action: () => Promise<void>,
  ): Promise<void> {
    pendingLaunch = launch;
    try {
      await action();
    } finally {
      pendingLaunch = null;
    }
  }

  function notifyIfActiveRun(
    ctx: ExtensionCommandContext,
    commandName: "review" | "review-fix",
  ): boolean {
    const blockingRun = getBlockingActiveRun();
    if (blockingRun === undefined) {
      return false;
    }

    ctx.ui.notify(
      `Cannot start ${commandName}: pi-review-code ${describeBlockingRun(blockingRun)}`,
      "error",
    );
    return true;
  }

  function buildPromptOptions(
    resolvedTarget: ResolvedReviewTarget,
    reviewGuidelines?: string,
  ): ReviewPromptDraftOptions {
    const promptOptions: ReviewPromptDraftOptions = {};
    if (
      resolvedTarget.kind === "diff-against" &&
      resolvedTarget.diffText !== undefined
    ) {
      promptOptions.diffText = resolvedTarget.diffText;
    }

    const normalizedReviewGuidelines = normalizeOptionalText(reviewGuidelines);
    if (normalizedReviewGuidelines !== undefined) {
      promptOptions.reviewGuidelines = normalizedReviewGuidelines;
    }

    return promptOptions;
  }

  async function resolveReviewLaunchContext(
    target: ReviewTarget,
    ctx: ExtensionCommandContext,
  ): Promise<ReviewLaunchContext | undefined> {
    const model = ctx.model;
    if (model === undefined) {
      ctx.ui.notify(REVIEW_NO_ACTIVE_MODEL_ERROR, "error");
      return undefined;
    }

    await ctx.waitForIdle();

    const originLeafId = ensureOriginLeafId(ctx, dependencies.pi);
    if (originLeafId === null) {
      ctx.ui.notify("Cannot start review: no current branch leaf id.", "error");
      return undefined;
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
      return undefined;
    }

    let reviewGuidelines: string | undefined;
    if (dependencies.readReviewGuidelines !== undefined) {
      try {
        reviewGuidelines = await dependencies.readReviewGuidelines();
      } catch (error) {
        ctx.ui.notify(
          error instanceof Error
            ? error.message
            : "Failed to load repository review guidelines.",
          "error",
        );
        return undefined;
      }
    }

    return {
      model,
      originLeafId,
      resolvedTarget,
      promptOptions: buildPromptOptions(resolvedTarget, reviewGuidelines),
      thinkingLevel: dependencies.getThinkingLevel(),
    };
  }

  function startReviewFromPrompt(
    launchContext: ReviewLaunchContext,
    ctx: ExtensionCommandContext,
    reviewPrompt: string,
  ): void {
    const runInfo: ReviewActiveRunInfo = {
      runId: dependencies.createRunId(),
      originLeafId: launchContext.originLeafId,
      targetHint: launchContext.resolvedTarget.targetHint,
      reviewPrompt,
      originModelProvider: launchContext.model.provider,
      originModelId: launchContext.model.id,
      originThinkingLevel: launchContext.thinkingLevel,
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
    dependencies.pi.sendUserMessage(reviewPrompt);
  }

  function startMetaPass(
    launchContext: ReviewLaunchContext,
    ctx: ExtensionCommandContext,
  ): void {
    const runId = dependencies.createRunId();
    const metaPrompt = buildReviewMetaPassPrompt(launchContext.resolvedTarget, {
      ...launchContext.promptOptions,
      runId,
    });
    const runInfo: ReviewMetaRunInfo = {
      runId,
      originLeafId: launchContext.originLeafId,
      targetHint: launchContext.resolvedTarget.targetHint,
      metaPrompt,
      originModelProvider: launchContext.model.provider,
      originModelId: launchContext.model.id,
      originThinkingLevel: launchContext.thinkingLevel,
    };

    dependencies.stateManager.startMetaRun(ctx, runInfo);
    activeRun = {
      ...runInfo,
      kind: "meta",
      commandCtx: ctx,
      launchContext,
      owned: false,
    };
    sendMetaPromptMessage(dependencies.pi, {
      kind: "meta-prompt",
      runId: runInfo.runId,
      targetHint: runInfo.targetHint,
      metaPrompt: runInfo.metaPrompt,
      originModelProvider: runInfo.originModelProvider,
      originModelId: runInfo.originModelId,
      originThinkingLevel: runInfo.originThinkingLevel,
    });

    ctx.ui.notify(`Starting review prompt meta-pass: ${runInfo.runId}`, "info");
    dependencies.pi.sendUserMessage(metaPrompt);
  }

  async function launchReview(
    target: ReviewTarget,
    ctx: ExtensionCommandContext,
  ): Promise<void> {
    const launchContext = await resolveReviewLaunchContext(target, ctx);
    if (launchContext === undefined) {
      return;
    }

    startMetaPass(launchContext, ctx);
  }

  function buildWidgetConfig(prefill: {
    initialKind?: ReviewInputWidgetKind;
    initialPrimaryValue?: string;
  }): ReviewInputWidgetConfig {
    const config: ReviewInputWidgetConfig = {
      title: REVIEW_WIDGET_BASE_TITLE,
      helpText: REVIEW_WIDGET_HELP_TEXT,
    };

    if (prefill.initialKind !== undefined) {
      config.initialKind = prefill.initialKind;
    }

    if (prefill.initialPrimaryValue !== undefined) {
      config.initialPrimaryValue = prefill.initialPrimaryValue;
    }

    return config;
  }

  function getErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
  }

  function buildTargetFromWidgetInput(
    input: Extract<ReviewInputWidgetResult, { submitted: true }>,
  ): ReviewTarget {
    switch (input.kind) {
      case "review":
        return buildReviewCommandFromInput({
          prompt: input.primaryValue,
          reviewContext: input.reviewContext,
        }).target;
      case "diff-against":
        return buildReviewDiffAgainstCommandFromInput({
          ref: input.primaryValue,
          reviewContext: input.reviewContext,
        }).target;
      case "pr":
        return buildReviewPrCommandFromInput({
          selector: input.primaryValue,
          reviewContext: input.reviewContext,
        }).target;
    }
  }

  async function handleReviewCommand(
    args: string,
    ctx: ExtensionCommandContext,
  ): Promise<void> {
    if (!ctx.hasUI) {
      return;
    }

    if (notifyIfActiveRun(ctx, "review")) {
      return;
    }

    await withPendingLaunch("review", async () => {
      if (dependencies.showInputWidget === undefined) {
        if (args.trim().length === 0) {
          ctx.ui.notify(REVIEW_WIDGET_HELP_TEXT, "info");
          return;
        }

        let command: { target: ReviewTarget };
        try {
          command = parseReviewArgs(args);
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

      let prefill: ReturnType<typeof parseUnifiedReviewArgs>;
      try {
        prefill = parseUnifiedReviewArgs(args);
      } catch (error) {
        ctx.ui.notify(
          getErrorMessage(error, REVIEW_WIDGET_INVALID_ARGS_ERROR),
          "error",
        );
        return;
      }

      if (ctx.model === undefined) {
        ctx.ui.notify(REVIEW_NO_ACTIVE_MODEL_ERROR, "error");
        return;
      }

      const input = await dependencies.showInputWidget(
        ctx,
        buildWidgetConfig(prefill),
      );
      if (input.submitted === false) {
        ctx.ui.notify(REVIEW_WIDGET_CANCELLED_MESSAGE, "info");
        return;
      }

      let target: ReviewTarget;
      try {
        target = buildTargetFromWidgetInput(input);
      } catch (error) {
        ctx.ui.notify(
          getErrorMessage(error, REVIEW_WIDGET_INVALID_ARGS_ERROR),
          "error",
        );
        return;
      }

      await launchReview(target, ctx);
    });
  }

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

  function buildSelectedReviewSummaryForWidgetResult(
    entries: unknown[],
    result: { reviewRunId: string; findingIds: string[] },
  ): ReviewSummaryForFix | undefined {
    const { reviews, fixedFindingKeys } = scanReviewFixEntries(entries);
    const selectedReview = sortReviewSummariesByRecency(
      reviews.filter((review) => review.runId === result.reviewRunId),
    )[0];

    if (selectedReview === undefined || selectedReview.comments.length === 0) {
      return undefined;
    }

    const commentById = new Map(
      selectedReview.comments.map((comment) => [comment.id, comment]),
    );
    const selectedIds = new Set(result.findingIds);

    if (selectedIds.size === 0) {
      return undefined;
    }

    for (const findingId of selectedIds) {
      const comment = commentById.get(findingId);
      if (
        comment === undefined ||
        fixedFindingKeys.has(reviewFindingKey(result.reviewRunId, findingId))
      ) {
        return undefined;
      }
    }

    const emittedIds = new Set<string>();
    const comments = selectedReview.comments.filter((comment) => {
      if (!selectedIds.has(comment.id) || emittedIds.has(comment.id)) {
        return false;
      }

      emittedIds.add(comment.id);
      return true;
    });

    if (comments.length !== selectedIds.size) {
      return undefined;
    }

    return {
      runId: selectedReview.runId,
      targetHint: selectedReview.targetHint,
      reviewPrompt: selectedReview.reviewPrompt,
      completedAt: selectedReview.completedAt,
      comments,
    };
  }

  async function handleBeforeAgentStart(
    event: { prompt: string; systemPrompt: string; type?: string },
    ctx: ExtensionContext,
  ): Promise<{ systemPrompt: string } | undefined> {
    const state = dependencies.stateManager.getState();
    if (state.activeKind !== "meta") {
      return undefined;
    }

    if (event.prompt !== state.metaPrompt) {
      if (activeRun?.kind === "meta" && activeRun.runId === state.runId) {
        activeRun = null;
      }
      dependencies.stateManager.clearActiveRun(ctx);
      if (ctx.hasUI) {
        ctx.ui.notify(
          `Abandoned pi-review-code review prompt meta-pass ${state.runId}: next turn did not match the meta-pass prompt.`,
          "warning",
        );
      }
      return undefined;
    }

    if (activeRun?.kind === "meta" && activeRun.runId === state.runId) {
      activeRun = { ...activeRun, owned: true };
    }

    const metaSystemPrompt = buildReviewMetaSystemPrompt({
      runId: state.runId,
      targetHint: state.targetHint,
    });

    return {
      systemPrompt: `${event.systemPrompt}\n\n${metaSystemPrompt}`,
    };
  }

  function handleToolCall(
    event: ToolCallEvent,
    ctx: ExtensionContext,
  ): ToolCallEventResult | undefined {
    const state = dependencies.stateManager.getState();
    if (state.activeKind !== "meta") {
      return undefined;
    }

    if (event.toolName !== "edit" && event.toolName !== "write") {
      return undefined;
    }

    const reason = `pi-review-code review prompt meta-pass ${state.runId} is read-only; ${event.toolName} is blocked. Use read/search/browser tools, then call set_review_prompt.`;
    if (ctx.hasUI) {
      ctx.ui.notify(reason, "warning");
    }

    return { block: true, reason };
  }

  async function handleReviewFixCommand(
    args: string,
    ctx: ExtensionCommandContext,
  ) {
    if (!ctx.hasUI) {
      return;
    }

    if (notifyIfActiveRun(ctx, "review-fix")) {
      return;
    }

    await withPendingLaunch("review-fix", async () => {
      if (args.trim().length > 0) {
        ctx.ui.notify(REVIEW_FIX_BARE_HELP_MESSAGE, "info");
        return;
      }

      if (dependencies.showFixWidget === undefined) {
        ctx.ui.notify(REVIEW_FIX_USAGE, "info");
        return;
      }

      const widgetData = buildReviewFixWidgetData(
        ctx.sessionManager.getEntries(),
      );
      const selectedResult = await dependencies.showFixWidget(ctx, {
        title: REVIEW_FIX_WIDGET_TITLE,
        helpText: REVIEW_FIX_WIDGET_HELP_TEXT,
        ...(widgetData.ok
          ? {
              reviewRunId: widgetData.reviewRunId,
              targetHint: widgetData.targetHint,
              completedAt: widgetData.completedAt,
            }
          : {}),
        findings: widgetData.findings.map((finding) => ({
          id: finding.comment.id,
          priority: finding.comment.priority,
          comment: finding.comment.comment,
          references: finding.comment.references,
          fixed: finding.fixed,
          reviewRunId: finding.reviewRunId,
          targetHint: finding.targetHint,
          completedAt: finding.completedAt,
        })),
      });

      if (selectedResult.submitted === false) {
        ctx.ui.notify(REVIEW_FIX_WIDGET_CANCELLED_MESSAGE, "info");
        return;
      }

      const revalidated = buildSelectedReviewSummaryForWidgetResult(
        ctx.sessionManager.getEntries(),
        selectedResult,
      );

      if (revalidated === undefined) {
        ctx.ui.notify(REVIEW_FIX_REVALIDATE_ERROR, "error");
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

      const optionalFixContext = withFixContext(selectedResult.fixContext);
      const fixContext = optionalFixContext.fixContext;

      const fixPrompt = buildReviewFixPrompt({
        reviewRunId: revalidated.runId,
        targetHint: revalidated.targetHint,
        comments: revalidated.comments,
        fixContext,
      });

      const thinkingLevel = dependencies.getThinkingLevel();
      const fixRunInfo: ReviewFixRunInfo = {
        runId: dependencies.createRunId(),
        originLeafId,
        targetHint: revalidated.targetHint,
        reviewPrompt: fixPrompt,
        originModelProvider: model.provider,
        originModelId: model.id,
        originThinkingLevel: thinkingLevel,
        sourceReviewRunId: revalidated.runId,
        commentIds: revalidated.comments.map((comment) => comment.id),
        ...optionalFixContext,
      };

      await startFixRunIfSupported(ctx, fixRunInfo);

      activeRun = {
        ...fixRunInfo,
        kind: "fix",
        commandCtx: ctx,
        selectedComments: revalidated.comments,
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
        ...optionalFixContext,
      });
      ctx.ui.notify(`Fix branch started: ${fixRunInfo.runId}`, "info");
      dependencies.pi.sendUserMessage(fixPrompt);
    });
  }

  function sleep(ms = 0): Promise<void> {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  function isCurrentMetaRun(run: ActiveMetaRun): boolean {
    return activeRun?.kind === "meta" && activeRun.runId === run.runId;
  }

  async function waitForContextDrain(
    ctx: ExtensionCommandContext,
  ): Promise<void> {
    while (true) {
      if (!ctx.isIdle()) {
        await ctx.waitForIdle();
        continue;
      }

      if (ctx.hasPendingMessages()) {
        await sleep(25);
        continue;
      }

      return;
    }
  }

  async function waitForMetaRunDrain(run: ActiveMetaRun): Promise<boolean> {
    while (isCurrentMetaRun(run)) {
      if (!run.commandCtx.isIdle()) {
        await run.commandCtx.waitForIdle();
        continue;
      }

      if (run.commandCtx.hasPendingMessages()) {
        await sleep(25);
        continue;
      }

      return true;
    }

    return false;
  }

  function abandonMetaRun(run: ActiveMetaRun, message: string): void {
    if (isCurrentMetaRun(run)) {
      activeRun = null;
    }
    pendingSummaries.delete(run.runId);
    dependencies.stateManager.clearActiveRun(run.commandCtx);
    if (run.commandCtx.hasUI) {
      run.commandCtx.ui.notify(message, "error");
    }
  }

  async function runMetaPromptEditorHandoff(
    run: ActiveMetaRun,
    result: ReviewMetaResult,
  ): Promise<void> {
    try {
      await waitForContextDrain(run.commandCtx);

      const originLeafId = ensureOriginLeafId(run.commandCtx, dependencies.pi);
      if (originLeafId === null) {
        run.commandCtx.ui.notify(
          "Cannot start review: no current branch leaf id after meta-pass collapse.",
          "error",
        );
        return;
      }

      const editedPrompt = await run.commandCtx.ui.editor(
        "Edit review prompt",
        result.reviewPrompt,
      );
      if (editedPrompt === undefined) {
        run.commandCtx.ui.notify(
          "Review cancelled before branch launch.",
          "info",
        );
        return;
      }

      startReviewFromPrompt(
        { ...run.launchContext, originLeafId },
        run.commandCtx,
        editedPrompt,
      );
    } catch (error) {
      if (activeRun?.kind === "review") {
        activeRun = null;
        dependencies.stateManager.clearActiveRun(run.commandCtx);
      }
      run.commandCtx.ui.notify(
        `Review prompt handoff failed after meta-pass ${run.runId}: ${getErrorMessage(error, "handoff failed")}`,
        "error",
      );
    } finally {
      if (pendingLaunch === "review") {
        pendingLaunch = null;
      }
    }
  }

  function scheduleMetaPromptEditorHandoff(
    run: ActiveMetaRun,
    result: ReviewMetaResult,
  ): void {
    pendingLaunch = "review";
    setTimeout(() => {
      void runMetaPromptEditorHandoff(run, result).catch((error: unknown) => {
        if (pendingLaunch === "review") {
          pendingLaunch = null;
        }
        run.commandCtx.ui.notify(
          `Review prompt handoff failed after meta-pass ${run.runId}: ${getErrorMessage(error, "handoff failed")}`,
          "error",
        );
      });
    }, 0);
  }

  async function handleMetaAgentEnd(
    run: ActiveMetaRun,
    ctx: ExtensionContext,
  ): Promise<void> {
    if (!(await waitForMetaRunDrain(run))) {
      return;
    }

    const result = dependencies.getMetaResultForRun(
      { sessionManager: ctx.sessionManager },
      run.runId,
    );
    if (result === undefined) {
      abandonMetaRun(
        run,
        `Review prompt meta-pass ${run.runId} ended without set_review_prompt; review was not started.`,
      );
      return;
    }

    const summary = buildReviewMetaBranchSummary({
      runId: run.runId,
      targetHint: run.targetHint,
      metaPrompt: run.metaPrompt,
      result,
      completedAt: dependencies.getNow(),
    });

    pendingSummaries.set(run.runId, {
      runId: run.runId,
      targetId: run.originLeafId,
      summary,
    });

    const collapseLabel = `${REVIEW_META_SUMMARY_ENTRY}:${run.runId}`;
    let collapseResult: { cancelled: boolean };
    try {
      collapseResult = await run.commandCtx.navigateTree(run.originLeafId, {
        summarize: true,
        label: collapseLabel,
      });
    } catch (error) {
      abandonMetaRun(
        run,
        `Review prompt meta-pass ${run.runId} collapse failed: ${getErrorMessage(error, "tree navigation failed")}`,
      );
      return;
    }

    if (collapseResult.cancelled) {
      abandonMetaRun(
        run,
        `Review prompt meta-pass ${run.runId} collapse cancelled; review was not started.`,
      );
      return;
    }

    dependencies.pi.appendEntry(REVIEW_META_SUMMARY_ENTRY_TYPE, summary);
    sendSummaryMessage(dependencies.pi, summary);
    activeRun = null;
    dependencies.stateManager.clearActiveRun(run.commandCtx);
    run.commandCtx.ui.notify(`Review prompt ready: ${run.runId}`, "info");
    scheduleMetaPromptEditorHandoff(run, result);
  }

  return {
    handleReviewCommand,
    handleReviewFixCommand,
    handleBeforeAgentStart,
    handleToolCall,
    async handleAgentEnd(event, ctx): Promise<void> {
      if (activeRun === null) {
        return;
      }

      const run = activeRun;
      if (run.kind === "meta") {
        if (!run.owned || !agentEndMatchesMetaRun(event, run)) {
          return;
        }

        activeRun = { ...run, owned: false };
        setTimeout(() => {
          void handleMetaAgentEnd(run, ctx);
        }, 0);
        return;
      }

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
          ...withFixContext(run.fixContext),
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
