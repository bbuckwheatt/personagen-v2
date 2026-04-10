/**
 * components/panels/test-panel.tsx — Drawer content: persona testing interface
 *
 * Lets the user chat with the generated persona to evaluate how it behaves.
 * Rendered inside a <Drawer> — no Card wrapper needed.
 *
 * WHY A SEPARATE useChat() INSTANCE?
 * - The generate flow and test flow have independent conversation histories
 * - Generating a new persona doesn't reset the test conversation
 * - Test flow sends phase="test" and currentPersona in the body
 *
 * IMPROVEMENT OVER PYTHON:
 * Python's Test class (openaipersona.py lines 103–112) was single-turn:
 *   conversation_history = [system, user_message]  // no history preserved!
 * This panel maintains full multi-turn history, so the persona "remembers"
 * what was said earlier in the test conversation.
 */

"use client";

import { useRef, useEffect } from "react";
import type { Message } from "ai";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

interface TestPanelProps {
  messages: Message[];
  input: string;
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  isLoading: boolean;
  hasPersona: boolean;
}

export function TestPanel({
  messages,
  input,
  onInputChange,
  onSubmit,
  isLoading,
  hasPersona,
}: TestPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (!hasPersona) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground italic">
          No persona loaded yet. Generate one in the chat panel first.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Message history ─────────────────────────────────────────────── */}
      <ScrollArea className="flex-1 px-4 pt-4">
        <div className="flex flex-col gap-3 pb-2">
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              Ask a question to see how your persona responds.
            </p>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`rounded-2xl px-3 py-2 text-sm max-w-[85%] ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-tr-sm"
                    : "bg-muted rounded-tl-sm"
                }`}
              >
                {msg.content || (
                  <span className="inline-flex gap-1 items-center text-muted-foreground">
                    <span className="animate-bounce h-1 w-1 bg-current rounded-full" />
                    <span className="animate-bounce delay-150 h-1 w-1 bg-current rounded-full" />
                    <span className="animate-bounce delay-300 h-1 w-1 bg-current rounded-full" />
                  </span>
                )}
              </div>
            </div>
          ))}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* ── Input form ──────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-border px-4 py-3">
        <form onSubmit={onSubmit} className="flex flex-col gap-2">
          <Textarea
            value={input}
            onChange={onInputChange}
            placeholder="Ask a question to test the persona..."
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
            {isLoading ? "Responding..." : "Send"}
          </Button>
        </form>
      </div>
    </div>
  );
}
