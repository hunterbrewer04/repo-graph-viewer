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
 * "AFRAME is not defined" in dev, where nothing is tree-shaken. Importing them
 * separately also means the Three.js bundle only downloads if 3D is opened.
 */
const ForceGraph2D = dynamic(
  () =>
    import("react-force-graph-2d").then(
      (mod) => mod.default as unknown as ComponentType<ForceGraph2DProps>,
    ),
  { ssr: false },
);

const ForceGraph3D = dynamic(
  () =>
    import("react-force-graph-3d").then(
      (mod) => mod.default as unknown as ComponentType<ForceGraph3DProps>,
    ),
  { ssr: false },
);

export type ViewMode = "2d" | "3d";

/**
 * The simulation writes coordinates onto the node objects we hand it and
 * swaps each link's string endpoints for live node references.
 */
type SimNode = GraphNode & { x?: number; y?: number; z?: number };
type SimLink = Omit<GraphLink, "source" | "target"> & {
  source: string | SimNode;
  target: string | SimNode;
};

/** Props shared by both renderers. */
interface ForceGraphSharedProps {
  graphData: { nodes: GraphNode[]; links: GraphLink[] };
  width?: number;
  height?: number;
  backgroundColor?: string;
  nodeRelSize?: number;
  nodeVal?: (node: SimNode) => number;
  nodeLabel?: (node: SimNode) => string;
  nodeColor?: (node: SimNode) => string;
  linkColor?: (link: SimLink) => string;
  linkWidth?: (link: SimLink) => number;
  linkDirectionalArrowLength?: (link: SimLink) => number;
  linkDirectionalArrowRelPos?: number;
  onNodeClick?: (node: SimNode) => void;
  onNodeHover?: (node: SimNode | null) => void;
  onBackgroundClick?: () => void;
  onEngineStop?: () => void;
  cooldownTime?: number;
}

/**
 * Hand-written props covering only what this viewer uses. The libraries' own
 * generic signatures do not survive `next/dynamic`, and narrow local
 * interfaces type-check our call sites better than `any` would.
 */
interface ForceGraph2DProps extends ForceGraphSharedProps {
  ref?: React.RefObject<ForceGraph2DHandle | undefined>;
  nodeCanvasObjectMode?: (node: SimNode) => "before" | "after" | "replace";
  nodeCanvasObject?: (
    node: SimNode,
    ctx: CanvasRenderingContext2D,
    globalScale: number,
  ) => void;
  linkLineDash?: (link: SimLink) => number[] | null;
  minZoom?: number;
  maxZoom?: number;
}

interface ForceGraph3DProps extends ForceGraphSharedProps {
  ref?: React.RefObject<ForceGraph3DHandle | undefined>;
  nodeOpacity?: number;
  nodeResolution?: number;
  linkOpacity?: number;
  showNavInfo?: boolean;
  controlType?: "trackball" | "orbit" | "fly";
}

interface ForceGraph2DHandle {
  zoomToFit: (ms?: number, padding?: number) => void;
}

interface ForceGraph3DHandle {
  zoomToFit: (ms?: number, padding?: number) => void;
  controls: () => unknown;
}

/** The slice of Three's OrbitControls this component drives. */
interface OrbitLike {
  autoRotate: boolean;
  autoRotateSpeed: number;
}

