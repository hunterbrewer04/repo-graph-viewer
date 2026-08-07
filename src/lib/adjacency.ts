import type { GraphData } from "./graphLoader";

/** One edge as seen from a node: who is at the other end, and how. */
export interface AdjacencyEdge {
  /** Id of the node at the far end of the link. */
  id: string;
  relation: string;
  confidence: string;
}

export interface NodeAdjacency {
  /** Edges where this node is the source (what it depends on). */
  out: AdjacencyEdge[];
  /** Edges where this node is the target (what depends on it). */
  in: AdjacencyEdge[];
  /** Ids of every node one hop away, in either direction. */
  neighbors: Set<string>;
}

export type Adjacency = Map<string, NodeAdjacency>;

/**
 * Indexes a graph's links by node id so the detail panel and hover highlight
 * can answer "who touches this node?" without rescanning every link.
 *
 * Endpoints are copied out as plain ids rather than kept as link references:
 * react-force-graph rewrites each link's `source`/`target` into live node
 * objects once the simulation starts, which would corrupt a stored reference.
 */
export function buildAdjacency(data: GraphData): Adjacency {
  const index: Adjacency = new Map();
  for (const node of data.nodes) {
    index.set(node.id, { out: [], in: [], neighbors: new Set() });
  }

  for (const link of data.links) {
    const source = index.get(link.source);
    const target = index.get(link.target);
    if (!source || !target) continue;

    const shared = { relation: link.relation, confidence: link.confidence };
    source.out.push({ id: link.target, ...shared });
    target.in.push({ id: link.source, ...shared });
    // A self-loop leaves the node in its own neighbor set, which is what the
    // highlight wants anyway.
    source.neighbors.add(link.target);
    target.neighbors.add(link.source);
  }

  return index;
}

const EMPTY: NodeAdjacency = { out: [], in: [], neighbors: new Set() };

/** Adjacency for a node, or an empty record for an unknown/unselected id. */
export function adjacencyFor(
  index: Adjacency,
  id: string | null | undefined,
): NodeAdjacency {
  return (id && index.get(id)) || EMPTY;
}
