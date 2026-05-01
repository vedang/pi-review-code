import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  SessionBeforeTreeEvent,
} from "@mariozechner/pi-coding-agent";

import { parseReviewArgs } from "./command";
import type {
  PiReviewThinkingLevel,
  ReviewPromptDraftGenerationResult,
} from "./draft";
import type { ReviewPromptDraftRequest } from "./prompts";
import type {
  ResolvedReviewTarget,
  ReviewComment,
  ReviewTarget,
} from "./types";

export const REVIEW_ANCHOR_MESSAGE_TYPE = "pi-review-code:anchor";
export const REVIEW_SUMMARY_ENTRY_TYPE = "pi-review-code:review-summary";

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

export type ReviewSessionBeforeTreeResult = {
  summary: {
    summary: string;
    details: ReviewBranchSummaryDetails;
  };
};

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

type ReviewFlowController = {
  handleReviewCommand: (
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
  startReviewRun: (
    ctx: { hasUI: boolean },
    state: {
      runId: string;
      originLeafId: string;
      targetHint: string;
      reviewPrompt: string;
      originModelProvider: string;
      originModelId: string;
      originThinkingLevel: string;
    },
  ) => void;
  clearActiveRun: (ctx: { hasUI: boolean }) => void;
};

type ReviewFlowRuntime = Pick<ExtensionAPI, "appendEntry" | "sendUserMessage"> &
  Partial<Pick<ExtensionAPI, "sendMessage">>;

type ReviewFlowDependencies = {
  pi: ReviewFlowRuntime;
  stateManager: ReviewFlowStateManager;
  resolveTarget: ResolveTarget;
  buildDraftRequest: (target: ResolvedReviewTarget) => ReviewPromptDraftRequest;
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
  commandCtx: ExtensionCommandContext;
};

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

function agentEndMatchesRun(event: unknown, run: ActiveReviewRun): boolean {
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

  runtime.sendMessage?.({
    customType: REVIEW_ANCHOR_MESSAGE_TYPE,
    content: "pi-review-code review anchor",
    display: false,
    details: { purpose: "Anchor empty session before review branch." },
  });

  return getLeafId(ctx);
}

export function createReviewFlowController(
  dependencies: ReviewFlowDependencies,
): ReviewFlowController {
  let activeRun: ActiveReviewRun | null = null;
  const pendingSummaries = new Map<string, ReviewBranchSummary>();

  return {
    async handleReviewCommand(args, ctx): Promise<void> {
      if (!ctx.hasUI) {
        return;
      }

      const model = ctx.model;
      if (model === undefined) {
        ctx.ui.notify(
          "Cannot start review: no active model is selected.",
          "error",
        );
        return;
      }

      await ctx.waitForIdle();

      let command: ReturnType<typeof parseReviewArgs>;
      try {
        command = parseReviewArgs(args);
      } catch (error) {
        ctx.ui.notify(
          error instanceof Error
            ? error.message
            : "Cannot start review: invalid command arguments.",
          "error",
        );
        return;
      }

      if (command.target.kind === "pr") {
        ctx.ui.notify(
          "`/review pr` is not supported in this iteration. Use `/review diff-against` or `/review prompt`.",
          "error",
        );
        return;
      }

      const originLeafId = ensureOriginLeafId(ctx, dependencies.pi);
      if (originLeafId === null) {
        ctx.ui.notify(
          "Cannot start review: no current branch leaf id.",
          "error",
        );
        return;
      }

      let resolvedTarget: ResolvedReviewTarget;
      try {
        resolvedTarget = await dependencies.resolveTarget(command.target);
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
      const draftRequest = dependencies.buildDraftRequest(resolvedTarget);
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

      const editedPrompt = await ctx.ui.editor(
        "Edit review prompt",
        draft.draft,
      );
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
      activeRun = { ...runInfo, commandCtx: ctx };

      ctx.ui.notify(`Review branch started: ${runInfo.runId}`, "info");
      dependencies.pi.sendUserMessage(editedPrompt);
    },

    async handleAgentEnd(event, ctx): Promise<void> {
      if (activeRun === null) {
        return;
      }

      const run = activeRun;
      if (!agentEndMatchesRun(event, run)) {
        return;
      }

      const comments = dependencies.getCommentsForRun(
        { sessionManager: ctx.sessionManager },
        run.runId,
      );
      const summary = buildReviewBranchSummary({
        runId: run.runId,
        targetHint: run.targetHint,
        reviewPrompt: run.reviewPrompt,
        comments,
        completedAt: dependencies.getNow(),
      });

      pendingSummaries.set(run.runId, summary);

      let collapseResult: { cancelled: boolean };
      try {
        collapseResult = await run.commandCtx.navigateTree(run.originLeafId, {
          summarize: true,
          label: `review:${run.runId}`,
        });
      } catch {
        return;
      }

      if (collapseResult.cancelled) {
        return;
      }

      dependencies.pi.appendEntry(REVIEW_SUMMARY_ENTRY_TYPE, summary);
      activeRun = null;
      dependencies.stateManager.clearActiveRun(run.commandCtx);
    },

    async handleSessionBeforeTree(event) {
      if (event.preparation.userWantsSummary === false) {
        return undefined;
      }

      const label = event.preparation.label;
      if (typeof label !== "string" || !label.startsWith("review:")) {
        return undefined;
      }

      const runId = label.slice("review:".length);
      const summary = pendingSummaries.get(runId);
      if (summary === undefined) {
        return undefined;
      }

      pendingSummaries.delete(runId);

      return {
        summary: {
          summary: summary.summary,
          details: summary.details,
        },
      };
    },
  };
}
