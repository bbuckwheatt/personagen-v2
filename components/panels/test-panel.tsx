/**
 * components/panels/test-panel.tsx — Right panel: persona testing interface
 *
 * Lets the user chat with the generated persona to see how it behaves in practice.
 * This panel has its OWN useChat() instance (managed by the parent PersonaGenApp),
 * separate from the main generation chat.
 *
 * WHY A SEPARATE useChat() INSTANCE?
 * - The generate flow and test flow have independent conversation histories
 * - Generating a new persona shouldn't reset the test conversation
 * - The test flow sends phase="test" and passes currentPersona in the body
 * - The generate flow sends phase="generate"
 *
 * IMPROVEMENT OVER PYTHON:
 * The Python Test class (lines 103–112 of openaipersona.py) was single-turn:
 *   conversation_history = [system, user_message]  # no history!
 * This panel maintains full multi-turn history via testConversation, so the
 * persona "remembers" what was said earlier in the test conversation.
 */

"use client";

import { useRef, useEffect } from "react";
import type { Message } from "ai";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { AgentStepIndicator } from "@/components/agent-step-indicator";

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

  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="pb-2 shrink-0">
        <CardTitle className="text-base">Test the Persona</CardTitle>
        <p className="text-xs text-muted-foreground">
          Chat directly with your generated persona to evaluate how it behaves.
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-3 flex-1 min-h-0 p-4 pt-0">
        {!hasPersona ? (
          <p className="text-sm text-muted-foreground italic">
            No persona loaded. Generate one in the chat panel first.
          </p>
        ) : (
          <>
            <ScrollArea className="flex-1 pr-2">
              <div className="flex flex-col gap-3 pb-2">
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

                <AgentStepIndicator label={isLoading ? "Testing persona..." : null} />
                <div ref={bottomRef} />
              </div>
            </ScrollArea>

            <form onSubmit={onSubmit} className="flex flex-col gap-2 shrink-0">
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
          </>
        )}
      </CardContent>
    </Card>
  );
}