function isOrbitLike(value: unknown): value is OrbitLike {
  return typeof value === "object" && value !== null && "autoRotate" in value;
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

/**
 * `#rrggbb` -> `rgba(r,g,b,alpha)`, for dimming without a second palette.
 * Both renderers understand rgba: the 3D one splits the alpha out onto the
 * material rather than the color.
 */
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
const BACKGROUND = "#08080b";

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
  const graph2dRef = useRef<ForceGraph2DHandle | undefined>(undefined);
  const graph3dRef = useRef<ForceGraph3DHandle | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>("2d");
  const [autoRotate, setAutoRotate] = useState(true);
  const [query, setQuery] = useState("");

  /** Kinds present in this graph, most common first, for the legend. */
  const kinds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of data.nodes) {
      counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  // Both renderers take explicit pixel dimensions rather than filling a parent.
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = !!target?.closest(
        "input, textarea, [contenteditable='true']",
      );

      // Escape backs out of whatever is narrowing the view, even while typing.
      if (event.key === "Escape") {
        setQuery("");
        onSelect(null);
        if (typing) target?.blur();
        return;
      }

      // `G` toggles dimension, but must not eat a `g` typed into the search box.
      if (event.key !== "g" && event.key !== "G") return;
      if (event.metaKey || event.ctrlKey || event.altKey || typing) return;
      setMode((current) => (current === "2d" ? "3d" : "2d"));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onSelect]);

  /**
   * OrbitControls exposes auto-rotate, TrackballControls (the 3D default) does
   * not — hence `controlType="orbit"`. The controls object only exists once the
   * lazily-loaded renderer has mounted, so retry across frames until it does.
   */
  useEffect(() => {
    if (mode !== "3d") return;
    let frame = 0;
    const apply = () => {
      const controls = graph3dRef.current?.controls();
      if (isOrbitLike(controls)) {
        controls.autoRotate = autoRotate;
        controls.autoRotateSpeed = 0.55;
        return;
      }
      frame = requestAnimationFrame(apply);
    };
    apply();
    return () => cancelAnimationFrame(frame);
  }, [mode, autoRotate]);

  /**
   * The simulation mutates this object in place, so it must stay referentially
   * stable across renders — a fresh object would restart the layout on every
   * hover.
   */
  const graphData = useMemo(
    () => ({ nodes: data.nodes, links: data.links }),
    [data],
  );

  /** Nodes whose label contains the query. Null when the box is empty. */
  const matched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return null;
    return new Set(
      data.nodes
        .filter((node) => node.name.toLowerCase().includes(needle))
        .map((node) => node.id),
    );
  }, [data, query]);

  // Hover wins over selection so the graph stays responsive while exploring.
  const focusId = hoverId ?? selectedId;

  /**
   * Which nodes stay at full brightness. A hovered or selected node takes
   * precedence over the search, since it is the more specific intent.
   */
  const highlighted = useMemo(() => {
    if (focusId) {
      const ids = new Set(adjacencyFor(adjacency, focusId).neighbors);
      ids.add(focusId);
      return ids;
    }
    if (!matched) return null;
    // Matches alone read as disconnected dots, so keep their neighbors lit too.
    const ids = new Set(matched);
    for (const id of matched) {
      for (const neighbor of adjacencyFor(adjacency, id).neighbors) {
        ids.add(neighbor);
      }
    }
    return ids;
  }, [adjacency, focusId, matched]);

  const touchesFocus = useCallback(
    (link: SimLink) =>
      !!focusId &&
      (endId(link.source) === focusId || endId(link.target) === focusId),
    [focusId],
  );

  const touchesMatch = useCallback(
    (link: SimLink) =>
      !!matched &&
      (matched.has(endId(link.source)) || matched.has(endId(link.target))),
    [matched],
  );

  /**
   * 3D dims less: its spheres are Lambert-shaded, so lighting already darkens
   * them well below the flat 2D circles at the same alpha.
   */
  const dimAlpha = mode === "3d" ? 0.2 : 0.1;

  const nodeColor = useCallback(
    (node: SimNode) => {
      if (!highlighted) return node.color;
      return highlighted.has(node.id)
        ? node.color
        : withAlpha(node.color, dimAlpha);
    },
    [dimAlpha, highlighted],
  );

  const linkColor = useCallback(
    (link: SimLink) => {
      if (focusId) return touchesFocus(link) ? LINK_ACTIVE : LINK_MUTED;
      if (matched) return touchesMatch(link) ? LINK_ACTIVE : LINK_MUTED;
      return LINK_BASE;
    },
    [focusId, matched, touchesFocus, touchesMatch],
  );

  const linkWidth = useCallback(
    (link: SimLink) => {
      if (focusId) return touchesFocus(link) ? 1.6 : 0.4;
      if (matched) return touchesMatch(link) ? 1.2 : 0.4;
      return 0.6;
    },
    [focusId, matched, touchesFocus, touchesMatch],
  );

  // INFERRED edges are graphify's best guess rather than a parsed fact.
  const linkLineDash = useCallback(
    (link: SimLink) => (link.confidence === "INFERRED" ? [3, 3] : null),
    [],
  );

  const linkArrowLength = useCallback(
    (link: SimLink) => (focusId && touchesFocus(link) ? 4 : 0),
    [focusId, touchesFocus],
  );

  const nodeVal = useCallback((node: SimNode) => node.val + 1, []);

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

  const handleBackgroundClick = useCallback(() => onSelect(null), [onSelect]);

  /**
   * Frame the graph once per loaded dataset and per dimension switch. The first
   * fit runs when the simulation settles; a second pass follows because nodes
   * drift during the fit animation, leaving the first framing too loose.
   * Guarded by a ref so later engine stops never yank a user's own camera.
   */
  const hasFitRef = useRef(false);
  useEffect(() => {
    hasFitRef.current = false;
  }, [data, mode]);

  const handleEngineStop = useCallback(() => {
    if (hasFitRef.current) return;
    hasFitRef.current = true;
    // 3D fits a bounding sphere rather than a box, so the same padding leaves
    // noticeably more dead space than in 2D.
    const padding = mode === "2d" ? 60 : 25;
    const handle = mode === "2d" ? graph2dRef.current : graph3dRef.current;
    handle?.zoomToFit(400, padding);
    window.setTimeout(() => handle?.zoomToFit(250, padding), 500);
  }, [mode]);

  const ready = size.width > 0 && size.height > 0;

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {ready && mode === "2d" && (
        <ForceGraph2D
          ref={graph2dRef}
          graphData={graphData}
          width={size.width}
          height={size.height}
          backgroundColor={BACKGROUND}
          nodeRelSize={3}
          nodeVal={nodeVal}
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
          onBackgroundClick={handleBackgroundClick}
          onEngineStop={handleEngineStop}
          // Default is 15s, which delays the initial zoom-to-fit far too long.
          // A few hundred nodes settle well inside 4s.
          cooldownTime={4000}
          minZoom={0.05}
          maxZoom={40}
        />
      )}

      {ready && mode === "3d" && (
        <ForceGraph3D
          ref={graph3dRef}
          graphData={graphData}
          width={size.width}
          height={size.height}
          backgroundColor={BACKGROUND}
          nodeRelSize={3}
          nodeVal={nodeVal}
          nodeColor={nodeColor}
          nodeLabel={nodeLabel}
          // Both are multiplied by the color's own alpha, so keep them at 1 and
          // let the rgba values above be the single source of truth.
          nodeOpacity={1}
          nodeResolution={12}
          linkColor={linkColor}
          linkWidth={linkWidth}
          linkOpacity={1}
          linkDirectionalArrowLength={linkArrowLength}
          linkDirectionalArrowRelPos={1}
          onNodeHover={handleHover}
          onNodeClick={handleClick}
          onBackgroundClick={handleBackgroundClick}
          onEngineStop={handleEngineStop}
          cooldownTime={4000}
          controlType="orbit"
          showNavInfo={false}
        />
      )}

      <div className="pointer-events-none absolute left-4 top-4 flex max-w-[min(22rem,50%)] flex-col items-start gap-2">
        <div className="pointer-events-auto relative">
          {/* Deliberately type="text": the native search clear button would
              sit on top of the match count, and Escape already clears. */}
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search nodes…"
            aria-label="Search nodes"
            className="w-56 rounded-md border border-border bg-surface/90 py-1.5 pl-2.5 pr-9 text-[11px] text-foreground placeholder:text-muted outline-none backdrop-blur focus:border-accent"
          />
          {matched && (
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-[10px] text-muted">
              {matched.size}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-1">
          {kinds.map(([kind, count]) => (
            <span
              key={kind}
              className="rounded border border-border bg-surface/90 px-1.5 py-0.5 font-mono text-[10px] text-muted backdrop-blur"
            >
              {kind} <span className="text-foreground/70">{count}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="pointer-events-none absolute right-4 top-4 flex items-center gap-2">
        {mode === "3d" && (
          <label className="pointer-events-auto flex cursor-pointer select-none items-center gap-1.5 rounded-md border border-border bg-surface/90 px-2.5 py-1.5 text-[11px] text-muted backdrop-blur transition-colors hover:text-foreground">
            <input
              type="checkbox"
              checked={autoRotate}
              onChange={(event) => setAutoRotate(event.target.checked)}
              className="size-3 accent-accent"
            />
            Auto-rotate
          </label>
        )}

        <div
          role="group"
          aria-label="View mode"
          className="pointer-events-auto flex overflow-hidden rounded-md border border-border bg-surface/90 backdrop-blur"
          title="Toggle 2D / 3D (G)"
        >
          {(["2d", "3d"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setMode(option)}
              aria-pressed={mode === option}
              className={`px-3 py-1.5 text-[11px] font-medium uppercase transition-colors ${
                mode === option
                  ? "bg-surface-raised text-foreground"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
