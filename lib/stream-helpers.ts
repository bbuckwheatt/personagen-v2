/**
 * lib/stream-helpers.ts — Bridge between LangGraph events and the Vercel AI SDK
 *
 * ─────────────────────────────────────────────────────────────────
 * THE STREAMING ARCHITECTURE
 * ─────────────────────────────────────────────────────────────────
 *
 * When the API route calls graph.streamEvents(initialState, { version: "v2" }),
 * LangGraph emits a stream of events describing everything that happens inside
 * the graph: node transitions, LLM token outputs, chain calls, etc.
 *
 * The Vercel AI SDK's useChat() expects a specific wire format in the HTTP
 * response body called the "AI Data Stream Protocol":
 *   "0:\"token\"\n"          — a text token to append to the current message
 *   "2:[{...}]\n"            — a structured data annotation
 *   "d:{...}\n"              — stream finish metadata
 *
 * This file contains utilities that translate LangGraph events into those
 * AI SDK protocol frames.
 *
 * ─────────────────────────────────────────────────────────────────
 * TWO CHANNELS IN THE STREAM
 * ─────────────────────────────────────────────────────────────────
 *
 * Channel 1 — Text tokens ("0:" frames):
 *   Raw LLM output tokens as they arrive. The useChat() hook assembles them
 *   into messages[last].content in real time.
 *
 * Channel 2 — Structured annotations ("2:" frames):
 *   Typed events about what's happening in the graph. The frontend reads
 *   these from useChat().data[] to update:
 *   - AgentStepIndicator: which node is running
 *   - EvaluationBadge: current score
 *   - PersonaPreviewPanel: extracted persona text
 *
 * WHY TWO CHANNELS?
 * The text stream is for the human-readable chat message. Parsing JSON from
 * a partial token stream is fragile (you'd need to buffer until the stream
 * ends, which defeats the purpose of streaming). Structured annotations are
 * a clean side-channel that don't pollute the chat message text.
 *
 * ─────────────────────────────────────────────────────────────────
 * ABOUT LangGraph streamEvents
 * ─────────────────────────────────────────────────────────────────
 *
 * graph.streamEvents(state, { version: "v2" }) yields events like:
 *
 *   { event: "on_chain_start", name: "promptGen", ... }
 *   { event: "on_chat_model_stream", data: { chunk: { content: "Hello" } }, ... }
 *   { event: "on_chat_model_stream", data: { chunk: { content: " world" } }, ... }
 *   { event: "on_chain_end", name: "promptGen", data: { output: { ... } }, ... }
 *   { event: "on_chain_start", name: "evaluator", ... }
 *   ...
 *
 * We filter for the events we care about and translate them into AI SDK frames.
 */

import type { AgentStepAnnotation } from "./schemas";

// Node names used in the graph (matches the strings in graph.ts addNode calls)
type NodeName = "promptGen" | "evaluator" | "refine" | "test";

// Human-readable labels for each node, shown in the AgentStepIndicator UI
const NODE_LABELS: Record<string, string> = {
  promptGen: "Generating persona...",
  evaluator: "Evaluating persona...",
  refine: "Refining persona...",
  test: "Testing persona...",
};

/**
 * Formats an AgentStepAnnotation as an AI SDK "2:" data frame.
 *
 * The AI SDK data stream protocol encodes structured data as:
 *   2:[json_array]\n
 * where json_array is an array of annotation objects.
 *
 * Example output:
 *   2:[{"type":"agentStep","node":"promptGen","label":"Generating persona..."}]\n
 */
export function formatAnnotationFrame(annotation: AgentStepAnnotation): string {
  return `2:${JSON.stringify([annotation])}\n`;
}

/**
 * Formats a text token as an AI SDK "0:" text frame.
 *
 * The AI SDK protocol encodes text as:
 *   0:"escaped_string"\n
 *
 * The string is JSON-encoded (so quotes and newlines are escaped).
 */
export function formatTextFrame(token: string): string {
  return `0:${JSON.stringify(token)}\n`;
}

/**
 * Formats the stream finish frame.
 * The AI SDK requires this at the end of the stream to signal completion.
 */
export function formatFinishFrame(): string {
  return `d:{"finishReason":"stop","usage":{"promptTokens":0,"completionTokens":0}}\n`;
}

/**
 * Builds the agentStep annotation for a node starting.
 * Used when we see "on_chain_start" events from LangGraph.
 */
export function buildAgentStepAnnotation(
  node: NodeName,
  refinementCount?: number
): AgentStepAnnotation {
  let label = NODE_LABELS[node] ?? `Running ${node}...`;

  // For refine node, show the iteration count
  if (node === "refine" && refinementCount !== undefined) {
    label = `Refining persona (attempt ${refinementCount + 1}/3)...`;
  }

  return {
    type: "agentStep",
    node,
    label,
  };
}

/**
 * Determines if a LangGraph event is a token from an LLM call inside a
 * specific node. We filter to specific nodes to avoid forwarding tokens
 * from nested LangChain chains that we don't want the user to see.
 *
 * @param event - The raw LangGraph stream event
 * @param targetNodes - If provided, only return true for events from these nodes.
 *   If omitted, accept tokens from any node.
 */
export function isLLMTokenEvent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event: any,
  targetNodes?: NodeName[]
): boolean {
  if (event.event !== "on_chat_model_stream") return false;

  // LangGraph puts the node name in event.metadata.langgraph_node
  if (targetNodes && event.metadata?.langgraph_node) {
    return targetNodes.includes(event.metadata.langgraph_node as NodeName);
  }

  return true;
}

/**
 * Extracts the token text from an "on_chat_model_stream" event.
 * Returns null if the chunk has no text content (e.g. tool call chunks).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractTokenFromEvent(event: any): string | null {
  const chunk = event.data?.chunk;
  if (!chunk) return null;

  // LangChain chat model chunks have .content as string or array of content parts
  const content = chunk.content;
  if (typeof content === "string") return content || null;
  if (Array.isArray(content)) {
    // Some models (e.g. Claude) return content as an array of content blocks
    const text = content
      .filter((c: { type: string }) => c.type === "text")
      .map((c: { text: string }) => c.text)
      .join("");
    return text || null;
  }

  return null;
}

/**
 * Checks if a LangGraph event is a node chain start event.
 * Used to emit the agentStep annotation when a node begins.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isNodeStartEvent(event: any, nodeName: string): boolean {
  return (
    event.event === "on_chain_start" &&
    event.name === nodeName
  );
}

/**
 * Checks if a LangGraph event is a node chain end event.
 * Used to emit the evaluation annotation after evaluatorNode completes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isNodeEndEvent(event: any, nodeName: string): boolean {
  return (
    event.event === "on_chain_end" &&
    event.name === nodeName
  );
}
