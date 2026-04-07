/**
 * lib/graph/state.ts — LangGraph shared state definition
 *
 * ─────────────────────────────────────────────────────────────────
 * THE CORE CONCEPT: THE SHARED WHITEBOARD
 * ─────────────────────────────────────────────────────────────────
 * LangGraph requires a single "state" type that flows through every node
 * in the graph. Think of it as a whiteboard that every agent can read from
 * and write to. Each node receives the FULL current state and returns a
 * PARTIAL update — LangGraph merges the partial update into the full state
 * using "reducers" before passing it to the next node.
 *
 * WHAT IS A REDUCER?
 * A reducer is a function: (currentValue, newValue) => mergedValue
 *
 * Example: For the `conversation` field, the reducer is `messagesStateReducer`,
 * which appends new messages to the existing array instead of replacing it:
 *   current: [msg1, msg2]
 *   update:  [msg3]
 *   result:  [msg1, msg2, msg3]
 *
 * If you used the default "last write wins" reducer, a node returning [msg3]
 * would wipe out msg1 and msg2. That would lose the conversation history!
 *
 * ALTERNATIVE PATTERNS:
 * 1. Point-to-point (pipeline): node1 returns output → node2 gets it as input
 *    Simpler for linear flows but can't handle the evaluator needing BOTH
 *    conversation history AND eval log simultaneously.
 * 2. External state store (Redis): nodes read/write from a database
 *    Needed for resumable/durable workflows but adds infrastructure complexity
 *    that isn't warranted for a synchronous request-response flow.
 * 3. Shared state (this pattern): single whiteboard, all nodes share it
 *    Best for flows where multiple agents need overlapping subsets of state.
 *
 * ─────────────────────────────────────────────────────────────────
 * LANGGRAPH ANNOTATION API
 * ─────────────────────────────────────────────────────────────────
 * Annotation.Root({}) is LangGraph's way of defining state schema.
 * Each field uses Annotation<Type, UpdateType>({ reducer, default }).
 * The compiled type GraphStateAnnotation.State is the full TypeScript type.
 */

import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import type { Provider } from "../providers";

export const GraphStateAnnotation = Annotation.Root({
  // ─── Conversation history (main chat panel) ───────────────────────────────
  /**
   * The full conversation between the user and the PromptGen agent.
   * Mirrors Python's st.session_state.conversation.
   *
   * Type: BaseMessage[] — LangChain's message type that carries role + content
   * + optional metadata (usage stats, tool calls, etc.)
   *
   * Reducer: messagesStateReducer — APPENDS new messages, never replaces the
   * array. This is critical: if a node returns [newMsg], the reducer produces
   * [...existingMessages, newMsg], not just [newMsg].
   */
  conversation: Annotation<BaseMessage[], BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  // ─── Evaluator history ────────────────────────────────────────────────────
  /**
   * The evaluator's own conversation history — separate from the main chat.
   * Mirrors Python's st.session_state.eval_log.
   *
   * WHY SEPARATE? The Evaluator needs its own context to score consistently
   * across iterations. If eval messages were mixed into `conversation`, the
   * PromptGen agent would see the evaluator's critiques as user turns and
   * get confused about who is speaking to it.
   *
   * The Python app had this right (line 197-200 in openaipersona.py):
   *   conversation_history = [system] + st.session_state.conversation
   *                        + st.session_state.eval_log + [user_turn]
   * We preserve exactly that structure here.
   */
  evalLog: Annotation<BaseMessage[], BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  // ─── Test panel conversation ───────────────────────────────────────────────
  /**
   * Conversation history for the right-panel test interface.
   * Kept separate so generating a new persona doesn't wipe the test history.
   * Mirrors Python's st.session_state.test_conversation.
   *
   * IMPROVEMENT OVER PYTHON: The original Test class (line 106-107) passed
   * only the current query — no history. This supports multi-turn testing.
   */
  testConversation: Annotation<BaseMessage[], BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  // ─── Current persona ──────────────────────────────────────────────────────
  /**
   * The most recently extracted persona string.
   * null = no persona has been generated yet.
   *
   * Reducer: "last write wins" (the default). We always want the latest persona,
   * not an accumulated list of them. When refineNode produces a better persona,
   * it replaces the previous one.
   *
   * WHY NOT keep all versions? This is a design choice. We could keep a
   * `personaHistory: string[]` to support undo, but the original app didn't
   * have that and adding it would require a history panel in the UI.
   */
  currentPersona: Annotation<string | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  // ─── Evaluation results ───────────────────────────────────────────────────
  /**
   * The evaluator's most recent score (0.0–1.0).
   * Read by the shouldRefine() conditional edge to decide whether to loop.
   * Also sent to the frontend as a stream annotation for the score badge.
   *
   * WHY STORE IN STATE (not returned from the evaluator function directly)?
   * LangGraph's conditional edge routing functions receive the full state, not
   * the return value of the previous node. The routing function must read from
   * state. So the evaluator node must write its score INTO state for routing
   * to work.
   */
  latestScore: Annotation<number | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  /**
   * The evaluator's most recent feedback text.
   * Injected into the PromptGen prompt during refinement so the agent knows
   * specifically what to improve. Mirrors Python line 235:
   *   redo = promptgen.generate_persona(evaluation)
   * where `evaluation` is the evaluator's JSON response with feedback.
   */
  latestFeedback: Annotation<string | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  // ─── Refinement loop counter ───────────────────────────────────────────────
  /**
   * How many times refineNode has run this session.
   * The Python app encoded this with 3 hardcoded nested if blocks (lines 234–257).
   * Here, shouldRefine() checks: if refinementCount >= 3, stop.
   *
   * Starting value: 0
   * After first refine: 1
   * After second: 2
   * After third: 3 → shouldRefine returns "__end__" regardless of score
   *
   * WHY 3? The original app's design — 3 attempts is enough to converge on a
   * high-quality persona for most use cases. This is now a named constant
   * (see lib/graph/edges.ts) that's easy to change.
   */
  refinementCount: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 0,
  }),

  // ─── Flow control ─────────────────────────────────────────────────────────
  /**
   * Determines which graph branch to take from START.
   * "generate" → PromptGen → Evaluator → (Refine loop)
   * "test"     → Test agent (uses currentPersona as system prompt)
   *
   * The API route sets this based on the request body `phase` field.
   * Using a single endpoint for both flows keeps the frontend simpler — it
   * doesn't need to track two separate API URLs.
   */
  phase: Annotation<"generate" | "test">({
    reducer: (_, next) => next,
    default: () => "generate",
  }),

  // ─── Provider selection ───────────────────────────────────────────────────
  /**
   * Which LLM provider to use for all nodes in this graph run.
   * Set by the API route from the request body.
   * All nodes in a single run use the same provider — mixing providers within
   * one graph run would produce inconsistent JSON formats since the models
   * were prompted differently during development.
   */
  provider: Annotation<Provider>({
    reducer: (_, next) => next,
    default: () => "openai",
  }),

  // ─── User input ───────────────────────────────────────────────────────────
  /**
   * The current user message being processed.
   * Set by the API route before invoking the graph. Each node that needs
   * the user's raw input reads this rather than parsing it out of the
   * conversation array (which would require array indexing).
   */
  userInput: Annotation<string>({
    reducer: (_, next) => next,
    default: () => "",
  }),
});

// Export the compiled TypeScript type for use in node function signatures
export type GraphState = typeof GraphStateAnnotation.State;
