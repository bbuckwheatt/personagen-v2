/**
 * app/api/persona/route.ts — The streaming API route
 *
 * ─────────────────────────────────────────────────────────────────
 * OVERVIEW
 * ─────────────────────────────────────────────────────────────────
 * This is the only API endpoint in the application. It:
 * 1. Receives a POST request from the frontend (via useChat)
 * 2. Parses and validates the request body
 * 3. Reconstructs the LangGraph state from the request
 * 4. Runs the graph with streamEvents() to get a live event stream
 * 5. Translates LangGraph events into the Vercel AI SDK wire format
 * 6. Returns a streaming response that the useChat() hook can consume
 *
 * ─────────────────────────────────────────────────────────────────
 * RUNTIME: NODE.JS (NOT EDGE)
 * ─────────────────────────────────────────────────────────────────
 * Vercel offers two runtimes for API routes:
 *
 * Edge Runtime:
 *   - Runs in V8 isolates (like Cloudflare Workers)
 *   - Cold start ~0ms, but max duration 30s (free) / 30s (Pro)
 *   - Cannot use Node.js built-ins (fs, Buffer, crypto, etc.)
 *   - PROBLEM: LangGraph.js uses Node.js APIs internally → incompatible
 *
 * Node.js Runtime (what we use):
 *   - Full Node.js environment
 *   - Cold start ~250ms, max duration 60s (free) / 300s (Pro)
 *   - Required for LangGraph.js
 *
 * The maxDuration export below sets the timeout. 300 requires Vercel Pro.
 * On the free tier, reduce to 60, but note that worst-case graph runs
 * (8 LLM calls) may occasionally timeout. Upgrading to Pro is recommended.
 *
 * ─────────────────────────────────────────────────────────────────
 * THE AI SDK DATA STREAM PROTOCOL
 * ─────────────────────────────────────────────────────────────────
 * The Vercel AI SDK's useChat() expects a specific HTTP response format.
 * We construct this manually using TransformStream + the helper functions
 * in lib/stream-helpers.ts.
 *
 * The wire format uses newline-delimited JSON with type prefixes:
 *   0:"token"          — text token to append to the current message
 *   2:[{...}]          — structured data annotation (agent step, score, etc.)
 *   d:{...}            — stream finish metadata
 *
 * The response must have Content-Type: text/plain;charset=utf-8
 * (the AI SDK parses this format, not application/json or text/event-stream).
 *
 * ─────────────────────────────────────────────────────────────────
 * WHY RECONSTRUCT STATE FROM THE REQUEST BODY?
 * ─────────────────────────────────────────────────────────────────
 * LangGraph's graph state lives in memory only during a single invocation.
 * Between HTTP requests, state is lost — Next.js API routes are stateless.
 * The frontend must send the complete conversation history on every request.
 *
 * This is the same pattern the Vercel AI SDK's useChat() uses by default —
 * it sends the full messages array on every submission. We extend this with
 * additional fields (evalLog, refinementCount, currentPersona) so the graph
 * can reconstruct its full state.
 *
 * TRADEOFF: Large conversations = larger request payloads. For a persona
 * generator with ~10-20 turns max, this is fine. For a production chatbot
 * with hundreds of turns, you'd want server-side session storage (Redis,
 * Vercel KV) and send only a session ID.
 */

import { NextRequest, NextResponse } from "next/server";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { graph } from "@/lib/graph/graph";
import { PersonaRequestBodySchema } from "@/lib/schemas";
import {
  formatAnnotationFrame,
  formatTextFrame,
  formatFinishFrame,
  buildAgentStepAnnotation,
  isLLMTokenEvent,
  extractTokenFromEvent,
  isNodeStartEvent,
  isNodeEndEvent,
} from "@/lib/stream-helpers";
import { EvaluatorOutputSchema } from "@/lib/schemas";

// Tell Vercel to use the Node.js runtime (required for LangGraph.js)
export const runtime = "nodejs";

