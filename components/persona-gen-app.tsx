/**
 * components/persona-gen-app.tsx — Root client component
 *
 * Orchestrates the entire application:
 * - Two useChat() instances (generate + test flows)
 * - Stream annotation processing (agentStep, evaluation, persona events)
 * - Step log state (live timeline of agent activity)
 * - Drawer state (preview + test panels)
 * - Reset logic
 *
 * LAYOUT: Chat-first
 * The chat panel fills the full page. Preview and Test are drawers — hidden
 * by default, opened by buttons in the top bar. Only one drawer open at a time.
 *
 * WHY CHAT-FIRST?
 * The original 3-column layout showed the persona preview and test panel even
 * when no persona existed yet. This cluttered the screen and made each panel
 * feel cramped. A full-width chat lets the conversation breathe; the preview
 * and test are discoverable via clearly-labeled buttons.
 */

"use client";

import { useChat } from "ai/react";
import { useState, useEffect, useRef, useCallback } from "react";
import type { Provider } from "@/lib/providers";
import type { AgentStepAnnotation } from "@/lib/schemas";
import type { StepEntry } from "@/components/step-log";
import { ChatPanel } from "@/components/panels/chat-panel";
import { PersonaPreviewPanel } from "@/components/panels/persona-preview-panel";
import { TestPanel } from "@/components/panels/test-panel";
import { ModelSelector } from "@/components/model-selector";
import { ResetButton } from "@/components/reset-button";
import { Drawer } from "@/components/drawer";

type DrawerView = "preview" | "test" | null;
type ChatData = AgentStepAnnotation[];

