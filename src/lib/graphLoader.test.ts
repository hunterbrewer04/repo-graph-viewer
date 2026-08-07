import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { COMMUNITY_PALETTE, loadGraph, paletteForCommunity } from "./graphLoader";

const REAL_CORPUS = readFileSync(
  join(process.cwd(), "public/graphs/apple-calendar-mcp.json"),
  "utf8",
);

/** Minimal graphify-shaped payload; override pieces per test. */
function fixture(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    directed: true,
    built_at_commit: "abc1234",
    nodes: [
      {
        id: "a",
        label: "Alpha",
        type: "module",
        source_file: "A.swift",
        source_location: "L1",
        community: 3,
        community_name: "Community 3",
      },
      { id: "b", label: "Beta", community: 3, community_name: "Community 3" },
      { id: "c", label: "Gamma", community: 7, community_name: "Community 7" },
    ],
    links: [
      { source: "a", target: "b", relation: "imports", confidence: "EXTRACTED" },
      { source: "b", target: "c", relation: "calls", confidence: "INFERRED" },
    ],
    ...overrides,
  });
}

describe("loadGraph — real corpus", () => {
  it("parses the apple-calendar-mcp graph into 398 nodes and 977 links", () => {
    const graph = loadGraph(REAL_CORPUS);
    expect(graph.nodes).toHaveLength(398);
    expect(graph.links).toHaveLength(977);
  });

  it("reports stats matching the corpus", () => {
    const { stats } = loadGraph(REAL_CORPUS);
    expect(stats.nodes).toBe(398);
    expect(stats.links).toBe(977);
    expect(stats.communities).toBe(13);
    expect(stats.commit).toBe("279a64b7");
  });

  it("assigns every node a kind, falling back to unknown", () => {
    const graph = loadGraph(REAL_CORPUS);
    expect(graph.nodes.every((n) => n.kind.length > 0)).toBe(true);
    // 388 of 398 nodes carry no `type` field in the real output.
    expect(graph.nodes.filter((n) => n.kind === "unknown")).toHaveLength(388);
    expect(graph.nodes.filter((n) => n.kind === "module")).toHaveLength(10);
  });

  it("leaves no link pointing at a missing node", () => {
    const graph = loadGraph(REAL_CORPUS);
    const ids = new Set(graph.nodes.map((n) => n.id));
    for (const link of graph.links) {
      expect(ids.has(link.source)).toBe(true);
      expect(ids.has(link.target)).toBe(true);
    }
  });
});

describe("loadGraph — node normalization", () => {
  it("maps label to name and carries file/location through", () => {
    const [alpha] = loadGraph(fixture()).nodes;
    expect(alpha.id).toBe("a");
    expect(alpha.name).toBe("Alpha");
    expect(alpha.kind).toBe("module");
    expect(alpha.file).toBe("A.swift");
    expect(alpha.loc).toBe("L1");
    expect(alpha.communityName).toBe("Community 3");
  });

  it("computes val as in+out degree", () => {
    const byId = Object.fromEntries(
      loadGraph(fixture()).nodes.map((n) => [n.id, n]),
    );
    expect(byId.a.val).toBe(1); // a->b
    expect(byId.b.val).toBe(2); // a->b, b->c
    expect(byId.c.val).toBe(1); // b->c
  });

  it("gives isolated nodes a degree of 0", () => {
    const graph = loadGraph(fixture({ links: [] }));
    expect(graph.nodes.map((n) => n.val)).toEqual([0, 0, 0]);
  });

  it("falls back to the id when label is missing", () => {
    const graph = loadGraph(
      fixture({ nodes: [{ id: "orphan" }], links: [] }),
    );
    expect(graph.nodes[0].name).toBe("orphan");
  });

  it("accepts nodeId as an alias for id", () => {
    const graph = loadGraph(
      fixture({ nodes: [{ nodeId: "aliased", label: "Aliased" }], links: [] }),
    );
    expect(graph.nodes[0].id).toBe("aliased");
  });

  it("drops nodes with no usable identifier", () => {
    const graph = loadGraph(
      fixture({ nodes: [{ label: "Nameless" }, { id: "keep" }], links: [] }),
    );
    expect(graph.nodes.map((n) => n.id)).toEqual(["keep"]);
  });

  it("de-duplicates repeated node ids", () => {
    const graph = loadGraph(
      fixture({
        nodes: [
          { id: "dup", label: "First" },
          { id: "dup", label: "Second" },
        ],
        links: [],
      }),
    );
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].name).toBe("First");
  });
});

