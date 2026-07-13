import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { completeSimple } from "@earendil-works/pi-ai/compat";

/**
 * Compat is intentional for pi-coding-agent 0.80.6: extension custom APIs are
 * registered in its compat-backed dispatcher. Replace this when pi exposes a
 * first-class extension completion API or a non-compat registered dispatcher.
 */
export function completeWithRegisteredApi<TApi extends Api>(
  model: Model<TApi>,
  context: Context,
  options?: SimpleStreamOptions,
): Promise<AssistantMessage> {
  return completeSimple(model, context, options);
}
