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
  assert.ok(text.includes("Alt+Enter newline"));
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

test("review fix widget groups findings from multiple review runs", () => {
  const { component } = createComponent({
    ...baseConfig,
    reviewRunId: undefined,
    targetHint: undefined,
    completedAt: undefined,
    findings: [
      finding({
        id: "new",
        reviewRunId: "review-2",
        targetHint: "review cache boundaries",
        completedAt: 1_700_000_000_000,
      }),
      finding({
        id: "old",
        reviewRunId: "review-1",
        targetHint: "review auth boundaries",
        completedAt: 1_600_000_000_000,
      }),
    ],
    initialSelectedFindingIds: [],
    initialFixContext: undefined,
  });

  const text = component.render(80).join("\n");

  assert.ok(text.includes("Review runs: 2 with open findings"));
  assert.ok(text.includes("Review run: review-2"));
  assert.ok(text.includes("Target: review cache boundaries"));
  assert.ok(text.includes("Review run: review-1"));
  assert.ok(text.includes("Target: review auth boundaries"));
  assert.ok(text.includes("[ ] P1 new"));
  assert.ok(text.includes("[ ] P1 old"));
});

test("Space and Enter toggle open findings and submit in displayed order", () => {
  const { component, results } = createComponent({
    ...baseConfig,
    findings: [finding({ id: "finding-a" }), finding({ id: "finding-b" })],
    initialSelectedFindingIds: [],
    initialFixContext: undefined,
  });

  component.handleInput?.(" ");
  component.handleInput?.("\x1b[B");
  component.handleInput?.("\r");
  component.handleInput?.("\x13");

  assert.deepEqual(results, [
    {
      submitted: true,
      reviewRunId: "review-1",
      findingIds: ["finding-a", "finding-b"],
    },
  ]);
});

test("fixed findings stay disabled when focused and cannot be toggled", () => {
  const { component, results } = createComponent({
    ...baseConfig,
    findings: [
      finding({ id: "finding-a", fixed: true }),
      finding({ id: "finding-b" }),
    ],
    initialSelectedFindingIds: [],
    initialFixContext: undefined,
  });

  component.handleInput?.(" ");
  component.handleInput?.("\x1b[B");
  component.handleInput?.(" ");
  component.handleInput?.("\x13");

  assert.deepEqual(results, [
    {
      submitted: true,
      reviewRunId: "review-1",
      findingIds: ["finding-b"],
    },
  ]);
});

test("selection can submit a finding from an older review run", () => {
  const { component, results } = createComponent({
    ...baseConfig,
    reviewRunId: undefined,
    targetHint: undefined,
    completedAt: undefined,
    findings: [
      finding({ id: "new", reviewRunId: "review-2" }),
      finding({ id: "old", reviewRunId: "review-1" }),
    ],
    initialSelectedFindingIds: [],
    initialFixContext: undefined,
  });

  component.handleInput?.("\x1b[B");
  component.handleInput?.(" ");
  component.handleInput?.("\x13");

  assert.deepEqual(results, [
    {
      submitted: true,
      reviewRunId: "review-1",
      findingIds: ["old"],
    },
  ]);
});

test("selection rejects findings from multiple review runs", () => {
  const { component, results } = createComponent({
    ...baseConfig,
    reviewRunId: undefined,
    targetHint: undefined,
    completedAt: undefined,
    findings: [
      finding({ id: "new", reviewRunId: "review-2" }),
      finding({ id: "old", reviewRunId: "review-1" }),
    ],
    initialSelectedFindingIds: [],
    initialFixContext: undefined,
  });

  component.handleInput?.("a");
  component.handleInput?.("\x13");

  assert.deepEqual(results, []);
  assert.ok(
    component
      .render(80)
      .some((line) =>
        line.includes("Selected findings must come from a single review run."),
      ),
  );
});

