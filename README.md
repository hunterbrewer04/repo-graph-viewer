# Repo Graph Viewer

Renders any graphify `graph.json` as an interactive code graph — 2D canvas or 3D
WebGL, colored by community, with a node detail panel and search.

Fully client-side. No backend, no auth, nothing to deploy.

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # loader + adjacency unit tests
```

## Loading a graph

- **Presets** — the dropdown is built from `public/graphs/manifest.json`.
- **Drag and drop** — drop a `graph.json` anywhere on the canvas.
- **Load file…** — bottom-right, same thing via a file picker.

To add a preset, drop the JSON in `public/graphs/` and add an entry to
`manifest.json`.

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
