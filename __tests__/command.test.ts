import assert from "node:assert/strict";
import test from "node:test";

import {
  REVIEW_DIFF_AGAINST_USAGE,
  REVIEW_FIX_USAGE,
  REVIEW_PR_USAGE,
  REVIEW_USAGE,
  buildReviewCommandFromInput,
  buildReviewDiffAgainstCommandFromInput,
  buildReviewPrCommandFromInput,
  parseReviewArgs,
  parseReviewDiffAgainstArgs,
  parseReviewPrArgs,
} from "../src/command.js";

function reviewPromptCommand(prompt: string) {
  return {
    kind: "review",
    target: { kind: "prompt", prompt, targetHint: prompt },
  };
}

function reviewDiffCommand(ref: string) {
  return {
    kind: "review",
    target: { kind: "diff-against", ref, targetHint: ref },
  };
}

function reviewPrCommand(selector: string) {
  return {
    kind: "review",
    target: { kind: "pr", selector, targetHint: selector },
  };
}

function assertUsageContains(usage: string, patterns: RegExp[]): void {
  for (const pattern of patterns) {
    assert.match(usage, pattern);
  }
}

function assertUsageExcludes(usage: string, patterns: RegExp[]): void {
  for (const pattern of patterns) {
    assert.doesNotMatch(usage, pattern);
  }
}

test("parses /review free-form requests as prompt targets", () => {
  const cases = [
    [
      "review the database schema and ensure column names are sensible",
      "review the database schema and ensure column names are sensible",
    ],
    [
      'review "database schema" and "column names"',
      "review database schema and column names",
    ],
    ["diff-against origin/main", "diff-against origin/main"],
    [
      "pr https://github.com/owner/repo/pull/1",
      "pr https://github.com/owner/repo/pull/1",
    ],
  ] as const;

  for (const [input, expectedPrompt] of cases) {
    assert.deepEqual(
      parseReviewArgs(input),
      reviewPromptCommand(expectedPrompt),
    );
  }
});

test("rejects missing /review request with exact usage", () => {
  assert.throws(() => parseReviewArgs(""), new Error(REVIEW_USAGE));
});

test("builds /review command from widget input with optional context", () => {
  assert.deepEqual(
    buildReviewCommandFromInput({
      prompt: "  review auth boundaries  ",
      reviewContext: "\nFocus on token refresh races.\n",
    }),
    {
      kind: "review",
      target: {
        kind: "prompt",
        prompt: "review auth boundaries",
        targetHint: "review auth boundaries",
        reviewContext: "Focus on token refresh races.",
      },
    },
  );

  assert.deepEqual(
    buildReviewCommandFromInput({
      prompt: "review auth boundaries",
      reviewContext: "   ",
    }),
    reviewPromptCommand("review auth boundaries"),
  );

  assert.throws(
    () => buildReviewCommandFromInput({ prompt: "   " }),
    new Error(REVIEW_USAGE),
  );
});

const singleTargetCommandCases = [
  {
    commandName: "review-diff-against",
    parse: parseReviewDiffAgainstArgs,
    validInput: "origin/main",
    quotedInput: '"change id"',
    validExpected: reviewDiffCommand("origin/main"),
    quotedExpected: reviewDiffCommand("change id"),
    missingMessage: "/review-diff-against requires a ref or change id.",
    extraInput: "origin/main extra",
    extraMessage: "/review-diff-against accepts exactly one ref or change id.",
  },
  {
    commandName: "review-pr",
    parse: parseReviewPrArgs,
    validInput: "https://github.com/owner/repo/pull/123",
    quotedInput: '"group/project!42"',
    validExpected: reviewPrCommand("https://github.com/owner/repo/pull/123"),
    quotedExpected: reviewPrCommand("group/project!42"),
    missingMessage:
      "/review-pr requires a GitHub URL, GitLab URL, or GitHub number.",
    extraInput: "123 extra",
    extraMessage:
      "/review-pr accepts exactly one GitHub URL, GitLab URL, or GitHub number.",
  },
] as const;

test("builds selector review commands from widget input with optional context", () => {
  assert.deepEqual(
    buildReviewDiffAgainstCommandFromInput({
      ref: " origin/main ",
      reviewContext: "Changed auth middleware.",
    }),
    {
      kind: "review",
      target: {
        kind: "diff-against",
        ref: "origin/main",
        targetHint: "origin/main",
        reviewContext: "Changed auth middleware.",
      },
    },
  );

  assert.deepEqual(
    buildReviewPrCommandFromInput({
      selector: " 123 ",
      reviewContext: "   ",
    }),
    reviewPrCommand("123"),
  );

  assert.throws(
    () => buildReviewDiffAgainstCommandFromInput({ ref: "" }),
    new Error("/review-diff-against requires a ref or change id."),
  );
  assert.throws(
    () => buildReviewPrCommandFromInput({ selector: "" }),
    new Error(
      "/review-pr requires a GitHub URL, GitLab URL, or GitHub number.",
    ),
  );
});

for (const testCase of singleTargetCommandCases) {
  test(`parses /${testCase.commandName} target`, () => {
    assert.deepEqual(
      testCase.parse(testCase.validInput),
      testCase.validExpected,
    );
    assert.deepEqual(
      testCase.parse(testCase.quotedInput),
      testCase.quotedExpected,
    );
  });

  test(`rejects invalid /${testCase.commandName} args`, () => {
    assert.throws(() => testCase.parse(""), new Error(testCase.missingMessage));
    assert.throws(
      () => testCase.parse(testCase.extraInput),
      new Error(testCase.extraMessage),
    );
    assert.throws(
      () => testCase.parse('""'),
      new Error(testCase.missingMessage),
    );
  });
}

test("review-specific usage constants mention only supported commands", () => {
  assertUsageContains(REVIEW_USAGE, [
    /\/review <review request>/,
    /\/review-diff-against <ref>/,
    /\/review-pr <github-url\|gitlab-url\|github-number>/,
    /\/review-fix$/m,
  ]);
  assertUsageContains(REVIEW_FIX_USAGE, [/\/review-fix$/m]);
  assertUsageExcludes(`${REVIEW_USAGE}\n${REVIEW_FIX_USAGE}`, [
    /\/review-fix .*list/,
    /\/review-fix .*latest/,
    /\/review-fix .*run/,
    /\/review-fix .*finding/,
    /<review-run-id>/,
    /<finding-id>/,
  ]);
  assertUsageContains(REVIEW_DIFF_AGAINST_USAGE, [
    /\/review-diff-against <ref>/,
  ]);
  assertUsageContains(REVIEW_PR_USAGE, [
    /\/review-pr <github-url\|gitlab-url\|github-number>/,
  ]);
});

test("rejects unterminated quotes", () => {
  for (const parse of [
    parseReviewArgs,
    parseReviewDiffAgainstArgs,
    parseReviewPrArgs,
  ]) {
    assert.throws(
      () => parse('"unfinished'),
      new Error("Unterminated quote in command arguments."),
    );
  }
});
