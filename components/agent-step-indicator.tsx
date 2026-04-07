/**
 * components/agent-step-indicator.tsx
 *
 * Shows which graph node is currently executing. This is one of the main
 * UX improvements over the Python app — users can see the agent's progress
 * in real time rather than staring at a spinner.
 *
 * State flow:
 *   API route emits { type: "agentStep", label: "..." } annotation
 *   → useChat().data receives it
 *   → PersonaGenApp extracts it and passes `label` as a prop here
 *   → We display it with a pulsing indicator
 *
 * WHY A SEPARATE COMPONENT?
 * This could be inlined in ChatPanel, but keeping it separate makes it
 * reusable and easier to style/animate independently.
 */

interface AgentStepIndicatorProps {
  /** The current step label, e.g. "Generating persona..." or null when idle */
  label: string | null;
}

export function AgentStepIndicator({ label }: AgentStepIndicatorProps) {
  if (!label) return null;

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground px-1 py-1">
      {/* Pulsing dot — CSS animation indicating live activity */}
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500" />
      </span>
      <span>{label}</span>
    </div>
  );
}
