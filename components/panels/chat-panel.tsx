/**
 * components/panels/chat-panel.tsx — Full-width chat interface
 *
 * The main conversation panel. In the chat-first layout this fills the entire
 * page. No Card wrapper — the outer container is the layout primitive.
 *
 * ── SPECIAL RENDERS ──────────────────────────────────────────────────────────
 *
 * Empty state: When there are no messages, shows a welcome screen with
 * example prompt chips. Clicking a chip sends it directly without typing.
 *
 * Completion card: After persona generation finishes, a special card appears
 * at the bottom of the chat (styled like an AI message, but visually distinct).
 * It contains a "Test it" button and clickable refinement chips from the agent's
 * remaining `plan` questions.
 *
 * ── JSON PARSING ─────────────────────────────────────────────────────────────
 * Assistant messages contain the full PromptGen JSON blob as their content.
 * We extract and display only the `next` field — the user-facing text.
 *
 * If `next` is empty but a persona exists (model generated without a message),
 * we show a fallback confirmation string. If parsing fails mid-stream, we show
 * a typing indicator instead of raw JSON fragments.
 */

"use client";

import { useRef, useEffect } from "react";
import type { Message } from "ai";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { StepLog } from "@/components/step-log";
import type { StepEntry } from "@/components/step-log";

// Example prompts shown in the empty state.
// These are common use cases for quick-starting the conversation.
const EXAMPLE_PROMPTS = [
  "A customer support bot for an e-commerce store",
  "An internal HR assistant for company policy questions",
  "A sales qualification assistant for B2B SaaS",
  "A technical documentation helper for developers",
];

interface CompletionCardData {
  score: number | null;
  planItems: string[];
  onOpenTest: () => void;
  onKeepRefining: () => void;
}

interface ChatPanelProps {
  messages: Message[];
  input: string;
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  isLoading: boolean;
  steps: StepEntry[];
  /** Called when user clicks an example prompt chip or a completion plan chip */
  onSendMessage?: (text: string) => void;
  /** If set, renders the post-completion card after the last message */
  completionCard?: CompletionCardData;
}

/**
 * Extracts the display text from a PromptGen JSON response.
 *
 * Priority:
 *  1. `next` field — the agent's user-facing response
 *  2. If `next` is empty but `current-persona` exists — a fallback "ready" message
 *  3. If content starts with `{` or ``` — return "" (typing indicator shows instead)
 *  4. Otherwise return the raw content (plain-text response, shouldn't happen often)
 *
 * Mirrors Python: extract_next(extract_response(msg['content'])) (lines 43–69)
 */
function extractDisplayText(content: string): string {
  const stripped = content
    .replace(/^```(?:\w+)?\n?/, "")
    .replace(/\n?```$/, "")
    .trim();

  try {
    const parsed = JSON.parse(stripped);

    // Primary: the agent's explicit user-facing response
    if (typeof parsed?.next === "string" && parsed.next.trim()) {
      return parsed.next.trim();
    }

    // next is empty/null — pick the best available fallback rather than
    // leaving a three-dot indicator on a completed message.
    if (parsed?.["current-persona"]) {
      // A persona was generated or refined — acknowledge it
      return "Your persona has been generated. Open Preview to review it, or keep chatting to refine it.";
    }

    if (typeof parsed?.reasoning === "string" && parsed.reasoning.trim()) {
      // Agent is thinking through requirements but hasn't asked yet — show nothing
      // and let the dots play until the stream finishes with a real next field
      return "";
    }
  } catch {
    // Partial stream — JSON not yet complete, show typing indicator
  }

  // Hide raw JSON fragments while they're accumulating during streaming
  if (content.trim().startsWith("{") || content.trim().startsWith("```")) {
    return "";
  }

  // Plain text response (shouldn't normally happen with these prompts)
  return content;
}

