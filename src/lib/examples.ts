/**
 * Bundled example graphs, listed in public/graphs/manifest.json and fetched on
 * demand so the initial page load stays small. Each entry points at a minified
 * graphify graph.json committed alongside it.
 */

export interface ExampleStats {
  nodes: number;
  links: number;
  communities: number;
}

export interface Example {
  id: string;
  name: string;
  /** URL of the graph.json, relative to the site root. */
  file: string;
  language: string;
  blurb: string;
  /** Shown on the card before the graph is fetched; null when the manifest omits it. */
  stats: ExampleStats | null;
}

export const MANIFEST_URL = "/graphs/manifest.json";

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function parseStats(value: unknown): ExampleStats | null {
  if (typeof value !== "object" || value === null) return null;
  const { nodes, links, communities } = value as Record<string, unknown>;
  if (
    typeof nodes !== "number" ||
    typeof links !== "number" ||
    typeof communities !== "number"
  ) {
    return null;
  }
  return { nodes, links, communities };
}

/** The manifest is written by hand, so a bad entry is skipped rather than fatal. */
export function parseManifest(value: unknown): Example[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const { id, file, name, language, blurb, stats } = entry as Record<
      string,
      unknown
    >;
    if (typeof id !== "string" || typeof file !== "string") return [];
    return [
      {
        id,
        file,
        name: str(name, id),
        language: str(language),
        blurb: str(blurb),
        stats: parseStats(stats),
      },
    ];
  });
}

export async function fetchExamples(): Promise<Example[]> {
  const response = await fetch(MANIFEST_URL);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseManifest(await response.json());
}

/** Returns the raw JSON text; the caller runs it through loadGraph. */
export async function fetchExampleGraph(example: Example): Promise<string> {
  const response = await fetch(example.file);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

/**
 * The example named by `?example=<id>` in a URL's query string, so a link (or
 * an embedding page) can open straight onto a graph instead of the picker.
 * Unknown or missing ids fall through to the normal empty state.
 */
export function exampleFromQuery(
  search: string,
  examples: Example[],
): Example | null {
  const id = new URLSearchParams(search).get("example");
  if (!id) return null;
  return examples.find((example) => example.id === id) ?? null;
}
