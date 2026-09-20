import StatsBar from "@/components/StatsBar";
import ThemeToggle from "@/components/ThemeToggle";
import type { GraphData } from "@/lib/graphLoader";

export interface AppHeaderProps {
  /** Name of the file or example the current graph came from; empty until one loads. */
  source: string;
  graph: GraphData | null;
  error: string | null;
  /** Renders the Examples button when provided. */
  onOpenExamples?: () => void;
}

/**
 * Phones get stacked rows (title + controls, then stats, then any error);
 * from `sm` up everything sits on one line with the spacer pushing the error
 * and controls right. The order classes do the reflow.
 */
export default function AppHeader({
  source,
  graph,
  error,
  onOpenExamples,
}: AppHeaderProps) {
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-b border-border bg-surface px-4 py-2.5 sm:px-5 sm:py-3">
      {/* flex-1 lets the source name truncate on phones instead of pushing
          the controls onto their own row; on desktop the spacer owns the
          free space. */}
      <div className="order-1 flex min-w-0 flex-1 items-baseline gap-3 sm:flex-initial">
        <h1 className="shrink-0 text-base font-semibold tracking-tight">
          Repo Graph Viewer
        </h1>
        {/* Loaded-graph name: muted when absent, accent once a graph is up. */}
        {source ? (
          <span
            className="truncate text-[13px] font-medium text-accent sm:max-w-xs"
            title={source}
          >
            {source}
          </span>
        ) : (
          <span className="truncate text-[13px] text-muted">
            no graph loaded
          </span>
        )}
      </div>

      {graph && (
        <div className="order-3 w-full sm:order-2 sm:w-auto">
          <StatsBar stats={graph.stats} />
        </div>
      )}

      <div className="hidden sm:order-3 sm:block sm:flex-1" />

      {error && (
        <p
          role="alert"
          className="order-4 w-full truncate rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[11px] text-red-700 sm:w-auto sm:max-w-md dark:text-red-300"
          title={error}
        >
          {error}
        </p>
      )}

      <div className="order-2 ml-auto flex items-center gap-2 sm:order-5 sm:ml-0">
        {onOpenExamples && (
          <button
            type="button"
            onClick={onOpenExamples}
            className="h-8 rounded-md border border-border bg-surface px-3 text-[11px] text-muted transition-colors hover:bg-surface-raised hover:text-foreground sm:h-7 sm:px-2.5"
          >
            Examples
          </button>
        )}
        <ThemeToggle />
      </div>
    </header>
  );
}
