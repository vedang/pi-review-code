import assert from "node:assert/strict";
import test from "node:test";

import {
  REVIEW_DIFF_AGAINST_USAGE,
  REVIEW_FIX_USAGE,
  REVIEW_PR_USAGE,
  REVIEW_USAGE,
  parseReviewArgs,
  parseReviewDiffAgainstArgs,
  parseReviewFixArgs,
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

test("review-specific usage constants mention renamed commands", () => {
  assert.match(REVIEW_USAGE, /\/review <review request>/);
  assert.match(REVIEW_USAGE, /\/review-diff-against <ref>/);
  assert.match(
    REVIEW_USAGE,
    /\/review-pr <github-url\|gitlab-url\|github-number>/,
  );
  assert.match(
    REVIEW_USAGE,
    /\/review-fix \[latest\|<review-run-id>\|<finding-id>\]/,
  );
  assert.match(REVIEW_DIFF_AGAINST_USAGE, /\/review-diff-against <ref>/);
  assert.match(
    REVIEW_PR_USAGE,
    /\/review-pr <github-url\|gitlab-url\|github-number>/,
  );
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

test("parses /review-fix selectors", () => {
  assert.deepEqual(parseReviewFixArgs(""), {
    kind: "review-fix",
    selector: { kind: "help" },
  });
  assert.deepEqual(parseReviewFixArgs("latest"), {
    kind: "review-fix",
    selector: { kind: "latest" },
  });
  assert.deepEqual(parseReviewFixArgs("rev_20260501_abc"), {
    kind: "review-fix",
    selector: { kind: "id", id: "rev_20260501_abc" },
  });
  assert.deepEqual(parseReviewFixArgs('"finding id"'), {
    kind: "review-fix",
    selector: { kind: "id", id: "finding id" },
  });
  assert.deepEqual(parseReviewFixArgs("run rev_20260501_abc"), {
    kind: "review-fix",
    selector: { kind: "run-id", runId: "rev_20260501_abc" },
  });
  assert.deepEqual(parseReviewFixArgs("finding 5044ff4b"), {
    kind: "review-fix",
    selector: { kind: "finding-id", findingId: "5044ff4b" },
  });
});

test("rejects invalid /review-fix selectors", () => {
  assert.throws(() => parseReviewFixArgs('""'), new Error(REVIEW_FIX_USAGE));
  assert.throws(() => parseReviewFixArgs("run"), new Error(REVIEW_FIX_USAGE));
  assert.throws(
    () => parseReviewFixArgs("finding"),
    new Error(REVIEW_FIX_USAGE),
  );
  assert.throws(
    () => parseReviewFixArgs("one two"),
    new Error(REVIEW_FIX_USAGE),
  );
});
