/**
 * components/persona-gen-app.tsx — Root client component
 *
 * Orchestrates the entire application:
 * - Two useChat() instances (generate + test flows)
 * - Stream annotation processing (agentStep, evaluation, persona events)
 * - Step log state (live timeline of agent activity)
 * - Drawer state (preview + test panels)
 * - Completion card state (shown after persona is ready)
 * - Reset logic
 *
 * ── TEST PANEL BUG FIX ───────────────────────────────────────────────────────
 * The root cause of "test response never comes": the `body` option passed to
 * useChat() is evaluated at hook initialization time. At that moment,
 * `activePersona` is null. Even after generation completes and `activePersona`
 * is set, the stale null flows into the POST body when the user submits the
 * test form. The API route gets `currentPersona: null`, which causes testNode
 * to hit the static-message early-return branch (no LLM invocation → no token
 * stream → empty assistant message with no visible text).
 *
 * Fix: Don't rely on the `body` option in useChat() config for test. Instead,
 * pass the current values explicitly via handleSubmit's second argument, which
 * is evaluated at submission time (not initialization time). This guarantees
 * the latest `activePersona` is always sent.
 */

"use client";

import { useChat } from "ai/react";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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

/**
 * Extracts the `plan` array from the last assistant message in the generate
 * conversation. These are the remaining questions the PromptGen agent planned
 * to ask — we surface them as quick-send chips in the completion card so the
 * user can refine without having to type.
 */
function extractPlanFromMessages(
  messages: Array<{ role: string; content: string }>
): string[] {
  const lastAsst = [...messages].reverse().find((m) => m.role === "assistant");
  if (!lastAsst) return [];
  try {
    const stripped = lastAsst.content
      .replace(/^```(?:\w+)?\n?/, "")
      .replace(/\n?```$/, "")
      .trim();
    const parsed = JSON.parse(stripped);
    return Array.isArray(parsed?.plan) ? parsed.plan.slice(0, 3) : [];
  } catch {
    return [];
  }
}

