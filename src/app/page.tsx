"use client";

import { useCallback, useMemo, useState } from "react";

import DetailPanel from "@/components/DetailPanel";
import FileDrop from "@/components/FileDrop";
import GraphViewer from "@/components/GraphViewer";
import { buildAdjacency } from "@/lib/adjacency";
import { loadGraph, type GraphData } from "@/lib/graphLoader";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col leading-tight">
      <span className="font-mono text-sm text-foreground">{value}</span>
      <span className="text-[10px] uppercase tracking-wider text-muted">
        {label}
      </span>
    </div>
  );
}

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
      <header className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-b border-border bg-surface px-5 py-3">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-sm font-semibold tracking-tight">
            Repo Graph Viewer
          </h1>
          {source && <span className="text-[11px] text-muted">{source}</span>}
        </div>

        {graph && (
          <div className="flex items-center gap-6">
            <Stat label="nodes" value={graph.stats.nodes} />
            <Stat label="links" value={graph.stats.links} />
            <Stat label="communities" value={graph.stats.communities} />
            <Stat label="commit" value={graph.stats.commit || "—"} />
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="ml-auto max-w-md truncate rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[11px] text-red-300"
            title={error}
          >
            {error}
          </p>
        )}
      </header>

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
