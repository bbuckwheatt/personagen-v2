/**
 * components/persona-display.tsx
 *
 * Renders the current persona text in the preview panel.
 * The persona is a plain-text system prompt, so we render it in a monospace
 * pre block for readability rather than parsing it as markdown.
 *
 * WHY NOT MARKDOWN?
 * The generated personas are plain text instructions, not formatted documents.
 * Markdown parsing would add a dependency and potentially mangle the text
 * if the persona contains symbols like * or _.
 */

interface PersonaDisplayProps {
  persona: string | null;
}

export function PersonaDisplay({ persona }: PersonaDisplayProps) {
  if (!persona) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No persona generated yet. Start a conversation in the chat panel.
      </p>
    );
  }

  return (
    <pre className="text-xs text-foreground whitespace-pre-wrap font-mono leading-relaxed break-words">
      {persona}
    </pre>
  );
}
