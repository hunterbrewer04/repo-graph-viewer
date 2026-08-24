# Repo Graph Viewer

Renders any graphify `graph.json` as an interactive code graph — 2D canvas or 3D
WebGL, colored by community, with a node detail panel and search.

Fully client-side. No backend, no auth, nothing to deploy.

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # loader + adjacency unit tests
```

Most tests are self-contained. Six of them assert against a real graphify graph
and are skipped unless one exists on disk; point them at any repo you have
already run graphify on:

```bash
GRAPH_CORPUS=/path/to/repo/graphify-out/graph.json npm test
```

## Loading a graph

Run graphify on any repo, then open the `graph.json` it writes:

```bash
graphify extract /path/to/repo --code-only
graphify cluster-only /path/to/repo --no-label   # optional: community naming
# -> /path/to/repo/graphify-out/graph.json
```

- **Drag and drop** a `graph.json` anywhere on the canvas.
- **Load file…** (bottom-right) opens a file picker for the same thing.

Loading a graph replaces whatever is on screen. No datasets ship with this repo;
it starts empty and renders whatever you give it.

## Controls

| Action | Result |
| --- | --- |
| Hover a node | Highlights it and its neighbors, dims everything else |
| Click a node | Opens the detail panel; click a neighbor to walk the graph |
| Search | Highlights matches and their neighbors; Enter flies the camera to the pick |
| `/` | Focuses the search box from anywhere |
| `G` | Toggles 2D / 3D (3D auto-rotates until you interact) |
| `Esc` | Clears the search and the selection |
| Click empty canvas | Deselects |

Link styling: dashed edges are `INFERRED` (graphify's guess), solid are
`EXTRACTED` (parsed from the AST).

## Sharing a view

Every loaded graph is encoded into the URL hash as
`#g=<deflate+base64url>`, so any view can be shared by copying the address
bar. The payload is the raw uploaded JSON, compressed and reloaded through
the exact same loader as a file drop — nothing about the data path changes.

- **Copy Link**: after dropping a `graph.json`, the URL *is* the share link.
  Paste it anywhere; opening it restores the same graph with source shown as
  `shared link`.
- **Deep links**: appending `&n=<nodeId>` pre-selects that node and flies
  the camera to it on load.
- **Size guards**: graphs whose encoded hash would exceed ~2 MB of URL are
  refused at load time ("too large to share"), and decode-side output is
  capped at 16 MB — both surface through the header error channel like a bad
  drop.
- **`?graph=<name>.json`** (optional): fetches `./graphs/<name>.json`
  relative to the host origin, for owners who publish curated graphs next to
  the deployment. Takes precedence over `#g=`; a missing file shows a clear
  "not published" error rather than falling back.
- Loading a new file replaces the hash in place (`replaceState`) — no
  history spam, and a stale `#g=` never resurrects an old graph.

The hash never leaves the browser: fragments are not sent to servers,
proxies, or analytics.

## Screenshots

Deliberately no committed PNGs — they rot fast against a moving UI. To
capture fresh ones for a README refresh, run `npm run dev` and shoot:

| Shot | How to capture |
| --- | --- |
| 2D overview with community colors | Drop a real repo's `graph.json`; screenshot after the intro settles (~2 s) |
| Node focus + detail panel | Click a hub node so neighbors highlight and the detail panel opens |
| Search fly-to | Press `/`, type a node name, press Enter mid-flight |
| 3D mode | Press `G`; capture the orbiting view with legend visible |
| Shared-link restore | Open a `#g=…` URL in a fresh tab showing `shared link` in the header |

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
