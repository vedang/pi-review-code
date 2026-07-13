import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { completeWithRegisteredApi } from "./pi-complete.js";
import type { ReviewPromptDraftRequest } from "./prompts.js";

export type DraftTextBlock = {
  type: string;
  text?: string;
};

export type DraftCompletion = {
  content?: unknown;
  stopReason?: string;
  errorMessage?: string;
};

export type PiReviewThinkingLevel =
  | "off"
  | NonNullable<SimpleStreamOptions["reasoning"]>;

type DraftTextPiece = {
  type: string;
  text: string;
};

export type ReviewPromptDraftGenerationResult =
  | {
      ok: true;
      draft: string;
    }
  | {
      ok: false;
      aborted?: true;
      error: string;
    };

export type CompleteReviewDraft = (
  request: ReviewPromptDraftRequest,
) => Promise<DraftCompletion>;

export type CompleteWithModel = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
) => Promise<AssistantMessage>;

export type GetApiKeyAndHeadersResult =
  | {
      ok: false;
      error: string;
    }
  | {
      ok: true;
      apiKey?: string;
      headers?: Record<string, string>;
      env?: Record<string, string>;
    };

export interface ModelRegistryLike<TModel = unknown> {
  getApiKeyAndHeaders: (model: TModel) => Promise<GetApiKeyAndHeadersResult>;
}

export interface GenerateReviewPromptDraftContext {
  completeDraft: CompleteReviewDraft;
}

export interface CompleteReviewPromptDraftWithPiAiOptions<
  TModel extends Model<Api> = Model<Api>,
> {
  request: ReviewPromptDraftRequest;
  model: TModel;
  modelRegistry: ModelRegistryLike<TModel>;
  thinkingLevel: PiReviewThinkingLevel;
  signal?: AbortSignal;
  complete?: CompleteWithModel;
}

function toSimpleReasoning(
  thinkingLevel: PiReviewThinkingLevel,
): NonNullable<SimpleStreamOptions["reasoning"]> | undefined {
  return thinkingLevel === "off" ? undefined : thinkingLevel;
}

function isTextPiece(value: unknown): value is DraftTextPiece {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as DraftTextPiece).type === "text" &&
    typeof (value as DraftTextPiece).text === "string"
  );
}

function extractDraftText(response: DraftCompletion): string {
  const content = response.content;
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter(isTextPiece)
    .map((item) => item.text)
    .join("")
    .trim();
}

export async function generateReviewPromptDraft(
  request: ReviewPromptDraftRequest,
  context: GenerateReviewPromptDraftContext,
): Promise<ReviewPromptDraftGenerationResult> {
  try {
    const completion = await context.completeDraft(request);

    if (completion.stopReason === "aborted") {
      return {
        ok: false,
        aborted: true,
        error: "Review prompt draft generation was cancelled.",
      };
    }

    if (completion.stopReason === "error") {
      return {
        ok: false,
        error:
          completion.errorMessage === undefined
            ? "Review prompt draft generation failed."
            : `Review prompt draft generation failed: ${completion.errorMessage}`,
      };
    }

    if (completion.stopReason !== "stop") {
      return {
        ok: false,
        error: `Review prompt draft generation stopped unexpectedly: ${completion.stopReason}.`,
      };
    }

    const draftText = extractDraftText(completion);
    if (draftText.length === 0) {
      return {
        ok: false,
        error: "Review prompt draft generation returned no text.",
      };
    }

    return {
      ok: true,
      draft: draftText,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: `Failed to generate review prompt draft: ${message}`,
    };
  }
}

export async function completeReviewPromptDraftWithPiAi<
  TModel extends Model<Api>,
>(
  options: CompleteReviewPromptDraftWithPiAiOptions<TModel>,
): Promise<DraftCompletion> {
  const {
    request,
    model,
    modelRegistry,
    thinkingLevel,
    signal,
    complete: injectedComplete,
  } = options;

  const complete = injectedComplete ?? completeWithRegisteredApi;

  const auth = await modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) {
    throw new Error(auth.error);
  }

  if (!auth.apiKey) {
    throw new Error(`No API key for ${model.provider}`);
  }

  return complete(
    model,
    {
      systemPrompt: request.systemPrompt,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: request.userPrompt }],
          timestamp: 0,
        },
      ],
    },
    {
      apiKey: auth.apiKey,
      headers: auth.headers,
      env: auth.env,
      signal,
      reasoning: toSimpleReasoning(thinkingLevel),
    },
  );
}