export function PersonaGenApp() {
  // ─── Core state ───────────────────────────────────────────────────────────
  const [provider, setProvider] = useState<Provider>("openai");
  const [activePersona, setActivePersona] = useState<string | null>(null);
  const [latestScore, setLatestScore] = useState<number | null>(null);
  const [latestFeedback, setLatestFeedback] = useState<string | null>(null);

  // evalLog: serialized message pairs from the evaluator, sent back on each request
  // so the evaluator maintains context across user turns.
  const [evalLog, setEvalLog] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);

  // refinementCount: how many refinement iterations have happened this session.
  // Sent to the API route so it knows where the graph left off across requests.
  const [refinementCount, setRefinementCount] = useState(0);

  // ─── Step log state ───────────────────────────────────────────────────────
  // An ordered list of agent steps shown as a timeline while the graph runs.
  // Each step is added when its "agentStep" annotation arrives, updated when
  // the next step starts or an "evaluation" annotation arrives.
  const [steps, setSteps] = useState<StepEntry[]>([]);
  const stepCounterRef = useRef(0); // used to generate unique step IDs

  // ─── Drawer state ─────────────────────────────────────────────────────────
  const [openDrawer, setOpenDrawer] = useState<DrawerView>(null);

  const openPreview = useCallback(() => setOpenDrawer("preview"), []);
  const openTest = useCallback(() => setOpenDrawer("test"), []);
  const closeDrawer = useCallback(() => setOpenDrawer(null), []);

  // ─── Annotation processing ────────────────────────────────────────────────
  const processedAnnotationsRef = useRef(0);

  // ─── Generate flow useChat ────────────────────────────────────────────────
  const generateChat = useChat({
    api: "/api/persona",
    body: {
      phase: "generate",
      currentPersona: activePersona,
      refinementCount,
      provider,
      evalLog,
    },
    onError: (error) => {
      console.error("[generateChat] Error:", error);
      // Mark the last running step as errored
      setSteps((prev) =>
        prev.map((s) =>
          s.status === "running" ? { ...s, status: "error" as const, endedAt: Date.now() } : s
        )
      );
    },
    onFinish: () => {
      // Mark any still-running step as done when the stream ends
      setSteps((prev) =>
        prev.map((s) =>
          s.status === "running" ? { ...s, status: "done" as const, endedAt: Date.now() } : s
        )
      );
    },
  });

  // ─── Test flow useChat ────────────────────────────────────────────────────
  const testChat = useChat({
    api: "/api/persona",
    body: {
      phase: "test",
      currentPersona: activePersona,
      refinementCount: 0,
      provider,
      evalLog: [],
    },
    onError: (error) => {
      console.error("[testChat] Error:", error);
    },
  });

  // ─── Process stream annotations ───────────────────────────────────────────
  useEffect(() => {
    const data = generateChat.data as unknown as ChatData | undefined;
    if (!data || data.length === 0) return;

    const newAnnotations = data.slice(processedAnnotationsRef.current);
    if (newAnnotations.length === 0) return;

    for (const annotation of newAnnotations) {
      switch (annotation.type) {
        case "agentStep": {
          // Mark the previous running step as done
          setSteps((prev) => {
            const updated = prev.map((s) =>
              s.status === "running"
                ? { ...s, status: "done" as const, endedAt: Date.now() }
                : s
            );
            // Add the new running step
            const id = `step-${stepCounterRef.current++}`;
            return [...updated, {
              id,
              label: annotation.label,
              status: "running" as const,
              startedAt: Date.now(),
            }];
          });
          break;
        }

        case "evaluation": {
          // Update the current evaluator step with the score as detail
          const scoreText = `score: ${Math.round(annotation.score * 100)}%`;
          const detail = annotation.score >= 0.9
            ? `${scoreText} ✓ accepted`
            : `${scoreText} — refining`;

          setSteps((prev) =>
            prev.map((s) =>
              s.status === "running" && s.label.toLowerCase().includes("evaluat")
                ? { ...s, status: "done" as const, endedAt: Date.now(), detail }
                : s
            )
          );

          setLatestScore(annotation.score);
          setLatestFeedback(annotation.feedback);

          // Sync refinementCount so the next request knows where we are
          if (annotation.score < 0.9) {
            setRefinementCount(annotation.refinementCount + 1);
          }
          break;
        }

        case "persona": {
          setActivePersona(annotation.persona);
          break;
        }
      }
    }

    processedAnnotationsRef.current = data.length;
  }, [generateChat.data]);

  // ─── Reset ────────────────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    generateChat.setMessages([]);
    testChat.setMessages([]);
    setActivePersona(null);
    setLatestScore(null);
    setLatestFeedback(null);
    setEvalLog([]);
    setRefinementCount(0);
    setSteps([]);
    stepCounterRef.current = 0;
    processedAnnotationsRef.current = 0;
    setOpenDrawer(null);
  }, [generateChat, testChat]);

  const isAnyLoading = generateChat.isLoading || testChat.isLoading;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen">
      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between gap-4 px-4 py-2 border-b border-border shrink-0">
        <div>
          <h1 className="text-sm font-semibold leading-tight">PersonaGen</h1>
          <p className="text-[11px] text-muted-foreground">
            {/* FIX: template literal was missing backticks in original — was rendering as plain text */}
            {`LangGraph · ${provider === "openai" ? "OpenAI gpt-4.1" : "Claude claude-sonnet-4-6"}`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <ModelSelector
            value={provider}
            onChange={setProvider}
            disabled={isAnyLoading}
          />

          {/* Preview button — disabled until a persona exists */}
          <button
            onClick={openPreview}
            disabled={!activePersona}
            className={`
              flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border transition-colors
              ${activePersona
                ? "border-border hover:bg-muted text-foreground cursor-pointer"
                : "border-border/50 text-muted-foreground/50 cursor-not-allowed"
              }
            `}
          >
            <span>Preview</span>
            {/* Score badge inline with button when persona exists */}
            {latestScore !== null && activePersona && (
              <span className={`
                text-[10px] font-mono px-1 py-0.5 rounded
                ${latestScore >= 0.9
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                }
              `}>
                {Math.round(latestScore * 100)}%
              </span>
            )}
            <span className="text-muted-foreground">›</span>
          </button>

          {/* Test button — disabled until a persona exists */}
          <button
            onClick={openTest}
            disabled={!activePersona}
            className={`
              flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border transition-colors
              ${activePersona
                ? "border-border hover:bg-muted text-foreground cursor-pointer"
                : "border-border/50 text-muted-foreground/50 cursor-not-allowed"
              }
            `}
          >
            <span>Test</span>
            <span className="text-muted-foreground">›</span>
          </button>

          <ResetButton onReset={handleReset} disabled={isAnyLoading} />
        </div>
      </header>

      {/* ── Main chat area — full width ───────────────────────────────────── */}
      <main className="flex-1 min-h-0">
        <ChatPanel
          messages={generateChat.messages}
          input={generateChat.input}
          onInputChange={generateChat.handleInputChange}
          onSubmit={generateChat.handleSubmit}
          isLoading={generateChat.isLoading}
          steps={steps}
        />
      </main>

      {/* ── Preview drawer ────────────────────────────────────────────────── */}
      <Drawer
        isOpen={openDrawer === "preview"}
        onClose={closeDrawer}
        title="Persona Preview"
      >
        <PersonaPreviewPanel
          persona={activePersona}
          latestScore={latestScore}
          latestFeedback={latestFeedback}
          isEvaluating={generateChat.isLoading}
        />
      </Drawer>

      {/* ── Test drawer ───────────────────────────────────────────────────── */}
      <Drawer
        isOpen={openDrawer === "test"}
        onClose={closeDrawer}
        title="Test Persona"
      >
        <TestPanel
          messages={testChat.messages}
          input={testChat.input}
          onInputChange={testChat.handleInputChange}
          onSubmit={testChat.handleSubmit}
          isLoading={testChat.isLoading}
          hasPersona={!!activePersona}
        />
      </Drawer>
    </div>
  );
}
