/**
 * lib/graph/nodes.ts — The four agent nodes in the LangGraph graph
 *
 * ─────────────────────────────────────────────────────────────────
 * WHAT IS A NODE?
 * ─────────────────────────────────────────────────────────────────
 * A LangGraph node is a function with this signature:
 *   async (state: GraphState) => Partial<GraphState>
 *
 * It receives the full current state, does work (LLM call, parsing, etc.),
 * and returns ONLY the fields it wants to update. LangGraph merges the partial
 * update into the full state using the reducers defined in state.ts.
 *
 * NODES IN THIS GRAPH:
 * 1. promptGenNode  — First-time persona generation (mirrors Python's PromptGen class)
 * 2. evaluatorNode  — Scores the latest persona 0–1 (mirrors Python's Evaluator class)
 * 3. refineNode     — PromptGen re-run with evaluator feedback injected
 * 4. testNode       — Uses current persona as system prompt for a test conversation
 *
 * WHY FOUR NODES INSTEAD OF THREE (matching the Python classes)?
 * The Python app had PromptGen, Evaluator, and Test. But PromptGen handled
 * BOTH initial generation AND refinement in a single class — the refinement
 * was triggered by passing the evaluator JSON back to the same method.
 *
 * Splitting into promptGenNode + refineNode makes the graph topology explicit:
 * - promptGenNode: user input → initial persona
 * - refineNode:    evaluator feedback → improved persona
 * The separation also lets us give each step its own streamStepLabel so the
 * UI can show "Generating..." vs "Refining (1/3)..." distinctly.
 *
 * ─────────────────────────────────────────────────────────────────
 * ABOUT LLM CALLS IN NODES
 * ─────────────────────────────────────────────────────────────────
 * Each node uses getLLMClient() to get a model, then calls model.invoke()
 * for a non-streaming call (we just want the final text for parsing).
 * The API route handles streaming to the frontend separately via streamEvents().
 * See lib/stream-helpers.ts for how LangGraph events → frontend tokens.
 *
 * WHY NOT STREAM INSIDE THE NODE?
 * Streaming within a node complicates state updates — we'd need to buffer
 * the full response before we can parse JSON from it anyway. The LangGraph
 * streamEvents() API intercepts LLM calls across all nodes and streams their
 * tokens to the API route, which forwards them to the client. The nodes
 * themselves stay simple: invoke → parse → return state update.
 */

import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { getLLMClient } from "../providers";
import type { GraphState } from "./state";
import {
  PROMPTGEN_SYSTEM_PROMPT,
  EVALUATOR_SYSTEM_PROMPT,
  buildRefinementInjection,
} from "./prompts";
import { PromptGenOutputSchema, EvaluatorOutputSchema } from "../schemas";

// ─────────────────────────────────────────────────────────────────────────────
// Helper: extract and clean JSON from LLM responses
//
// The Python app used extract_response() to strip markdown code fences
// (```json ... ```) before parsing JSON. Models sometimes wrap their output
// in fences even when instructed not to. This function handles that.
// ─────────────────────────────────────────────────────────────────────────────

