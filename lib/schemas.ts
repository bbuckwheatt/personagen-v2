/**
 * lib/schemas.ts — Zod schemas for all LLM output shapes
 *
 * WHY ZOD?
 * LLMs return strings. Even when we ask for JSON, they sometimes wrap it in
 * markdown fences (```json ... ```), add a preamble, or omit optional fields.
 * The original Python app handled this with scattered try/except json.JSONDecodeError
 * blocks (see openaipersona.py lines 52–96). Zod replaces that pattern with:
 *
 *   const result = SomeSchema.safeParse(parsed)
 *   if (!result.success) { /* handle gracefully *\/ }
 *   else { result.data.fieldName }  // fully typed!
 *
 * Two benefits over manual type assertions (as SomeType):
 * 1. Runtime safety — validates the actual shape, not just the TypeScript types
 * 2. Inferred TypeScript types — no separate interface needed, z.infer<> handles it
 *
 * TRADEOFF: Zod adds ~15KB to the bundle (server-side only here, so irrelevant),
 * and every parse has a tiny runtime cost. For LLM output validation this is
 * always worth it — LLMs are not type-safe by nature.
 */

import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// PromptGen output schema
// Mirrors the JSON contract defined in the PromptGen system prompt.
// The Python app expected exactly these keys (openaipersona.py lines 121–124).
// ─────────────────────────────────────────────────────────────────────────────

export const PromptGenOutputSchema = z.object({
  /**
   * The full text of the generated persona (system prompt for a chatbot).
   * null means the LLM hasn't generated one yet — it's still asking questions.
   * WHY nullable? The PromptGen agent is designed to ask clarifying questions
   * before creating a persona, so early turns legitimately have no persona.
   */
  "current-persona": z.string().nullable().default(null),

  /**
   * The LLM's explanation of why it built the persona this way.
   * Valuable for the user to understand what the AI is optimizing for.
   */
  reasoning: z.string().default(""),

  /**
   * A list of remaining questions to ask the user before finalizing the persona.
   * The LLM maintains and updates this list as questions are answered.
   */
  plan: z.array(z.string()).default([]),

  /**
   * The text to show the user — either the next question from the plan,
   * or a response acknowledging their input.
   * This is what the chat panel renders as the assistant's visible message.
   */
  next: z.string().default(""),
});

export type PromptGenOutput = z.infer<typeof PromptGenOutputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Evaluator output schema
// From openaipersona.py lines 184–191 — the evaluator returns exactly two keys.
// ─────────────────────────────────────────────────────────────────────────────

export const EvaluatorOutputSchema = z.object({
  /**
   * How good is this persona? 0.0 = unusable, 1.0 = excellent.
   * The graph uses this to decide whether to refine (threshold: 0.9).
   * WHY .min(0).max(1)? LLMs occasionally return values like 0.85 or even 1.2.
   * Clamping at parse time prevents out-of-range values from confusing routing.
   */
  score: z.number().min(0).max(1),

  /**
   * Specific critique and suggestions for improvement.
   * Passed back into the PromptGen agent during refinement so it knows
   * exactly what to fix — not just "try again".
   */
  feedback: z.string(),
});

export type EvaluatorOutput = z.infer<typeof EvaluatorOutputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Stream annotation types — sent from the API route to the frontend
//
// The Vercel AI SDK supports two frame types in its data stream:
//   "0:" — raw text token (builds up the message in the chat panel)
//   "2:" — structured data annotation (used for UI state updates)
//
// We use "2:" frames to tell the frontend:
//   - Which graph node is currently running (drives AgentStepIndicator)
//   - The evaluator's score + feedback (drives EvaluationBadge)
//   - The extracted persona text (drives PersonaPreviewPanel)
//
// WHY NOT just parse the text stream on the frontend?
// The text stream is for the human-readable chat message. Extracting JSON from
// a partial stream mid-flight is fragile. Structured annotations are a clean
// side-channel that don't pollute the chat message.
// ─────────────────────────────────────────────────────────────────────────────

export const AgentStepAnnotationSchema = z.discriminatedUnion("type", [
  /**
   * Emitted when a graph node starts executing.
   * The frontend uses this to show "Generating persona..." / "Evaluating..." etc.
   */
  z.object({
    type: z.literal("agentStep"),
    node: z.enum(["promptGen", "evaluator", "refine", "test"]),
    label: z.string(), // human-readable, e.g. "Generating initial persona..."
  }),

  /**
   * Emitted after the evaluatorNode completes.
   * The frontend uses this to update the score badge and evaluation log.
   */
  z.object({
    type: z.literal("evaluation"),
    score: z.number(),
    feedback: z.string(),
    refinementCount: z.number(), // how many refinement attempts so far
  }),

  /**
   * Emitted when a persona has been successfully extracted.
   * The frontend uses this to update the PersonaPreviewPanel immediately,
   * even before the full graph run completes.
   */
  z.object({
    type: z.literal("persona"),
    persona: z.string(),
  }),
]);

export type AgentStepAnnotation = z.infer<typeof AgentStepAnnotationSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Request body schema — what the frontend POSTs to /api/persona
// ─────────────────────────────────────────────────────────────────────────────

export const PersonaRequestBodySchema = z.object({
  /**
   * The conversation messages in Vercel AI SDK format.
   * useChat() sends { messages: Message[] } by default.
   */
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant", "system"]),
      content: z.string(),
    })
  ),

  /**
   * "generate" — run the PromptGen → Evaluator → (Refine loop) flow
   * "test"     — run the Test agent using currentPersona as system prompt
   */
  phase: z.enum(["generate", "test"]),

  /** The currently active persona string (null if none yet). */
  currentPersona: z.string().nullable().default(null),

  /** How many refinement attempts have already happened this session. */
  refinementCount: z.number().default(0),

  /**
   * The model provider to use.
   * "openai"    → gpt-4.1
   * "anthropic" → claude-sonnet-4-6
   */
  provider: z.enum(["openai", "anthropic"]).default("openai"),

  /**
   * Serialized eval log (role/content pairs from previous evaluator calls).
   * Passed so the evaluator can maintain consistency across the session.
   */
  evalLog: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })
    )
    .default([]),
});

export type PersonaRequestBody = z.infer<typeof PersonaRequestBodySchema>;
