/**
 * app/api/test/route.ts — Dedicated streaming route for persona testing
 *
 * WHY A SEPARATE ROUTE INSTEAD OF REUSING /api/persona?
 * The original design ran both generate and test flows through a single
 * /api/persona endpoint, routing them via a `phase` field into LangGraph.
 * The test flow then ran through graph.streamEvents(), which intercepts
 * LLM calls and emits on_chat_model_stream events for forwarding.
 *
 * The problem: for a single-node graph call (testNode in isolation),
 * streamEvents may not consistently emit token-level events, causing the
 * response stream to carry no text frames — the client receives only
 * annotation + finish frames, leaving the chat with an empty assistant message.
 *
 * The test flow is architecturally different from the generate flow:
 * - Generate: multi-node orchestration (promptGen → evaluator → refine loop)
 *   requires LangGraph's state machine and conditional edges
 * - Test: one LLM call with a system prompt — no orchestration needed at all
 *
 * This route calls the LLM directly via LangChain's model.stream(), writes
 * tokens as Vercel AI SDK "0:" protocol frames, and closes. Clean, simple,
 * and guaranteed to stream because we own the token loop ourselves.
 *
 * PROTOCOL NOTE:
 * The Vercel AI SDK useChat() hook expects the exact same wire format here
 * as in /api/persona — text/plain with x-vercel-ai-data-stream: v1.
 * We reuse the same formatTextFrame / formatFinishFrame helpers.
 */

import { NextRequest, NextResponse } from "next/server";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { getLLMClient } from "@/lib/providers";
import { formatTextFrame, formatFinishFrame } from "@/lib/stream-helpers";
import type { Provider } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  // ─── 1. Parse request ──────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { messages, currentPersona, provider = "openai" } = body as {
    messages?: Array<{ role: string; content: string }>;
    currentPersona?: string | null;
    provider?: Provider;
  };

  if (!currentPersona) {
    return NextResponse.json(
      { error: "currentPersona is required" },
      { status: 400 }
    );
  }

  if (!messages || messages.length === 0) {
    return NextResponse.json(
      { error: "messages array is required" },
      { status: 400 }
    );
  }

  // ─── 2. Build LangChain message list ───────────────────────────────────────
  // useChat() sends the full messages array including the newest user message.
  // We put the persona as the system prompt and pass the full history — this
  // gives the test conversation multi-turn memory for free.
  const lcMessages = [
    new SystemMessage(currentPersona),
    ...messages.map((m) =>
      m.role === "user"
        ? new HumanMessage(m.content)
        : new AIMessage(m.content)
    ),
  ];

  // ─── 3. Stream directly from LangChain ─────────────────────────────────────
  // We call model.stream() (not model.invoke()) and iterate the token chunks
  // ourselves. This is the most reliable way to forward tokens — we own the
  // loop, so there's no dependency on LangGraph's streamEvents intercepting
  // the call correctly.
  //
  // streaming: true is critical here — it tells the provider to use its
  // streaming API endpoint rather than the standard completion endpoint.
  const model = getLLMClient(provider, true, 0.7);

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const write = (frame: string) =>
    writer.write(encoder.encode(frame));

  (async () => {
    try {
      const stream = await model.stream(lcMessages);

      for await (const chunk of stream) {
        const content = chunk.content;

        // LangChain content can be a string or an array of content blocks
        // (Claude uses the array form for text + tool_use blocks)
        let token = "";
        if (typeof content === "string") {
          token = content;
        } else if (Array.isArray(content)) {
          token = content
            .filter(
              (c): c is { type: "text"; text: string } => c.type === "text"
            )
            .map((c) => c.text)
            .join("");
        }

        if (token) {
          await write(formatTextFrame(token));
        }
      }

      await write(formatFinishFrame());
    } catch (error) {
      console.error("[api/test] Stream error:", error);
      await write(
        formatTextFrame(
          "\n\n[Error: Something went wrong. Please try again.]"
        )
      );
      await write(formatFinishFrame());
    } finally {
      await writer.close();
    }
  })();

  // ─── 4. Return streaming response ──────────────────────────────────────────
  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "x-vercel-ai-data-stream": "v1",
    },
  });
}
