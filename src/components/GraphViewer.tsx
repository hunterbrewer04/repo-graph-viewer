"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { adjacencyFor, type Adjacency } from "@/lib/adjacency";
import CommunityLegend from "@/components/CommunityLegend";
import SearchBox, { type SearchResult } from "@/components/SearchBox";
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
  nodeThreeObject?: (node: SimNode) => unknown;
  linkOpacity?: number;
  showNavInfo?: boolean;
  controlType?: "trackball" | "orbit" | "fly";
}

interface ForceGraph2DHandle {
  zoomToFit: (ms?: number, padding?: number) => void;
  centerAt: (x?: number, y?: number, ms?: number) => void;
  /** Setter form animates to `k`; bare getter returns the current zoom. */
  zoom: {
    (): number;
    (k?: number, ms?: number): void;
  };
}

interface ForceGraph3DHandle {
  zoomToFit: (ms?: number, padding?: number) => void;
  controls: () => unknown;
  /** Signature verified against the installed react-force-graph-3d .d.ts. */
  cameraPosition: (
    position: Vec3Like,
    lookAt?: Vec3Like,
    transitionMs?: number,
  ) => void;
}

/** A minimal slice of THREE.Vector3. */
interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** The slice of Three's OrbitControls this component drives. */
interface OrbitLike {
  autoRotate: boolean;
  autoRotateSpeed: number;
  /** OrbitControls keeps the camera on `object` and the pivot on `target`. */
  object?: { position: Vec3Like };
  target?: Vec3Like;
}

function isOrbitLike(value: unknown): value is OrbitLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "autoRotate" in value &&
    "target" in value &&
    "object" in value
  );
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
/** Fully transparent: the CSS .graph-backdrop behind the canvas IS the bg. */
const BACKGROUND = "rgba(0,0,0,0)";

/*
 * Shared Three.js resources for the sprite-halo glow. Everything expensive is
 * allocated exactly once at module level — one sphere geometry, one radial
 * glow texture, and per-color material caches (≤16 entries, the palette size).
 * `nodeThreeObject` below reuses these instead of allocating per node.
 */
let sphereGeo: THREE.SphereGeometry | undefined;
function getSphereGeo(): THREE.SphereGeometry {
  return (sphereGeo ??= new THREE.SphereGeometry(1, 12, 8)); // matches nodeResolution={12}
}

const meshMats = new Map<string, THREE.MeshLambertMaterial>();
function getMeshMat(color: string): THREE.MeshLambertMaterial {
  let m = meshMats.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color });
    meshMats.set(color, m);
  }
  return m;
}

