import assert from "node:assert/strict";
import test from "node:test";

import {
  REVIEW_FIX_USAGE,
  REVIEW_USAGE,
  buildReviewCommandFromInput,
  buildReviewDiffAgainstCommandFromInput,
  buildReviewPrCommandFromInput,
  parseReviewArgs,
  parseUnifiedReviewArgs,
} from "../src/command.js";

function reviewPromptCommand(prompt: string) {
  return {
    kind: "review",
    target: { kind: "prompt", prompt, targetHint: prompt },
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
    new Error("Select diff against ref and enter a ref or change id."),
  );
  assert.throws(
    () => buildReviewPrCommandFromInput({ selector: "" }),
    new Error(
      "Select PR/MR and enter a GitHub URL, GitLab URL, MR URL, or PR number.",
    ),
  );
});

test("parses unified /review widget prefill args", () => {
  assert.deepEqual(parseUnifiedReviewArgs(""), {});
  assert.deepEqual(parseUnifiedReviewArgs("   \t"), {});
  assert.deepEqual(parseUnifiedReviewArgs('review "database schema"'), {
    initialKind: "review",
    initialPrimaryValue: "review database schema",
  });
  assert.deepEqual(parseUnifiedReviewArgs("diff-against origin/main"), {
    initialKind: "diff-against",
    initialPrimaryValue: "origin/main",
  });
  assert.deepEqual(parseUnifiedReviewArgs("diff origin/main"), {
    initialKind: "diff-against",
    initialPrimaryValue: "origin/main",
  });
  assert.deepEqual(parseUnifiedReviewArgs("diff-against"), {
    initialKind: "diff-against",
  });
  assert.deepEqual(
    parseUnifiedReviewArgs("pr https://github.com/owner/repo/pull/123"),
    {
      initialKind: "pr",
      initialPrimaryValue: "https://github.com/owner/repo/pull/123",
    },
  );
  assert.deepEqual(parseUnifiedReviewArgs("mr 42"), {
    initialKind: "pr",
    initialPrimaryValue: "42",
  });
  assert.deepEqual(
    parseUnifiedReviewArgs("https://github.com/owner/repo/pull/123"),
    {
      initialKind: "pr",
      initialPrimaryValue: "https://github.com/owner/repo/pull/123",
    },
  );
  assert.deepEqual(
    parseUnifiedReviewArgs(
      "https://gitlab.com/group/project/-/merge_requests/42",
    ),
    {
      initialKind: "pr",
      initialPrimaryValue:
        "https://gitlab.com/group/project/-/merge_requests/42",
    },
  );
  assert.deepEqual(parseUnifiedReviewArgs("123"), {
    initialKind: "pr",
    initialPrimaryValue: "123",
  });
  assert.deepEqual(parseUnifiedReviewArgs("origin/main"), {
    initialKind: "review",
    initialPrimaryValue: "origin/main",
  });
  assert.deepEqual(parseUnifiedReviewArgs("abc123"), {
    initialKind: "review",
    initialPrimaryValue: "abc123",
  });
});

test("review-specific usage constants mention only supported commands", () => {
  assertUsageContains(REVIEW_USAGE, [
    /\/review \[target or request\]/,
    /choose review type/m,
    /\/review-fix$/m,
  ]);
  assertUsageContains(REVIEW_FIX_USAGE, [/\/review-fix$/m]);
  assertUsageExcludes(`${REVIEW_USAGE}\n${REVIEW_FIX_USAGE}`, [
    /\/review-diff-against/,
    /\/review-pr/,
    /\/review-fix .*list/,
    /\/review-fix .*latest/,
    /\/review-fix .*run/,
    /\/review-fix .*finding/,
    /<review-run-id>/,
    /<finding-id>/,
  ]);
});

test("rejects unterminated quotes", () => {
  for (const parse of [parseReviewArgs, parseUnifiedReviewArgs]) {
    assert.throws(
      () => parse('"unfinished'),
      new Error("Unterminated quote in command arguments."),
    );
  }
});
