/**
 * components/evaluation-badge.tsx
 *
 * Displays the evaluator's score (0.0–1.0) as a color-coded badge.
 *
 * COLOR CODING:
 *   Red    (< 0.5)  — Poor persona, likely needs significant work
 *   Yellow (< 0.9)  — Acceptable but refinement is ongoing (0.9 is the threshold)
 *   Green  (≥ 0.9)  — Score exceeds the refinement threshold; this persona passed
 *
 * The 0.9 threshold matches the Python app and the shouldRefine() edge function.
 * Showing green when the score hits 0.9+ gives the user immediate visual
 * confirmation that the refinement loop has stopped.
 */

import { Badge } from "@/components/ui/badge";

interface EvaluationBadgeProps {
  score: number | null;
  /** If true, the evaluator is currently running — show a "..." state */
  isEvaluating?: boolean;
}

export function EvaluationBadge({ score, isEvaluating }: EvaluationBadgeProps) {
  if (isEvaluating) {
    return (
      <Badge variant="outline" className="text-xs animate-pulse">
        Evaluating...
      </Badge>
    );
  }

  if (score === null) return null;

  const percentage = Math.round(score * 100);

  // Determine variant based on score bands
  // Using Tailwind utility classes directly since shadcn Badge variants are limited
  let colorClasses = "";
  if (score >= 0.9) {
    colorClasses = "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400";
  } else if (score >= 0.5) {
    colorClasses = "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400";
  } else {
    colorClasses = "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400";
  }

  return (
    <Badge
      variant="outline"
      className={`text-xs font-mono ${colorClasses}`}
    >
      Score: {percentage}%
    </Badge>
  );
}
