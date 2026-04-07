/**
 * lib/graph/graph.ts — StateGraph wiring and compilation
 *
 * This file is the "assembly" step: it takes all the nodes, edges, and state
 * definitions from the other files and wires them into a compiled graph.
 *
 * ─────────────────────────────────────────────────────────────────
 * THE GRAPH TOPOLOGY (visual)
 * ─────────────────────────────────────────────────────────────────
 *
 *   START
 *     │
 *     ├─[phase=test]──────────────────────────────► testNode ──► END
 *     │
 *     └─[phase=generate]─► promptGenNode
 *                               │  (deterministic)
 *                           evaluatorNode
 *                               │
 *                    [shouldRefine conditional]
 *                        │                │
 *                    "refine"          "__end__"
 *                        │                │
 *                    refineNode          END
 *                        │  (deterministic)
 *                    evaluatorNode  ◄─── loops back
 *                        │
 *                    [shouldRefine conditional]
 *                        │                │
 *                    "refine"          "__end__"
 *                     ...                END
 *
 * DETERMINISTIC EDGES (addEdge):
 *   promptGenNode → evaluatorNode  (always evaluate after generating)
 *   refineNode    → evaluatorNode  (always evaluate after refining)
 *   testNode      → END            (test is always a single turn)
 *
 * CONDITIONAL EDGES (addConditionalEdges):
 *   START         → routeByPhase  → "promptGen" or "test"
 *   evaluatorNode → shouldRefine  → "refine" or "__end__"
 *
 * ─────────────────────────────────────────────────────────────────
 * ABOUT graph.compile()
 * ─────────────────────────────────────────────────────────────────
 * Calling .compile() validates the graph structure (no disconnected nodes,
 * all edge targets exist, etc.) and returns a compiled graph object that can
 * be invoked or streamed. The compiled graph is a module-level singleton —
 * we create it once when the module loads, not on every request.
 *
 * WHY SINGLETON? Creating a new StateGraph and compiling it on every API
 * request would be wasteful — the topology never changes between requests.
 * Only the initial state changes per request. The compiled graph is stateless;
 * all state lives in the invocation arguments.
 */

import { StateGraph, START, END } from "@langchain/langgraph";
import { GraphStateAnnotation } from "./state";
import { promptGenNode, evaluatorNode, refineNode, testNode } from "./nodes";
import { shouldRefine, routeByPhase } from "./edges";

const workflow = new StateGraph(GraphStateAnnotation)
  // ─── Register nodes ────────────────────────────────────────────────────────
  // addNode(name, function) — the name is what edges reference
  .addNode("promptGen", promptGenNode)
  .addNode("evaluator", evaluatorNode)
  .addNode("refine", refineNode)
  .addNode("test", testNode)

  // ─── Conditional entry edge ────────────────────────────────────────────────
  // addConditionalEdges(source, routingFn, { returnValue: targetNode })
  // routeByPhase returns "promptGen" or "test", mapped to their node names.
  .addConditionalEdges(START, routeByPhase, {
    promptGen: "promptGen",
    test: "test",
  })

  // ─── Deterministic edges ───────────────────────────────────────────────────
  // After generating a persona, always evaluate it
  .addEdge("promptGen", "evaluator")

  // After testing, always end (test is a single turn)
  .addEdge("test", END)

  // ─── Conditional loop edge ─────────────────────────────────────────────────
  // After evaluating, either refine (score < 0.9 and under iteration cap)
  // or end (score >= 0.9 or cap reached).
  // "__end__" is LangGraph's reserved string that maps to the END node.
  .addConditionalEdges("evaluator", shouldRefine, {
    refine: "refine",
    __end__: END,
  })

  // After refining, always re-evaluate (to check if the refinement helped)
  .addEdge("refine", "evaluator");

// Compile once, export as singleton
export const graph = workflow.compile();
