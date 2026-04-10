/**
 * components/drawer.tsx — Right-side slide-in drawer
 *
 * A panel that overlays the main content from the right side. Used for the
 * Persona Preview and Test panels — they're hidden by default and opened on demand.
 *
 * WHY OVERLAY INSTEAD OF RESIZING?
 * Resizing the chat panel when a drawer opens would cause the chat layout to
 * reflow (messages reposition, scroll position jumps). An overlay drawer appears
 * ON TOP of the chat without affecting its layout — smoother and less jarring.
 *
 * IMPLEMENTATION: Pure CSS transitions, no animation library needed.
 * The drawer uses `translate-x-full` (off-screen right) when closed and
 * `translate-x-0` (fully visible) when open. The backdrop is a semi-transparent
 * overlay that closes the drawer on click.
 *
 * TRADEOFF: The overlay partially obscures the chat. For narrow screens this
 * is fine; for wide screens the drawer only takes up ~40% of the width, leaving
 * the chat readable. We don't support resizing the drawer — fixed width is
 * simpler and sufficient for this use case.
 */

"use client";

import { useEffect } from "react";

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Width of the drawer. Defaults to "w-[480px] max-w-[90vw]" */
  width?: string;
}

export function Drawer({ isOpen, onClose, title, children, width = "w-[520px] max-w-[90vw]" }: DrawerProps) {
  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  return (
    <>
      {/* Backdrop — clicking it closes the drawer */}
      <div
        className={`fixed inset-0 z-40 bg-black/30 backdrop-blur-sm transition-opacity duration-200 ${
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`
          fixed top-0 right-0 z-50 h-full ${width}
          bg-background border-l border-border shadow-2xl
          flex flex-col
          transition-transform duration-200 ease-in-out
          ${isOpen ? "translate-x-0" : "translate-x-full"}
        `}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted"
            aria-label="Close drawer"
          >
            {/* ✕ icon using unicode — no icon library needed */}
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="1" y1="1" x2="13" y2="13" />
              <line x1="13" y1="1" x2="1" y2="13" />
            </svg>
          </button>
        </div>

        {/* Content — scrollable */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {children}
        </div>
      </div>
    </>
  );
}