/** Completion card — appears after persona generation finishes */
function CompletionCard({
  score,
  planItems,
  onOpenTest,
  onKeepRefining,
  onSendQuestion,
}: CompletionCardData & { onSendQuestion: (q: string) => void }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-xl rounded-tl-sm overflow-hidden border border-amber-200 dark:border-amber-800 shadow-sm">
        {/* Header strip — flat amber, no gradient */}
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-amber-600">
          <div className="flex items-center gap-2">
            <span className="text-white text-xs font-semibold tracking-wide">Persona ready</span>
          </div>
          {score !== null && (
            <span className="text-[11px] font-mono bg-black/20 text-white px-2 py-0.5 rounded font-semibold">
              {Math.round(score * 100)}%
            </span>
          )}
        </div>

        {/* Body */}
        <div className="bg-amber-50/60 dark:bg-amber-950/20 px-4 py-3 flex flex-col gap-3">
          <p className="text-sm text-foreground/80">
            Your chatbot persona has been generated and evaluated. What would you like to do next?
          </p>

          {/* Primary CTA */}
          <button
            onClick={onOpenTest}
            className="flex items-center justify-between w-full px-3 py-2 bg-white dark:bg-background border border-amber-200 dark:border-amber-700 rounded-md text-sm font-medium text-foreground hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-colors group"
          >
            <span>Test your persona</span>
            <span className="text-amber-600 group-hover:translate-x-0.5 transition-transform">↗</span>
          </button>

          {/* Secondary action */}
          <button
            onClick={onKeepRefining}
            className="flex items-center justify-between w-full px-3 py-2 bg-white dark:bg-background border border-border rounded-md text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
          >
            <span>Keep refining</span>
            <span className="text-muted-foreground/60">↩</span>
          </button>

          {/* Refinement chips */}
          {planItems.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                Or refine further
              </p>
              <div className="flex flex-col gap-1">
                {planItems.map((item, i) => (
                  <button
                    key={i}
                    onClick={() => onSendQuestion(item)}
                    className="text-left text-xs px-3 py-1.5 rounded-md bg-white dark:bg-background border border-amber-100 dark:border-amber-800/50 text-foreground/70 hover:text-foreground hover:border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ChatPanel({
  messages,
  input,
  onInputChange,
  onSubmit,
  isLoading,
  steps,
  onSendMessage,
  completionCard,
}: ChatPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, steps, completionCard]);

  const isEmpty = messages.length === 0 && steps.length === 0;

  return (
    <div className="flex flex-col h-full">
      {/* ── Message history / empty state ───────────────────────────────── */}
      <ScrollArea className="flex-1 px-4 pt-4">
        <div className="flex flex-col gap-4 pb-4 max-w-2xl mx-auto">

          {/* Empty state — shown before first message */}
          {isEmpty && (
            <div className="flex flex-col items-center gap-6 py-16 text-center">
              <div className="w-12 h-12 rounded-xl bg-amber-600 flex items-center justify-center shadow-md">
                <span className="text-white text-lg font-bold tracking-tight leading-none">PG</span>
              </div>
              <div>
                <h2 className="text-base font-semibold text-foreground mb-1">
                  Build your chatbot persona
                </h2>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Describe what your chatbot should do. The agent will ask a few
                  targeted questions, then generate and evaluate a structured system prompt.
                </p>
              </div>
              {onSendMessage && (
                <div className="flex flex-wrap gap-2 justify-center max-w-md">
                  {EXAMPLE_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => onSendMessage(prompt)}
                      disabled={isLoading}
                      className="text-xs px-3 py-1.5 rounded-full border border-border bg-muted/50 hover:bg-muted hover:border-foreground/20 text-foreground/70 hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Message list */}
          {messages.map((msg) => {
            if (msg.role === "user") {
              return (
                <div key={msg.id} className="flex justify-end">
                  <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-sm max-w-[85%] shadow-sm">
                    {msg.content}
                  </div>
                </div>
              );
            }

            const displayText = extractDisplayText(msg.content);
            return (
              <div key={msg.id} className="flex justify-start">
                <div className="bg-muted rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm max-w-[85%]">
                  {displayText || (
                    <span className="inline-flex gap-1 items-center text-muted-foreground">
                      <span className="animate-bounce delay-0 h-1.5 w-1.5 bg-current rounded-full" />
                      <span className="animate-bounce delay-150 h-1.5 w-1.5 bg-current rounded-full" />
                      <span className="animate-bounce delay-300 h-1.5 w-1.5 bg-current rounded-full" />
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {/* Step log — visible while running and after completion */}
          {steps.length > 0 && (
            <div className="mt-1">
              <StepLog steps={steps} />
            </div>
          )}

          {/* Completion card */}
          {completionCard && onSendMessage && (
            <CompletionCard
              {...completionCard}
              onKeepRefining={completionCard.onKeepRefining}
              onSendQuestion={onSendMessage}
            />
          )}

          {/* Anchor for auto-scroll */}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* ── Input form ──────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-border px-4 py-3 bg-background/95">
        <form onSubmit={onSubmit} className="flex flex-col gap-2 max-w-2xl mx-auto">
          <div className="relative">
            <Textarea
              value={input}
              onChange={onInputChange}
              placeholder="Describe your chatbot requirements..."
              className="resize-none text-sm min-h-[80px] pr-4 rounded-lg border-border/60 focus:border-amber-400 dark:focus:border-amber-600 transition-colors"
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              disabled={isLoading}
            />
          </div>
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground/60">
              ⌘↵ to send
            </p>
            <Button
              type="submit"
              disabled={isLoading || !input.trim()}
              size="sm"
              className="bg-amber-600 hover:bg-amber-700 text-white border-0 shadow-sm px-4 transition-colors"
            >
              {isLoading ? "Running..." : "Send"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
