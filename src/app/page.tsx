"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import DetailPanel from "@/components/DetailPanel";
import FileDrop from "@/components/FileDrop";
import GraphViewer from "@/components/GraphViewer";
import { buildAdjacency } from "@/lib/adjacency";
import { loadGraph, type GraphData } from "@/lib/graphLoader";

interface Preset {
  id: string;
  name: string;
  file: string;
}

const MANIFEST_URL = "/graphs/manifest.json";

/** Presets are authored by hand, so tolerate a malformed or missing manifest. */
function parseManifest(value: unknown): Preset[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const { id, name, file } = entry as Record<string, unknown>;
    if (typeof id !== "string" || typeof file !== "string") return [];
    return [{ id, name: typeof name === "string" ? name : id, file }];
  });
}

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
  const [presets, setPresets] = useState<Preset[]>([]);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [source, setSource] = useState<string>("");
  /** Empty when the current graph came from a dropped/picked file. */
  const [presetId, setPresetId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const loadPreset = useCallback(
    async (preset: Preset) => {
      setLoading(true);
      try {
        const response = await fetch(preset.file);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        applyGraph(await response.text(), preset.name);
        setPresetId(preset.id);
      } catch (cause) {
        setError(
          `Could not load ${preset.name}: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        );
      } finally {
        setLoading(false);
      }
    },
    [applyGraph],
  );

  // Fetch the preset list, then open the first one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(MANIFEST_URL);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const list = parseManifest(await response.json());
        if (cancelled) return;
        setPresets(list);
        if (list.length > 0) {
          await loadPreset(list[0]);
          return;
        }
        setError("No presets found in manifest.json. Drop a graph.json to start.");
      } catch (cause) {
        if (!cancelled) {
          setError(
            `Could not load presets: ${
              cause instanceof Error ? cause.message : String(cause)
            }`,
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPreset]);

  const handleFile = useCallback(
    (text: string, fileName: string) => {
      setPresetId("");
      applyGraph(text, fileName);
    },
    [applyGraph],
  );

  // Rebuilt only when a different graph loads, not on every selection change.
  const adjacency = useMemo(
    () => (graph ? buildAdjacency(graph) : new Map()),
    [graph],
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-b border-border bg-surface px-5 py-3">
        <h1 className="text-sm font-semibold tracking-tight">
          Repo Graph Viewer
        </h1>

        <div className="flex items-center gap-2">
          <select
            value={presetId}
            aria-label="Dataset"
            onChange={(event) => {
              const preset = presets.find((p) => p.id === event.target.value);
              if (preset) void loadPreset(preset);
            }}
            className="rounded-md border border-border bg-surface-raised px-2 py-1 text-[11px] text-foreground outline-none focus:border-accent"
          >
            {presetId === "" && (
              <option value="">{source || "custom graph"}</option>
            )}
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
          {loading && <span className="text-[11px] text-muted">loading…</span>}
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
          <FileDrop onFile={handleFile} onError={setError}>
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
                  {loading
                    ? "Loading graph…"
                    : "Drop a graphify graph.json anywhere to render it."}
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
