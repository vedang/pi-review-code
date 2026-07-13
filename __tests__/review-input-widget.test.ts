import assert from "node:assert/strict";
import test from "node:test";

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";

import {
  type ReviewInputWidgetConfig,
  type ReviewInputWidgetResult,
  createReviewInputWidgetComponent,
  normalizeReviewInput,
  showReviewInputWidget,
} from "../src/review-input-widget.js";

const baseConfig: ReviewInputWidgetConfig = {
  title: "Start review",
  helpText: "Usage:\n  /review <review request>",
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

function renderText(
  component: ReturnType<typeof createComponent>["component"],
) {
  return component.render(72).join("\n");
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

test("review input widget renders selector, default mode, labels, and bounded lines", () => {
  const { component } = createComponent(baseConfig);

  const lines = component.render(60);
  const text = lines.join("\n");

  assert.ok(text.includes("Start review"));
  assert.ok(text.includes("/review <review request>"));
  assert.ok(text.includes("▶ review type"));
  assert.ok(text.includes("[x] Free-form request"));
  assert.ok(text.includes("[ ] Diff against ref"));
  assert.ok(text.includes("[ ] PR/MR"));
  assert.ok(text.includes("URL or number"));
  assert.ok(text.includes("what do I review?"));
  assert.ok(text.includes("Describe the code, behavior, or risk to review."));
  assert.ok(text.includes("any context I should be aware of?"));
  for (const line of lines) {
    assert.ok(visibleWidth(line) <= 60, `line too wide: ${line}`);
  }
});

test("Tab and Shift+Tab move focus between kind, primary, and context fields", () => {
  const { component } = createComponent(baseConfig);
  component.focused = true;

  assert.ok(renderText(component).includes("▶ review type"));

  component.handleInput?.("\t");
  assert.ok(renderText(component).includes("▶ what do I review?"));

  component.handleInput?.("\t");
  assert.ok(
    renderText(component).includes("▶ any context I should be aware of?"),
  );

  component.handleInput?.("\x1b[Z");
  assert.ok(renderText(component).includes("▶ what do I review?"));
});

test("arrow and number keys change mode and update label and placeholder", () => {
  const { component } = createComponent(baseConfig);

  component.handleInput?.("\x1b[C");
  let text = renderText(component);
  assert.ok(text.includes("[x] Diff against ref"));
  assert.ok(text.includes("ref:"));
  assert.ok(text.includes("Enter ref or change id."));

  component.handleInput?.("3");
  text = renderText(component);
  assert.ok(text.includes("[x] PR/MR URL or number"));
  assert.ok(text.includes("pr:"));
  assert.ok(
    text.includes("Enter GitHub URL, GitLab URL, MR URL, or PR number."),
  );
});

test("Enter on kind field moves to primary instead of submitting", () => {
  const { component, results } = createComponent(baseConfig);

  component.handleInput?.("\r");

  assert.deepEqual(results, []);
  assert.ok(renderText(component).includes("▶ what do I review?"));
});

test("blank primary value blocks submit and shows active-mode validation", () => {
  const { component, results } = createComponent(baseConfig);

  component.handleInput?.("2");
  component.handleInput?.("\t");
  component.handleInput?.("\r");

  assert.deepEqual(results, []);
  assert.ok(renderText(component).includes("ref: is required."));
});

test("Enter submits trimmed primary and context values with selected kind", () => {
  const { component, results } = createComponent({
    ...baseConfig,
    initialKind: "pr",
    initialPrimaryValue: "  https://github.com/o/r/pull/12  ",
    initialContext: "  Watch migration path.  ",
  });

  component.handleInput?.("\t");
  component.handleInput?.("\r");

  assert.deepEqual(results, [
    {
      submitted: true,
      kind: "pr",
      primaryValue: "https://github.com/o/r/pull/12",
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

  component.handleInput?.("\t");
  component.handleInput?.(`\x1b[200~${pastedTarget}\x1b[201~`);
  component.handleInput?.("\r");

  assert.deepEqual(results, [
    {
      submitted: true,
      kind: "review",
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