test("a selects and clears all open findings", () => {
  const { component, results } = createComponent({
    ...baseConfig,
    findings: [
      finding({ id: "finding-a" }),
      finding({ id: "finding-b", fixed: true }),
      finding({ id: "finding-c" }),
    ],
    initialSelectedFindingIds: [],
    initialFixContext: undefined,
  });

  component.handleInput?.("a");
  component.handleInput?.("\x13");

  assert.deepEqual(results, [
    {
      submitted: true,
      reviewRunId: "review-1",
      findingIds: ["finding-a", "finding-c"],
    },
  ]);

  const { component: secondComponent, results: secondResults } =
    createComponent({
      ...baseConfig,
      findings: [finding({ id: "finding-a" }), finding({ id: "finding-b" })],
      initialSelectedFindingIds: [],
      initialFixContext: undefined,
    });

  secondComponent.handleInput?.("a");
  secondComponent.handleInput?.("a");
  secondComponent.handleInput?.("\x13");

  assert.deepEqual(secondResults, []);
  assert.ok(
    secondComponent
      .render(72)
      .some((line) => line.includes("Select at least one finding to fix.")),
  );
});

test("long finding lists scroll and keep active row visible", () => {
  const findings = Array.from({ length: 12 }, (_value, index) =>
    finding({ id: `finding-${index + 1}` }),
  );
  const { component } = createComponent({
    ...baseConfig,
    findings,
    initialSelectedFindingIds: [],
    initialFixContext: undefined,
  });

  for (let index = 0; index < 9; index += 1) {
    component.handleInput?.("\x1b[B");
  }

  const text = component.render(80).join("\n");

  assert.ok(text.includes("showing 3-10 of 12"));
  assert.ok(text.includes("› [ ] P1 finding-10"));
  assert.ok(!text.includes("finding-1 src/auth.ts:42-45"));
});

test("Tab and Shift+Tab cycle focus between findings, context, and actions", () => {
  const { component } = createComponent();
  component.focused = true;

  assert.ok(component.render(72).some((line) => line.includes("▶ findings")));

  component.handleInput?.("\t");
  assert.ok(
    component
      .render(72)
      .some((line) =>
        line.includes("▶ additional context for the fix loop (optional)"),
      ),
  );

  component.handleInput?.("\t");
  assert.ok(component.render(72).some((line) => line.includes("▶  Start fix")));

  component.handleInput?.("\x1b[Z");
  assert.ok(
    component
      .render(72)
      .some((line) =>
        line.includes("▶ additional context for the fix loop (optional)"),
      ),
  );
});

test("context editor submits trimmed expanded paste text", () => {
  const pastedContext = Array.from(
    { length: 11 },
    (_value, index) => `fix note ${index + 1}`,
  ).join("\n");
  const { component, results } = createComponent({
    ...baseConfig,
    initialSelectedFindingIds: ["finding-a"],
    initialFixContext: undefined,
  });

  component.handleInput?.("\t");
  component.handleInput?.(`\x1b[200~  ${pastedContext}  \x1b[201~`);
  component.handleInput?.("\r");

  assert.deepEqual(results, [
    {
      submitted: true,
      reviewRunId: "review-1",
      findingIds: ["finding-a"],
      fixContext: pastedContext,
    },
  ]);
});

test("context editor keeps text when Enter submission fails validation", () => {
  const { component, results } = createComponent({
    ...baseConfig,
    initialSelectedFindingIds: [],
    initialFixContext: undefined,
  });

  component.handleInput?.("\t");
  component.handleInput?.("Preserve this fix note.");
  component.handleInput?.("\r");

  assert.deepEqual(results, []);
  const text = component.render(72).join("\n");
  assert.ok(text.includes("Select at least one finding to fix."));
  assert.ok(text.includes("Preserve this fix note."));
});

test("action row can cancel after keyboard navigation", () => {
  const { component, results } = createComponent();

  component.handleInput?.("\t");
  component.handleInput?.("\t");
  component.handleInput?.("\x1b[C");
  component.handleInput?.("\r");

  assert.deepEqual(results, [{ submitted: false }]);
});

test("Escape cancels the review fix widget", () => {
  const { component, results } = createComponent();

  component.handleInput?.("\x1b");

  assert.deepEqual(results, [{ submitted: false }]);
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

test("showReviewFixWidget uses default custom UI placement", async () => {
  let customOptions: unknown = "not-called";

  const ctx = {
    ui: {
      custom: async <T>(_factory: unknown, options?: unknown): Promise<T> => {
        customOptions = options;
        return { submitted: false } as T;
      },
    },
  };

  const result = await showReviewFixWidget(ctx as never, baseConfig);

  assert.deepEqual(result, { submitted: false });
  assert.equal(customOptions, undefined);
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
