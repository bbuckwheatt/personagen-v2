/**
 * components/step-log.tsx — Live agent step log
 *
 * A scrollable timeline of agent steps shown while (and after) the graph runs.
 * Each entry shows the status icon, label, optional detail (score), and elapsed time.
 *
 * Visual design:
 * - Left border color changes by status: sky=running, emerald=done, red=error
 * - Running step has a spinning border-radius indicator
 * - Completed steps show elapsed time on the right
 */

"use client";

import { useState } from "react";

export type StepStatus = "running" | "done" | "error";

export interface StepEntry {
  id: string;
  label: string;
  status: StepStatus;
  startedAt: number;
  endedAt?: number;
  detail?: string;
}

interface StepLogProps {
  steps: StepEntry[];
  alwaysVisible?: boolean;
}

const STATUS_STYLES: Record<StepStatus, string> = {
  running: "border-l-sky-400 dark:border-l-sky-500",
  done: "border-l-emerald-400 dark:border-l-emerald-500",
  error: "border-l-red-400 dark:border-l-red-500",
};

export function StepLog({ steps, alwaysVisible }: StepLogProps) {
  const isRunning = steps.some((s) => s.status === "running");
  // Auto-expand while running, collapsed by default when all done
  const [open, setOpen] = useState(true);

  // Reset to open whenever a new run starts
  // (handled by parent clearing steps, which unmounts/remounts this component)

  if (steps.length === 0 && !alwaysVisible) return null;

  const lastStep = steps[steps.length - 1];
  const summary = isRunning
    ? lastStep?.label ?? "Running..."
    : `${steps.length} step${steps.length !== 1 ? "s" : ""} completed`;

  return (
    <div className="rounded-xl border border-border bg-muted/20 text-xs font-mono overflow-hidden">
      {/* Header — always visible, click to toggle */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-1.5 border-b border-border/60 hover:bg-muted/40 transition-colors group"
      >
        <span className="text-muted-foreground text-[10px] uppercase tracking-widest font-sans font-medium">
          Agent Steps
        </span>
        <span className="flex items-center gap-2">
          {!open && (
            <span className="text-muted-foreground/60 font-sans normal-case tracking-normal text-[10px]">
              {summary}
            </span>
          )}
          {isRunning && open && (
            <span className="inline-block w-2.5 h-2.5 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
          )}
          <span className={`text-muted-foreground/50 transition-transform duration-200 ${open ? "rotate-0" : "-rotate-90"}`}>
            ▾
          </span>
        </span>
      </button>

      {open && <ul className="divide-y divide-border/40">
        {steps.map((step) => (
          <li
            key={step.id}
            className={`flex items-start gap-2.5 px-3 py-2 border-l-2 transition-colors ${STATUS_STYLES[step.status]}`}
          >
            {/* Status icon */}
            <span className="shrink-0 mt-0.5 w-3.5 flex justify-center">
              {step.status === "running" && (
                <span className="inline-block w-3 h-3 border-2 border-sky-400 dark:border-sky-500 border-t-transparent rounded-full animate-spin" />
              )}
              {step.status === "done" && (
                <span className="text-emerald-500 dark:text-emerald-400 text-[13px] leading-none">✓</span>
              )}
              {step.status === "error" && (
                <span className="text-red-500 dark:text-red-400 text-[13px] leading-none">✗</span>
              )}
            </span>

            {/* Label + optional detail */}
            <span className={`flex-1 leading-relaxed ${step.status === "running" ? "text-foreground" : "text-muted-foreground"}`}>
              {step.label}
              {step.detail && (
                <span className={`ml-1.5 ${
                  step.detail.includes("accepted")
                    ? "text-emerald-600 dark:text-emerald-400"
                    : step.detail.includes("refining")
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground/70"
                }`}>
                  — {step.detail}
                </span>
              )}
            </span>

            {/* Elapsed time */}
            {step.status !== "running" && step.endedAt && (
              <span className="shrink-0 text-muted-foreground/50 tabular-nums">
                {((step.endedAt - step.startedAt) / 1000).toFixed(1)}s
              </span>
            )}
          </li>
        ))}
      </ul>}
    </div>
  );
}