function extractJSON(raw: string): string {
  // Match content inside triple backtick blocks (with optional language tag)
  // Example: ```json\n{...}\n``` → {...}
  const fenceMatch = raw.match(/```(?:\w+)?\n?([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Also handle cases where the model returns JSON directly (no fence)
  return raw.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Node 1: promptGenNode
//
// What it does:
//   Sends the user's message to the PromptGen agent (with full conversation
//   history as context) and receives a JSON response containing a persona
//   definition (or null if the agent needs more information first).
//
// Mirrors: Python's PromptGen.generate_persona() (lines 165–174) + the
//   UI code that calls it (lines 223–225)
//
// State reads:  conversation, userInput, provider
// State writes: conversation (appends user + AI messages), currentPersona
// ─────────────────────────────────────────────────────────────────────────────

export async function promptGenNode(
  state: GraphState
): Promise<Partial<GraphState>> {
  const model = getLLMClient(state.provider, false, 0.7);

  // Build the message history for the LLM call.
  // Structure: [SystemMessage, ...conversationHistory, HumanMessage(userInput)]
  // This matches the Python implementation exactly (lines 167–169):
  //   conversation_history = [{"role": "system", ...}]
  //                        + st.session_state.conversation
  //                        + [{"role": "user", "content": query}]
  const messages = [
    new SystemMessage(PROMPTGEN_SYSTEM_PROMPT),
    ...state.conversation, // existing back-and-forth
    new HumanMessage(state.userInput),
  ];

  const response = await model.invoke(messages);
  const rawContent = String(response.content);

  // Parse the JSON response to extract the persona (if one was generated).
  // Using Zod safeParse instead of Python's try/except json.JSONDecodeError
  // (which just returned None on failure — we do the same but with types).
  let currentPersona: string | null = null;
  const parseResult = PromptGenOutputSchema.safeParse(
    JSON.parse(extractJSON(rawContent))
  );
  if (parseResult.success) {
    currentPersona = parseResult.data["current-persona"];
  }

  // Return the partial state update.
  // Note: we append BOTH the user message and the AI response to conversation.
  // The messagesStateReducer will append them to the existing array.
  return {
    conversation: [new HumanMessage(state.userInput), new AIMessage(rawContent)],
    currentPersona,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Node 2: evaluatorNode
//
// What it does:
//   Scores the current-persona on a 0–1 scale and provides feedback.
//   The score is used by the shouldRefine() conditional edge to decide
//   whether to loop back to refineNode or end the graph.
//
// Mirrors: Python's Evaluator.generate_persona() (lines 195–205) + the
//   UI code that calls it (lines 228–231)
//
// State reads:  conversation, evalLog, currentPersona, provider
// State writes: evalLog (appends evaluation pair), latestScore, latestFeedback
//
// WHY temperature=0?
// The evaluator should be consistent — the same persona should get roughly the
// same score across multiple runs. A temperature of 0 makes the output more
// deterministic. (Note: not perfectly deterministic due to floating-point
// non-determinism in GPU operations, but much more consistent than 0.7.)
// ─────────────────────────────────────────────────────────────────────────────

export async function evaluatorNode(
  state: GraphState
): Promise<Partial<GraphState>> {
  const model = getLLMClient(state.provider, false, 0.0);

  // The evaluator gets the full conversation history + eval log as context.
  // This matches the Python implementation (lines 197–200):
  //   conversation_history = [system] + conversation + eval_log + [user_turn]
  //
  // The "user_turn" here is the most recent PromptGen response — we pass it
  // so the evaluator has the freshest persona to score.
  const latestPersonaMessage =
    state.conversation[state.conversation.length - 1];

  const messages = [
    new SystemMessage(EVALUATOR_SYSTEM_PROMPT),
    ...state.conversation,
    ...state.evalLog,
    // If there's no new message (shouldn't happen, but defensive), skip
    ...(latestPersonaMessage ? [new HumanMessage(String(latestPersonaMessage.content))] : []),
  ];

  const response = await model.invoke(messages);
  const rawContent = String(response.content);

  // Parse score and feedback from the evaluator's JSON response.
  // If parsing fails (e.g. malformed JSON), default to score=1.0 so the graph
  // doesn't loop indefinitely on a parse failure.
  let latestScore = 1.0;
  let latestFeedback = "Unable to parse evaluation. Proceeding with current persona.";

  try {
    const parseResult = EvaluatorOutputSchema.safeParse(
      JSON.parse(extractJSON(rawContent))
    );
    if (parseResult.success) {
      latestScore = parseResult.data.score;
      latestFeedback = parseResult.data.feedback;
    }
  } catch {
    // JSON.parse threw — raw content wasn't valid JSON even after fence removal.
    // The defaults above handle this gracefully.
  }

  return {
    // Append the evaluation pair: the input we evaluated (user role) and the
    // score/feedback response (assistant role). This mirrors the Python app's
    // eval_log structure (lines 228–230).
    evalLog: [
      new HumanMessage(String(latestPersonaMessage?.content ?? "")),
      new AIMessage(rawContent),
    ],
    latestScore,
    latestFeedback,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Node 3: refineNode
//
// What it does:
//   Re-runs the PromptGen agent with the evaluator's feedback injected as the
//   "user" message. This tells the agent exactly what to fix in the persona.
//
// Mirrors: Python lines 235–236:
//   redo = promptgen.generate_persona(evaluation)
//   extracted_persona = extract_persona(extract_response(redo))
//
// State reads:  conversation, latestFeedback, latestScore, refinementCount, provider
// State writes: conversation (appends refinement response), currentPersona,
//               refinementCount (incremented)
//
// KEY DIFFERENCE FROM PYTHON:
// The Python app passed the raw evaluator JSON as the user turn. We use
// buildRefinementInjection() from prompts.ts to format it more clearly.
// Both approaches work because the PromptGen system prompt explicitly says
// "Your input may be json from an evaluator" — we just make it cleaner.
// ─────────────────────────────────────────────────────────────────────────────

export async function refineNode(
  state: GraphState
): Promise<Partial<GraphState>> {
  const model = getLLMClient(state.provider, false, 0.7);

  const feedbackMessage = buildRefinementInjection(
    state.latestScore ?? 0,
    state.latestFeedback ?? "Please improve the persona."
  );

  const messages = [
    new SystemMessage(PROMPTGEN_SYSTEM_PROMPT),
    ...state.conversation,
    new HumanMessage(feedbackMessage),
  ];

  const response = await model.invoke(messages);
  const rawContent = String(response.content);

  // Extract the refined persona (same parsing logic as promptGenNode)
  let currentPersona = state.currentPersona; // fallback to previous if parse fails
  try {
    const parseResult = PromptGenOutputSchema.safeParse(
      JSON.parse(extractJSON(rawContent))
    );
    if (parseResult.success && parseResult.data["current-persona"]) {
      currentPersona = parseResult.data["current-persona"];
    }
  } catch {
    // Keep existing persona on parse failure — don't regress
  }

  return {
    conversation: [
      new HumanMessage(feedbackMessage),
      new AIMessage(rawContent),
    ],
    currentPersona,
    refinementCount: state.refinementCount + 1,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Node 4: testNode
//
// What it does:
//   Uses the currentPersona as the system prompt and generates a response to
//   the user's test query. This lets the user experience what the chatbot would
//   actually say with the generated persona.
//
// Mirrors: Python's Test.generate_response() (lines 103–112)
//
// IMPROVEMENT OVER PYTHON:
// The Python Test class used a single-turn conversation:
//   conversation_history = [{"role": "system", ...}, {"role": "user", content: query}]
// It didn't preserve previous test messages. This node uses testConversation to
// maintain multi-turn context — the test persona "remembers" the conversation.
//
// State reads:  currentPersona, testConversation, userInput, provider
// State writes: testConversation (appends user + AI messages)
// ─────────────────────────────────────────────────────────────────────────────

export async function testNode(
  state: GraphState
): Promise<Partial<GraphState>> {
  if (!state.currentPersona) {
    // No persona to test — return an error message as the AI response
    return {
      testConversation: [
        new HumanMessage(state.userInput),
        new AIMessage(
          "No persona has been generated yet. Please create one in the chat panel first."
        ),
      ],
    };
  }

  // Use a slightly lower temperature for testing — the persona should behave
  // consistently when a user is evaluating it. 0.5 allows some natural variation
  // without being erratic.
  const model = getLLMClient(state.provider, false, 0.5);

  const messages = [
    new SystemMessage(state.currentPersona),
    ...state.testConversation,
    new HumanMessage(state.userInput),
  ];

  const response = await model.invoke(messages);

  return {
    testConversation: [
      new HumanMessage(state.userInput),
      new AIMessage(String(response.content)),
    ],
  };
}
