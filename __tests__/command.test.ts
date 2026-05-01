import assert from "node:assert/strict";
import test from "node:test";

import {
  REVIEW_FIX_USAGE,
  REVIEW_USAGE,
  parseReviewArgs,
  parseReviewFixArgs,
} from "../src/command";

test("parses /review diff-against target", () => {
  assert.deepEqual(parseReviewArgs("diff-against origin/main"), {
    kind: "review",
    target: {
      kind: "diff-against",
      ref: "origin/main",
      targetHint: "origin/main",
    },
  });
});

test("parses quoted /review diff-against target", () => {
  assert.deepEqual(parseReviewArgs('diff-against "change id"'), {
    kind: "review",
    target: {
      kind: "diff-against",
      ref: "change id",
      targetHint: "change id",
    },
  });
});

test("parses /review prompt target as free-form review request", () => {
  assert.deepEqual(
    parseReviewArgs(
      "prompt review the database schema and ensure column names are sensible",
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

test("parses quoted words inside /review prompt free-form text", () => {
  assert.deepEqual(
    parseReviewArgs('prompt review "database schema" and "column names"'),
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

test("parses /review pr target", () => {
  assert.deepEqual(
    parseReviewArgs("pr https://github.com/owner/repo/pull/123"),
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

test("parses quoted /review pr target", () => {
  assert.deepEqual(parseReviewArgs('pr "group/project!42"'), {
    kind: "review",
    target: {
      kind: "pr",
      selector: "group/project!42",
      targetHint: "group/project!42",
    },
  });
});

test("rejects missing /review args with exact usage", () => {
  assert.throws(() => parseReviewArgs(""), new Error(REVIEW_USAGE));
});

test("rejects unknown /review target kind", () => {
  assert.throws(
    () => parseReviewArgs("files src/index.ts"),
    new Error(
      'Unknown /review target "files". Expected diff-against, prompt, or pr.',
    ),
  );
});

test("rejects missing /review diff-against ref", () => {
  assert.throws(
    () => parseReviewArgs("diff-against"),
    new Error("/review diff-against requires a ref or change id."),
  );
});

test("rejects extra /review diff-against args", () => {
  assert.throws(
    () => parseReviewArgs("diff-against origin/main extra"),
    new Error("/review diff-against accepts exactly one ref or change id."),
  );
});

test("rejects empty quoted /review diff-against ref", () => {
  assert.throws(
    () => parseReviewArgs('diff-against ""'),
    new Error("/review diff-against requires a ref or change id."),
  );
});

test("rejects missing /review prompt text", () => {
  assert.throws(
    () => parseReviewArgs("prompt"),
    new Error("/review prompt requires a review request."),
  );
});

test("rejects empty quoted /review prompt text", () => {
  assert.throws(
    () => parseReviewArgs('prompt ""'),
    new Error("/review prompt requires a review request."),
  );
});

test("rejects missing /review pr selector", () => {
  assert.throws(
    () => parseReviewArgs("pr"),
    new Error("/review pr requires a PR/MR URL, number, or ref."),
  );
});

test("rejects extra /review pr args", () => {
  assert.throws(
    () => parseReviewArgs("pr 123 extra"),
    new Error("/review pr accepts exactly one PR/MR URL, number, or ref."),
  );
});

test("rejects empty quoted /review pr selector", () => {
  assert.throws(
    () => parseReviewArgs('pr ""'),
    new Error("/review pr requires a PR/MR URL, number, or ref."),
  );
});

test("rejects unterminated quotes", () => {
  assert.throws(
    () => parseReviewArgs('prompt "unfinished'),
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
