/**
 * Normalizes a graphify `graph.json` (graphology-style) into the shape
 * react-force-graph expects.
 *
 * graphify is actively developed, so every field is read defensively: key
 * aliases are accepted, missing fields fall back to documented defaults, and
 * anything unusable is dropped rather than allowed to reach the renderer.
 * The tests in graphLoader.test.ts are the tripwire for format drift.
 */

/** Node colors, indexed by community id. Sixteen hues that stay distinct on a dark canvas. */
export const COMMUNITY_PALETTE = [
  "#60a5fa", // blue
  "#f472b6", // pink
  "#34d399", // emerald
  "#fbbf24", // amber
  "#a78bfa", // violet
  "#fb7185", // rose
  "#22d3ee", // cyan
  "#a3e635", // lime
  "#fb923c", // orange
  "#818cf8", // indigo
  "#2dd4bf", // teal
  "#e879f9", // fuchsia
  "#facc15", // yellow
  "#4ade80", // green
  "#f87171", // red
  "#93c5fd", // light blue
] as const;

export interface GraphNode {
  id: string;
  /** Display label; falls back to the id. */
  name: string;
  /** Node size input for react-force-graph: in+out degree. */
  val: number;
  community: number;
  communityName: string;
  /** graphify's `type` (module, class, function, ...); "unknown" when absent. */
  kind: string;
  file: string;
  loc: string;
  color: string;
}

export interface GraphLink {
  source: string;
  target: string;
  relation: string;
  confidence: string;
}

export interface GraphStats {
  nodes: number;
  links: number;
  communities: number;
  /** Short commit the graph was built from; empty when graphify omitted it. */
  commit: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  stats: GraphStats;
}

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads a string field, tolerating numbers and treating blanks as absent. */
function str(source: Raw, key: string): string | undefined {
  const value = source[key];
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function num(source: Raw, key: string): number | undefined {
  const value = source[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** Link endpoints may arrive as bare ids or as `{ id }` objects once a graph has been simulated. */
function endpoint(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (isRecord(value)) return str(value, "id") ?? str(value, "nodeId");
  return undefined;
}

export function paletteForCommunity(community: number): string {
  const size = COMMUNITY_PALETTE.length;
  const safe = Number.isFinite(community) ? Math.trunc(community) : 0;
  // `%` keeps the sign in JS, so shift negatives back into range.
  return COMMUNITY_PALETTE[((safe % size) + size) % size];
}

export function loadGraph(json: string): GraphData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("That file is not valid JSON.");
  }

  if (!isRecord(parsed)) {
    throw new Error("Expected a graph object at the top level of the JSON.");
  }

  const rawNodes = parsed.nodes;
  if (!Array.isArray(rawNodes)) {
    throw new Error(
      "This does not look like a graphify graph: no `nodes` array found.",
    );
  }

  const nodes: GraphNode[] = [];
  const byId = new Map<string, GraphNode>();

  for (const entry of rawNodes) {
    if (!isRecord(entry)) continue;
    const id = str(entry, "id") ?? str(entry, "nodeId");
    if (!id || byId.has(id)) continue; // first definition of an id wins

    const community = num(entry, "community") ?? 0;
    const node: GraphNode = {
      id,
      name: str(entry, "label") ?? id,
      val: 0, // filled in from link degree below
      community,
      communityName: str(entry, "community_name") ?? `Community ${community}`,
      kind: str(entry, "type") ?? "unknown",
      file: str(entry, "source_file") ?? "",
      loc: str(entry, "source_location") ?? "",
      color: paletteForCommunity(community),
    };
    nodes.push(node);
    byId.set(id, node);
  }

  if (nodes.length === 0) {
    throw new Error("This graph has no nodes to display.");
  }

  // graphify writes `links`; older/other exports use `edges`.
  const rawLinks = Array.isArray(parsed.links)
    ? parsed.links
    : Array.isArray(parsed.edges)
      ? parsed.edges
      : [];

  const links: GraphLink[] = [];
  for (const entry of rawLinks) {
    if (!isRecord(entry)) continue;
    const source = endpoint(entry.source);
    const target = endpoint(entry.target);
    if (!source || !target) continue;

    const sourceNode = byId.get(source);
    const targetNode = byId.get(target);
    // react-force-graph throws on links into nodes it does not have.
    if (!sourceNode || !targetNode) continue;

    links.push({
      source,
      target,
      relation: str(entry, "relation") ?? "unknown",
      confidence: str(entry, "confidence") ?? "EXTRACTED",
    });
    sourceNode.val += 1;
    targetNode.val += 1;
  }

  const commit = str(parsed, "built_at_commit") ?? "";

  return {
    nodes,
    links,
    stats: {
      nodes: nodes.length,
      links: links.length,
      communities: new Set(nodes.map((n) => n.community)).size,
      commit: commit.slice(0, 8),
    },
  };
}
