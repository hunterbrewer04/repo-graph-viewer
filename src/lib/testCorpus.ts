import { existsSync, readFileSync } from "node:fs";
import { describe } from "vitest";

/**
 * A real graphify graph to test against, read from disk rather than committed.
 *
 * No sample dataset ships with this repo, so the corpus-backed tests point at a
 * graph on the developer's machine and skip when it is not there. They are the
 * tripwire for graphify changing its output format, which synthetic fixtures
 * cannot catch. Everything else in the suite runs everywhere, unconditionally.
 *
 * Override the path with GRAPH_CORPUS to aim these tests at your own repo:
 *   GRAPH_CORPUS=~/Code/whatever/graphify-out/graph.json npm test
 */
export const CORPUS_PATH =
  process.env.GRAPH_CORPUS ??
  `${process.env.HOME}/Code/apple-calendar-mcp/graphify-out/graph.json`;

export const hasCorpus = existsSync(CORPUS_PATH);

export const REAL_CORPUS = hasCorpus ? readFileSync(CORPUS_PATH, "utf8") : "";

/** `describe` that skips its whole block when no corpus is available. */
export const describeIfCorpus = hasCorpus ? describe : describe.skip;
