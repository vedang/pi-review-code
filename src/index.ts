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
import {
  type ReviewStateManager,
  createReviewStateManager,
  getLatestReviewState,
} from "./state.js";
import { resolveReviewTarget } from "./targets.js";

export const REVIEW_HELP_TEXT = [
  "pi-review-code review flow is installed.",
  "Usage:",
  "- /review <review request>",
  "- /review-fix [list|latest|<review-run-id>|<finding-id>]",
  "- /review-diff-against <ref>",
  "- /review-pr <github-url|gitlab-url|github-number>",
].join("\n");

export const REVIEW_FIX_HELP_TEXT = [
  "pi-review-code fix flow is installed.",
  "Usage:",
  "- /review-fix",
  "- /review-fix latest",
  "- /review-fix list",
  "- /review-fix run <review-run-id>",
  "- /review-fix finding <finding-id> [<finding-id> ...]",
  "- /review-fix <review-run-id>",
  "- /review-fix <finding-id>",
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

type ReviewCommandDefinition = {
  name: "review-fix" | "review" | "review-diff-against" | "review-pr";
  description: string;
  helpText: string;
  hasEmptyArgsHelp?: boolean;
};

type ReviewRuntimeCommandDefinition = ReviewCommandDefinition & {
  runtimeHandler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
};

const REVIEW_COMMANDS = {
  reviewFix: {
    name: "review-fix",
    description: "Fix findings from a recent pi-review-code run",
    helpText: REVIEW_FIX_HELP_TEXT,
    hasEmptyArgsHelp: true,
  },
  review: {
    name: "review",
    description: "Start a context-rich code review",
    helpText: REVIEW_HELP_TEXT,
    hasEmptyArgsHelp: true,
  },
  reviewDiffAgainst: {
    name: "review-diff-against",
    description: "Start a context-rich code review from local diff",
    helpText: REVIEW_HELP_TEXT,
  },
  reviewPr: {
    name: "review-pr",
    description: "Start a context-rich code review from a PR",
    helpText: REVIEW_HELP_TEXT,
  },
} as const satisfies Record<string, ReviewCommandDefinition>;

export default function reviewCodeExtension(pi: ExtensionAPI): void {
  if (isReviewRendererRuntime(pi)) {
    registerReviewMessageRenderers(pi);
  }

  const stateManager = registerReviewRuntimeHelpers(pi);

  if (stateManager === null) {
    for (const command of Object.values(REVIEW_COMMANDS)) {
      registerInfoCommand(
        pi,
        command.name,
        command.description,
        command.helpText,
      );
    }
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
    const latestState = getLatestReviewState(ctx);

    if (latestState.activeKind === "review") {
      stateManager.clearActiveRun(ctx);
      if (ctx.hasUI) {
        ctx.ui.notify(
          `Abandoned persisted pi-review-code review ${latestState.runId} after extension reload; start /review again.`,
          "warning",
        );
      }
      return;
    }

    if (latestState.activeKind === "fix") {
      stateManager.clearActiveRun(ctx);
      if (ctx.hasUI) {
        ctx.ui.notify(
          `Abandoned persisted pi-review-code fix ${latestState.runId} after extension reload; start /review-fix again.`,
          "warning",
        );
      }
      return;
    }

    stateManager.refresh(ctx);
  });
  pi.on("agent_end", (event, ctx) => controller.handleAgentEnd(event, ctx));
  pi.on("session_before_tree", (event) =>
    controller.handleSessionBeforeTree(event),
  );

  const runtimeReviewCommands: ReviewRuntimeCommandDefinition[] = [
    {
      ...REVIEW_COMMANDS.reviewFix,
      runtimeHandler: (args, ctx) =>
        controller.handleReviewFixCommand(args, ctx),
    },
    {
      ...REVIEW_COMMANDS.review,
      runtimeHandler: (args, ctx) => controller.handleReviewCommand(args, ctx),
    },
    {
      ...REVIEW_COMMANDS.reviewDiffAgainst,
      runtimeHandler: (args, ctx) =>
        controller.handleReviewDiffAgainstCommand(args, ctx),
    },
    {
      ...REVIEW_COMMANDS.reviewPr,
      runtimeHandler: (args, ctx) =>
        controller.handleReviewPrCommand(args, ctx),
    },
  ];

  for (const command of runtimeReviewCommands) {
    pi.registerCommand(command.name, {
      description: command.description,
      handler: async (args, ctx) => {
        if (!ctx.hasUI) {
          return;
        }

        if (command.hasEmptyArgsHelp && args.trim().length === 0) {
          ctx.ui.notify(command.helpText, "info");
          return;
        }

        await command.runtimeHandler(args, ctx);
      },
    });
  }
}
