"use client";

import { useMemo } from "react";

import { adjacencyFor, type Adjacency } from "@/lib/adjacency";
import type { GraphData, GraphNode } from "@/lib/graphLoader";

export interface DetailPanelProps {
  data: GraphData;
  adjacency: Adjacency;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

/** Groups a node's edges by relation so "3 calls, 1 imports" reads at a glance. */
function countByRelation(relations: string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const relation of relations) {
    counts.set(relation, (counts.get(relation) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function RelationCounts({ relations }: { relations: string[] }) {
  const counts = countByRelation(relations);
  if (counts.length === 0) return <span className="text-muted">none</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {counts.map(([relation, count]) => (
        <span
          key={relation}
          className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[11px] text-foreground/80"
        >
          {relation} <span className="text-muted">{count}</span>
        </span>
      ))}
    </span>
  );
}

function NeighborList({
  title,
  entries,
  nodesById,
  onSelect,
}: {
  title: string;
  entries: { id: string; relation: string }[];
  nodesById: Map<string, GraphNode>;
  onSelect: (id: string) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <section>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
        {title} <span className="text-muted/60">({entries.length})</span>
      </h3>
      <ul className="space-y-0.5">
        {entries.map((entry, index) => {
          const node = nodesById.get(entry.id);
          return (
            <li key={`${entry.id}-${entry.relation}-${index}`}>
              <button
                type="button"
                onClick={() => onSelect(entry.id)}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs transition-colors hover:bg-surface-raised"
              >
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: node?.color ?? "#8b8b9a" }}
                />
                <span className="truncate">{node?.name ?? entry.id}</span>
                <span className="ml-auto shrink-0 font-mono text-[10px] text-muted">
                  {entry.relation}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function DetailPanel({
  data,
  adjacency,
  selectedId,
  onSelect,
}: DetailPanelProps) {
  const nodesById = useMemo(
    () => new Map(data.nodes.map((node) => [node.id, node])),
    [data],
  );

  const selected = selectedId ? nodesById.get(selectedId) : undefined;
  const entry = adjacencyFor(adjacency, selectedId);

  if (!selected) {
    return (
      <aside className="flex w-80 shrink-0 items-center justify-center border-l border-border bg-surface p-6">
        <p className="text-center text-xs leading-relaxed text-muted">
          Click a node to inspect its source location, community, and neighbors.
        </p>
      </aside>
    );
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-surface">
      <header className="border-b border-border p-4">
        <div className="flex items-start gap-2">
          <span
            aria-hidden
            className="mt-1.5 size-2.5 shrink-0 rounded-full"
            style={{ background: selected.color }}
          />
          <h2 className="min-w-0 flex-1 break-words text-sm font-semibold">
            {selected.name}
          </h2>
          <button
            type="button"
            onClick={() => onSelect(null)}
            aria-label="Clear selection"
            className="-mr-1 shrink-0 rounded px-1.5 text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
          >
            ×
          </button>
        </div>
        <p className="mt-2 font-mono text-[11px] text-muted">
          {selected.file
            ? `${selected.file}${selected.loc ? `:${selected.loc}` : ""}`
            : "no source location"}
        </p>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <dl className="space-y-2 text-xs">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Kind</dt>
            <dd className="font-mono">{selected.kind}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Community</dt>
            <dd className="truncate">{selected.communityName}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Degree</dt>
            <dd className="font-mono">
              {selected.val}
              <span className="text-muted">
                {" "}
                ({entry.in.length} in / {entry.out.length} out)
              </span>
            </dd>
          </div>
        </dl>

        <div className="space-y-2 text-xs">
          <div>
            <span className="text-muted">Outgoing</span>{" "}
            <RelationCounts relations={entry.out.map((l) => l.relation)} />
          </div>
          <div>
            <span className="text-muted">Incoming</span>{" "}
            <RelationCounts relations={entry.in.map((l) => l.relation)} />
          </div>
        </div>

        <NeighborList
          title="Depends on"
          entries={entry.out}
          nodesById={nodesById}
          onSelect={onSelect}
        />
        <NeighborList
          title="Used by"
          entries={entry.in}
          nodesById={nodesById}
          onSelect={onSelect}
        />
      </div>
    </aside>
  );
}
