import assert from "node:assert/strict";
import test from "node:test";

import {
  completeReviewPromptDraftWithPiAi,
  generateReviewPromptDraft,
} from "../src/draft.js";
import type { ReviewPromptDraftRequest } from "../src/prompts.js";

const request: ReviewPromptDraftRequest = {
  systemPrompt: "system",
  userPrompt: "user packet",
};

function completion(text: string, stopReason = "stop") {
  return {
    stopReason,
    content: [{ type: "text", text }],
  };
}

test("generateReviewPromptDraft extracts text from injected LLM completion", async () => {
  const result = await generateReviewPromptDraft(request, {
    completeDraft: async (draftRequest) => {
      assert.equal(draftRequest, request);
      return completion("Review prompt draft");
    },
  });

  assert.deepEqual(result, { ok: true, draft: "Review prompt draft" });
});

test("generateReviewPromptDraft fails closed on empty LLM output", async () => {
  const result = await generateReviewPromptDraft(request, {
    completeDraft: async () => completion("   "),
  });

  assert.deepEqual(result, {
    ok: false,
    error: "Review prompt draft generation returned no text.",
  });
});

test("generateReviewPromptDraft returns friendly errors for LLM failures", async () => {
  const result = await generateReviewPromptDraft(request, {
    completeDraft: async () => {
      throw new Error("No API key for anthropic");
    },
  });

  assert.deepEqual(result, {
    ok: false,
    error: "Failed to generate review prompt draft: No API key for anthropic",
  });
});

test("generateReviewPromptDraft treats aborted completions as cancellation", async () => {
  const result = await generateReviewPromptDraft(request, {
    completeDraft: async () => completion("ignored", "aborted"),
  });

  assert.deepEqual(result, {
    ok: false,
    aborted: true,
    error: "Review prompt draft generation was cancelled.",
  });
});

test("generateReviewPromptDraft rejects truncated completions", async () => {
  const result = await generateReviewPromptDraft(request, {
    completeDraft: async () => completion("partial prompt", "length"),
  });

  assert.deepEqual(result, {
    ok: false,
    error: "Review prompt draft generation stopped unexpectedly: length.",
  });
});

test("completeReviewPromptDraftWithPiAi uses registry auth and current thinking level", async () => {
  let capturedContext: unknown;
  let capturedOptions: unknown;

  const response = await completeReviewPromptDraftWithPiAi({
    request,
    model: { provider: "anthropic", id: "claude-sonnet" } as never,
    modelRegistry: {
      getApiKeyAndHeaders: async () => ({
        ok: true,
        apiKey: "secret",
        headers: { "x-test": "yes" },
      }),
    } as never,
    thinkingLevel: "high",
    signal: undefined,
    complete: async (_model, context, options) => {
      capturedContext = context;
      capturedOptions = options;
      return completion("Draft from pi-ai") as never;
    },
  });

  assert.deepEqual(response, completion("Draft from pi-ai"));
  assert.deepEqual(capturedContext, {
    systemPrompt: "system",
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "user packet" }],
        timestamp: 0,
      },
    ],
  });
  assert.deepEqual(capturedOptions, {
    apiKey: "secret",
    headers: { "x-test": "yes" },
    signal: undefined,
    reasoning: "high",
  });
});

test("completeReviewPromptDraftWithPiAi omits reasoning when thinking is off", async () => {
  let capturedOptions: unknown;

  await completeReviewPromptDraftWithPiAi({
    request,
    model: { provider: "anthropic", id: "claude-sonnet" } as never,
    modelRegistry: {
      getApiKeyAndHeaders: async () => ({
        ok: true,
        apiKey: "secret",
      }),
    } as never,
    thinkingLevel: "off",
    complete: async (_model, _context, options) => {
      capturedOptions = options;
      return completion("Draft from pi-ai") as never;
    },
  });

  assert.deepEqual(capturedOptions, {
    apiKey: "secret",
    headers: undefined,
    signal: undefined,
    reasoning: undefined,
  });
});

test("completeReviewPromptDraftWithPiAi rejects missing auth", async () => {
  await assert.rejects(
    () =>
      completeReviewPromptDraftWithPiAi({
        request,
        model: { provider: "anthropic", id: "claude-sonnet" } as never,
        modelRegistry: {
          getApiKeyAndHeaders: async () => ({ ok: true }),
        } as never,
        thinkingLevel: "medium",
        complete: async () => completion("unused") as never,
      }),
    /No API key for anthropic/,
  );
});
