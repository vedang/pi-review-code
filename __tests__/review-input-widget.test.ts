import assert from "node:assert/strict";
import test from "node:test";

import type { Theme } from "@mariozechner/pi-coding-agent";
import type { TUI } from "@mariozechner/pi-tui";
import { visibleWidth } from "@mariozechner/pi-tui";

import {
  type ReviewInputWidgetConfig,
  type ReviewInputWidgetResult,
  createReviewInputWidgetComponent,
  normalizeReviewInput,
  showReviewInputWidget,
} from "../src/review-input-widget.js";

const baseConfig: ReviewInputWidgetConfig = {
  kind: "review",
  title: "Start review",
  helpText: "Usage:\n  /review <review request>",
  primaryLabel: "what do I review?",
  primaryPlaceholder: "Describe code to review.",
  contextLabel: "any context I should be aware of?",
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

function createComponent(config: ReviewInputWidgetConfig) {
  const results: ReviewInputWidgetResult[] = [];
  const component = createReviewInputWidgetComponent({
    tui: createFakeTui(),
    theme: createFakeTheme(),
    config,
    done: (result) => {
      results.push(result);
    },
  });

  return { component, results };
}

test("normalizeReviewInput trims values and omits blank context", () => {
  assert.deepEqual(normalizeReviewInput("  auth flow  ", "  "), {
    ok: true,
    primaryValue: "auth flow",
  });

  assert.deepEqual(normalizeReviewInput("auth flow", "  check cache\n"), {
    ok: true,
    primaryValue: "auth flow",
    reviewContext: "check cache",
  });
});

test("normalizeReviewInput rejects blank primary value", () => {
  assert.deepEqual(normalizeReviewInput(" \n\t ", "context"), {
    ok: false,
    error: "what do I review? is required.",
  });
});

test("review input widget renders help, labels, and bounded lines", () => {
  const { component } = createComponent(baseConfig);

  const lines = component.render(60);

  assert.ok(lines.some((line) => line.includes("Start review")));
  assert.ok(lines.some((line) => line.includes("/review <review request>")));
  assert.ok(lines.some((line) => line.includes("what do I review?")));
  assert.ok(
    lines.some((line) => line.includes("any context I should be aware of?")),
  );
  for (const line of lines) {
    assert.ok(visibleWidth(line) <= 60, `line too wide: ${line}`);
  }
});

test("Tab and Shift+Tab move focus between primary and context fields", () => {
  const { component } = createComponent(baseConfig);
  component.focused = true;

  assert.ok(
    component.render(72).some((line) => line.includes("▶ what do I review?")),
  );

  component.handleInput?.("\t");
  assert.ok(
    component
      .render(72)
      .some((line) => line.includes("▶ any context I should be aware of?")),
  );

  component.handleInput?.("\x1b[Z");
  assert.ok(
    component.render(72).some((line) => line.includes("▶ what do I review?")),
  );
});

test("blank primary value blocks submit and shows validation", () => {
  const { component, results } = createComponent(baseConfig);

  component.handleInput?.("\r");

  assert.deepEqual(results, []);
  assert.ok(
    component
      .render(72)
      .some((line) => line.includes("what do I review? is required.")),
  );
});

test("Enter submits trimmed primary and context values", () => {
  const { component, results } = createComponent({
    ...baseConfig,
    initialPrimaryValue: "  auth flow  ",
    initialContext: "  Watch migration path.  ",
  });

  component.handleInput?.("\r");

  assert.deepEqual(results, [
    {
      submitted: true,
      primaryValue: "auth flow",
      reviewContext: "Watch migration path.",
    },
  ]);
});

test("large bracketed paste submits expanded editor content", () => {
  const { component, results } = createComponent(baseConfig);
  const pastedTarget = Array.from(
    { length: 11 },
    (_value, index) => `review item ${index + 1}`,
  ).join("\n");

  component.handleInput?.(`\x1b[200~${pastedTarget}\x1b[201~`);
  component.handleInput?.("\r");

  assert.deepEqual(results, [
    {
      submitted: true,
      primaryValue: pastedTarget,
    },
  ]);
});

test("action row can cancel after keyboard navigation", () => {
  const { component, results } = createComponent({
    ...baseConfig,
    initialPrimaryValue: "auth flow",
  });

  component.handleInput?.("\t");
  component.handleInput?.("\t");
  component.handleInput?.("\x1b[C");
  component.handleInput?.("\r");

  assert.deepEqual(results, [{ submitted: false }]);
});

test("Escape cancels the widget", () => {
  const { component, results } = createComponent(baseConfig);

  component.handleInput?.("\x1b");

  assert.deepEqual(results, [{ submitted: false }]);
});

test("showReviewInputWidget uses default custom UI placement", async () => {
  let customOptions: unknown = "not-called";

  const ctx = {
    ui: {
      custom: async <T>(_factory: unknown, options?: unknown): Promise<T> => {
        customOptions = options;
        return { submitted: false } as T;
      },
    },
  };

  const result = await showReviewInputWidget(ctx as never, baseConfig);

  assert.deepEqual(result, { submitted: false });
  assert.equal(customOptions, undefined);
});
