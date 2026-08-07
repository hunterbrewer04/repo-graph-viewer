"use client";

import { useEffect, useMemo, useState } from "react";

import DetailPanel from "@/components/DetailPanel";
import GraphViewer from "@/components/GraphViewer";
import { buildAdjacency } from "@/lib/adjacency";
import { loadGraph, type GraphData } from "@/lib/graphLoader";

const DEFAULT_GRAPH = "/graphs/apple-calendar-mcp.json";

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
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(DEFAULT_GRAPH)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((text) => {
        if (!cancelled) setGraph(loadGraph(text));
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Rebuilt only when a different graph loads, not on every selection change.
  const adjacency = useMemo(
    () => (graph ? buildAdjacency(graph) : new Map()),
    [graph],
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-6 border-b border-border bg-surface px-5 py-3">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-sm font-semibold tracking-tight">
            Repo Graph Viewer
          </h1>
          <span className="text-[11px] text-muted">apple-calendar-mcp</span>
        </div>

        {graph && (
          <div className="flex items-center gap-6">
            <Stat label="nodes" value={graph.stats.nodes} />
            <Stat label="links" value={graph.stats.links} />
            <Stat label="communities" value={graph.stats.communities} />
            <Stat label="commit" value={graph.stats.commit || "—"} />
          </div>
        )}
      </header>

      <main className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {graph ? (
            <GraphViewer
              data={graph}
              adjacency={adjacency}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-xs text-muted">
                {error ? `Could not load graph: ${error}` : "Loading graph…"}
              </p>
            </div>
          )}
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
