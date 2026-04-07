/**
 * components/panels/persona-preview-panel.tsx — Center panel: live persona preview
 *
 * Shows the currently extracted persona and the latest evaluation score.
 * This panel updates immediately when a persona annotation arrives in the
 * stream — even before the full graph run completes.
 *
 * WHAT IT SHOWS:
 * - The persona text (from `persona` prop, updated via stream annotations)
 * - The latest evaluation score (from `latestScore` prop)
 * - The evaluator's feedback (collapsed, expandable)
 *
 * WHY THE PERSONA UPDATES MID-RUN:
 * The API route emits a `{ type: "persona", persona: "..." }` annotation as
 * soon as promptGenNode or refineNode extracts a persona — before the evaluator
 * or further refinement nodes run. The frontend reads this from useChat().data[]
 * and updates the preview panel immediately. This gives the user real-time
 * feedback instead of waiting for the entire graph to finish.
 */

"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <Card className="flex flex-col h-full">
      <CardHeader className="pb-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Persona Preview</CardTitle>
          <EvaluationBadge score={latestScore} isEvaluating={isEvaluating} />
        </div>
        <p className="text-xs text-muted-foreground">
          The generated system prompt for your chatbot.
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-3 flex-1 min-h-0 p-4 pt-0 overflow-y-auto">
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
      </CardContent>
    </Card>
  );
}
