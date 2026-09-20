import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe } from "vitest";

/**
 * A real graphify graph to test against. Defaults to the bundled
 * apple-calendar-mcp example, so the corpus-backed tests run everywhere; they
 * are the tripwire for graphify changing its output format, which synthetic
 * fixtures cannot catch.
 *
 * Override the path with GRAPH_CORPUS to aim these tests at your own repo:
 *   GRAPH_CORPUS=~/Code/whatever/graphify-out/graph.json npm test
 */
export const CORPUS_PATH =
  process.env.GRAPH_CORPUS ??
  join(__dirname, "../../public/graphs/apple-calendar-mcp.json");

export const hasCorpus = existsSync(CORPUS_PATH);

export const REAL_CORPUS = hasCorpus ? readFileSync(CORPUS_PATH, "utf8") : "";

/** `describe` that skips its whole block when no corpus is available. */
export const describeIfCorpus = hasCorpus ? describe : describe.skip;
