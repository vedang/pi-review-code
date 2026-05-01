import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";

import {
  getReviewCommentsForRun,
  registerAddReviewCommentTool,
} from "./comments.js";
import {
  type PiReviewThinkingLevel,
  completeReviewPromptDraftWithPiAi,
  generateReviewPromptDraft,
} from "./draft.js";
import { createReviewFlowController } from "./flow.js";
import { buildReviewPromptDraftRequest } from "./prompts.js";
import { registerReviewMessageRenderers } from "./renderers.js";
import { type ReviewStateManager, createReviewStateManager } from "./state.js";
import { resolveReviewTarget } from "./targets.js";

export const REVIEW_HELP_TEXT = [
  "pi-review-code review flow is installed.",
  "Usage:",
  "- /review diff-against <ref>",
  "- /review prompt <review request>",
  "- /review pr <github-url|gitlab-url|github-number>",
].join("\n");

export const REVIEW_FIX_HELP_TEXT = [
  "pi-review-code fix flow is installed.",
  "Usage:",
  "- /review-fix",
  "- /review-fix latest",
  "- /review-fix <run-id>",
].join("\n");

type ReviewRuntimeMethods = Pick<
  ExtensionAPI,
  "appendEntry" | "getActiveTools" | "registerTool" | "setActiveTools"
>;

type ReviewRendererMethods = Pick<ExtensionAPI, "registerMessageRenderer">;

type ReviewRuntimeAPI = ExtensionAPI & ReviewRuntimeMethods;
type ReviewRendererAPI = ExtensionAPI & ReviewRendererMethods;

function isReviewRuntime(pi: ExtensionAPI): pi is ReviewRuntimeAPI {
  const candidate = pi as Partial<Record<keyof ReviewRuntimeMethods, unknown>>;

  return (
    typeof candidate.registerTool === "function" &&
    typeof candidate.appendEntry === "function" &&
    typeof candidate.getActiveTools === "function" &&
    typeof candidate.setActiveTools === "function"
  );
}

function isReviewRendererRuntime(pi: ExtensionAPI): pi is ReviewRendererAPI {
  const candidate = pi as Partial<Record<keyof ReviewRendererMethods, unknown>>;

  return typeof candidate.registerMessageRenderer === "function";
}

function registerReviewRuntimeHelpers(
  pi: ExtensionAPI,
): ReviewStateManager | null {
  if (!isReviewRuntime(pi)) {
    return null;
  }

  const stateManager = createReviewStateManager(pi);

  registerAddReviewCommentTool(pi, {
    getState: () => stateManager.getState(),
    createId: () => crypto.randomUUID(),
    now: () => Date.now(),
  });

  return stateManager;
}

function registerInfoCommand(
  pi: ExtensionAPI,
  name: string,
  description: string,
  message: string,
): void {
  pi.registerCommand(name, {
    description,
    handler: async (_args, ctx: ExtensionCommandContext) => {
      if (ctx.hasUI) {
        ctx.ui.notify(message, "info");
      }
    },
  });
}

export default function reviewCodeExtension(pi: ExtensionAPI): void {
  if (isReviewRendererRuntime(pi)) {
    registerReviewMessageRenderers(pi);
  }

  const stateManager = registerReviewRuntimeHelpers(pi);

  if (stateManager === null) {
    registerInfoCommand(
      pi,
      "review-fix",
      "Fix findings from a recent pi-review-code run",
      REVIEW_FIX_HELP_TEXT,
    );
    registerInfoCommand(
      pi,
      "review",
      "Start a context-rich code review",
      REVIEW_HELP_TEXT,
    );
    return;
  }

  const controller = createReviewFlowController({
    pi: {
      appendEntry: (customType, data) => pi.appendEntry(customType, data),
      sendMessage: (message) => pi.sendMessage(message),
      sendUserMessage: (message) => pi.sendUserMessage(message),
    },
    stateManager,
    resolveTarget: (target) =>
      resolveReviewTarget(target, {
        exec: async (command, args) => {
          const result = await pi.exec(command, args);
          return {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.code,
          };
        },
      }),
    buildDraftRequest: buildReviewPromptDraftRequest,
    generateDraft: (request, context) =>
      generateReviewPromptDraft(request, {
        completeDraft: (draftRequest) =>
          completeReviewPromptDraftWithPiAi({
            request: draftRequest,
            model: context.model,
            modelRegistry: context.modelRegistry,
            thinkingLevel: context.thinkingLevel,
            signal: context.signal,
          }),
      }),
    getCommentsForRun: (context, runId) =>
      getReviewCommentsForRun(context, runId),
    createRunId: () => crypto.randomUUID(),
    getNow: () => Date.now(),
    getThinkingLevel: () => pi.getThinkingLevel() as PiReviewThinkingLevel,
  });

  pi.on("session_start", (_event, ctx) => {
    stateManager.refresh(ctx);
  });
  pi.on("agent_end", (event, ctx) => controller.handleAgentEnd(event, ctx));
  pi.on("session_before_tree", (event) =>
    controller.handleSessionBeforeTree(event),
  );

  pi.registerCommand("review-fix", {
    description: "Fix findings from a recent pi-review-code run",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        return;
      }

      await controller.handleReviewFixCommand(args, ctx);
    },
  });

  pi.registerCommand("review", {
    description: "Start a context-rich code review",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        return;
      }

      if (args.trim().length === 0) {
        ctx.ui.notify(REVIEW_HELP_TEXT, "info");
        return;
      }

      await controller.handleReviewCommand(args, ctx);
    },
  });
}
