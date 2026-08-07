"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface FileDropProps {
  /** Receives the file's text plus its name, for both drop and picker. */
  onFile: (text: string, fileName: string) => void;
  onError: (message: string) => void;
  children: React.ReactNode;
}

/**
 * Wraps the canvas so a `graph.json` can be dropped anywhere on it, and exposes
 * a picker button for the same path.
 *
 * Drag events fire per-element, so a naive dragleave handler flickers the
 * overlay off every time the pointer crosses a child. A depth counter tracks
 * enter/leave pairs instead.
 */
export default function FileDrop({ onFile, onError, children }: FileDropProps) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const read = useCallback(
    (file: File) => {
      if (!/\.json$/i.test(file.name)) {
        onError(`${file.name} is not a .json file.`);
        return;
      }
      file
        .text()
        .then((text) => onFile(text, file.name))
        .catch(() => onError(`Could not read ${file.name}.`));
    },
    [onError, onFile],
  );

  // The browser navigates to a dropped file unless the whole window opts out.
  useEffect(() => {
    const prevent = (event: DragEvent) => event.preventDefault();
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  const handleDragEnter = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    depth.current += 1;
    if (event.dataTransfer.types.includes("Files")) setDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    depth.current -= 1;
    if (depth.current <= 0) {
      depth.current = 0;
      setDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      depth.current = 0;
      setDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) read(file);
    },
    [read],
  );

  return (
    <div
      className="relative h-full w-full"
      onDragEnter={handleDragEnter}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}

      <div className="pointer-events-none absolute bottom-4 left-4">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="pointer-events-auto rounded-md border border-border bg-surface/90 px-3 py-1.5 text-[11px] text-muted backdrop-blur transition-colors hover:text-foreground"
        >
          Load file…
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) read(file);
            // Reset so re-picking the same file fires change again.
            event.target.value = "";
          }}
        />
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-accent/60 bg-background/70 backdrop-blur-sm">
          <p className="text-sm font-medium text-accent">
            Drop a graphify graph.json to load it
          </p>
        </div>
      )}
    </div>
  );
}
