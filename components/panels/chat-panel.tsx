/**
 * components/panels/chat-panel.tsx — Full-width chat interface
 *
 * The main conversation panel where the user describes their chatbot and the
 * PromptGen agent asks clarifying questions. In the new chat-first layout this
 * fills the entire page — no Card wrapper, no fixed column constraints.
 *
 * WHAT IT RENDERS:
 * - Scrollable message history (user right-aligned, assistant left-aligned)
 * - For assistant messages: renders only the `next` field from the JSON response,
 *   NOT the raw JSON. Mirrors Python's extract_next(extract_response(msg)) (lines 43–69).
 * - StepLog — a scrollable timeline of agent steps shown while (and after) the
 *   graph runs. Replaces the single-line AgentStepIndicator.
 * - Textarea input + send button
 *
 * WHY NOT STREAM RAW JSON?
 * The PromptGen agent returns a JSON blob. The user only cares about the `next`
 * field (the question/response the agent wants to say). Showing raw JSON would
 * be confusing and ugly. We parse it client-side after each token update and
 * display only the human-readable part.
 *
 * PARSING STRATEGY:
 * Tokens accumulate into a partial JSON string as the stream flows. We can't
 * parse JSON until the stream is complete, so:
 * - While streaming: show a typing indicator (three bouncing dots)
 * - After stream: extract and display the `next` field
 */

"use client";

import { useRef, useEffect } from "react";
import type { Message } from "ai";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { StepLog } from "@/components/step-log";
import type { StepEntry } from "@/components/step-log";

interface ChatPanelProps {
  messages: Message[];
  input: string;
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  isLoading: boolean;
  steps: StepEntry[];
}

/**
 * Extracts the display text from a PromptGen JSON response.
 * Falls back gracefully to hide raw JSON fragments mid-stream.
 *
 * Mirrors Python: extract_next(extract_response(msg['content']))
 * (openaipersona.py lines 43–69)
 */
function extractDisplayText(content: string): string {
  // Strip markdown code fences if present
  const stripped = content.replace(/^```(?:\w+)?\n?/, "").replace(/\n?```$/, "").trim();

  try {
    const parsed = JSON.parse(stripped);
    if (typeof parsed?.next === "string" && parsed.next) {
      return parsed.next;
    }
  } catch {
    // Partial stream — JSON not complete yet
  }

  // Hide raw JSON fragments — the typing indicator will show instead
  if (content.trim().startsWith("{") || content.trim().startsWith("```")) {
    return "";
  }

  // Non-JSON response (e.g. plain-text error or fallback)
  return content;
}

export function ChatPanel({
  messages,
  input,
  onInputChange,
  onSubmit,
  isLoading,
  steps,
}: ChatPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the latest message or step update
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, steps]);

  return (
    <div className="flex flex-col h-full">
      {/* ── Message history ─────────────────────────────────────────────── */}
      <ScrollArea className="flex-1 px-4 pt-4">
        <div className="flex flex-col gap-3 pb-2 max-w-2xl mx-auto">
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              Describe your chatbot — the agent will ask clarifying questions and build a persona.
            </p>
          )}

          {messages.map((msg) => {
            if (msg.role === "user") {
              return (
                <div key={msg.id} className="flex justify-end">
                  <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-3 py-2 text-sm max-w-[85%]">
                    {msg.content}
                  </div>
                </div>
              );
            }

            // Assistant message — extract only the `next` field
            const displayText = extractDisplayText(msg.content);

            return (
              <div key={msg.id} className="flex justify-start">
                <div className="bg-muted rounded-2xl rounded-tl-sm px-3 py-2 text-sm max-w-[85%]">
                  {displayText || (
                    // JSON building up mid-stream — show typing indicator
                    <span className="inline-flex gap-1 items-center text-muted-foreground">
                      <span className="animate-bounce delay-0 h-1 w-1 bg-current rounded-full" />
                      <span className="animate-bounce delay-150 h-1 w-1 bg-current rounded-full" />
                      <span className="animate-bounce delay-300 h-1 w-1 bg-current rounded-full" />
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {/* ── Step log — visible while running and after completion ───── */}
          {steps.length > 0 && (
            <div className="mt-1">
              <StepLog steps={steps} />
            </div>
          )}

          {/* Anchor for auto-scroll */}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* ── Input form ──────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-border px-4 py-3">
        <form onSubmit={onSubmit} className="flex flex-col gap-2 max-w-2xl mx-auto">
          <Textarea
            value={input}
            onChange={onInputChange}
            placeholder="Describe your chatbot requirements..."
            className="resize-none text-sm min-h-[80px]"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            disabled={isLoading}
          />
          <Button
            type="submit"
            disabled={isLoading || !input.trim()}
            size="sm"
            className="self-end"
          >
            {isLoading ? "Running..." : "Send"}
          </Button>
        </form>
      </div>
    </div>
  );
}
