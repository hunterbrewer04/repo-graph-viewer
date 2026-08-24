"use client";

import type { Ref, RefObject } from "react";

export interface SearchResult {
  id: string;
  name: string;
  kind: string;
  /** Community color dot, consistent with DetailPanel rows. */
  color: string;
}

export interface SearchBoxProps {
  value: string;
  /** Already computed + capped upstream (GraphViewer memo). */
  results: SearchResult[];
  /** Keyboard cursor into `results`; null when nothing is cursored. */
  activeIndex: number | null;
  inputRef: RefObject<HTMLInputElement | undefined>;
  /**
   * Total nodes matching the query, before the 8-result cap. When it exceeds
   * `results.length`, a `+N more` footer keeps the old match-count badge
   * honest about truncation.
   */
  totalMatches?: number;
  onChange: (value: string) => void;
  onPick: (result: SearchResult) => void;
  onActiveIndexChange: (index: number | null) => void;
}

/**
 * Presentational search input + results dropdown. State lives upstream in
 * GraphViewer (where `query` and the `matched` set live); this component only
 * renders and reports intent. Escape is deliberately NOT handled here — the
 * existing global keydown handler already clears the query and blurs inputs,
 * so double-handling would fight it.
 */
export default function SearchBox({
  value,
  results,
  activeIndex,
  inputRef,
  totalMatches,
  onChange,
  onPick,
  onActiveIndexChange,
}: SearchBoxProps) {
  const open = results.length > 0 && value.trim().length > 0;
  const hidden =
    typeof totalMatches === "number" ? totalMatches - results.length : 0;

  // The match-count badge survives card B verbatim whenever a query is active.
  const matchedBadge =
    value.trim() && typeof totalMatches === "number" ? (
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-[10px] text-muted">
        {totalMatches}
      </span>
    ) : null;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        const base = activeIndex ?? -1;
        onActiveIndexChange((base + 1) % results.length);
        break;
      }
      case "ArrowUp": {
        event.preventDefault();
        const base = activeIndex ?? results.length;
        onActiveIndexChange((base - 1 + results.length) % results.length);
        break;
      }
      case "Enter": {
        // Only swallow Enter while the dropdown is actually open; otherwise
        // typing-then-submit flows outside search behave natively.
        event.preventDefault();
        const index = activeIndex ?? 0;
        const result = results[index];
        if (result) onPick(result);
        break;
      }
      default:
        break;
    }
  };

  return (
    <>
      {/* Deliberately type="text": the native search clear button would sit on
          top of the match count, and Escape already clears. */}
      <input
        /* The upstream ref holds `undefined` rather than `null`, matching its
           own declaration; React's Ref<> wants the nullable flavor, hence the
           one-way adapter below instead of widening the caller's ref type. */
        ref={inputRef as unknown as Ref<HTMLInputElement>}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls="search-results-listbox"
        aria-activedescendant={
          open && activeIndex !== null ? `search-option-${activeIndex}` : undefined
        }
        aria-autocomplete="list"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          onActiveIndexChange(null);
        }}
        onKeyDown={handleKeyDown}
        placeholder="Search nodes…"
        aria-label="Search nodes"
        className="w-56 rounded-md border border-border bg-surface/90 py-1.5 pl-2.5 pr-9 text-[11px] text-foreground placeholder:text-muted outline-none backdrop-blur focus:border-accent"
      />
      {matchedBadge}
      {open && (
        <ul
          id="search-results-listbox"
          role="listbox"
          aria-label="Search results"
          className="absolute left-0 right-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-surface/90 py-1 shadow-lg backdrop-blur"
        >
          {results.map((result, index) => (
            <li
              key={result.id}
              id={`search-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseEnter={() => onActiveIndexChange(index)}
            >
              <button
                type="button"
                onClick={() => onPick(result)}
                className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs transition-colors ${
                  index === activeIndex ? "bg-surface-raised" : ""
                }`}
              >
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: result.color }}
                />
                <span className="truncate">{result.name}</span>
                <span className="ml-auto shrink-0 font-mono text-[10px] text-muted">
                  {result.kind}
                </span>
              </button>
            </li>
          ))}
          {hidden > 0 && (
            <li
              aria-hidden
              className="px-2.5 pb-0.5 pt-1 font-mono text-[10px] text-muted"
            >
              +{hidden} more
            </li>
          )}
        </ul>
      )}
    </>
  );
}
