import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

import {
  getReviewCommentsForRun,
  registerAddReviewCommentTool,
} from "./comments.js";
import type { PiReviewThinkingLevel } from "./draft.js";
import { createReviewFlowController } from "./flow.js";
import { readReviewGuidelinesFromCwd } from "./guidelines.js";
import {
  getReviewMetaResultForRun,
  registerSetReviewPromptTool,
} from "./meta-result.js";
import { registerReviewMessageRenderers } from "./renderers.js";
import { showReviewFixWidget } from "./review-fix-widget.js";
import { showReviewInputWidget } from "./review-input-widget.js";
import {
  type ReviewStateManager,
  createReviewStateManager,
  getLatestReviewState,
} from "./state.js";
import { resolveReviewTarget } from "./targets.js";
import type { ReviewState } from "./types.js";

export const REVIEW_HELP_TEXT = [
  "pi-review-code review flow is installed.",
  "Usage:",
  "- /review [target or request]",
  "  Choose review type in the widget: free-form, diff against ref, or PR/MR.",
  "  Runs a prompt-generation meta-pass, opens the prompt editor, then starts the final review.",
  "- /review-fix",
].join("\n");

export const REVIEW_FIX_HELP_TEXT = [
  "pi-review-code fix flow is installed.",
  "Usage:",
  "- /review-fix",
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

  registerSetReviewPromptTool(pi, {
    getState: () => stateManager.getState(),
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
  name: "review-fix" | "review";
  description: string;
  helpText: string;
};

type ActivePersistedReviewState = Exclude<ReviewState, { activeKind: null }>;

type ReviewRuntimeCommandDefinition = ReviewCommandDefinition & {
  runtimeHandler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
};

const REVIEW_COMMANDS = {
  reviewFix: {
    name: "review-fix",
    description: "Fix findings from a recent pi-review-code run",
    helpText: REVIEW_FIX_HELP_TEXT,
  },
  review: {
    name: "review",
    description: "Generate a rich prompt, then start a code review",
    helpText: REVIEW_HELP_TEXT,
  },
} as const satisfies Record<string, ReviewCommandDefinition>;

const PERSISTED_RUN_RELOAD_COPY = {
  meta: { label: "review prompt meta-pass", retryCommand: "/review" },
  review: { label: "review", retryCommand: "/review" },
  fix: { label: "fix", retryCommand: "/review-fix" },
} as const satisfies Record<
  ActivePersistedReviewState["activeKind"],
  { label: string; retryCommand: string }
>;

function buildPersistedRunReloadMessage(
  state: ActivePersistedReviewState,
): string {
  const copy = PERSISTED_RUN_RELOAD_COPY[state.activeKind];

  return `Abandoned persisted pi-review-code ${copy.label} ${state.runId} after extension reload; start ${copy.retryCommand} again.`;
}

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
      sendMessage: (message, options) => pi.sendMessage(message, options),
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
    readReviewGuidelines: () => readReviewGuidelinesFromCwd(),
    getCommentsForRun: (context, runId) =>
      getReviewCommentsForRun(context, runId),
    getMetaResultForRun: (context, runId) =>
      getReviewMetaResultForRun(context, runId),
    createRunId: () => crypto.randomUUID(),
    getNow: () => Date.now(),
    getThinkingLevel: () => pi.getThinkingLevel() as PiReviewThinkingLevel,
    showInputWidget: showReviewInputWidget,
    showFixWidget: showReviewFixWidget,
  });

  pi.on("session_start", (_event, ctx) => {
    const latestState = getLatestReviewState(ctx);

    if (latestState.activeKind !== null) {
      stateManager.clearActiveRun(ctx);
      if (ctx.hasUI) {
        ctx.ui.notify(buildPersistedRunReloadMessage(latestState), "warning");
      }
      return;
    }

    stateManager.refresh(ctx);
  });
  pi.on("before_agent_start", (event, ctx) =>
    controller.handleBeforeAgentStart(event, ctx),
  );
  pi.on("tool_call", (event, ctx) => controller.handleToolCall(event, ctx));
  // Keep agent_end: controller uses this low-level boundary to schedule follow-up work.
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
  ];

  for (const command of runtimeReviewCommands) {
    pi.registerCommand(command.name, {
      description: command.description,
      handler: async (args, ctx) => {
        if (!ctx.hasUI) {
          return;
        }

        await command.runtimeHandler(args, ctx);
      },
    });
  }
}
