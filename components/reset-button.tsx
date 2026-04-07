/**
 * components/reset-button.tsx
 *
 * Clears all conversation state, persona, and evaluation history.
 * Mirrors the Python app's reset_app() function (lines 27–32).
 *
 * The actual reset logic lives in PersonaGenApp (the parent), which calls
 * useChat()'s setMessages([]) and resets its own state. This component
 * just renders the button and fires the callback.
 */

import { Button } from "@/components/ui/button";

interface ResetButtonProps {
  onReset: () => void;
  disabled?: boolean;
}

export function ResetButton({ onReset, disabled }: ResetButtonProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onReset}
      disabled={disabled}
      className="text-xs"
    >
      Reset All
    </Button>
  );
}
