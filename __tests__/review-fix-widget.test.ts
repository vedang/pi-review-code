import assert from "node:assert/strict";
import test from "node:test";

import {
  type ReviewFixWidgetFindingInput,
  normalizeReviewFixWidgetSelection,
} from "../src/review-fix-widget.js";

function finding(
  overrides: Partial<ReviewFixWidgetFindingInput> = {},
): ReviewFixWidgetFindingInput {
  return {
    id: "finding-1",
    priority: "P1",
    comment: "Token refresh can race with logout.",
    references: [{ filePath: "src/auth.ts", startLine: 42, endLine: 45 }],
    fixed: false,
    ...overrides,
  };
}

test("normalizeReviewFixWidgetSelection returns selected ids in displayed order and trims context", () => {
  assert.deepEqual(
    normalizeReviewFixWidgetSelection({
      reviewRunId: "  review-1  ",
      findings: [
        finding({ id: "finding-a" }),
        finding({ id: "finding-b" }),
        finding({ id: "finding-c" }),
      ],
      selectedFindingIds: ["finding-c", "finding-a", "finding-a"],
      fixContext: "  Keep existing API names.  ",
    }),
    {
      ok: true,
      reviewRunId: "review-1",
      findingIds: ["finding-a", "finding-c"],
      fixContext: "Keep existing API names.",
    },
  );
});

test("normalizeReviewFixWidgetSelection omits blank context", () => {
  assert.deepEqual(
    normalizeReviewFixWidgetSelection({
      reviewRunId: "review-1",
      findings: [finding({ id: "finding-a" })],
      selectedFindingIds: ["finding-a"],
      fixContext: "  \n\t ",
    }),
    {
      ok: true,
      reviewRunId: "review-1",
      findingIds: ["finding-a"],
    },
  );
});

test("normalizeReviewFixWidgetSelection blocks empty or all-fixed findings before review id validation", () => {
  assert.deepEqual(
    normalizeReviewFixWidgetSelection({
      reviewRunId: undefined,
      findings: [],
      selectedFindingIds: [],
    }),
    {
      ok: false,
      error: "No review findings are available to fix.",
    },
  );

  assert.deepEqual(
    normalizeReviewFixWidgetSelection({
      reviewRunId: undefined,
      findings: [finding({ id: "finding-a", fixed: true })],
      selectedFindingIds: ["finding-a"],
    }),
    {
      ok: false,
      error: "No review findings are available to fix.",
    },
  );
});

test("normalizeReviewFixWidgetSelection requires review run id when selectable findings exist", () => {
  assert.deepEqual(
    normalizeReviewFixWidgetSelection({
      reviewRunId: "  ",
      findings: [finding({ id: "finding-a" })],
      selectedFindingIds: ["finding-a"],
    }),
    {
      ok: false,
      error: "No review run is available to fix.",
    },
  );
});

test("normalizeReviewFixWidgetSelection requires one selectable selected finding", () => {
  assert.deepEqual(
    normalizeReviewFixWidgetSelection({
      reviewRunId: "review-1",
      findings: [finding({ id: "finding-a" })],
      selectedFindingIds: [],
    }),
    {
      ok: false,
      error: "Select at least one finding to fix.",
    },
  );
});

test("normalizeReviewFixWidgetSelection rejects unknown and fixed selected ids", () => {
  assert.deepEqual(
    normalizeReviewFixWidgetSelection({
      reviewRunId: "review-1",
      findings: [finding({ id: "finding-a" })],
      selectedFindingIds: ["finding-b"],
    }),
    {
      ok: false,
      error: "Selected finding is no longer available: finding-b.",
    },
  );

  assert.deepEqual(
    normalizeReviewFixWidgetSelection({
      reviewRunId: "review-1",
      findings: [
        finding({ id: "finding-a" }),
        finding({ id: "finding-b", fixed: true }),
      ],
      selectedFindingIds: ["finding-b"],
    }),
    {
      ok: false,
      error: "Selected finding is already fixed: finding-b.",
    },
  );
});

test("normalizeReviewFixWidgetSelection rejects invalid finding metadata", () => {
  assert.deepEqual(
    normalizeReviewFixWidgetSelection({
      reviewRunId: "review-1",
      findings: [finding({ id: "  " })],
      selectedFindingIds: [],
    }),
    {
      ok: false,
      error: "Review-fix widget data has a blank finding id.",
    },
  );

  assert.deepEqual(
    normalizeReviewFixWidgetSelection({
      reviewRunId: "review-1",
      findings: [finding({ id: "finding-a" }), finding({ id: "finding-a" })],
      selectedFindingIds: ["finding-a"],
    }),
    {
      ok: false,
      error: "Review-fix widget data has duplicate finding id: finding-a.",
    },
  );
});
