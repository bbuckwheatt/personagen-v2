/**
 * components/model-selector.tsx
 *
 * A dropdown that lets the user switch between OpenAI and Anthropic at runtime.
 * The selected provider is passed through useChat()'s `body` option on every
 * request, so the API route knows which getLLMClient() to call.
 *
 * WHY A SELECTOR IN THE UI (not just an env var)?
 * The learning goal of this project is to compare models side by side. Having
 * a runtime toggle lets you generate a persona with OpenAI, see how it scores,
 * then regenerate with Claude and compare — without redeploying or changing env vars.
 *
 * UI PATTERN: Controlled component
 * The parent (PersonaGenApp) owns the `provider` state and passes `onChange`.
 * This keeps the selector "dumb" — it renders and calls back, that's all.
 */

import type { Provider } from "@/lib/providers";

interface ModelSelectorProps {
  value: Provider;
  onChange: (provider: Provider) => void;
  disabled?: boolean;
}

const PROVIDER_LABELS: Record<Provider, string> = {
  openai: "OpenAI gpt-4.1",
  anthropic: "Claude claude-sonnet-4-6",
};

export function ModelSelector({ value, onChange, disabled }: ModelSelectorProps) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="model-select" className="text-xs text-muted-foreground whitespace-nowrap">
        Model:
      </label>
      <select
        id="model-select"
        value={value}
        onChange={(e) => onChange(e.target.value as Provider)}
        disabled={disabled}
        className="text-xs border border-input bg-background rounded-md px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {Object.entries(PROVIDER_LABELS).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
