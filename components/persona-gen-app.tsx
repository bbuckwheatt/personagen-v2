/**
 * components/persona-gen-app.tsx — Root client component
 *
 * This is the "orchestrator" component that:
 * 1. Owns TWO useChat() instances (generate flow + test flow)
 * 2. Reads stream annotations from useChat().data to update UI state
 * 3. Passes props down to the three panel components
 * 4. Handles reset logic
 *
 * ─────────────────────────────────────────────────────────────────
 * WHY "use client"?
 * ─────────────────────────────────────────────────────────────────
 * This component uses React hooks (useState, useEffect, useCallback) and
 * the useChat() hook from the Vercel AI SDK — both are client-side only.
 * The "use client" directive tells Next.js to send this component's JS to
 * the browser and hydrate it. Without it, hooks would throw errors because
 * React Server Components run on the server without browser APIs.
 *
 * The parent (app/page.tsx) is a React Server Component — it renders the
 * static HTML shell with zero JavaScript. PersonaGenApp hydrates on top of
 * that shell, which is why initial page loads feel fast even before JS arrives.
 *
 * ─────────────────────────────────────────────────────────────────
 * TWO useChat() INSTANCES
 * ─────────────────────────────────────────────────────────────────
 * `generateChat` — handles the PromptGen flow (left panel + triggers preview)
 * `testChat`     — handles the Test agent flow (right panel)
 *
 * Both POST to /api/persona, but with different `phase` values in the body.
 * The API route reads `phase` from the body and routes to the correct graph branch.
 *
 * WHY NOT ONE INSTANCE?
 * If we used one instance for both flows, pressing "Send" in the test panel
 * would overwrite the generate chat's messages array, and vice versa. They
 * are logically independent conversations.
 *
 * ─────────────────────────────────────────────────────────────────
 * STREAM ANNOTATION PROCESSING
 * ─────────────────────────────────────────────────────────────────
 * The API route emits structured "2:" frames alongside text tokens:
 *   - { type: "agentStep", label: "..." }  → update currentStep
 *   - { type: "evaluation", score, feedback } → update latestScore/Feedback
 *   - { type: "persona", persona: "..." }  → update activePersona
 *
 * useChat() collects these in its `data` array. We process them in a
 * useEffect that runs whenever `data` changes. Since annotations are
 * appended (never replaced), we track a `processedAnnotationsCount` ref
 * to avoid reprocessing old annotations on each render.
 *
 * ─────────────────────────────────────────────────────────────────
 * STATE RECONSTRUCTION ON EACH REQUEST
 * ─────────────────────────────────────────────────────────────────
 * The LangGraph graph state is stateless between requests — it lives only
 * in memory during execution. We pass the full context on every request:
 *   - messages: the full conversation history (useChat manages this)
 *   - evalLog: evaluation history (we maintain this in useState)
 *   - currentPersona: the latest persona (maintained in useState)
 *   - refinementCount: how many refinements have happened (maintained in useState)
 *   - provider: chosen by the model selector (maintained in useState)
 *
 * This stateless approach matches how useChat works by default — it sends
 * all messages on every request.
 */

"use client";

import { useChat } from "ai/react";
import { useState, useEffect, useRef, useCallback } from "react";
import type { Provider } from "@/lib/providers";
import type { AgentStepAnnotation } from "@/lib/schemas";
import { ChatPanel } from "@/components/panels/chat-panel";
import { PersonaPreviewPanel } from "@/components/panels/persona-preview-panel";
import { TestPanel } from "@/components/panels/test-panel";
import { ModelSelector } from "@/components/model-selector";
import { ResetButton } from "@/components/reset-button";

// Shape of each item in useChat().data[]
// The AI SDK types this as JSONValue[] — we cast to our known annotation shape.
type ChatData = AgentStepAnnotation[];

