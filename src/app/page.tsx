"use client";

import { useCallback, useMemo, useState } from "react";

import AppHeader from "@/components/AppHeader";
import DetailPanel from "@/components/DetailPanel";
import FileDrop from "@/components/FileDrop";
import GraphViewer from "@/components/GraphViewer";
import { buildAdjacency } from "@/lib/adjacency";
import { loadGraph, type GraphData } from "@/lib/graphLoader";

export default function Home() {
  const [graph, setGraph] = useState<GraphData | null>(null);
  /** Name of the file the current graph came from. */
  const [source, setSource] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /** Loading a graph replaces whatever is on screen; a failure leaves it up. */
  const applyGraph = useCallback((text: string, label: string) => {
    try {
      setGraph(loadGraph(text));
      setSource(label);
      setSelectedId(null);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  // Rebuilt only when a different graph loads, not on every selection change.
  const adjacency = useMemo(
    () => (graph ? buildAdjacency(graph) : new Map()),
    [graph],
  );

  return (
    <div className="flex h-full flex-col">
      <AppHeader source={source} graph={graph} error={error} />

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
    </div>
  );
}
