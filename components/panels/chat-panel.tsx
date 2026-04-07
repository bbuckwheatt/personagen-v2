/**
 * components/panels/chat-panel.tsx — Left panel: PromptGen conversation
 *
 * This is the main chat interface where the user describes their chatbot
 * requirements and the PromptGen agent asks clarifying questions.
 *
 * WHAT IT RENDERS:
 * - Scrollable message history (user and assistant turns)
 * - For assistant messages: renders only the `next` field from the JSON
 *   response (the question/response the user should see), NOT the raw JSON.
 *   This mirrors the Python app's extract_next(extract_response(msg['content']))
 *   call on line 217.
 * - Text area input + send button
 * - AgentStepIndicator (shown while the graph is running)
 *
 * WHY NOT STREAM THE RAW JSON IN THE CHAT?
 * The PromptGen agent returns a JSON blob with multiple fields. The user
 * only cares about the `next` field (the question/response). Showing raw JSON
 * would be confusing. We parse it client-side and display only the `next` field.
 *
 * PARSING STRATEGY:
 * The assistant messages arrive as streaming tokens that build up a JSON string.
 * We can't parse JSON until the stream is complete. So:
 * - While streaming: show the raw accumulating text (or hide it and show a spinner)
 * - After stream completes: parse and display only the `next` field
 *
 * We use a simple heuristic: if the message content starts with "{" or "```",
 * try to parse it as JSON. If it fails (partial stream), show nothing or a
 * placeholder. Once the stream completes, the full JSON is parseable.
 */

"use client";

import { useRef, useEffect } from "react";
import type { Message } from "ai";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { AgentStepIndicator } from "@/components/agent-step-indicator";

interface ChatPanelProps {
  messages: Message[];
  input: string;
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  isLoading: boolean;
  currentStep: string | null;
}

/**
 * Extracts the display text from a PromptGen JSON response.
 * Falls back to the raw content if parsing fails (e.g. mid-stream).
 *
 * Mirrors Python's: extract_next(extract_response(msg['content']))
 * (openaipersona.py lines 43–69)
 */
function extractDisplayText(content: string): string {
  // Strip markdown code fences if present
  const stripped = content.replace(/^```(?:\w+)?\n?/, "").replace(/\n?```$/, "").trim();

  try {
    const parsed = JSON.parse(stripped);
    // The `next` field is what the user should read
    if (typeof parsed?.next === "string" && parsed.next) {
      return parsed.next;
    }
  } catch {
    // Not valid JSON yet (mid-stream) or not JSON at all
  }

  // If we can't parse it, don't show raw JSON fragments to the user
  // Return empty string — the loading indicator shows instead
  if (content.trim().startsWith("{") || content.trim().startsWith("```")) {
    return "";
  }

  // Non-JSON response (shouldn't happen with this LLM setup, but handle gracefully)
  return content;
}

export function ChatPanel({
  messages,
  input,
  onInputChange,
  onSubmit,
  isLoading,
  currentStep,
}: ChatPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="pb-2 shrink-0">
        <CardTitle className="text-base">PromptGen Chat</CardTitle>
        <p className="text-xs text-muted-foreground">
          Describe your chatbot — the agent will ask questions and generate a persona.
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-3 flex-1 min-h-0 p-4 pt-0">
        {/* Message history */}
        <ScrollArea className="flex-1 pr-2">
          <div className="flex flex-col gap-3 pb-2">
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

              // Assistant message — extract and display only the `next` field
              const displayText = extractDisplayText(msg.content);

              return (
                <div key={msg.id} className="flex justify-start">
                  <div className="bg-muted rounded-2xl rounded-tl-sm px-3 py-2 text-sm max-w-[85%]">
                    {displayText || (
                      // Streaming in progress — show a pulse placeholder
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

            {/* Live step indicator — shown while any graph node is running */}
            <AgentStepIndicator label={isLoading ? currentStep : null} />

            {/* Anchor for auto-scroll */}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        {/* Input form */}
        <form onSubmit={onSubmit} className="flex flex-col gap-2 shrink-0">
          <Textarea
            value={input}
            onChange={onInputChange}
            placeholder="Describe your chatbot requirements..."
            className="resize-none text-sm min-h-[80px]"
            // Submit on Cmd/Ctrl+Enter for power users
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
      </CardContent>
    </Card>
  );
}
