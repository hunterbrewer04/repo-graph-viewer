import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseManifest } from "./examples";
import { loadGraph } from "./graphLoader";

const PUBLIC_DIR = join(__dirname, "../../public");

describe("parseManifest", () => {
  it("returns an empty list for anything that is not an array", () => {
    expect(parseManifest(null)).toEqual([]);
    expect(parseManifest({})).toEqual([]);
    expect(parseManifest("[]")).toEqual([]);
  });

  it("skips entries missing an id or file and defaults the rest", () => {
    const list = parseManifest([
      { id: "ok", file: "/graphs/ok.json" },
      { id: "no-file" },
      { file: "/graphs/no-id.json" },
      "nope",
      null,
    ]);
    expect(list).toEqual([
      {
        id: "ok",
        file: "/graphs/ok.json",
        name: "ok",
        language: "",
        blurb: "",
        stats: null,
      },
    ]);
  });

  it("drops stats unless all three counts are numbers", () => {
    const [partial, full] = parseManifest([
      { id: "a", file: "a.json", stats: { nodes: 1, links: 2 } },
      { id: "b", file: "b.json", stats: { nodes: 1, links: 2, communities: 3 } },
    ]);
    expect(partial.stats).toBeNull();
    expect(full.stats).toEqual({ nodes: 1, links: 2, communities: 3 });
  });
});

/**
 * Tripwire for the bundled examples: every manifest entry must point at a
 * file that exists, parses through the loader, and matches the stats printed
 * on its card. Regenerating a graph without updating the manifest fails here.
 */
describe("bundled examples", () => {
  const manifest = parseManifest(
    JSON.parse(readFileSync(join(PUBLIC_DIR, "graphs/manifest.json"), "utf8")),
  );

  it("lists at least one example", () => {
    expect(manifest.length).toBeGreaterThan(0);
  });

  it.each(manifest.map((example) => [example.id, example] as const))(
    "%s loads and matches its manifest stats",
    (_id, example) => {
      expect(example.file.startsWith("/")).toBe(true);
      const text = readFileSync(join(PUBLIC_DIR, example.file), "utf8");
      const graph = loadGraph(text);
      expect(example.stats).not.toBeNull();
      expect({
        nodes: graph.stats.nodes,
        links: graph.stats.links,
        communities: graph.stats.communities,
      }).toEqual(example.stats);
      expect(example.language).not.toBe("");
      expect(example.blurb).not.toBe("");
    },
  );
});