let glowTex: THREE.CanvasTexture | undefined;
function getGlowTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(0.25, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

const glowMats = new Map<string, THREE.SpriteMaterial>();
function getGlowMat(color: string): THREE.SpriteMaterial {
  let m = glowMats.get(color);
  if (!m) {
    m = new THREE.SpriteMaterial({
      map: getGlowTexture(),
      color,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.55,
    });
    glowMats.set(color, m);
  }
  return m;
}

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
  const [activeResult, setActiveResult] = useState<number | null>(null);
  /**
   * Explicit "fly the camera to this node" signal. `nonce` increments so
   * re-picking the SAME node re-triggers the effect (a bare id would not).
   */
  const [focusRequest, setFocusRequest] = useState<{
    id: string;
    nonce: number;
  } | null>(null);
  const searchInputRef = useRef<HTMLInputElement | undefined>(undefined);

  /** Kinds present in this graph, most common first, for the legend. */
  const kinds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of data.nodes) {
      counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  /** Communities present, largest first, for CommunityLegend. */
  const communities = useMemo(() => {
    const counts = new Map<number, { name: string; count: number }>();
    for (const node of data.nodes) {
      const hit = counts.get(node.community);
      if (hit) hit.count += 1;
      else counts.set(node.community, { name: node.communityName, count: 1 });
    }
    return [...counts.entries()]
      .map(([community, { name, count }]) => ({ community, name, count }))
      .sort((a, b) => b.count - a.count);
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

      // `/` focuses search, unless the keystroke belongs to a field already.
      if (event.key === "/") {
        if (event.metaKey || event.ctrlKey || event.altKey || typing) return;
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
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
   * Frame the graph once per loaded dataset and per dimension switch. The intro
   * runs when the simulation settles; a second pass follows because nodes
   * drift during the fit animation, leaving the first framing too loose.
   * Guarded by a ref so later engine stops never yank a user's own camera.
   */
  const hasFitRef = useRef(false);
  useEffect(() => {
    hasFitRef.current = false;
    dollyParkedRef.current = false;
  }, [data, mode]);

  /**
   * OrbitControls exposes auto-rotate, TrackballControls (the 3D default) does
   * not — hence `controlType="orbit"`. The controls object only exists once the
   * lazily-loaded renderer has mounted, so retry across frames until it does.
   *
   * On the first pass for a fresh graph/mode, park the orbit camera at 2.2× its
   * distance-to-target so the post-settle `zoomToFit` becomes a dolly-in. The
   * park happens exactly once (before `onEngineStop` can fire) and auto-rotate
   * stays off during the intro; once the fit has landed (`hasFitRef` true),
   * this effect adopts the live toggle so later prop changes take effect.
   */
  const dollyParkedRef = useRef(false);
  useEffect(() => {
    if (mode !== "3d") return;
    let frame = 0;
    const apply = () => {
      const controls = graph3dRef.current?.controls();
      if (isOrbitLike(controls)) {
        if (
          !hasFitRef.current &&
          !dollyParkedRef.current &&
          controls.target &&
          controls.object
        ) {
          const { x, y, z } = controls.target;
          const position = controls.object.position;
          const dx = position.x - x;
          const dy = position.y - y;
          const dz = position.z - z;
          const scale = Math.hypot(dx, dy, dz);
          if (scale > 0) {
            // Park along the current view axis at 2.2× the distance.
            position.x = x + dx * 2.2;
            position.y = y + dy * 2.2;
            position.z = z + dz * 2.2;
          }
          dollyParkedRef.current = true;
        }
        // During the intro (fit not yet landed) auto-rotate stays off so the
        // dolly-in reads cleanly; afterwards adopt the live toggle so user
        // changes re-run through this effect and take effect immediately.
        controls.autoRotate = hasFitRef.current ? autoRotate : false;
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

  /** id -> node, for resolving the `matched` set into dropdown rows. */
  const nodesById = useMemo(
    () => new Map(data.nodes.map((node) => [node.id, node])),
    [data],
  );

  /**
   * Dropdown rows: capped at 8, shortest names first so "Serve" outranks
   * "ServeTests" for a "serve" query. The full match count still feeds the
   * badge and the `+N more` footer.
   */
  const searchResults = useMemo<SearchResult[]>(() => {
    if (!matched) return [];
    return [...matched]
      .map((id) => nodesById.get(id))
      .filter((node): node is GraphNode => node !== undefined)
      .sort((a, b) => a.name.length - b.name.length)
      .slice(0, 8)
      .map(({ id, name, kind, color }) => ({ id, name, kind, color }));
  }, [matched, nodesById]);

  /**
   * Picking a result selects the node through the ONE canonical selection
   * path (`onSelect` — page.tsx owns selectedId; DetailPanel and the hover
   * machinery react automatically), clears the query (selection highlight
   * supersedes match dimming anyway), and fires the camera fly-to. The input
   * is blurred so `/`-then-type flows stay snappy on the next round.
   */
  const pickResult = useCallback(
    (result: SearchResult) => {
      onSelect(result.id);
      setQuery("");
      setActiveResult(null);
      searchInputRef.current?.blur();
      setFocusRequest((prev) => ({
        id: result.id,
        nonce: (prev?.nonce ?? 0) + 1,
      }));
    },
    [onSelect],
  );

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

  /**
   * 3D node = core sphere + additive glow sprite. Reuses the shared geometry,
   * texture, and per-color material caches above; only the Group and two refs
   * are allocated per call. Radius formula mirrors the 2D painter's
   * `Math.sqrt(val + 1) * 3` scaled by nodeRelSize semantics.
   */
  const nodeThreeObject = useCallback(
    (node: SimNode) => {
      const group = new THREE.Group();
      const radius = Math.sqrt(node.val + 1) * 3;

      const core = new THREE.Mesh(getSphereGeo(), getMeshMat(node.color));
      core.scale.setScalar(radius);

      const halo = new THREE.Sprite(getGlowMat(node.color));
      const dimmed = !!highlighted && !highlighted.has(node.id);
      // Halo breathes with the core; dimmed nodes get a whisper of glow.
      halo.scale.setScalar(radius * (dimmed ? 2.2 : 4));
      group.add(core, halo);
      return group;
    },
    [highlighted],
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

      // Accent ring around the focused node (hover or selection) so the
      // fly-to target stays identifiable after the camera settles.
      if (node.id === focusId) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 3.5 / globalScale, 0, Math.PI * 2);
        ctx.strokeStyle = "#60a5fa"; // --accent
        ctx.lineWidth = 1.5 / globalScale;
        ctx.stroke();
      }
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
   * Cinematic intro per dimension, replacing the abrupt double snap. 2D glides
   * in via a slow zoomToFit tween; 3D dollies from the parked camera. A
   * correction pass follows because nodes drift during the fit animation, and
   * it also re-applies autoRotate now that the 3D dolly has landed.
   * Guarded by `hasFitRef` so later engine stops never yank a user's camera.
   */
  /**
   * The +700ms correction pass is cancellable: an explicit search focus ends
   * the intro's authority over the camera, so a pending correction must never
   * fire after it and yank the view back.
   */
  const fitCorrectionRef = useRef<number | null>(null);
  const handleEngineStop = useCallback(() => {
    if (hasFitRef.current) return;
    hasFitRef.current = true;
    // 3D fits a bounding sphere rather than a box, so the same padding leaves
    // noticeably more dead space than in 2D.
    const padding = mode === "2d" ? 60 : 25;
    const handle = mode === "2d" ? graph2dRef.current : graph3dRef.current;
    handle?.zoomToFit(mode === "2d" ? 1400 : 900, padding);
    fitCorrectionRef.current = window.setTimeout(() => {
      fitCorrectionRef.current = null;
      handle?.zoomToFit(300, padding);
      if (mode === "3d") {
        const controls = graph3dRef.current?.controls();
        if (isOrbitLike(controls)) controls.autoRotate = autoRotate;
      }
    }, 700);
  }, [autoRotate, mode]);

  /**
   * Camera fly-to on an explicit search focus. Retries via rAF until the
   * simulation has coordinates for the node (fresh loads may not yet), then:
   * - ends the intro's authority (`hasFitRef`), cancelling any pending
   *   correction pass so it can never snap the camera back afterwards;
   * - 2D: zooms IN only — `max(current, 2.4)` respects a user already deeper
   *   in — and retargets `centerAt` either way, over a ~0.75s glide;
   * - 3D: steps back from the node along the CURRENT camera→target axis,
   *   preserving the user's viewing direction, with distance clamped to
   *   [140, 420] world units. No jarring side-of-node snaps. autoRotate is
   *   left as the toggle holds it; orbiting around a focused node reads well
   *   and the controls-adoption effect reconciles state on its next run.
   *
   * Bounded retry (~120 frames): if a node never gains coordinates, bail
   * silently — the selection highlight still applied via pickResult.
   */
  useEffect(() => {
    if (!focusRequest) return;
    const { id } = focusRequest;
    let frame = 0;
    let attempts = 0;
    const attempt = () => {
      // `data.nodes` is typed without coordinates, but the simulation writes
      // them onto these same objects; view as SimNode to read them.
      const node = data.nodes.find((n) => n.id === id) as SimNode | undefined; // once-per-click; O(n) fine
      if (
        !node ||
        node.x === undefined ||
        node.y === undefined ||
        attempts++ > 120
      ) {
        frame = requestAnimationFrame(attempt);
        return;
      }
      // An explicit focus ends the intro's authority over the camera.
      hasFitRef.current = true;
      if (fitCorrectionRef.current !== null) {
        clearTimeout(fitCorrectionRef.current);
        fitCorrectionRef.current = null;
      }
      if (mode === "2d") {
        const handle = graph2dRef.current;
        if (!handle) return;
        const current = handle.zoom(); // getter form
        handle.zoom(Math.max(current, 2.4), 750); // closer, never out
        handle.centerAt(node.x, node.y, 750);
      } else {
        const handle = graph3dRef.current;
        if (!handle) return;
        const controls = handle.controls();
        let distance = 260;
        let position: Vec3Like | undefined;
        if (isOrbitLike(controls)) {
          if (controls.target && controls.object) {
            const p = controls.object.position;
            const t = controls.target;
            distance = Math.min(
              420,
              Math.max(
                140,
                Math.hypot(p.x - t.x, p.y - t.y, p.z - t.z),
              ),
            );
          }
          position = controls.object?.position;
        }
        // Preserve the user's viewing direction: step back from the node
        // along the current camera→target axis.
        const dir = (() => {
          if (!position) return { x: 0, y: 0, z: 1 };
          const len =
            Math.hypot(
              position.x - node.x!,
              position.y - node.y!,
              position.z - (node.z ?? 0),
            ) || 1;
          return {
            x: (position.x - node.x!) / len,
            y: (position.y - node.y!) / len,
            z: (position.z - (node.z ?? 0)) / len,
          };
        })();
        handle.cameraPosition(
          {
            x: node.x! + dir.x * distance,
            y: node.y! + dir.y * distance,
            z: (node.z ?? 0) + dir.z * distance,
          },
          { x: node.x!, y: node.y!, z: node.z ?? 0 },
          750,
        );
      }
    };
    attempt();
    return () => cancelAnimationFrame(frame);
  }, [focusRequest, data, mode]);


  const ready = size.width > 0 && size.height > 0;

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full"
      data-focus-active={focusRequest ? "true" : undefined}
    >
      {/* Ambient CSS backdrop sits behind the transparent canvases: earlier
          siblings render below the absolutely-positioned force-graph layers. */}
      <div aria-hidden className="graph-backdrop absolute inset-0" />
      <div aria-hidden className="graph-stars absolute inset-0 opacity-70" />

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
          nodeThreeObject={nodeThreeObject}
        />
      )}

      <div className="pointer-events-none absolute bottom-4 left-4 flex max-h-[calc(100%-8rem)] max-w-[min(16rem,50%)] flex-col items-start gap-2">
        {communities.length > 0 && (
          <div className="pointer-events-auto max-h-56 overflow-y-auto">
            <CommunityLegend entries={communities} />
          </div>
        )}

        {/* Kind chips: secondary legend row beneath the community colors. */}
        <div className="pointer-events-auto flex max-w-full flex-wrap gap-1 overflow-y-auto">
          {kinds.map(([kind, count]) => (
            <span
              key={kind}
              className="rounded border border-border bg-surface/90 px-1.5 py-0.5 font-mono text-[9px] text-muted backdrop-blur"
            >
              {kind} <span className="text-foreground/70">{count}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="pointer-events-none absolute left-4 top-4 flex max-w-[min(22rem,50%)] flex-col items-start gap-2">
        <div className="pointer-events-auto relative">
          <SearchBox
            value={query}
            results={searchResults}
            activeIndex={activeResult}
            inputRef={searchInputRef}
            totalMatches={matched?.size}
            onChange={setQuery}
            onPick={pickResult}
            onActiveIndexChange={setActiveResult}
          />
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
