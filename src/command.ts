import type {
  ReviewCommand,
  ReviewDiffAgainstTarget,
  ReviewFixCommand,
  ReviewFixRunIdSelector,
  ReviewFixSelector,
  ReviewPrTarget,
  ReviewPromptTarget,
  ReviewTarget,
} from "./types";

export const REVIEW_USAGE = [
  "Usage:",
  "  /review diff-against <ref>",
  "  /review prompt <review request>",
  "  /review pr <url-or-ref>",
].join("\n");

export const REVIEW_FIX_USAGE = [
  "Usage:",
  "  /review-fix",
  "  /review-fix latest",
  "  /review-fix <run-id>",
].join("\n");

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

function parseReviewTarget(targetKind: string, args: string[]): ReviewTarget {
  if (targetKind === "diff-against") {
    if (args.length < 1 || isBlank(args[0])) {
      throw new Error("/review diff-against requires a ref or change id.");
    }
    if (args.length > 1) {
      throw new Error(
        "/review diff-against accepts exactly one ref or change id.",
      );
    }

    const ref = args[0].trim();
    const target: ReviewDiffAgainstTarget = {
      kind: "diff-against",
      ref,
      targetHint: ref,
    };
    return target;
  }

  if (targetKind === "prompt") {
    const promptText = args.join(" ").trim();
    if (isBlank(promptText)) {
      throw new Error("/review prompt requires a review request.");
    }

    const target: ReviewPromptTarget = {
      kind: "prompt",
      prompt: promptText,
      targetHint: promptText,
    };
    return target;
  }

  if (targetKind === "pr") {
    if (args.length < 1 || isBlank(args[0])) {
      throw new Error("/review pr requires a PR/MR URL, number, or ref.");
    }
    if (args.length > 1) {
      throw new Error(
        "/review pr accepts exactly one PR/MR URL, number, or ref.",
      );
    }

    const selector = args[0].trim();
    const target: ReviewPrTarget = {
      kind: "pr",
      selector,
      targetHint: selector,
    };
    return target;
  }

  throw new Error(
    `Unknown /review target "${targetKind}". Expected diff-against, prompt, or pr.`,
  );
}

function parseReviewFixSelector(args: string[]): ReviewFixSelector {
  if (args.length === 0) {
    return { kind: "latest" };
  }

  if (args.length !== 1 || isBlank(args[0])) {
    throw new Error(REVIEW_FIX_USAGE);
  }

  const selectorText = args[0].trim();
  if (selectorText === "latest") {
    return { kind: "latest" };
  }

  const selector: ReviewFixRunIdSelector = {
    kind: "run-id",
    runId: selectorText,
  };
  return selector;
}

export function parseReviewArgs(input: string): ReviewCommand {
  const args = tokenizeCommandArgs(input);

  if (args.length === 0) {
    throw new Error(REVIEW_USAGE);
  }

  const targetKind = args[0];
  if (!targetKind) {
    throw new Error(REVIEW_USAGE);
  }

  const target = parseReviewTarget(targetKind, args.slice(1));

  return {
    kind: "review",
    target,
  };
}

export function parseReviewFixArgs(input: string): ReviewFixCommand {
  const args = tokenizeCommandArgs(input);

  const selector = parseReviewFixSelector(args);
  return {
    kind: "review-fix",
    selector,
  };
}
