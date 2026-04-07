/**
 * lib/providers/openai.ts — OpenAI LangChain client
 *
 * WHY A WRAPPER INSTEAD OF USING THE RAW OPENAI SDK?
 * LangGraph nodes work with LangChain's BaseChatModel interface.
 * ChatOpenAI (from @langchain/openai) implements that interface, so our graph
 * nodes can call model.invoke() / model.stream() without caring which provider
 * is underneath. This is the "program to an interface, not an implementation"
 * principle — swapping providers requires changing only this file and
 * lib/providers/anthropic.ts, not every node.
 *
 * ALTERNATIVE: Use the raw openai SDK and adapt it manually. This gives more
 * control (e.g. fine-grained retry config) but means writing ~50 lines of
 * adapter code per provider instead of one import.
 *
 * MODEL CHOICE: gpt-4.1
 * Released April 2025. Significantly faster and cheaper than gpt-4o while
 * matching or exceeding it on instruction-following tasks. Since we're running
 * up to 8 LLM calls in a worst-case graph run, faster per-call latency matters.
 *
 * WHY NOT o4-mini OR o1?
 * The "o" series models are optimized for multi-step reasoning (math, code).
 * Persona generation is a creative writing + structured JSON task — the standard
 * gpt-4.1 is better suited and cheaper for this use case.
 */

import { ChatOpenAI } from "@langchain/openai";

// The model ID as of April 2025. Pin this explicitly rather than using "latest"
// aliases — model aliases change silently and can break prompts optimized for
// a specific model version.
const OPENAI_MODEL = "gpt-4.1";

/**
 * Creates a configured ChatOpenAI instance.
 *
 * @param streaming - Whether to enable token streaming. Set true for nodes
 *   that stream tokens to the frontend; false for nodes where we only care
 *   about the final result (e.g. a quick metadata extraction step).
 * @param temperature - 0.0 for deterministic outputs (evaluator), higher for
 *   creative tasks (promptGen). Default 0.7 is a good balance.
 */
export function createOpenAIClient(
  streaming = false,
  temperature = 0.7
): ChatOpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to .env.local:\n  OPENAI_API_KEY=sk-..."
    );
  }

  return new ChatOpenAI({
    model: OPENAI_MODEL,
    temperature,
    streaming,
    apiKey: process.env.OPENAI_API_KEY,
    // maxRetries: 2 is the LangChain default — retries once on transient errors
    // (rate limits, 500s). Good enough for a dev project; for production you'd
    // configure exponential backoff here.
  });
}

export { OPENAI_MODEL };
