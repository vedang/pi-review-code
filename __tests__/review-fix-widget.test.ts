import assert from "node:assert/strict";
import test from "node:test";

import type { Theme } from "@mariozechner/pi-coding-agent";
import type { TUI } from "@mariozechner/pi-tui";
import { visibleWidth } from "@mariozechner/pi-tui";

import {
  type ReviewFixWidgetConfig,
  type ReviewFixWidgetFindingInput,
  type ReviewFixWidgetResult,
  createReviewFixWidgetComponent,
  normalizeReviewFixWidgetSelection,
  showReviewFixWidget,
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

const baseConfig: ReviewFixWidgetConfig = {
  title: "Start review fix",
  helpText:
    "Select findings to fix, add optional context, then start a fix branch.",
  reviewRunId: "review-1",
  targetHint: "src/auth.ts",
  completedAt: 1_700_000_000_000,
  findings: [
    finding({ id: "finding-a", priority: "P1" }),
    finding({ id: "finding-b", priority: "P2", fixed: true }),
  ],
  initialSelectedFindingIds: ["finding-a"],
  initialFixContext: "Keep public API stable.",
};

function createFakeTui(): TUI {
  return {
    terminal: { rows: 40 },
    requestRender: () => {},
  } as unknown as TUI;
}

function createFakeTheme(): Theme {
  const identity = (text: string) => text;
  return {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: identity,
  } as unknown as Theme;
}

function createComponent(config: ReviewFixWidgetConfig = baseConfig) {
  const results: ReviewFixWidgetResult[] = [];
  const component = createReviewFixWidgetComponent({
    tui: createFakeTui(),
    theme: createFakeTheme(),
    config,
    done: (result) => {
      results.push(result);
    },
  });

  return { component, results };
}

test("review fix widget renders header, metadata, findings, and context editor", () => {
  const { component } = createComponent();

  const lines = component.render(80);
  const text = lines.join("\n");

  assert.ok(text.includes("Start review fix"));
  assert.ok(text.includes("Select findings to fix"));
  assert.ok(text.includes("Review run: review-1"));
  assert.ok(text.includes("Target: src/auth.ts"));
  assert.ok(text.includes("Findings: 1 open • 1 fixed • 2 total"));
  assert.ok(text.includes("[x] P1 finding-a"));
  assert.ok(text.includes("[−] fixed P2 finding-b"));
  assert.ok(text.includes("additional context for the fix loop (optional)"));
  assert.ok(text.includes("Keep public API stable."));
});

test("review fix widget renders empty state when no findings exist", () => {
  const { component } = createComponent({
    ...baseConfig,
    reviewRunId: undefined,
    targetHint: undefined,
    completedAt: undefined,
    findings: [],
    initialSelectedFindingIds: [],
    initialFixContext: undefined,
  });

  const text = component.render(72).join("\n");

  assert.ok(text.includes("No completed review findings are available yet."));
  assert.ok(text.includes("Run /review first, then return to /review-fix."));
  assert.ok(text.includes("Start fix"));
  assert.ok(text.includes("Cancel"));
});

test("review fix widget keeps rendered lines within width", () => {
  const { component } = createComponent({
    ...baseConfig,
    helpText:
      "Select an extremely long review finding line that must never leak past overlay width.",
    targetHint: "src/authentication/very/deep/module/with/long/path.ts",
    findings: [
      finding({
        id: "finding-with-long-id-that-should-be-truncated",
        priority: "P0",
        comment:
          "This comment contains a very long explanation about refresh-token invalidation and logout races that should wrap or truncate safely.",
        references: [
          {
            filePath: "src/authentication/very/deep/module/with/long/path.ts",
            startLine: 123,
            endLine: 456,
          },
        ],
      }),
    ],
    initialSelectedFindingIds: [
      "finding-with-long-id-that-should-be-truncated",
    ],
  });

  for (const line of component.render(44)) {
    assert.ok(visibleWidth(line) <= 44, `line too wide: ${line}`);
  }
});

test("showReviewFixWidget opens an overlay custom UI", async () => {
  let overlay: boolean | undefined;
  let minWidth: number | undefined;

  const ctx = {
    ui: {
      custom: async <T>(
        _factory: unknown,
        options?: { overlay?: boolean; overlayOptions?: { minWidth?: number } },
      ): Promise<T> => {
        overlay = options?.overlay;
        minWidth = options?.overlayOptions?.minWidth;
        return { submitted: false } as T;
      },
    },
  };

  const result = await showReviewFixWidget(ctx as never, baseConfig);

  assert.deepEqual(result, { submitted: false });
  assert.equal(overlay, true);
  assert.equal(minWidth, 48);
});

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