describe("loadGraph — defensive defaults", () => {
  it("defaults a missing community to 0", () => {
    const graph = loadGraph(
      fixture({ nodes: [{ id: "a", label: "Alpha" }], links: [] }),
    );
    expect(graph.nodes[0].community).toBe(0);
    expect(graph.nodes[0].communityName).toBe("Community 0");
  });

  it("treats a missing links key as an empty array", () => {
    const raw = JSON.parse(fixture()) as Record<string, unknown>;
    delete raw.links;
    const graph = loadGraph(JSON.stringify(raw));
    expect(graph.links).toEqual([]);
    expect(graph.nodes).toHaveLength(3);
  });

  it("accepts edges as an alias for links", () => {
    const raw = JSON.parse(fixture()) as Record<string, unknown>;
    raw.edges = raw.links;
    delete raw.links;
    const graph = loadGraph(JSON.stringify(raw));
    expect(graph.links).toHaveLength(2);
    expect(graph.nodes.find((n) => n.id === "b")?.val).toBe(2);
  });

  it("defaults missing relation and confidence on links", () => {
    const graph = loadGraph(
      fixture({ links: [{ source: "a", target: "b" }] }),
    );
    expect(graph.links[0].relation).toBe("unknown");
    expect(graph.links[0].confidence).toBe("EXTRACTED");
  });

  it("drops links whose endpoints are not in the node set", () => {
    const graph = loadGraph(
      fixture({
        links: [
          { source: "a", target: "b" },
          { source: "a", target: "ghost" },
          { source: "ghost", target: "b" },
        ],
      }),
    );
    expect(graph.links).toHaveLength(1);
    expect(graph.nodes.find((n) => n.id === "a")?.val).toBe(1);
  });

  it("resolves source/target given as objects", () => {
    const graph = loadGraph(
      fixture({ links: [{ source: { id: "a" }, target: { id: "b" } }] }),
    );
    expect(graph.links[0]).toMatchObject({ source: "a", target: "b" });
  });

  it("reports an empty commit when built_at_commit is absent", () => {
    const raw = JSON.parse(fixture()) as Record<string, unknown>;
    delete raw.built_at_commit;
    expect(loadGraph(JSON.stringify(raw)).stats.commit).toBe("");
  });
});

/**
 * Cases taken from graphs this viewer was actually pointed at, so future
 * graphify output keeps being handled the way these repos needed.
 */
describe("loadGraph — observed graphify variation", () => {
  it("handles a graph with no built_at_commit at all (non-git repo)", () => {
    // Learning-Website's output omits the key entirely.
    const graph = loadGraph(
      JSON.stringify({
        directed: true,
        multigraph: false,
        graph: {},
        nodes: [{ id: "a", label: "A", community: 0 }],
        links: [],
        hyperedges: [],
      }),
    );
    expect(graph.stats.commit).toBe("");
  });

  it("wraps the palette when a graph has more communities than colors", () => {
    // Learning-Website clusters into 20 communities against a 16-color palette.
    const nodes = Array.from({ length: 20 }, (_, i) => ({
      id: `n${i}`,
      label: `N${i}`,
      community: i,
    }));
    const graph = loadGraph(JSON.stringify({ nodes, links: [] }));
    expect(graph.stats.communities).toBe(20);
    expect(new Set(graph.nodes.map((n) => n.color)).size).toBe(
      COMMUNITY_PALETTE.length,
    );
    // Community 16 wraps back onto community 0's color.
    expect(graph.nodes[16].color).toBe(graph.nodes[0].color);
  });

  it("ignores node fields it does not model", () => {
    // `_callable` and `metadata` appear in newer graphify output.
    const graph = loadGraph(
      JSON.stringify({
        nodes: [
          {
            id: "a",
            label: "A",
            _callable: true,
            metadata: { anything: [1, 2] },
            norm_label: "a",
            file_type: "code",
          },
        ],
        links: [],
      }),
    );
    expect(graph.nodes[0]).toMatchObject({ id: "a", name: "A", val: 0 });
  });

  it("passes through relation names it has never seen", () => {
    const graph = loadGraph(
      JSON.stringify({
        nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
        links: [
          { source: "a", target: "b", relation: "indirect_call" },
          { source: "b", target: "c", relation: "rationale_for" },
        ],
      }),
    );
    expect(graph.links.map((l) => l.relation)).toEqual([
      "indirect_call",
      "rationale_for",
    ]);
  });
});

describe("paletteForCommunity", () => {
  it("is deterministic for the same community", () => {
    expect(paletteForCommunity(5)).toBe(paletteForCommunity(5));
  });

  it("indexes the palette by community modulo palette length", () => {
    expect(paletteForCommunity(0)).toBe(COMMUNITY_PALETTE[0]);
    expect(paletteForCommunity(COMMUNITY_PALETTE.length)).toBe(
      COMMUNITY_PALETTE[0],
    );
    expect(paletteForCommunity(COMMUNITY_PALETTE.length + 3)).toBe(
      COMMUNITY_PALETTE[3],
    );
  });

  it("gives the 13 real communities 13 distinct colors", () => {
    const graph = loadGraph(REAL_CORPUS);
    const colors = new Set(graph.nodes.map((n) => n.color));
    expect(colors.size).toBe(13);
  });

  it("handles negative and non-finite community ids without crashing", () => {
    for (const value of [-1, -17, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(COMMUNITY_PALETTE).toContain(paletteForCommunity(value));
    }
  });

  it("colors each node to match its community", () => {
    const graph = loadGraph(fixture());
    const alpha = graph.nodes.find((n) => n.id === "a");
    const beta = graph.nodes.find((n) => n.id === "b");
    const gamma = graph.nodes.find((n) => n.id === "c");
    expect(alpha?.color).toBe(beta?.color);
    expect(alpha?.color).not.toBe(gamma?.color);
    expect(gamma?.color).toBe(paletteForCommunity(7));
  });
});

describe("loadGraph — error handling", () => {
  it("rejects malformed JSON with a clear error", () => {
    expect(() => loadGraph("{ not json")).toThrow(/not valid JSON/i);
  });

  it("rejects a payload that is not an object", () => {
    expect(() => loadGraph("[1, 2, 3]")).toThrow(/object/i);
  });

  it("rejects a payload with no nodes array", () => {
    expect(() => loadGraph('{"links": []}')).toThrow(/nodes/i);
  });

  it("rejects an empty node set", () => {
    expect(() => loadGraph('{"nodes": []}')).toThrow(/no nodes/i);
  });
});
