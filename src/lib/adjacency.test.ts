import { describe, expect, it } from "vitest";

import { adjacencyFor, buildAdjacency } from "./adjacency";
import { loadGraph } from "./graphLoader";
import { REAL_CORPUS, hasCorpus } from "./testCorpus";

const graph = loadGraph(
  JSON.stringify({
    nodes: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "lonely" }],
    links: [
      { source: "a", target: "b", relation: "calls" },
      { source: "a", target: "c", relation: "imports" },
      { source: "c", target: "a", relation: "references" },
    ],
  }),
);
const index = buildAdjacency(graph);

describe("buildAdjacency", () => {
  it("splits links into in and out per node", () => {
    const a = adjacencyFor(index, "a");
    expect(a.out.map((e) => e.id)).toEqual(["b", "c"]);
    expect(a.out.map((e) => e.relation)).toEqual(["calls", "imports"]);
    expect(a.in.map((e) => e.id)).toEqual(["c"]);
    expect(a.in.map((e) => e.relation)).toEqual(["references"]);
  });

  it("snapshots endpoint ids so simulation mutation cannot corrupt them", () => {
    // react-force-graph replaces string endpoints with node objects in place.
    const mutated = loadGraph(
      JSON.stringify({
        nodes: [{ id: "x" }, { id: "y" }],
        links: [{ source: "x", target: "y", relation: "calls" }],
      }),
    );
    const built = buildAdjacency(mutated);
    Object.assign(mutated.links[0], {
      source: { id: "x" },
      target: { id: "y" },
    });
    expect(adjacencyFor(built, "x").out[0].id).toBe("y");
    expect(adjacencyFor(built, "y").in[0].id).toBe("x");
  });

  it("collects neighbors in both directions", () => {
    expect([...adjacencyFor(index, "a").neighbors].sort()).toEqual(["b", "c"]);
    expect([...adjacencyFor(index, "b").neighbors]).toEqual(["a"]);
  });

  it("includes isolated nodes with empty entries", () => {
    const lonely = adjacencyFor(index, "lonely");
    expect(lonely.in).toEqual([]);
    expect(lonely.out).toEqual([]);
    expect(lonely.neighbors.size).toBe(0);
  });

  it("returns an empty record for unknown or missing ids", () => {
    expect(adjacencyFor(index, "nope").neighbors.size).toBe(0);
    expect(adjacencyFor(index, null).out).toEqual([]);
  });

  it("carries relation and confidence onto each edge", () => {
    expect(adjacencyFor(index, "b").in[0]).toEqual({
      id: "a",
      relation: "calls",
      confidence: "EXTRACTED",
    });
  });

  it.skipIf(!hasCorpus)(
    "keeps in+out degree consistent with the loader's val",
    () => {
      const real = loadGraph(REAL_CORPUS);
      const realIndex = buildAdjacency(real);
      for (const node of real.nodes) {
        const entry = adjacencyFor(realIndex, node.id);
        expect(entry.in.length + entry.out.length).toBe(node.val);
      }
    },
  );
});
