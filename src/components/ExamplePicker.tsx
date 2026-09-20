"use client";

import { useEffect, useRef } from "react";

import type { Example } from "@/lib/examples";

export interface ExamplePickerProps {
  examples: Example[];
  /** Id of the example being fetched; its card shows a loading state. */
  loadingId: string | null;
  onPick: (example: Example) => void;
}

function ExampleCard({
  example,
  loading,
  disabled,
  onPick,
}: {
  example: Example;
  loading: boolean;
  disabled: boolean;
  onPick: (example: Example) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(example)}
      disabled={disabled}
      aria-busy={loading}
      className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-3.5 text-left transition-colors hover:border-accent/60 hover:bg-surface-raised disabled:cursor-wait disabled:hover:border-border disabled:hover:bg-surface"
    >
      <div className="flex items-center gap-2">
        <span className="truncate text-sm font-semibold text-foreground">
          {example.name}
        </span>
        {example.language && (
          <span className="ml-auto shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted">
            {example.language}
          </span>
        )}
      </div>
      {example.blurb && (
        <p className="text-xs leading-snug text-muted">{example.blurb}</p>
      )}
      <p className="font-mono text-[10px] text-muted">
        {loading
          ? "Loading…"
          : example.stats &&
            `${example.stats.nodes} nodes · ${example.stats.links} links · ${example.stats.communities} communities`}
      </p>
    </button>
  );
}

/**
 * The "want to see an example?" prompt. Rendered inline when no graph is
 * loaded, and inside ExamplesDialog once one is.
 */
export default function ExamplePicker({
  examples,
  loadingId,
  onPick,
}: ExamplePickerProps) {
  return (
    <div className="w-full">
      <div className="mb-5 text-center">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          Want to see an example?
        </h2>
        <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-muted">
          Pick a repo to load its code graph. Or drop your own graphify{" "}
          <code className="font-mono">graph.json</code> anywhere on the canvas,
          or use Load file, bottom right.
        </p>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2">
        {examples.map((example) => (
          <ExampleCard
            key={example.id}
            example={example}
            loading={loadingId === example.id}
            disabled={loadingId !== null}
            onPick={onPick}
          />
        ))}
      </div>

      <p className="mt-5 text-center text-[11px] text-muted">
        Make your own with{" "}
        <code className="font-mono">graphify extract &lt;repo&gt; --code-only</code>
      </p>
    </div>
  );
}

export interface ExamplesDialogProps extends ExamplePickerProps {
  open: boolean;
  onClose: () => void;
}

/** Modal wrapper over the picker, for switching examples after one is loaded. */
export function ExamplesDialog({ open, onClose, ...picker }: ExamplesDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  // <dialog> only opens imperatively; mirror the prop onto it.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      // Escape closes the dialog natively; stop it reaching the viewer's own
      // Escape handler, which would also clear the selection underneath.
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}
      // Padding lives on the inner div, so a click whose target is the dialog
      // itself can only have landed on the backdrop.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-xl border border-border bg-surface p-0 text-foreground shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      <div className="relative p-6">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 rounded px-2 py-0.5 text-lg leading-none text-muted outline-none transition-colors hover:bg-surface-raised hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          ×
        </button>
        <ExamplePicker {...picker} />
      </div>
    </dialog>
  );
}
