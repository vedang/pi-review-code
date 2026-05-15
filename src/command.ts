import type { ReviewCommand } from "./types.js";

function formatUsage(...lines: string[]): string {
  return ["Usage:", ...lines].join("\n");
}

export const REVIEW_USAGE = formatUsage(
  "  /review [target or request]",
  "  choose review type in the widget",
  "  run prompt-generation meta-pass before final review",
  "  /review-fix",
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

function withReviewContext(reviewContext?: string): { reviewContext?: string } {
  const trimmed = reviewContext?.trim();
  return trimmed === undefined || trimmed.length === 0
    ? {}
    : { reviewContext: trimmed };
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

const DIFF_AGAINST_REQUIRED_MESSAGE =
  "Select diff against ref and enter a ref or change id.";
const PR_REQUIRED_MESSAGE =
  "Select PR/MR and enter a GitHub URL, GitLab URL, MR URL, or PR number.";

type UnifiedReviewPrefillKind = "review" | "diff-against" | "pr";

const UNIFIED_REVIEW_KIND_PREFIXES: Partial<
  Record<string, UnifiedReviewPrefillKind>
> = {
  "diff-against": "diff-against",
  diff: "diff-against",
  pr: "pr",
  mr: "pr",
};

export type ParsedUnifiedReviewArgs = {
  initialKind?: UnifiedReviewPrefillKind;
  initialPrimaryValue?: string;
};

function isPullOrMergeRequestUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      /\/pull\/\d+\/?$/.test(url.pathname) ||
      /\/-\/merge_requests\/\d+\/?$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function isPrLikeSelector(value: string): boolean {
  return /^\d+$/.test(value) || isPullOrMergeRequestUrl(value);
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
  const ref = requireNonBlank(input.ref, DIFF_AGAINST_REQUIRED_MESSAGE);

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
  const selector = requireNonBlank(input.selector, PR_REQUIRED_MESSAGE);

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

export function parseUnifiedReviewArgs(input: string): ParsedUnifiedReviewArgs {
  const args = tokenizeCommandArgs(input);

  if (args.length === 0) {
    return {};
  }

  const explicitKind = UNIFIED_REVIEW_KIND_PREFIXES[args[0] ?? ""];
  if (explicitKind !== undefined) {
    const explicitPrimaryValue = args.slice(1).join(" ").trim();
    return {
      initialKind: explicitKind,
      ...(explicitPrimaryValue.length > 0
        ? { initialPrimaryValue: explicitPrimaryValue }
        : {}),
    };
  }

  const primaryValue = args.join(" ").trim();

  return {
    initialKind:
      args.length === 1 && isPrLikeSelector(primaryValue) ? "pr" : "review",
    initialPrimaryValue: primaryValue,
  };
}
