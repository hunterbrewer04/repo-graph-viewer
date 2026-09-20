"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import AppHeader from "@/components/AppHeader";
import DetailPanel from "@/components/DetailPanel";
import ExamplePicker, { ExamplesDialog } from "@/components/ExamplePicker";
import FileDrop from "@/components/FileDrop";
import GraphViewer from "@/components/GraphViewer";
import { buildAdjacency } from "@/lib/adjacency";
import {
  fetchExampleGraph,
  fetchExamples,
  type Example,
} from "@/lib/examples";
import { loadGraph, type GraphData } from "@/lib/graphLoader";

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export default function Home() {
  const [graph, setGraph] = useState<GraphData | null>(null);
  /** Name of the file or example the current graph came from. */
  const [source, setSource] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [examples, setExamples] = useState<Example[]>([]);
  /** Id of the example being fetched, so its card can show progress. */
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // A missing manifest is not an error: the drop zone still works without it.
  useEffect(() => {
    let cancelled = false;
    fetchExamples()
      .then((list) => {
        if (!cancelled) setExamples(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /** Loading a graph replaces whatever is on screen; a failure leaves it up. */
  const applyGraph = useCallback((text: string, label: string) => {
    try {
      setGraph(loadGraph(text));
      setSource(label);
      setSelectedId(null);
      setError(null);
    } catch (cause) {
      setError(message(cause));
    }
  }, []);

  const loadExample = useCallback(
    async (example: Example) => {
      setLoadingId(example.id);
      try {
        applyGraph(await fetchExampleGraph(example), example.name);
        setPickerOpen(false);
      } catch (cause) {
        setError(`Could not load ${example.name}: ${message(cause)}`);
      } finally {
        setLoadingId(null);
      }
    },
    [applyGraph],
  );

  const openPicker = useCallback(() => setPickerOpen(true), []);
  const closePicker = useCallback(() => setPickerOpen(false), []);

  // Rebuilt only when a different graph loads, not on every selection change.
  const adjacency = useMemo(
    () => (graph ? buildAdjacency(graph) : new Map()),
    [graph],
  );

  return (
    <div className="flex h-full flex-col">
      <AppHeader
        source={source}
        graph={graph}
        error={error}
        onOpenExamples={graph && examples.length > 0 ? openPicker : undefined}
      />

      <main className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <FileDrop onFile={applyGraph} onError={setError}>
            {graph ? (
              <GraphViewer
                data={graph}
                adjacency={adjacency}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            ) : examples.length > 0 ? (
              // m-auto rather than items-center so a short window scrolls the
              // picker instead of clipping its top. Bottom padding keeps the
              // last card clear of the Load file button.
              <div className="flex h-full overflow-y-auto p-6 pb-20 sm:pb-6">
                <div className="m-auto w-full max-w-2xl">
                  <ExamplePicker
                    examples={examples}
                    loadingId={loadingId}
                    onPick={loadExample}
                  />
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                <p className="text-sm text-foreground">
                  Drop a graphify <code className="font-mono">graph.json</code>{" "}
                  to render it
                </p>
                <p className="text-xs text-muted">
                  or use Load file, bottom right. Run{" "}
                  <code className="font-mono">graphify extract</code> on a repo
                  and its graph lands in{" "}
                  <code className="font-mono">graphify-out/graph.json</code>.
                </p>
              </div>
            )}
          </FileDrop>
        </div>

        {graph && (
          <DetailPanel
            data={graph}
            adjacency={adjacency}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        )}
      </main>

      {graph && (
        <ExamplesDialog
          open={pickerOpen}
          onClose={closePicker}
          examples={examples}
          loadingId={loadingId}
          onPick={loadExample}
        />
      )}
    </div>
  );
}