export function PersonaGenApp() {
  // ─── Core state ───────────────────────────────────────────────────────────
  const [provider, setProvider] = useState<Provider>("openai");
  const [activePersona, setActivePersona] = useState<string | null>(null);
  const [latestScore, setLatestScore] = useState<number | null>(null);
  const [latestFeedback, setLatestFeedback] = useState<string | null>(null);

  // evalLog: serialized message pairs from the evaluator, sent back on each
  // request so the evaluator maintains context across user turns.
  const [evalLog, setEvalLog] = useState<
    Array<{ role: "user" | "assistant"; content: string }>
  >([]);

  // refinementCount: how many refinement iterations have happened this session.
  const [refinementCount, setRefinementCount] = useState(0);

  // ─── Completion state ─────────────────────────────────────────────────────
  // Set to true after the generate stream ends and we have an active persona.
  // Controls visibility of the completion card in the chat panel.
  const [personaComplete, setPersonaComplete] = useState(false);

  // ─── activePersona ref — for use inside stale closures ───────────────────
  // onFinish is defined once at hook creation and closes over the initial value
  // of `activePersona` (which is null). We keep a ref in sync with the state
  // so the onFinish callback can always read the latest value.
  const activePersonaRef = useRef<string | null>(null);
  useEffect(() => {
    activePersonaRef.current = activePersona;
  }, [activePersona]);

  // ─── Step log state ───────────────────────────────────────────────────────
  const [steps, setSteps] = useState<StepEntry[]>([]);
  const stepCounterRef = useRef(0);

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
      setSteps((prev) =>
        prev.map((s) =>
          s.status === "running"
            ? { ...s, status: "error" as const, endedAt: Date.now() }
            : s
        )
      );
    },
    onFinish: () => {
      // Mark any still-running step as done
      setSteps((prev) =>
        prev.map((s) =>
          s.status === "running"
            ? { ...s, status: "done" as const, endedAt: Date.now() }
            : s
        )
      );
      // Show the completion card if we now have an active persona.
      // Use the ref (not the state) because this callback closes over the
      // initial null value of activePersona.
      if (activePersonaRef.current) {
        setPersonaComplete(true);
      }
    },
  });

  // ─── Test flow useChat ────────────────────────────────────────────────────
  // Uses a dedicated /api/test route that streams directly from LangChain
  // without going through LangGraph's streamEvents. The test flow is just
  // "chat with a system prompt" — no orchestration needed.
  const testChat = useChat({
    api: "/api/test",
    onError: (error) => {
      console.error("[testChat] Error:", error);
    },
  });

  // Pass currentPersona and provider at submit time so we always use the
  // latest values (avoids the stale-closure problem with useChat body config).
  const handleTestSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      testChat.handleSubmit(e, {
        body: {
          currentPersona: activePersona,
          provider,
        },
      });
    },
    [testChat, activePersona, provider]
  );

  // ─── Quick-send handler (example prompts + completion card chips) ─────────
  // Called when the user clicks an example prompt or a plan-item chip.
  // Uses generateChat.append so the message is sent immediately without
  // requiring the user to type in the textarea.
  const handleSendMessage = useCallback(
    (text: string) => {
      setPersonaComplete(false); // hide completion card while generating
      generateChat.append(
        { role: "user", content: text },
        {
          body: {
            phase: "generate",
            currentPersona: activePersona,
            refinementCount,
            provider,
            evalLog,
          },
        }
      );
    },
    [generateChat, activePersona, refinementCount, provider, evalLog]
  );

  // ─── Process stream annotations ───────────────────────────────────────────
  useEffect(() => {
    const data = generateChat.data as unknown as ChatData | undefined;
    if (!data || data.length === 0) return;

    const newAnnotations = data.slice(processedAnnotationsRef.current);
    if (newAnnotations.length === 0) return;

    for (const annotation of newAnnotations) {
      switch (annotation.type) {
        case "agentStep": {
          setSteps((prev) => {
            const updated = prev.map((s) =>
              s.status === "running"
                ? { ...s, status: "done" as const, endedAt: Date.now() }
                : s
            );
            const id = `step-${stepCounterRef.current++}`;
            return [
              ...updated,
              {
                id,
                label: annotation.label,
                status: "running" as const,
                startedAt: Date.now(),
              },
            ];
          });
          break;
        }

        case "evaluation": {
          const scoreText = `score: ${Math.round(annotation.score * 100)}%`;
          const detail =
            annotation.score >= 0.9
              ? `${scoreText} ✓ accepted`
              : `${scoreText} — refining`;

          setSteps((prev) =>
            prev.map((s) =>
              s.status === "running" &&
              s.label.toLowerCase().includes("evaluat")
                ? {
                    ...s,
                    status: "done" as const,
                    endedAt: Date.now(),
                    detail,
                  }
                : s
            )
          );

          setLatestScore(annotation.score);
          setLatestFeedback(annotation.feedback);

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

  // ─── Completion card plan items ───────────────────────────────────────────
  // Extracted from the last assistant message's JSON `plan` field.
  // Memoized so we only re-parse when messages change.
  const completionPlanItems = useMemo(
    () =>
      personaComplete
        ? extractPlanFromMessages(generateChat.messages)
        : [],
    [personaComplete, generateChat.messages]
  );

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
    setPersonaComplete(false);
    stepCounterRef.current = 0;
    processedAnnotationsRef.current = 0;
    setOpenDrawer(null);
  }, [generateChat, testChat]);

  const isAnyLoading = generateChat.isLoading || testChat.isLoading;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-background">
      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between gap-4 px-5 py-3 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-md bg-amber-600 flex items-center justify-center shrink-0">
            <span className="text-white text-[11px] font-bold tracking-tight leading-none">PG</span>
          </div>
          <div>
            <h1 className="text-sm font-bold leading-tight tracking-tight">PersonaGen</h1>
            <p className="text-[10px] text-muted-foreground leading-tight">
              {`LangGraph · ${provider === "openai" ? "OpenAI gpt-4.1" : "Claude claude-sonnet-4-6"}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ModelSelector
            value={provider}
            onChange={setProvider}
            disabled={isAnyLoading}
          />

          {/* Preview button */}
          <button
            onClick={openPreview}
            disabled={!activePersona}
            className={`
              flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-medium transition-all
              ${activePersona
                ? "border-border hover:bg-muted text-foreground cursor-pointer hover:border-foreground/30"
                : "border-border/40 text-muted-foreground/40 cursor-not-allowed"
              }
            `}
          >
            <span>Preview</span>
            {latestScore !== null && activePersona && (
              <span className={`
                text-[10px] font-mono px-1.5 py-0.5 rounded-md font-semibold
                ${latestScore >= 0.9
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                }
              `}>
                {Math.round(latestScore * 100)}%
              </span>
            )}
            <span className="text-muted-foreground/60">›</span>
          </button>

          {/* Test button */}
          <button
            onClick={openTest}
            disabled={!activePersona}
            className={`
              flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-medium transition-all
              ${activePersona
                ? "border-border hover:bg-muted text-foreground cursor-pointer hover:border-foreground/30"
                : "border-border/40 text-muted-foreground/40 cursor-not-allowed"
              }
            `}
          >
            <span>Test</span>
            <span className="text-muted-foreground/60">›</span>
          </button>

          <ResetButton onReset={handleReset} disabled={isAnyLoading} />
        </div>
      </header>

      {/* ── Main chat area ────────────────────────────────────────────────── */}
      <main className="flex-1 min-h-0">
        <ChatPanel
          messages={generateChat.messages}
          input={generateChat.input}
          onInputChange={generateChat.handleInputChange}
          onSubmit={(e) => {
            // Always clear the completion card when the user manually submits
            // from the textarea — the new message is a continuation, not a chip click
            setPersonaComplete(false);
            generateChat.handleSubmit(e);
          }}
          isLoading={generateChat.isLoading}
          steps={steps}
          onSendMessage={handleSendMessage}
          completionCard={
            personaComplete
              ? {
                  score: latestScore,
                  planItems: completionPlanItems,
                  onOpenTest: openTest,
                  onKeepRefining: () => setPersonaComplete(false),
                }
              : undefined
          }
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
          onSubmit={handleTestSubmit}
          isLoading={testChat.isLoading}
          hasPersona={!!activePersona}
        />
      </Drawer>
    </div>
  );
}