// Set function timeout. 300 seconds requires Vercel Pro.
// On the free tier (60s max), the worst-case graph run may occasionally timeout.
// Change this to 60 if you're on the free tier.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  // ─── 1. Parse and validate the request body ─────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parseResult = PersonaRequestBodySchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parseResult.error.flatten() },
      { status: 400 }
    );
  }

  const {
    messages,
    phase,
    currentPersona,
    refinementCount,
    provider,
    evalLog,
  } = parseResult.data;

  // ─── 2. Reconstruct conversation history as LangChain messages ──────────
  // The frontend sends messages in AI SDK format: { role, content }
  // LangGraph needs LangChain message objects: HumanMessage, AIMessage, etc.
  const conversation = messages.map((m) => {
    switch (m.role) {
      case "user":
        return new HumanMessage(m.content);
      case "assistant":
        return new AIMessage(m.content);
      case "system":
        return new SystemMessage(m.content);
      default:
        // Defensive fallback — Zod schema restricts to the three cases above,
        // but TypeScript's switch exhaustiveness check doesn't apply at runtime.
        // Treat any unexpected role as a user message rather than produce undefined.
        return new HumanMessage(m.content);
    }
  });

  // Get the latest user message as the current userInput
  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
  const userInput = lastUserMessage?.content ?? "";

  // Reconstruct evalLog (excludes the current user message which is in userInput)
  const evalLogMessages = evalLog.map((m) =>
    m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content)
  );

  // ─── 3. Build the initial graph state ────────────────────────────────────
  // slice(0, -1) removes the last element (the current user message, which
  // lives in userInput) so the graph doesn't see it twice.
  // WHY SEPARATE conversation vs testConversation by phase?
  // The test useChat() instance only sends the TEST conversation in messages[].
  // The generate useChat() instance only sends the GENERATE conversation.
  // They hit the same endpoint but with different phase values — we route the
  // messages array into the correct state field based on phase.
  const historyWithoutLatestUserMsg = conversation.slice(0, -1);

  const initialState = {
    conversation: phase === "generate" ? historyWithoutLatestUserMsg : [],
    evalLog: evalLogMessages,
    testConversation: phase === "test" ? historyWithoutLatestUserMsg : [],
    currentPersona,
    latestScore: null as number | null,
    latestFeedback: null as string | null,
    refinementCount,
    phase,
    provider,
    userInput,
  };

  // ─── 4. Create the streaming response ────────────────────────────────────
  // TransformStream is the Web Streams API primitive for building pipelines.
  // We write AI SDK protocol frames to `writer` as LangGraph events arrive.
  // The `readable` end is returned as the HTTP response body.
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const write = (frame: string) => writer.write(encoder.encode(frame));

  // ─── 5. Run the graph asynchronously (non-blocking) ──────────────────────
  // We start the graph run in a separate async block and return the response
  // immediately. The stream will continue flowing as the graph executes.
  // The `write` calls happen asynchronously on the server while the client
  // reads from the streaming response.
  (async () => {
    try {
      // streamEvents emits a stream of events as the graph executes.
      // version: "v2" is required for the current LangGraph.js API.
      const eventStream = graph.streamEvents(initialState, {
        version: "v2",
      });

      let currentRefinementCount = refinementCount;
      // Which nodes should stream tokens to the user?
      // We stream from promptGen, refine, and test — the nodes whose output
      // the user sees in the chat panel. The evaluator output is shown as
      // structured annotations (score/feedback), not raw tokens.
      const streamingNodes = ["promptGen", "refine", "test"] as const;

      for await (const event of eventStream) {
        // ── Node start events: emit agentStep annotation ────────────────────
        if (isNodeStartEvent(event, "promptGen")) {
          await write(
            formatAnnotationFrame(buildAgentStepAnnotation("promptGen"))
          );
        } else if (isNodeStartEvent(event, "evaluator")) {
          await write(
            formatAnnotationFrame(buildAgentStepAnnotation("evaluator"))
          );
        } else if (isNodeStartEvent(event, "refine")) {
          await write(
            formatAnnotationFrame(
              buildAgentStepAnnotation("refine", currentRefinementCount)
            )
          );
        } else if (isNodeStartEvent(event, "test")) {
          await write(
            formatAnnotationFrame(buildAgentStepAnnotation("test"))
          );
        }

        // ── LLM token events: forward to text stream ────────────────────────
        // Only forward tokens from nodes whose output goes to the chat panel.
        // WHY NOT stream evaluator tokens?
        // The evaluator output is raw JSON (not user-facing text). Streaming it
        // would show JSON fragments in the chat message, which looks broken.
        // Instead we emit a structured annotation after the evaluator finishes.
        if (isLLMTokenEvent(event, [...streamingNodes])) {
          const token = extractTokenFromEvent(event);
          if (token) {
            await write(formatTextFrame(token));
          }
        }

        // ── Evaluator node end: emit evaluation annotation ──────────────────
        if (isNodeEndEvent(event, "evaluator")) {
          // The evaluator's output is in event.data.output — the node's return value
          const output = event.data?.output;
          if (output) {
            const score = output.latestScore ?? null;
            const feedback = output.latestFeedback ?? "";

            if (score !== null) {
              await write(
                formatAnnotationFrame({
                  type: "evaluation",
                  score,
                  feedback,
                  refinementCount: currentRefinementCount,
                })
              );
            }
          }
        }

        // ── PromptGen/Refine node end: emit persona annotation ──────────────
        // When a persona is extracted, tell the frontend to update the preview panel.
        // This fires as soon as the persona is available, before the full graph completes.
        if (
          isNodeEndEvent(event, "promptGen") ||
          isNodeEndEvent(event, "refine")
        ) {
          const output = event.data?.output;
          if (output?.currentPersona) {
            await write(
              formatAnnotationFrame({
                type: "persona",
                persona: output.currentPersona,
              })
            );
          }
          if (isNodeEndEvent(event, "refine")) {
            currentRefinementCount++;
          }
        }
      }

      // Stream ended normally
      await write(formatFinishFrame());
    } catch (error) {
      console.error("[persona/route] Graph execution error:", error);
      // Write an error message to the text stream so the user sees something
      // rather than a hanging loader
      await write(
        formatTextFrame(
          "\n\n[Error: The agent encountered a problem. Please try again.]"
        )
      );
      await write(formatFinishFrame());
    } finally {
      await writer.close();
    }
  })();

  // ─── 6. Return the streaming response ────────────────────────────────────
  // Content-Type must be text/plain for the AI SDK's stream parser to work.
  // x-vercel-ai-data-stream: v1 tells the SDK which protocol version to use.
  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "x-vercel-ai-data-stream": "v1",
    },
  });
}
