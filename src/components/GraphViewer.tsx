"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { adjacencyFor, type Adjacency } from "@/lib/adjacency";
import type { GraphData, GraphLink, GraphNode } from "@/lib/graphLoader";

/**
 * react-force-graph reaches for `window` at import time, so it can never be
 * server-rendered. `ssr: false` keeps it out of the server bundle entirely.
 *
 * The per-renderer packages are imported rather than the `react-force-graph`
 * umbrella: the umbrella also pulls in the AR/VR builds, which throw
 * "AFRAME is not defined" in dev, where nothing is tree-shaken.
 */
const ForceGraph2D = dynamic(
  () =>
    import("react-force-graph-2d").then(
      (mod) => mod.default as unknown as ComponentType<ForceGraph2DProps>,
    ),
  { ssr: false },
);

/**
 * The simulation writes coordinates onto the node objects we hand it and
 * swaps each link's string endpoints for live node references.
 */
type SimNode = GraphNode & { x?: number; y?: number };
type SimLink = Omit<GraphLink, "source" | "target"> & {
  source: string | SimNode;
  target: string | SimNode;
};

/**
 * Hand-written props covering only what this viewer uses. The library's own
 * generic signature does not survive `next/dynamic`, and a narrow local
 * interface type-checks our call sites better than `any` would.
 */
interface ForceGraph2DProps {
  ref?: React.RefObject<ForceGraphHandle | undefined>;
  graphData: { nodes: GraphNode[]; links: GraphLink[] };
  width?: number;
  height?: number;
  backgroundColor?: string;
  nodeRelSize?: number;
  nodeVal?: (node: SimNode) => number;
  nodeLabel?: (node: SimNode) => string;
  nodeColor?: (node: SimNode) => string;
  nodeCanvasObjectMode?: (node: SimNode) => "before" | "after" | "replace";
  nodeCanvasObject?: (
    node: SimNode,
    ctx: CanvasRenderingContext2D,
    globalScale: number,
  ) => void;
  linkColor?: (link: SimLink) => string;
  linkWidth?: (link: SimLink) => number;
  linkLineDash?: (link: SimLink) => number[] | null;
  linkDirectionalArrowLength?: (link: SimLink) => number;
  linkDirectionalArrowRelPos?: number;
  onNodeClick?: (node: SimNode) => void;
  onNodeHover?: (node: SimNode | null) => void;
  onEngineStop?: () => void;
  cooldownTime?: number;
  minZoom?: number;
  maxZoom?: number;
}

interface ForceGraphHandle {
  zoomToFit: (ms?: number, padding?: number) => void;
}

