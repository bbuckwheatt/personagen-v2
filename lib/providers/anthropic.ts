/**
 * lib/providers/anthropic.ts — Anthropic (Claude) LangChain client
 *
 * Mirrors lib/providers/openai.ts — same interface, different model.
 * This is the provider abstraction pattern: the graph nodes import from
 * lib/providers/index.ts (below), which routes to this file or openai.ts
 * based on the runtime provider selection.
 *
 * MODEL CHOICE: claude-sonnet-4-6
 * Anthropic's mid-2025 flagship. Strong at structured output (JSON) and
 * instruction following — exactly what persona generation and evaluation need.
 * claude-opus-4-6 would be slightly more capable but slower and ~5x more expensive.
 * For a persona generator, Sonnet's quality ceiling is more than sufficient.
 *
 * TRADEOFF vs OPENAI:
 * Anthropic's models tend to follow complex system prompts more literally, which
 * can mean the JSON output is more reliably structured. OpenAI's gpt-4.1 is
 * faster for short tasks. In practice, both work well for this use case —
 * the user can switch in the UI and compare.
 */

import { ChatAnthropic } from "@langchain/anthropic";

const ANTHROPIC_MODEL = "claude-sonnet-4-6";

/**
 * Creates a configured ChatAnthropic instance.
 * Parameters mirror createOpenAIClient for a consistent interface.
 */
export function createAnthropicClient(
  streaming = false,
  temperature = 0.7
): ChatAnthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local:\n  ANTHROPIC_API_KEY=sk-ant-..."
    );
  }

  return new ChatAnthropic({
    model: ANTHROPIC_MODEL,
    temperature,
    streaming,
    apiKey: process.env.ANTHROPIC_API_KEY,
    // Anthropic-specific: claude-sonnet-4-6 supports up to 64k output tokens.
    // We don't need more than a few hundred for persona generation, so the
    // default max_tokens is fine.
  });
}

export { ANTHROPIC_MODEL };
