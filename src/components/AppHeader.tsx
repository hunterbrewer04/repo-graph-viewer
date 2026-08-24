import StatsBar from "@/components/StatsBar";
import type { GraphData } from "@/lib/graphLoader";

export interface AppHeaderProps {
  /** Name of the file the current graph came from; empty until one loads. */
  source: string;
  graph: GraphData | null;
  error: string | null;
}

export default function AppHeader({ source, graph, error }: AppHeaderProps) {
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-b border-border bg-surface px-5 py-3">
      <div className="flex items-baseline gap-3">
        <h1 className="text-base font-semibold tracking-tight">
          Repo Graph Viewer
        </h1>
        {/* Loaded-graph name: muted when absent, foreground once a graph is up. */}
        {source ? (
          <span
            className="max-w-xs truncate text-[13px] font-medium text-accent"
            title={source}
          >
            {source}
          </span>
        ) : (
          <span className="text-[13px] text-muted">no graph loaded</span>
        )}
      </div>

      {graph && <StatsBar stats={graph.stats} />}

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
  );
}
