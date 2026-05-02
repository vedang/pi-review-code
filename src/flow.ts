import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  SessionBeforeTreeEvent,
} from "@mariozechner/pi-coding-agent";

import {
  REVIEW_FIX_USAGE,
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

export type ReviewSessionBeforeTreeResult = {
  summary: {
    summary: string;
    details: ReviewBranchSummaryDetails | FixBranchSummaryDetails;
  };
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
      case "finding-ids":
        break;

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
  if (summary.details.kind === "review") {
    const count = summary.details.comments.length;
    return `Review ${summary.details.runId} completed with ${count} finding${count === 1 ? "" : "s"}.`;
  }

  const count = summary.details.comments.length;
  return `Review-fix ${summary.details.runId} completed for ${count} finding${count === 1 ? "" : "s"}.`;
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

  function createReviewCommandHandler(parser: ReviewCommandParser) {
    return async (
      args: string,
      ctx: ExtensionCommandContext,
    ): Promise<void> => {
      if (!ctx.hasUI) {
        return;
      }

      let command: { target: ReviewTarget };
      try {
        command = parser(args);
      } catch (error) {
        ctx.ui.notify(
          error instanceof Error
            ? error.message
            : "Cannot start review: invalid command arguments.",
          "error",
        );
        return;
      }

      await launchReview(command.target, ctx);
    };
  }

  const handleReviewCommand = createReviewCommandHandler(parseReviewArgs);
  const handleReviewDiffAgainstCommand = createReviewCommandHandler(
    parseReviewDiffAgainstArgs,
  );
  const handleReviewPrCommand = createReviewCommandHandler(parseReviewPrArgs);

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