export function PersonaGenApp() {
  // ─── UI state ─────────────────────────────────────────────────────────────
  const [provider, setProvider] = useState<Provider>("openai");
  const [activePersona, setActivePersona] = useState<string | null>(null);
  const [latestScore, setLatestScore] = useState<number | null>(null);
  const [latestFeedback, setLatestFeedback] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);

  // Eval log: serialized message pairs for passing back to the API route.
  // We maintain this separately from generateChat.messages because the
  // eval log has a different structure (evaluator prompts/responses) that
  // shouldn't appear in the user-facing chat.
  const [evalLog, setEvalLog] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);

  // Refinement count: incremented each time a refine annotation arrives.
  // Sent to the API route so the graph knows where it left off.
  const [refinementCount, setRefinementCount] = useState(0);

  // Track how many data annotations we've already processed (avoid reprocessing)
  const processedAnnotationsRef = useRef(0);

  // ─── Generate flow (left panel) ───────────────────────────────────────────
  const generateChat = useChat({
    api: "/api/persona",
    // `body` is merged into the POST request body on every submission.
    // useChat automatically includes { messages } — we add our custom fields.
    body: {
      phase: "generate",
      currentPersona: activePersona,
      refinementCount,
      provider,
      evalLog,
    },
    onError: (error) => {
      console.error("[generateChat] Error:", error);
      setCurrentStep(null);
      setIsEvaluating(false);
    },
    onFinish: () => {
      // Graph run completed — clear the step indicator
      setCurrentStep(null);
      setIsEvaluating(false);
    },
  });

  // ─── Test flow (right panel) ───────────────────────────────────────────────
  const testChat = useChat({
    api: "/api/persona",
    body: {
      phase: "test",
      currentPersona: activePersona,
      refinementCount: 0, // not used in test phase, but required by schema
      provider,
      evalLog: [], // not used in test phase
    },
    onError: (error) => {
      console.error("[testChat] Error:", error);
    },
  });

  // ─── Process stream annotations ───────────────────────────────────────────
  // generateChat.data[] accumulates annotation objects emitted as "2:" frames.
  // We process new annotations whenever the array grows.
  useEffect(() => {
    const data = generateChat.data as unknown as ChatData | undefined;
    if (!data || data.length === 0) return;

    // Only process annotations we haven't seen yet
    const newAnnotations = data.slice(processedAnnotationsRef.current);
    if (newAnnotations.length === 0) return;

    for (const annotation of newAnnotations) {
      switch (annotation.type) {
        case "agentStep":
          setCurrentStep(annotation.label);
          // Show evaluating state when the evaluator node starts
          setIsEvaluating(annotation.node === "evaluator");
          break;

        case "evaluation":
          setLatestScore(annotation.score);
          setLatestFeedback(annotation.feedback);
          setIsEvaluating(false);
          // Update refinement count based on annotation data
          // (the API route tracks the actual count)
          break;

        case "persona":
          setActivePersona(annotation.persona);
          break;
      }
    }

    processedAnnotationsRef.current = data.length;
  }, [generateChat.data]);

  // ─── Reset handler ────────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    generateChat.setMessages([]);
    testChat.setMessages([]);
    setActivePersona(null);
    setLatestScore(null);
    setLatestFeedback(null);
    setCurrentStep(null);
    setIsEvaluating(false);
    setEvalLog([]);
    setRefinementCount(0);
    processedAnnotationsRef.current = 0;
  }, [generateChat, testChat]);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen p-4 gap-3">
      {/* Top bar: title + controls */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-lg font-semibold">Persona Generator</h1>
          <p className="text-xs text-muted-foreground">
            Powered by LangGraph + {provider === "openai" ? "OpenAI gpt-4.1" : "Claude claude-sonnet-4-6"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ModelSelector
            value={provider}
            onChange={setProvider}
            disabled={generateChat.isLoading || testChat.isLoading}
          />
          <ResetButton
            onReset={handleReset}
            disabled={generateChat.isLoading || testChat.isLoading}
          />
        </div>
      </div>

      {/* Three-panel layout
        *
        * Grid layout: 5fr | 3fr | 5fr
        * The middle preview panel is narrower since it's read-only display.
        * The left and right panels are wider since they have chat inputs.
        *
        * WHY CSS GRID over Flexbox?
        * Grid gives precise fractional column widths. Flexbox would require
        * explicit flex-basis values or would size columns based on content.
        * Grid columns maintain their ratios even when content overflows.
        */}
      <div className="grid grid-cols-[5fr_3fr_5fr] gap-3 flex-1 min-h-0">
        <ChatPanel
          messages={generateChat.messages}
          input={generateChat.input}
          onInputChange={generateChat.handleInputChange}
          onSubmit={generateChat.handleSubmit}
          isLoading={generateChat.isLoading}
          currentStep={currentStep}
        />

        <PersonaPreviewPanel
          persona={activePersona}
          latestScore={latestScore}
          latestFeedback={latestFeedback}
          isEvaluating={isEvaluating}
        />

        <TestPanel
          messages={testChat.messages}
          input={testChat.input}
          onInputChange={testChat.handleInputChange}
          onSubmit={testChat.handleSubmit}
          isLoading={testChat.isLoading}
          hasPersona={!!activePersona}
        />
      </div>
    </div>
  );
}
