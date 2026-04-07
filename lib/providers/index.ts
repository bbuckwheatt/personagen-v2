/**
 * lib/providers/index.ts — Provider factory
 *
 * This is the single import point for graph nodes. Instead of each node
 * deciding which provider to use, they call getLLMClient() with the provider
 * string from the graph state, and get back a LangChain BaseChatModel.
 *
 * WHY A FACTORY FUNCTION?
 * The provider is a runtime value (chosen by the user in the UI, passed through
 * the request body into the graph state). TypeScript generic types are compile-
 * time only — they can't express "give me the right client for this runtime string".
 * A factory function bridges compile-time typing and runtime values cleanly.
 *
 * DESIGN PATTERN: Strategy Pattern
 * Each provider is a "strategy" for the same operation (call an LLM). The factory
 * selects which strategy to use. Adding a new provider (e.g. Google Gemini) means
 * adding one case to the switch — the graph nodes never change.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { createOpenAIClient } from "./openai";
import { createAnthropicClient } from "./anthropic";

export type Provider = "openai" | "anthropic";

/**
 * Returns a LangChain-compatible chat model for the given provider.
 *
 * @param provider - "openai" | "anthropic"
 * @param streaming - Enable token streaming (true for nodes that stream to frontend)
 * @param temperature - Sampling temperature. Use 0 for evaluator (deterministic
 *   scoring), ~0.7 for PromptGen (creative), ~0.5 for refine (creative but focused).
 */
export function getLLMClient(
  provider: Provider,
  streaming = false,
  temperature = 0.7
): BaseChatModel {
  switch (provider) {
    case "openai":
      return createOpenAIClient(streaming, temperature);
    case "anthropic":
      return createAnthropicClient(streaming, temperature);
    default:
      // TypeScript's exhaustive check: this line is unreachable if all
      // Provider union members are handled above. If you add a new provider
      // to the union without adding a case, this becomes a compile error.
      throw new Error(`Unknown provider: ${provider satisfies never}`);
  }
}
