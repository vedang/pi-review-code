import type {
  ReviewCommand,
  ReviewFixCommand,
  ReviewFixSelector,
  ReviewTarget,
} from "./types.js";

function formatUsage(...lines: string[]): string {
  return ["Usage:", ...lines].join("\n");
}

export const REVIEW_USAGE = formatUsage(
  "  /review <review request>",
  "  /review-fix [list|latest|<review-run-id>|<finding-id>]",
  "  /review-diff-against <ref>",
  "  /review-pr <github-url|gitlab-url|github-number>",
);

export const REVIEW_DIFF_AGAINST_USAGE = formatUsage(
  "  /review-diff-against <ref>",
);

export const REVIEW_PR_USAGE = formatUsage(
  "  /review-pr <github-url|gitlab-url|github-number>",
);

export const REVIEW_FIX_USAGE = formatUsage(
  "  /review-fix",
  "  /review-fix latest",
  "  /review-fix list",
  "  /review-fix <review-run-id>",
  "  /review-fix <finding-id>",
  "  /review-fix run <review-run-id>",
  "  /review-fix finding <finding-id> [<finding-id> ...]",
);

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
  const ref = requireSingleArg(
    args,
    "/review-diff-against requires a ref or change id.",
    "/review-diff-against accepts exactly one ref or change id.",
  );

  return {
    kind: "diff-against",
    ref,
    targetHint: ref,
  };
}

function parseReviewPrTargetArgs(args: string[]): ReviewTarget {
  const selector = requireSingleArg(
    args,
    "/review-pr requires a GitHub URL, GitLab URL, or GitHub number.",
    "/review-pr accepts exactly one GitHub URL, GitLab URL, or GitHub number.",
  );

  return {
    kind: "pr",
    selector,
    targetHint: selector,
  };
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

  const reviewContext = input.reviewContext?.trim();

  return {
    kind: "review",
    target: {
      kind: "prompt",
      prompt,
      targetHint: prompt,
      ...(reviewContext === undefined || reviewContext.length === 0
        ? {}
        : { reviewContext }),
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

  const reviewContext = input.reviewContext?.trim();

  return {
    kind: "review",
    target: {
      kind: "diff-against",
      ref,
      targetHint: ref,
      ...(reviewContext === undefined || reviewContext.length === 0
        ? {}
        : { reviewContext }),
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

  const reviewContext = input.reviewContext?.trim();

  return {
    kind: "review",
    target: {
      kind: "pr",
      selector,
      targetHint: selector,
      ...(reviewContext === undefined || reviewContext.length === 0
        ? {}
        : { reviewContext }),
    },
  };
}

function parseFindingIds(args: string[]): string[] {
  const rawFindingIds = args;
  if (rawFindingIds.length === 0) {
    throw new Error(REVIEW_FIX_USAGE);
  }

  const findingIds: string[] = [];
  const seenFindingIds = new Set<string>();

  for (let index = 0; index < rawFindingIds.length; index += 1) {
    const rawFindingId = rawFindingIds[index] ?? "";
    const parts = rawFindingId.split(",");

    if (parts[0] === "") {
      throw new Error(REVIEW_FIX_USAGE);
    }

    const endsWithComma = parts.at(-1) === "";
    if (endsWithComma) {
      if (index === rawFindingIds.length - 1) {
        throw new Error(REVIEW_FIX_USAGE);
      }
      parts.pop();
    }

    for (const findingId of parts) {
      if (findingId === "") {
        throw new Error(REVIEW_FIX_USAGE);
      }

      if (!seenFindingIds.has(findingId)) {
        seenFindingIds.add(findingId);
        findingIds.push(findingId);
      }
    }
  }

  return findingIds;
}

function parseReviewFixSelector(args: string[]): ReviewFixSelector {
  if (args.length === 0) {
    return { kind: "help" };
  }

  if (args.length === 1) {
    const selectorText = requireNonBlank(args[0], REVIEW_FIX_USAGE);

    if (selectorText === "latest") {
      return { kind: "latest" };
    }

    if (selectorText === "list") {
      return { kind: "list" };
    }

    if (selectorText === "run" || selectorText === "finding") {
      throw new Error(REVIEW_FIX_USAGE);
    }

    return {
      kind: "id",
      id: selectorText,
    };
  }

  if (args.length >= 2) {
    const selectorType = args[0]?.trim() ?? "";
    const selectorArgs = args.slice(1);

    if (selectorType === "run") {
      if (selectorArgs.length !== 1) {
        throw new Error(REVIEW_FIX_USAGE);
      }

      return {
        kind: "run-id",
        runId: requireNonBlank(selectorArgs[0], REVIEW_FIX_USAGE),
      };
    }

    if (selectorType === "finding") {
      const usesMultiFindingSyntax =
        selectorArgs.length > 1 || (selectorArgs[0]?.includes(",") ?? false);
      const findingIds = parseFindingIds(selectorArgs);

      if (!usesMultiFindingSyntax && findingIds.length === 1) {
        return {
          kind: "finding-id",
          findingId: findingIds[0] ?? "",
        };
      }

      return {
        kind: "finding-ids",
        findingIds,
      };
    }
  }

  throw new Error(REVIEW_FIX_USAGE);
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

export function parseReviewFixArgs(input: string): ReviewFixCommand {
  const args = tokenizeCommandArgs(input);

  const selector = parseReviewFixSelector(args);
  return {
    kind: "review-fix",
    selector,
  };
}