/** Endpoints are strings before the first simulation tick and objects after. */
function endId(value: string | SimNode): string {
  return typeof value === "string" ? value : value.id;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** `#rrggbb` -> `rgba(r,g,b,alpha)`, for dimming without a second palette. */
function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const LINK_BASE = "rgba(140, 140, 165, 0.18)";
const LINK_ACTIVE = "rgba(226, 232, 240, 0.85)";
const LINK_MUTED = "rgba(140, 140, 165, 0.05)";

export interface GraphViewerProps {
  data: GraphData;
  adjacency: Adjacency;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export default function GraphViewer({
  data,
  adjacency,
  selectedId,
  onSelect,
}: GraphViewerProps) {
  const graphRef = useRef<ForceGraphHandle | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null);

  // ForceGraph2D takes explicit pixel dimensions rather than filling its parent.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /**
   * The simulation mutates this object in place, so it must stay referentially
   * stable across renders — a fresh object would restart the layout on every
   * hover.
   */
  const graphData = useMemo(
    () => ({ nodes: data.nodes, links: data.links }),
    [data],
  );

  // Hover wins over selection so the graph stays responsive while exploring.
  const focusId = hoverId ?? selectedId;
  const highlighted = useMemo(() => {
    if (!focusId) return null;
    const ids = new Set(adjacencyFor(adjacency, focusId).neighbors);
    ids.add(focusId);
    return ids;
  }, [adjacency, focusId]);

  const nodeColor = useCallback(
    (node: SimNode) => {
      if (!highlighted) return node.color;
      return highlighted.has(node.id) ? node.color : withAlpha(node.color, 0.12);
    },
    [highlighted],
  );

  const linkColor = useCallback(
    (link: SimLink) => {
      if (!focusId) return LINK_BASE;
      const touchesFocus =
        endId(link.source) === focusId || endId(link.target) === focusId;
      return touchesFocus ? LINK_ACTIVE : LINK_MUTED;
    },
    [focusId],
  );

  const linkWidth = useCallback(
    (link: SimLink) => {
      if (!focusId) return 0.6;
      const touchesFocus =
        endId(link.source) === focusId || endId(link.target) === focusId;
      return touchesFocus ? 1.6 : 0.4;
    },
    [focusId],
  );

  // INFERRED edges are graphify's best guess rather than a parsed fact.
  const linkLineDash = useCallback(
    (link: SimLink) => (link.confidence === "INFERRED" ? [3, 3] : null),
    [],
  );

  const linkArrowLength = useCallback(
    (link: SimLink) => {
      if (!focusId) return 0;
      const touchesFocus =
        endId(link.source) === focusId || endId(link.target) === focusId;
      return touchesFocus ? 4 : 0;
    },
    [focusId],
  );

  const nodeLabel = useCallback((node: SimNode) => {
    const where = node.file
      ? `${escapeHtml(node.file)}${node.loc ? `:${escapeHtml(node.loc)}` : ""}`
      : "no source location";
    return `
      <div style="
        background:#16161d;border:1px solid #26262f;border-radius:8px;
        padding:6px 9px;font-family:var(--font-geist-sans),sans-serif;
        font-size:12px;color:#e8e8ee;box-shadow:0 6px 20px rgba(0,0,0,.45)
      ">
        <div style="font-weight:600">${escapeHtml(node.name)}</div>
        <div style="color:#8b8b9a;font-size:11px;margin-top:2px">${where}</div>
      </div>`;
  }, []);

  // Only label the focused neighborhood; 398 permanent labels is unreadable.
  const nodeCanvasObjectMode = useCallback(
    (node: SimNode) =>
      highlighted?.has(node.id) ? ("after" as const) : ("before" as const),
    [highlighted],
  );

  const nodeCanvasObject = useCallback(
    (node: SimNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      if (!highlighted?.has(node.id)) return;
      if (node.x === undefined || node.y === undefined) return;

      const fontSize = Math.max(10 / globalScale, 2.5);
      const radius = Math.sqrt(node.val + 1) * 3;
      ctx.font = `${fontSize}px var(--font-geist-sans), sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = node.id === focusId ? "#ffffff" : "#c8c8d4";
      ctx.fillText(node.name, node.x, node.y + radius + 1.5 / globalScale);
    },
    [focusId, highlighted],
  );

  const handleHover = useCallback(
    (node: SimNode | null) => setHoverId(node?.id ?? null),
    [],
  );

  const handleClick = useCallback(
    (node: SimNode) => onSelect(node.id),
    [onSelect],
  );

  /**
   * Frame the graph once per loaded dataset. The first fit runs when the
   * simulation settles; a second pass follows because nodes drift slightly
   * during the fit animation itself, leaving the first framing too loose.
   * Guarded by a ref so later engine stops never yank a user's own zoom.
   */
  const hasFitRef = useRef(false);
  useEffect(() => {
    hasFitRef.current = false;
  }, [data]);

  const handleEngineStop = useCallback(() => {
    if (hasFitRef.current) return;
    hasFitRef.current = true;
    graphRef.current?.zoomToFit(400, 60);
    window.setTimeout(() => graphRef.current?.zoomToFit(250, 60), 500);
  }, []);

  return (
    <div ref={containerRef} className="h-full w-full">
      {size.width > 0 && size.height > 0 && (
        <ForceGraph2D
          ref={graphRef}
          graphData={graphData}
          width={size.width}
          height={size.height}
          backgroundColor="#08080b"
          nodeRelSize={3}
          nodeVal={(node) => node.val + 1}
          nodeColor={nodeColor}
          nodeLabel={nodeLabel}
          nodeCanvasObjectMode={nodeCanvasObjectMode}
          nodeCanvasObject={nodeCanvasObject}
          linkColor={linkColor}
          linkWidth={linkWidth}
          linkLineDash={linkLineDash}
          linkDirectionalArrowLength={linkArrowLength}
          linkDirectionalArrowRelPos={1}
          onNodeHover={handleHover}
          onNodeClick={handleClick}
          onEngineStop={handleEngineStop}
          // Default is 15s, which delays the initial zoom-to-fit far too long.
          // A few hundred nodes settle well inside 4s.
          cooldownTime={4000}
          minZoom={0.05}
          maxZoom={40}
        />
      )}
    </div>
  );
}
