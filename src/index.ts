import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";

export const REVIEW_HELP_TEXT = [
  "pi-review-code scaffold is installed.",
  "Planned usage:",
  "- /review diff-against <ref>",
  "- /review prompt <review request>",
  "- /review pr <url-or-ref>",
  "Full review branch lifecycle will be added in later iterations.",
].join("\n");

export const REVIEW_FIX_HELP_TEXT = [
  "pi-review-code fix scaffold is installed.",
  "Planned usage:",
  "- /review-fix",
  "- /review-fix latest",
  "- /review-fix <run-id>",
  "Review comment selection and fix branch lifecycle will be added later.",
].join("\n");

function notifyInfo(ctx: ExtensionCommandContext, message: string): void {
  if (!ctx.hasUI) {
    return;
  }

  ctx.ui.notify(message, "info");
}

export default function reviewCodeExtension(pi: ExtensionAPI): void {
  pi.registerCommand("review", {
    description: "Start a context-rich code review",
    handler: async (_args, ctx) => {
      notifyInfo(ctx, REVIEW_HELP_TEXT);
    },
  });

  pi.registerCommand("review-fix", {
    description: "Fix findings from a recent pi-review-code run",
    handler: async (_args, ctx) => {
      notifyInfo(ctx, REVIEW_FIX_HELP_TEXT);
    },
  });
}
