/**
 * lib/graph/edges.ts — Conditional routing functions
 *
 * ─────────────────────────────────────────────────────────────────
 * WHAT ARE EDGES IN LANGGRAPH?
 * ─────────────────────────────────────────────────────────────────
 * Edges connect nodes. There are two kinds:
 *
 * 1. Deterministic edges (addEdge): "always go from A to B"
 *    Example: promptGenNode always goes to evaluatorNode. No choice needed.
 *
 * 2. Conditional edges (addConditionalEdges): "call this function to decide
 *    where to go based on the current state"
 *    Example: after evaluatorNode, go to refineNode OR __end__ based on score.
 *
 * The functions in this file are the "conditional" part. They receive the full
 * current state and return a string — the name of the next node to run (or
 * "__end__" to terminate the graph).
 *
 * ─────────────────────────────────────────────────────────────────
 * WHY THIS IS BETTER THAN THE PYTHON APPROACH
 * ─────────────────────────────────────────────────────────────────
 * Python's refinement loop (openaipersona.py lines 234–257):
 *
 *   if extract_rating(extract_response(evaluation)) < .9:
 *       redo = promptgen.generate_persona(evaluation)
 *       ...
 *       if extract_rating(extract_response(evaluation2)) < .9:
 *           redo2 = promptgen.generate_persona(evaluation2)
 *           ...
 *           if extract_rating(extract_response(evaluation3)) < .9:
 *               redo3 = promptgen.generate_persona(evaluation3)
 *
 * Problems:
 * - 3 hardcoded nested ifs — O(n) code duplication for n iterations
 * - MAX_REFINEMENTS is implicitly 3, buried in nesting depth
 * - Adding a 4th iteration requires copy-pasting another block
 * - The logic is interleaved with state mutation, making it hard to test
 *
 * With LangGraph conditional edges:
 * - shouldRefine() is a pure function of state — testable in isolation
 * - MAX_REFINEMENTS is an explicit named constant
 * - Changing to 5 iterations: change one number
 * - The graph topology is inspectable via LangGraph Studio
 */

import type { GraphState } from "./state";

/**
 * Maximum number of refinement iterations before we accept whatever persona
 * we have, regardless of score. Matches the Python app's implicit limit of 3
 * (three nested if blocks = three possible redo calls).
 *
 * WHEN TO INCREASE THIS: If you're seeing consistently good improvement
 * between iteration 2 and 3, it may be worth trying 4 or 5 iterations.
 * The tradeoff: more iterations = higher latency and API costs.
 */
const MAX_REFINEMENTS = 3;

/**
 * shouldRefine — decides whether to run another refinement iteration
 *
 * Called by LangGraph after evaluatorNode completes.
 * Returns "refine" to loop back to refineNode, or "__end__" to terminate.
 *
 * The three terminal conditions (all return "__end__"):
 *   1. score === null  → evaluator returned unparseable output (fail-safe)
 *   2. score >= 0.9    → persona is good enough (same threshold as Python)
 *   3. refinementCount >= MAX_REFINEMENTS → hit the iteration cap
 *
 * If none of these conditions hold, we return "refine" to improve the persona.
 *
 * Note on condition 3: refinementCount is incremented AT THE END of refineNode,
 * so after the 3rd refinement, refinementCount === 3. The condition >= 3
 * catches this correctly — the graph will terminate after evaluating the
 * result of the 3rd refine, not before.
 */
export function shouldRefine(state: GraphState): "refine" | "__end__" {
  const { latestScore, refinementCount } = state;

  // Fail-safe: if we couldn't parse a score, don't loop
  if (latestScore === null) return "__end__";

  // Persona quality threshold — matches Python's hardcoded 0.9 check
  if (latestScore >= 0.9) return "__end__";

  // Iteration cap — prevents infinite loops
  if (refinementCount >= MAX_REFINEMENTS) return "__end__";

  return "refine";
}

/**
 * routeByPhase — determines the initial graph branch at START
 *
 * Called by LangGraph at the entry point (START node).
 * Routes to "promptGen" for persona generation, or "test" for persona testing.
 *
 * WHY ROUTE AT START?
 * Using a single endpoint for both flows (/api/persona) is simpler on the
 * frontend — it doesn't need to track two different API URLs or manage separate
 * connection states. The phase is passed in the request body and written into
 * graph state by the API route before invocation.
 *
 * ALTERNATIVE: Two separate API routes (/api/persona/generate and /api/persona/test).
 * Cleaner separation of concerns, but requires the frontend to manage two
 * different useChat() endpoints by URL rather than by body parameter. Since
 * we're already using two useChat() instances, this would work too — but the
 * single endpoint is marginally simpler.
 */
export function routeByPhase(
  state: GraphState
): "promptGen" | "test" {
  return state.phase === "test" ? "test" : "promptGen";
}

export { MAX_REFINEMENTS };
