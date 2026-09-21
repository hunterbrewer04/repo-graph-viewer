# Repo Graph Viewer

Renders any graphify `graph.json` as an interactive code graph — 2D canvas or 3D
WebGL, colored by community, with a node detail panel and search.

Fully client-side. No backend, no auth. Live at
[graph.hunterbrewer.com](https://graph.hunterbrewer.com).

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # loader + adjacency unit tests
npm run build   # static export to out/
```

## Deploy

`next.config.ts` sets `output: "export"`, so `npm run build` writes a plain
static site to `out/`. Cloudflare Pages builds it from this repo on every push
to `main` (build command `npm run build`, output directory `out`) and serves it
at graph.hunterbrewer.com. Nothing else to run.

## URL parameters

Both are optional and combine.

| Param | Effect |
| --- | --- |
| `?example=<id>` | Opens straight onto that bundled example (an `id` from `manifest.json`); unknown ids fall through to the picker |
| `?theme=dark` / `light` | Wins over the saved theme for this load, without changing it |

The portfolio embeds the viewer as
`/?example=portfolio-site&theme=dark` so the frame lands on a live graph in
chrome that matches the page around it.

Most tests are self-contained. Six of them assert against a real graphify graph,
which defaults to the bundled `public/graphs/apple-calendar-mcp.json`; point them
at any repo you have already run graphify on instead:

```bash
GRAPH_CORPUS=/path/to/repo/graphify-out/graph.json npm test
```

## Loading a graph

The viewer starts empty and offers a few bundled examples to click through.
To render your own, run graphify on any repo and open the `graph.json` it writes:

```bash
graphify extract /path/to/repo --code-only
graphify cluster-only /path/to/repo --no-label   # optional: community naming
# -> /path/to/repo/graphify-out/graph.json
```

- **Examples** (the prompt on the empty canvas, or the header button once a
  graph is up) loads one of the bundled graphs.
- **Drag and drop** a `graph.json` anywhere on the canvas.
- **Load file…** (bottom-right) opens a file picker for the same thing.

Loading a graph replaces whatever is on screen.

### Bundled examples

`public/graphs/manifest.json` lists them; each entry points at a minified
graphify graph committed next to it. They are fetched on click, not on page
load. To add one, run `graphify extract <repo> --code-only --out <dir>`, copy
`<dir>/graphify-out/graph.json` into `public/graphs/`, and add a manifest entry.
`examples.test.ts` checks that every entry exists, loads, and that the node,
link, and community counts on its card match the file.

| Example | Language | Nodes / links |
| --- | --- | --- |
| apple-calendar-mcp | Swift | 398 / 977 |
| portfolio-site | TypeScript | 304 / 425 |
| Search-Algorithms-Demos | JavaScript | 255 / 519 |
| Rummy Tracker | Swift | 192 / 410 |
| speedtest-cli | Python | 14 / 27 |

## Theme

Light by default, with a toggle in the header. The choice is saved to
`localStorage` and applied by an inline script before first paint, so there is
no flash on reload. Only the chrome switches: the graph canvas stays black in
both themes because the community palette is tuned for light-on-dark.

## Controls

| Action | Result |
| --- | --- |
| Hover a node | Highlights it and its neighbors, dims everything else |
| Click a node | Opens the detail panel; click a neighbor to walk the graph |
| Search | Highlights matches and their neighbors |
| `G` | Toggles 2D / 3D |
| `Esc` | Clears the search and the selection |
| Click empty canvas | Deselects |

Link styling: dashed edges are `INFERRED` (graphify's guess), solid are
`EXTRACTED` (parsed from the AST).

On phones the detail panel is a bottom sheet instead of a sidebar; tapping a
node in 2D pans it into the strip above the sheet. Tap the canvas or × to
dismiss. The search box is 16px there because iOS Safari zooms the page to
focus anything smaller.

## Format notes

`src/lib/graphLoader.ts` normalizes graphify output into what react-force-graph
wants. graphify is actively developed, so the loader reads every field
defensively and `graphLoader.test.ts` is the tripwire for format changes.

Variation seen across the repos this was tested against
(apple-calendar-mcp, kilgus-label-maker, Learning-Website), all handled without
loader changes and each covered by a test:

- **`type` is usually absent.** 388 of apple-calendar-mcp's 398 nodes carry no
  `type`; kilgus and Learning-Website have none at all. Missing kinds become
  `unknown`, which is why the legend is mostly one chip.
- **`built_at_commit` may be missing entirely.** Absent for non-git projects;
  the header shows `—`. When present it is a full 40-char SHA, displayed
  truncated to 8.
- **Community count can exceed the palette.** Learning-Website clusters into 20
  against 16 colors, so colors wrap by `community % 16` and two communities can
  share a hue.
- **Unmodeled fields keep appearing** (`_callable`, `metadata`, `norm_label`)
  and are ignored. New relation names (`indirect_call`, `rationale_for`,
  `defines`) pass through as-is.
- **`links` vs `edges`** are both accepted, as are `id` and `nodeId`. Links
  pointing at a node that is not in the node set are dropped, because
  react-force-graph throws on them.

## Rendering notes

Two things about react-force-graph that the code depends on:

- It **mutates `graphData` in place** — nodes gain `x`/`y`/`z`, and each link's
  string `source`/`target` is replaced with a live node reference. So the object
  passed in is memoized (a new one restarts the layout), and `buildAdjacency`
  snapshots endpoint ids rather than holding link references.
- **Opacity is multiplicative** in 3D: `nodeOpacity * colorAlpha(color)`. Both
  opacity props are pinned to 1 so the rgba color is the single source of truth,
  with 3D dimming less because its spheres are Lambert-shaded.

The 2D and 3D renderers are imported as separate packages rather than the
`react-force-graph` umbrella. The umbrella also loads the AR/VR builds, which
throw `AFRAME is not defined` in dev where nothing is tree-shaken; splitting
them also keeps Three.js out of the bundle until 3D is opened.
