import assert from "node:assert/strict";
import test from "node:test";

import {
  type FixBranchSummaryDetails,
  REVIEW_FIX_SUMMARY_ENTRY_TYPE,
  REVIEW_META_PROMPT_ENTRY_TYPE,
  REVIEW_META_SUMMARY_ENTRY_TYPE,
  REVIEW_PROMPT_ENTRY_TYPE,
  REVIEW_SUMMARY_ENTRY_TYPE,
  type ReviewBranchSummaryDetails,
  type ReviewMetaBranchSummaryDetails,
  type ReviewMetaPromptMessageDetails,
  type ReviewPromptMessageDetails,
} from "../src/flow.js";
import { registerReviewMessageRenderers } from "../src/renderers.js";
import type { ReviewComment } from "../src/types.js";

const theme = {
  bg: (_name: string, text: string) => text,
  fg: (_name: string, text: string) => text,
  bold: (text: string) => text,
};

type Renderer = (
  message: { content?: unknown; details?: unknown; customType?: string },
  options: { expanded: boolean },
  renderTheme: typeof theme,
) => { render: (width: number) => string[] } | undefined;

function collectRenderers(): Map<string, Renderer> {
  const renderers = new Map<string, Renderer>();

  registerReviewMessageRenderers({
    registerMessageRenderer: (customType: string, renderer: Renderer) => {
      renderers.set(customType, renderer);
    },
  } as never);

  return renderers;
}

function comment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    version: 1,
    id: "comment-1",
    runId: "review-1",
    priority: "P1",
    comment: "Token refresh can race with logout.",
    references: [{ filePath: "src/auth.ts", startLine: 42, endLine: 45 }],
    createdAt: 123,
    targetHint: "review auth boundaries",
    ...overrides,
  };
}

test("registerReviewMessageRenderers registers prompt and summary renderers", () => {
  const renderers = collectRenderers();

  assert.ok(renderers.has(REVIEW_PROMPT_ENTRY_TYPE));
  assert.ok(renderers.has(REVIEW_META_PROMPT_ENTRY_TYPE));
  assert.ok(renderers.has(REVIEW_SUMMARY_ENTRY_TYPE));
  assert.ok(renderers.has(REVIEW_META_SUMMARY_ENTRY_TYPE));
  assert.ok(renderers.has(REVIEW_FIX_SUMMARY_ENTRY_TYPE));
});

test("prompt renderer previews prompt until expanded", () => {
  const renderer = collectRenderers().get(REVIEW_PROMPT_ENTRY_TYPE);
  assert.ok(renderer);

  const details: ReviewPromptMessageDetails = {
    kind: "prompt",
    mode: "review",
    runId: "review-1",
    targetHint: "review auth boundaries",
    reviewPrompt: Array.from(
      { length: 10 },
      (_, index) => `prompt line ${index + 1}`,
    ).join("\n"),
    originModelProvider: "anthropic",
    originModelId: "claude-sonnet",
    originThinkingLevel: "high",
  };

  const collapsed = renderer(
    {
      customType: REVIEW_PROMPT_ENTRY_TYPE,
      content: "Review prompt prepared",
      details,
    },
    { expanded: false },
    theme,
  )
    ?.render(120)
    .join("\n");

  assert.match(collapsed ?? "", /Review prompt/);
  assert.match(collapsed ?? "", /review-1/);
  assert.match(collapsed ?? "", /prompt line 1/);
  assert.doesNotMatch(collapsed ?? "", /prompt line 10/);
  assert.match(collapsed ?? "", /expand/);

  const expanded = renderer(
    {
      customType: REVIEW_PROMPT_ENTRY_TYPE,
      content: "Review prompt prepared",
      details,
    },
    { expanded: true },
    theme,
  )
    ?.render(120)
    .join("\n");

  assert.match(expanded ?? "", /prompt line 10/);
  assert.match(expanded ?? "", /anthropic\/claude-sonnet/);
  assert.doesNotMatch(expanded ?? "", /expand/);
});

test("meta prompt renderer previews prompt until expanded", () => {
  const renderer = collectRenderers().get(REVIEW_META_PROMPT_ENTRY_TYPE);
  assert.ok(renderer);

  const details: ReviewMetaPromptMessageDetails = {
    kind: "meta-prompt",
    runId: "meta-1",
    targetHint: "review auth boundaries",
    metaPrompt: Array.from(
      { length: 10 },
      (_, index) => `meta line ${index + 1}`,
    ).join("\n"),
    originModelProvider: "anthropic",
    originModelId: "claude-sonnet",
    originThinkingLevel: "high",
  };

  const collapsed = renderer(
    {
      customType: REVIEW_META_PROMPT_ENTRY_TYPE,
      content: "Review prompt meta-pass meta-1",
      details,
    },
    { expanded: false },
    theme,
  )
    ?.render(120)
    .join("\n");

  assert.match(collapsed ?? "", /Review prompt meta-pass/);
  assert.match(collapsed ?? "", /meta-1/);
  assert.match(collapsed ?? "", /meta line 1/);
  assert.doesNotMatch(collapsed ?? "", /meta line 10/);
  assert.match(collapsed ?? "", /expand/);

  const expanded = renderer(
    {
      customType: REVIEW_META_PROMPT_ENTRY_TYPE,
      content: "Review prompt meta-pass meta-1",
      details,
    },
    { expanded: true },
    theme,
  )
    ?.render(120)
    .join("\n");

  assert.match(expanded ?? "", /meta line 10/);
  assert.match(expanded ?? "", /anthropic\/claude-sonnet/);
  assert.doesNotMatch(expanded ?? "", /expand/);
});

