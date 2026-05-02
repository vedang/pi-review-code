import type { ReviewCommand, ReviewTarget } from "./types.js";

function formatUsage(...lines: string[]): string {
  return ["Usage:", ...lines].join("\n");
}

export const REVIEW_USAGE = formatUsage(
  "  /review <review request>",
  "  /review-fix",
  "  /review-diff-against <ref>",
  "  /review-pr <github-url|gitlab-url|github-number>",
);

export const REVIEW_DIFF_AGAINST_USAGE = formatUsage(
  "  /review-diff-against <ref>",
);

export const REVIEW_PR_USAGE = formatUsage(
  "  /review-pr <github-url|gitlab-url|github-number>",
);

export const REVIEW_FIX_USAGE = formatUsage("  /review-fix");

const UNTERMINATED_QUOTE_ERROR = "Unterminated quote in command arguments.";

function tokenizeCommandArgs(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote: "'" | '"' | null = null;
  let tokenStarted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] ?? "";

    if (inQuote) {
      if (char === "\\") {
        const next = input[index + 1];
        if (next !== undefined) {
          current += next;
          index += 1;
          continue;
        }
      }

      if (char === inQuote) {
        inQuote = null;
        continue;
      }

      current += char;
      tokenStarted = true;
      continue;
    }

    if (char === '"' || char === "'") {
      tokenStarted = true;
      inQuote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (tokenStarted) {
        tokens.push(current);
        current = "";
        tokenStarted = false;
      }
      continue;
    }

    if (char === "\\") {
      const next = input[index + 1];
      if (next !== undefined) {
        tokenStarted = true;
        current += next;
        index += 1;
        continue;
      }
    }

    tokenStarted = true;
    current += char;
  }

  if (inQuote) {
    throw new Error(UNTERMINATED_QUOTE_ERROR);
  }

  if (tokenStarted) {
    tokens.push(current);
  }

  return tokens;
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0;
}

function requireNonBlank(
  value: string | undefined,
  errorMessage: string,
): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    throw new Error(errorMessage);
  }
  return trimmed;
}

function requireSingleArg(
  args: string[],
  missingMessage: string,
  extraMessage: string,
): string {
  if (args.length < 1 || isBlank(args[0])) {
    throw new Error(missingMessage);
  }
  if (args.length > 1) {
    throw new Error(extraMessage);
  }

  return args[0].trim();
}

function withReviewContext(reviewContext?: string): { reviewContext?: string } {
  const trimmed = reviewContext?.trim();
  return trimmed === undefined || trimmed.length === 0
    ? {}
    : { reviewContext: trimmed };
}

function parseSingleValueTarget(
  args: string[],
  missingMessage: string,
  extraMessage: string,
  buildTarget: (value: string) => ReviewTarget,
): ReviewTarget {
  return buildTarget(requireSingleArg(args, missingMessage, extraMessage));
}

function parsePromptText(input: string): ReviewCommand {
  const args = tokenizeCommandArgs(input);

  if (args.length === 0) {
    throw new Error(REVIEW_USAGE);
  }

  const promptText = args.join(" ").trim();
  if (isBlank(promptText)) {
    throw new Error(REVIEW_USAGE);
  }

  return {
    kind: "review",
    target: {
      kind: "prompt",
      prompt: promptText,
      targetHint: promptText,
    },
  };
}

function parseReviewDiffAgainstTargetArgs(args: string[]): ReviewTarget {
  return parseSingleValueTarget(
    args,
    "/review-diff-against requires a ref or change id.",
    "/review-diff-against accepts exactly one ref or change id.",
    (ref) => ({
      kind: "diff-against",
      ref,
      targetHint: ref,
    }),
  );
}

function parseReviewPrTargetArgs(args: string[]): ReviewTarget {
  return parseSingleValueTarget(
    args,
    "/review-pr requires a GitHub URL, GitLab URL, or GitHub number.",
    "/review-pr accepts exactly one GitHub URL, GitLab URL, or GitHub number.",
    (selector) => ({
      kind: "pr",
      selector,
      targetHint: selector,
    }),
  );
}

function parseReviewSelectorArgs(
  commandName: "diff-against" | "pr",
  args: string[],
): ReviewCommand {
  const target =
    commandName === "diff-against"
      ? parseReviewDiffAgainstTargetArgs(args)
      : parseReviewPrTargetArgs(args);

  return {
    kind: "review",
    target,
  };
}

export function buildReviewCommandFromInput(input: {
  prompt: string;
  reviewContext?: string;
}): ReviewCommand {
  const prompt = requireNonBlank(input.prompt, REVIEW_USAGE);

  return {
    kind: "review",
    target: {
      kind: "prompt",
      prompt,
      targetHint: prompt,
      ...withReviewContext(input.reviewContext),
    },
  };
}

export function buildReviewDiffAgainstCommandFromInput(input: {
  ref: string;
  reviewContext?: string;
}): ReviewCommand {
  const ref = requireNonBlank(
    input.ref,
    "/review-diff-against requires a ref or change id.",
  );

  return {
    kind: "review",
    target: {
      kind: "diff-against",
      ref,
      targetHint: ref,
      ...withReviewContext(input.reviewContext),
    },
  };
}

export function buildReviewPrCommandFromInput(input: {
  selector: string;
  reviewContext?: string;
}): ReviewCommand {
  const selector = requireNonBlank(
    input.selector,
    "/review-pr requires a GitHub URL, GitLab URL, or GitHub number.",
  );

  return {
    kind: "review",
    target: {
      kind: "pr",
      selector,
      targetHint: selector,
      ...withReviewContext(input.reviewContext),
    },
  };
}

export function parseReviewArgs(input: string): ReviewCommand {
  return parsePromptText(input);
}

export function parseReviewDiffAgainstArgs(input: string): ReviewCommand {
  return parseReviewSelectorArgs("diff-against", tokenizeCommandArgs(input));
}

export function parseReviewPrArgs(input: string): ReviewCommand {
  return parseReviewSelectorArgs("pr", tokenizeCommandArgs(input));
}
