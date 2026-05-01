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

test("parses /review free-form request as prompt target", () => {
  assert.deepEqual(
    parseReviewArgs(
      "review the database schema and ensure column names are sensible",
    ),
    {
      kind: "review",
      target: {
        kind: "prompt",
        prompt:
          "review the database schema and ensure column names are sensible",
        targetHint:
          "review the database schema and ensure column names are sensible",
      },
    },
  );
});

test("parses quoted words inside /review free-form text", () => {
  assert.deepEqual(
    parseReviewArgs('review "database schema" and "column names"'),
    {
      kind: "review",
      target: {
        kind: "prompt",
        prompt: "review database schema and column names",
        targetHint: "review database schema and column names",
      },
    },
  );
});

test("treats old /review subcommands as free-form prompt text", () => {
  assert.deepEqual(parseReviewArgs("diff-against origin/main"), {
    kind: "review",
    target: {
      kind: "prompt",
      prompt: "diff-against origin/main",
      targetHint: "diff-against origin/main",
    },
  });
  assert.deepEqual(parseReviewArgs("pr https://github.com/owner/repo/pull/1"), {
    kind: "review",
    target: {
      kind: "prompt",
      prompt: "pr https://github.com/owner/repo/pull/1",
      targetHint: "pr https://github.com/owner/repo/pull/1",
    },
  });
});

test("rejects missing /review request with exact usage", () => {
  assert.throws(() => parseReviewArgs(""), new Error(REVIEW_USAGE));
});

test("parses /review-diff-against target", () => {
  assert.deepEqual(parseReviewDiffAgainstArgs("origin/main"), {
    kind: "review",
    target: {
      kind: "diff-against",
      ref: "origin/main",
      targetHint: "origin/main",
    },
  });
});

test("parses quoted /review-diff-against target", () => {
  assert.deepEqual(parseReviewDiffAgainstArgs('"change id"'), {
    kind: "review",
    target: {
      kind: "diff-against",
      ref: "change id",
      targetHint: "change id",
    },
  });
});

test("rejects missing /review-diff-against ref", () => {
  assert.throws(
    () => parseReviewDiffAgainstArgs(""),
    new Error("/review-diff-against requires a ref or change id."),
  );
});

test("rejects extra /review-diff-against args", () => {
  assert.throws(
    () => parseReviewDiffAgainstArgs("origin/main extra"),
    new Error("/review-diff-against accepts exactly one ref or change id."),
  );
});

test("rejects empty quoted /review-diff-against ref", () => {
  assert.throws(
    () => parseReviewDiffAgainstArgs('""'),
    new Error("/review-diff-against requires a ref or change id."),
  );
});

test("parses /review-pr target", () => {
  assert.deepEqual(
    parseReviewPrArgs("https://github.com/owner/repo/pull/123"),
    {
      kind: "review",
      target: {
        kind: "pr",
        selector: "https://github.com/owner/repo/pull/123",
        targetHint: "https://github.com/owner/repo/pull/123",
      },
    },
  );
});

test("parses quoted /review-pr target", () => {
  assert.deepEqual(parseReviewPrArgs('"group/project!42"'), {
    kind: "review",
    target: {
      kind: "pr",
      selector: "group/project!42",
      targetHint: "group/project!42",
    },
  });
});

test("rejects missing /review-pr selector", () => {
  assert.throws(
    () => parseReviewPrArgs(""),
    new Error(
      "/review-pr requires a GitHub URL, GitLab URL, or GitHub number.",
    ),
  );
});

test("rejects extra /review-pr args", () => {
  assert.throws(
    () => parseReviewPrArgs("123 extra"),
    new Error(
      "/review-pr accepts exactly one GitHub URL, GitLab URL, or GitHub number.",
    ),
  );
});

test("rejects empty quoted /review-pr selector", () => {
  assert.throws(
    () => parseReviewPrArgs('""'),
    new Error(
      "/review-pr requires a GitHub URL, GitLab URL, or GitHub number.",
    ),
  );
});

test("review-specific usage constants mention renamed commands", () => {
  assert.match(REVIEW_USAGE, /\/review <review request>/);
  assert.match(REVIEW_USAGE, /\/review-diff-against <ref>/);
  assert.match(
    REVIEW_USAGE,
    /\/review-pr <github-url\|gitlab-url\|github-number>/,
  );
  assert.match(REVIEW_USAGE, /\/review-fix \[latest\|run-id\]/);
  assert.match(REVIEW_DIFF_AGAINST_USAGE, /\/review-diff-against <ref>/);
  assert.match(
    REVIEW_PR_USAGE,
    /\/review-pr <github-url\|gitlab-url\|github-number>/,
  );
});

test("rejects unterminated quotes", () => {
  assert.throws(
    () => parseReviewArgs('review "unfinished'),
    new Error("Unterminated quote in command arguments."),
  );
  assert.throws(
    () => parseReviewDiffAgainstArgs('"unfinished'),
    new Error("Unterminated quote in command arguments."),
  );
  assert.throws(
    () => parseReviewPrArgs('"unfinished'),
    new Error("Unterminated quote in command arguments."),
  );
});

test("parses default /review-fix selector as latest", () => {
  assert.deepEqual(parseReviewFixArgs(""), {
    kind: "review-fix",
    selector: { kind: "latest" },
  });
});

test("parses explicit latest /review-fix selector", () => {
  assert.deepEqual(parseReviewFixArgs("latest"), {
    kind: "review-fix",
    selector: { kind: "latest" },
  });
});

test("parses run-id /review-fix selector", () => {
  assert.deepEqual(parseReviewFixArgs("rev_20260501_abc"), {
    kind: "review-fix",
    selector: { kind: "run-id", runId: "rev_20260501_abc" },
  });
});

test("parses quoted run-id /review-fix selector", () => {
  assert.deepEqual(parseReviewFixArgs('"rev id"'), {
    kind: "review-fix",
    selector: { kind: "run-id", runId: "rev id" },
  });
});

test("rejects empty quoted /review-fix selector", () => {
  assert.throws(() => parseReviewFixArgs('""'), new Error(REVIEW_FIX_USAGE));
});

test("rejects too many /review-fix args", () => {
  assert.throws(
    () => parseReviewFixArgs("one two"),
    new Error(REVIEW_FIX_USAGE),
  );
});
