"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import AppHeader from "@/components/AppHeader";
import DetailPanel from "@/components/DetailPanel";
import FileDrop from "@/components/FileDrop";
import GraphViewer from "@/components/GraphViewer";
import { buildAdjacency } from "@/lib/adjacency";
import { loadGraph, type GraphData } from "@/lib/graphLoader";
import {
  buildShareHash,
  decodeSharePayload,
  parseShareHash,
} from "@/lib/shareUrl";

export default function Home() {
  const [graph, setGraph] = useState<GraphData | null>(null);
  /** Name of the file the current graph came from. */
  const [source, setSource] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /**
   * Node id to pre-select once GraphViewer mounts (from a shared link's
   * `n=` param). Consumed exactly once by GraphViewer's initial-selection
   * effect, then cleared.
   */
  const [initialSelectedId, setInitialSelectedId] = useState<string | null>(
    null,
  );

  /** Loading a graph replaces whatever is on screen; a failure leaves it up. */
  const applyGraph = useCallback((text: string, label: string) => {
    try {
      setGraph(loadGraph(text));
      setSource(label);
      setSelectedId(null);
      setError(null);
      // Success path only — a failed load leaves the URL (and screen) alone.
      // replaceState, not pushState: no history spam, and a stale #g= never
      // resurrects after a fresh drop. Encoded from the RAW text so the
      // decode side re-enters through loadGraph unchanged.
      void buildShareHash(text).then(
        (hash) => history.replaceState(null, "", hash),
        (cause: unknown) => {
          // Oversize-encode (>2M-char hash) must not be swallowed silently:
          // surface it through the same channel as load failures.
          setError(cause instanceof Error ? cause.message : String(cause));
        },
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  // One-time bootstrap: URL -> graph, BEFORE any user interaction. Deliberately
  // window.location-based (NOT useSearchParams): `/` stays fully static.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const named = sp.get("graph");
    const hash = window.location.hash;
    void (async () => {
      if (named) {
        // Secondary path: fetch ./graphs/<name>.json relative to origin.
        // Precedence: an explicit name beats #g=; on failure we do NOT
        // fall through to #g= — one clear error beats dual behavior.
        try {
          const res = await fetch(`graphs/${encodeURIComponent(named)}`);
          if (!res.ok) throw new Error(String(res.status));
          applyGraph(await res.text(), named);
        } catch {
          setError(
            `No graph is published at "${named}" — ask the owner to add graphs/${named}.json, or drop a graph.json directly.`,
          );
        }
        return;
      }
      const parsed = parseShareHash(hash);
      if (!parsed) return;
      try {
        const json = await decodeSharePayload(parsed.payload);
        // applyGraph resets selection, so restore ours AFTER it. Selection
        // is page-owned state; GraphViewer receives the same id as
        // initialSelectedId purely for its mount-time camera fly-to.
        if (parsed.nodeId) setInitialSelectedId(parsed.nodeId);
        applyGraph(json, "shared link");
        if (parsed.nodeId) setSelectedId(parsed.nodeId);
      } catch (cause) {
        setError(
          cause instanceof Error && cause.message.includes("large")
            ? cause.message
            : "This shared link's graph data is corrupted or incomplete.",
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design
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
                initialSelectedId={initialSelectedId}
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