test("meta summary renderer previews generated prompt and summary", () => {
  const renderer = collectRenderers().get(REVIEW_META_SUMMARY_ENTRY_TYPE);
  assert.ok(renderer);

  const details: ReviewMetaBranchSummaryDetails = {
    kind: "meta",
    runId: "meta-1",
    targetHint: "review auth boundaries",
    metaPrompt: "Meta prompt",
    reviewPrompt: Array.from(
      { length: 10 },
      (_, index) => `generated line ${index + 1}`,
    ).join("\n"),
    completedAt: 456,
    summary: "Found auth/session invariants.",
  };

  const collapsed = renderer(
    {
      customType: REVIEW_META_SUMMARY_ENTRY_TYPE,
      content: "Review prompt ready meta-1.",
      details,
    },
    { expanded: false },
    theme,
  )
    ?.render(120)
    .join("\n");

  assert.match(collapsed ?? "", /Review prompt ready meta-1/);
  assert.match(collapsed ?? "", /review auth boundaries/);
  assert.match(collapsed ?? "", /Found auth\/session invariants/);
  assert.match(collapsed ?? "", /generated line 1/);
  assert.doesNotMatch(collapsed ?? "", /generated line 10/);
  assert.match(collapsed ?? "", /expand/);

  const expanded = renderer(
    {
      customType: REVIEW_META_SUMMARY_ENTRY_TYPE,
      content: "Review prompt ready meta-1.",
      details,
    },
    { expanded: true },
    theme,
  )
    ?.render(120)
    .join("\n");

  assert.match(expanded ?? "", /generated line 10/);
  assert.match(expanded ?? "", /Meta-pass summary:/);
  assert.match(expanded ?? "", /Meta prompt:/);
  assert.match(expanded ?? "", /Meta prompt/);
});

test("review summary renderer shows findings compactly", () => {
  const renderer = collectRenderers().get(REVIEW_SUMMARY_ENTRY_TYPE);
  assert.ok(renderer);

  const details: ReviewBranchSummaryDetails = {
    kind: "review",
    runId: "review-1",
    targetHint: "review auth boundaries",
    reviewPrompt: "Review prompt",
    completedAt: 456,
    comments: [
      comment(),
      comment({
        id: "comment-2",
        priority: "P2",
        comment:
          "First line only in compact view.\nSecond line only when expanded.",
      }),
    ],
  };

  const rendered = renderer(
    {
      customType: REVIEW_SUMMARY_ENTRY_TYPE,
      content: "Review complete",
      details,
    },
    { expanded: false },
    theme,
  )
    ?.render(120)
    .join("\n");

  assert.match(rendered ?? "", /Review findings review-1/);
  assert.match(rendered ?? "", /2 finding/);
  assert.match(rendered ?? "", /P1 comment-1/);
  assert.match(rendered ?? "", /src\/auth\.ts:42-45/);
  assert.match(rendered ?? "", /First line only/);
  assert.match(rendered ?? "", /expand for full finding text/);
  assert.doesNotMatch(rendered ?? "", /Second line only when expanded/);

  const expanded = renderer(
    {
      customType: REVIEW_SUMMARY_ENTRY_TYPE,
      content: "Review complete",
      details,
    },
    { expanded: true },
    theme,
  )
    ?.render(120)
    .join("\n");

  assert.match(expanded ?? "", /Review findings review-1/);
  assert.match(expanded ?? "", /Second line only when expanded/);
  assert.doesNotMatch(expanded ?? "", /expand for full finding text/);
  assert.doesNotMatch(expanded ?? "", /Prompt:/);
  assert.doesNotMatch(expanded ?? "", /Review prompt/);
});

test("review-fix summary renderer includes source review and agent summary", () => {
  const renderer = collectRenderers().get(REVIEW_FIX_SUMMARY_ENTRY_TYPE);
  assert.ok(renderer);

  const details: FixBranchSummaryDetails = {
    kind: "fix",
    runId: "fix-1",
    sourceReviewRunId: "review-1",
    targetHint: "review auth boundaries",
    fixPrompt: "Fix prompt",
    completedAt: 456,
    comments: [comment()],
    agentSummary: "Fixed comment-1 and ran make test.",
  };

  const rendered = renderer(
    {
      customType: REVIEW_FIX_SUMMARY_ENTRY_TYPE,
      content: "Fix complete",
      details,
    },
    { expanded: true },
    theme,
  )
    ?.render(120)
    .join("\n");

  assert.match(rendered ?? "", /Review-fix fix-1/);
  assert.match(rendered ?? "", /Source review: review-1/);
  assert.match(rendered ?? "", /Fixed comment-1/);
});
