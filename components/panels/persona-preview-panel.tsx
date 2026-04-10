/**
 * components/panels/persona-preview-panel.tsx — Drawer content: live persona preview
 *
 * Shows the currently extracted persona and the latest evaluation score.
 * Rendered inside a <Drawer> — no Card wrapper needed; the drawer provides
 * the container chrome (border, shadow, close button).
 *
 * WHAT IT SHOWS:
 * - The persona text (from `persona` prop, updated via stream annotations)
 * - The latest evaluation score badge
 * - The evaluator's feedback (collapsible)
 *
 * WHY THE PERSONA UPDATES MID-RUN:
 * The API route emits a `{ type: "persona" }` annotation as soon as
 * promptGenNode or refineNode finishes — before the evaluator runs. The
 * frontend reads this from useChat().data[] and updates state immediately,
 * so the preview reflects the latest persona even during refinement loops.
 */

"use client";

import { useState } from "react";
import { PersonaDisplay } from "@/components/persona-display";
import { EvaluationBadge } from "@/components/evaluation-badge";

interface PersonaPreviewPanelProps {
  persona: string | null;
  latestScore: number | null;
  latestFeedback: string | null;
  isEvaluating: boolean;
}

export function PersonaPreviewPanel({
  persona,
  latestScore,
  latestFeedback,
  isEvaluating,
}: PersonaPreviewPanelProps) {
  const [feedbackExpanded, setFeedbackExpanded] = useState(false);

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Score badge */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          The generated system prompt for your chatbot.
        </p>
        <EvaluationBadge score={latestScore} isEvaluating={isEvaluating} />
      </div>

      {/* Persona text */}
      <PersonaDisplay persona={persona} />

      {/* Evaluator feedback (collapsible) */}
      {latestFeedback && !isEvaluating && (
        <div className="border rounded-md text-xs">
          <button
            onClick={() => setFeedbackExpanded((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className="font-medium">Evaluator Feedback</span>
            <span>{feedbackExpanded ? "▲" : "▼"}</span>
          </button>
          {feedbackExpanded && (
            <div className="px-3 pb-3 text-muted-foreground border-t pt-2">
              {latestFeedback}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
