/**
 * components/step-log.tsx — Live agent step log
 *
 * Replaces the single-line "Refining persona..." spinner with a scrollable
 * timeline of agent steps. Each entry shows:
 *   ✓  Generated initial persona       (3.2s)
 *   ✓  Evaluated — score 0.72          (1.8s)
 *   ⟳  Refining (attempt 1/3)...
 *
 * WHY A LOG INSTEAD OF A SINGLE INDICATOR?
 * Long-running agentic flows (8 LLM calls at worst) feel like a black box
 * with just a spinner. A log gives the user a sense of progress — they can
 * see which steps completed, how long each took, and what the evaluator said.
 * It also teaches users what the graph is doing under the hood.
 *
 * DATA FLOW:
 * 1. API route emits { type: "agentStep" } and { type: "evaluation" } annotations
 * 2. persona-gen-app.tsx reads them from useChat().data and builds the steps array
 * 3. This component renders the steps array
 *
 * The parent manages the steps state — this component is purely presentational.
 */

"use client";

export type StepStatus = "running" | "done" | "error";

export interface StepEntry {
  id: string;           // unique key (e.g. "promptGen-0", "evaluator-1")
  label: string;        // human-readable description
  status: StepStatus;
  startedAt: number;    // Date.now() when the step started
  endedAt?: number;     // Date.now() when the step finished
  detail?: string;      // optional extra info, e.g. "score: 0.72"
}

interface StepLogProps {
  steps: StepEntry[];
  /** If true, show the log even when all steps are done (for post-run review). */
  alwaysVisible?: boolean;
}

export function StepLog({ steps, alwaysVisible }: StepLogProps) {
  // Hide when empty and not forced visible
  if (steps.length === 0 && !alwaysVisible) return null;

  return (
    <div className="border border-border rounded-lg bg-muted/30 text-xs font-mono overflow-hidden">
      <div className="px-3 py-1.5 border-b border-border text-muted-foreground text-[11px] uppercase tracking-wider">
        Agent Steps
      </div>
      <ul className="divide-y divide-border/50 max-h-36 overflow-y-auto">
        {steps.map((step) => (
          <li key={step.id} className="flex items-start gap-2 px-3 py-2">
            {/* Status icon */}
            <span className="shrink-0 mt-0.5">
              {step.status === "running" && (
                // Spinning indicator for active step
                <span className="inline-block w-3 h-3 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
              )}
              {step.status === "done" && (
                <span className="text-emerald-500">✓</span>
              )}
              {step.status === "error" && (
                <span className="text-red-500">✗</span>
              )}
            </span>

            {/* Label + detail */}
            <span className={`flex-1 ${step.status === "running" ? "text-foreground" : "text-muted-foreground"}`}>
              {step.label}
              {step.detail && (
                <span className="ml-1 text-muted-foreground/70">— {step.detail}</span>
              )}
            </span>

            {/* Elapsed time (only shown when done) */}
            {step.status === "done" && step.endedAt && (
              <span className="shrink-0 text-muted-foreground/60 tabular-nums">
                {((step.endedAt - step.startedAt) / 1000).toFixed(1)}s
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
