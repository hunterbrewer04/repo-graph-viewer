# t_6a9f4ed4-c — Portfolio Sprint Sub-card C: Search + Click-to-Focus

> **For coder:** Work on branch `feat/portfolio-b` @ `34f7647` as base (PR #3 open;
> cards A and B live in this lineage — do not regress them). Read AGENTS.md:
> Next.js 16.3.0 has breaking changes vs training data — consult
> `node_modules/next/dist/docs/` before assuming any Next API.

**Goal:** A search box that finds nodes by name with a clickable results list;
picking a result animates the camera to that node and highlights its direct
connections (neighbors emphasized, everything else dimmed). `/` focuses the
search box from anywhere.

**Architecture:** Half the feature already ships in card B's lineage — `query`
state, the `matched` id-set memo, match dimming, and the
`focusId = hoverId ?? selectedId` neighborhood-highlight machinery all exist in
`GraphViewer.tsx`. This card ADDS three things and duplicates none of them:

1. A **results dropdown** under the existing input (new `SearchBox.tsx`),
   keyboard-navigable; picking a result calls the existing `onSelect(id)`.
2. A **camera fly-to** driven by a `focusRequest` signal (`{id, nonce}`) that
   GraphViewer turns into `centerAt`/`zoom` (2D) or `cameraPosition` (3D),
   composed safely with the card-B camera intro via the `hasFitRef` /
   fit-correction-timer guard.
3. The **`/` shortcut**, added to the existing global `keydown` handler with
   its existing typing guard.

Selection-driven highlighting needs zero new styling logic: setting
`selectedId` already lights the neighborhood (`highlighted`) and activates
touching links (`LINK_ACTIVE`, width bump, directional arrows) while dimming
the rest to `dimAlpha`.

**Tech stack:** unchanged — Next 16.3.0 / React 19 / Tailwind v4 /
react-force-graph-2d + -3d / three 0.185.1. One NEW devDependency:
`@playwright/test` (acceptance gate only; never imported by app code).

---

## Baseline (recorded on feat/portfolio-b @ 34f7647)

| Command | Result |
|---|---|
| `npx vitest run` | **35 passed \| 6 skipped**, exit 0 |
| `npm run lint` | exit 0 |
| `npm run build` | ✓ Compiled successfully |

These must not regress. Library API surface verified against installed
type declarations (do not trust memory over these):

- `react-force-graph-2d`: `centerAt(x?, y?, durationMs?)`, `zoom(scale?, ms?)`,
  `zoom(): number` (getter), `zoomToFit(ms?, padding?)`.
- `react-force-graph-3d`: `cameraPosition(pos, lookAt?, transitionMs?)`,
  `controls()`, `zoomToFit(ms?, padding?)`.

## Assumptions (decided, not blocking)

1. **Search state stays in `GraphViewer`** (where `query` lives today); the new
   `SearchBox` component is presentational + input-ref plumbing. Moving state
   would churn the `matched`/`highlighted` memos for no gain.
2. **Picking a result selects the node and clears the query.** Rationale:
   selection highlight supersedes match dimming anyway (existing precedence),
   and a stale query string with an empty-feeling dropdown reads as a bug.
   Input is blurred on pick so `/`-then-type flows stay snappy.
3. **Fly-to wins over the intro.** If the user picks a result while the card-B
   intro (settle → `zoomToFit` glide → +700ms correction pass) is still in
   flight, the fly-to cancels the pending correction timer and marks the intro
   done (`hasFitRef.current = true`). It never fights the intro tween mid-air,
   and the intro never yanks the camera back after an explicit focus.
4. **3D fly-to preserves the user's viewing direction and distance**: offset
   the camera from the node along the current camera→target unit vector,
   distance clamped to `[140, 420]` world units. No jarring side-of-node snaps.
5. **Dropdown caps at 8 results** (scrollable), ordered shortest-name-match
   first. No fuzzy-ranking library (YAGNI); substring case-insensitive match
   is the settled card-B behavior and stays.
6. **Focused-node emphasis:** 2D draws a `--accent` (#60a5fa) ring around the
   focused node in the existing `nodeCanvasObject`; 3D relies on the existing
   emphasis (white label, `LINK_ACTIVE` edges, arrows) to avoid Three-object
   rebuild churn. Asymmetric but visually coherent.
7. **Component verification** stays lint + build + vitest baseline; this card
   additionally introduces Playwright for the interaction checks the unit
   suite structurally cannot do (canvas, focus animation). jsdom/testing-library
   remains rejected (settled in card A's plan).

## Files-in-scope

| File | Action |
|---|---|
| `src/components/SearchBox.tsx` | Create — dropdown + input, keyboard nav |
| `src/components/GraphViewer.tsx` | Modify — wire SearchBox, `/` shortcut, fly-to machinery, 2D focus ring |
| `e2e/search-focus.spec.ts` | Create — Playwright interaction specs |
| `e2e/fixtures/tiny-graph.json` | Create — deterministic ~14-node fixture |
| `playwright.config.ts` | Create — webServer wiring to `npm run dev` |
| `package.json` | Modify — add `-D @playwright/test` ONLY |

## Do-NOT-touch boundaries

- `src/lib/graphLoader.ts` and its test — loader contract is test-locked (PR #1).
- `src/lib/adjacency.ts`, `adjacency.test.ts`, `testCorpus.ts` — read-only;
  `adjacencyFor(...).neighbors` already answers "who is connected".
- `AppHeader.tsx`, `StatsBar.tsx`, `FileDrop.tsx`, `CommunityLegend.tsx` —
  cards A/B shipped these; DOM structure and behavior must not change.
- `DetailPanel.tsx` — read-only. It already reacts to `selectedId`, so picking
  a search result populates it for free.
- Existing tests: all 35 passing tests stay green verbatim; no edits to
  `src/lib/*.test.ts`.
- Card B visuals: backdrop layers, legend placement, kind chips, 3D halo
  materials, autoRotate toggle, and the intro's post-fit framing must survive
  byte-for-byte in behavior.
- `next.config.*`, `tsconfig.json`, `src/app/layout.tsx`, `globals.css`
  tokens (consume them, don't redefine them).

## Out of scope

- URL state / shareable deep-links (`/?focus=…`) — **card D**.
- Multi-hop expansion, ranking heuristics, recent-search memory.
- Preset dataset picker, light theme, physics tuning.

---

## Tasks

### Task 1: Fixture + Playwright scaffolding

**Objective:** Deterministic graph fixture and the e2e harness, wired to the
dev server, red-before-green.

**Files:** `e2e/fixtures/tiny-graph.json`, `playwright.config.ts`,
`package.json`

**Step 1:** Install (exact, dev-only):

```bash
npm install -D @playwright/test
npx playwright install chromium
```

Do not touch any runtime dependency.

**Step 2:** `e2e/fixtures/tiny-graph.json` — hand-written graphify-shaped
document: 14 nodes across 3 communities with kinds `module|class|function`,
names including `UserService`, `UserServiceTests`, `UserCache`, `HttpClient`;
~18 links mixing `CALLS|IMPORTS`, some `"confidence": "INFERRED"`. Node shape
must satisfy the loader: `{id, name, kind, val, community, communityName,
color, file?, loc?}`, links `{source, target, relation, confidence}`.

**Step 3:** `playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
```

Add script `"test:e2e": "playwright test"` to `package.json`.

**Verify:** `npx playwright test` with a placeholder empty spec → 0 failed
(no tests found is fine at this step); `npx vitest run` still
35 passed | 6 skipped.

---

### Task 2: `SearchBox` component (TDD where testable)

**Objective:** Input + results dropdown, keyboard navigable, accessible.

**Files:** create `src/components/SearchBox.tsx`; modify
`src/components/GraphViewer.tsx` (mount + own state).

**Props contract (decision-complete):**

```tsx
export interface SearchResult {
  id: string;
  name: string;
  kind: string;
  color: string; // community color dot, consistent with DetailPanel rows
}

export interface SearchBoxProps {
  value: string;
  results: SearchResult[];      // already computed + capped upstream
  activeIndex: number | null;   // keyboard cursor
  inputRef: React.RefObject<HTMLInputElement | undefined>;
  onChange: (value: string) => void;
  onPick: (result: SearchResult) => void;
  onActiveIndexChange: (index: number | null) => void;
}
```

Behavior:
- Dropdown renders under the input when `results.length > 0 && value.trim()`:
  `role="listbox"`, options `role="option"`, `aria-selected` follows
  `activeIndex`. Row layout mirrors `DetailPanel.NeighborList`: color dot,
  truncated name, right-aligned mono `kind`.
- `ArrowDown` / `ArrowUp` move the cursor (wrap-around), `Enter` picks the
  cursored result, `Escape` is left to the EXISTING global handler (it already
  clears `query` and blurs inputs — do not double-handle). Prevent default on
  Arrow keys and Enter while the dropdown is open so the page never scrolls.
- Mouse click on a row calls `onPick`. Hover sets the cursor
  (`onMouseEnter` → `onActiveIndexChange`) so keyboard and pointer share one
  source of truth.
- Styling stays inside card B's system: `border-border bg-surface/90
  backdrop-blur text-foreground`, muted secondary text, `border-accent`
  focus ring on the input (input already has it — keep its classes verbatim).

**Mount in GraphViewer** (replaces the bare input block, lines ~658–675):
keep the wrapper `<div className="pointer-events-none absolute left-4 top-4 …">`,
swap the inner input for:

```tsx
<SearchBox
  value={query}
  results={searchResults}
  activeIndex={activeResult}
  inputRef={searchInputRef}
  onChange={setQuery}
  onPick={pickResult}
  onActiveIndexChange={setActiveResult}
/>
```

with upstream computation (all memoized):

```ts
// nodesById: Map<string, GraphNode> — memo on [data]; reused by Task 3/4.
const searchResults = useMemo<SearchResult[]>(() => {
  if (!matched) return [];
  // Shorter names first: "Serve" before "ServeTests".
  return [...matched]
    .map((id) => nodesById.get(id)!)
    .sort((a, b) => a.name.length - b.name.length)
    .slice(0, 8)
    .map(({ id, name, kind, color }) => ({ id, name, kind, color }));
}, [matched, nodesById]);
```

Keep the match-count badge behavior by rendering `{matched?.size}` inside
SearchBox when `results.length > 0 && matched.size > results.length`
(`+N more` footer row).

**Verify:** `npm run lint` exit 0; `npm run build` compiles; manual:
typing filters the dropdown, arrows + Enter pick, click picks.

---

### Task 3: `/` shortcut + pick wiring

**Objective:** `/` focuses search from anywhere; picking selects the node
through the ONE canonical selection path.

**Files:** `src/components/GraphViewer.tsx`

**Step 1:** Extend the existing global `keydown` effect (lines ~277–299) —
insert BEFORE the `g/G` branch, sharing its guards:

```ts
// `/` focuses search, unless the keystroke belongs to a field already.
if (event.key === "/") {
  if (event.metaKey || event.ctrlKey || event.altKey || typing) return;
  event.preventDefault();
  searchInputRef.current?.focus();
  searchInputRef.current?.select();
  return;
}
```

`typing` already covers `input, textarea, [contenteditable='true']`, so `/`
typed into the search box itself is untouched. Effect deps gain nothing new
(refs are stable).

**Step 2:** Pick handler — selection flows through the existing
`onSelect` prop (page.tsx owns `selectedId`; DetailPanel and hover machinery
react automatically). No parallel selection state:

```ts
const pickResult = useCallback(
  (result: SearchResult) => {
    onSelect(result.id);
    setQuery("");
    setActiveResult(null);
    searchInputRef.current?.blur();
    setFocusRequest((prev) => ({ id: result.id, nonce: prev.nonce + 1 }));
  },
  [onSelect],
);
```

**Verify:** manual — `/` focuses from cold page and mid-hover; typing `/`
inside the box inserts a slash; Enter on a result populates DetailPanel and
dims non-neighbors.

---

### Task 4: Camera fly-to (composes with the card-B intro)

**Objective:** Selecting a result animates the camera to the node in BOTH
modes without disturbing the intro machinery for fresh loads/mode switches.

**Files:** `src/components/GraphViewer.tsx`

**Step 1 — make the cancellable part cancellable.** In `handleEngineStop`,
hoist the +700ms correction timeout into a ref:

```ts
const fitCorrectionRef = useRef<number | null>(null);
// …inside handleEngineStop, replacing the bare setTimeout:
fitCorrectionRef.current = window.setTimeout(() => {
  fitCorrectionRef.current = null;
  handle?.zoomToFit(300, padding);
  if (mode === "3d") {
    const controls = graph3dRef.current?.controls();
    if (isOrbitLike(controls)) controls.autoRotate = autoRotate;
  }
}, 700);
```

and clear it on `[data, mode]` reset alongside `hasFitRef.current = false`.

**Step 2 — the fly-to effect.** Runs on every `focusRequest` nonce; retries
via rAF until the simulation has coordinates for the node (fresh loads may
not yet):

```ts
useEffect(() => {
  if (!focusRequest) return;
  const { id } = focusRequest;
  let frame = 0;
  const attempt = () => {
    const node = data.nodes.find((n) => n.id === id); // once-per-click; O(n) fine
    if (!node || node.x === undefined || node.y === undefined) {
      frame = requestAnimationFrame(attempt);
      return;
    }
    // An explicit focus ends the intro's authority over the camera.
    hasFitRef.current = true;
    if (fitCorrectionRef.current !== null) {
      clearTimeout(fitCorrectionRef.current);
      fitCorrectionRef.current = null;
    }
    if (mode === "2d") {
      const handle = graph2dRef.current;
      if (!handle) return;
      const current = handle.zoom();          // getter form
      handle.zoom(Math.max(current, 2.4), 750); // closer, never out
      handle.centerAt(node.x, node.y, 750);
    } else {
      const handle = graph3dRef.current;
      if (!handle) return;
      const controls = handle.controls();
      let distance = 260;
      if (isOrbitLike(controls) && controls.object && controls.target) {
        const p = controls.object.position, t = controls.target;
        distance = Math.min(420, Math.max(140, Math.hypot(p.x - t.x, p.y - t.y, p.z - t.z)));
      }
      // Preserve the user's viewing direction: step back from the node
      // along the current camera→target axis.
      const dir = (() => {
        const c = isOrbitLike(controls) ? controls.object?.position : undefined;
        if (!c) return { x: 0, y: 0, z: 1 };
        const len = Math.hypot(c.x - node.x!, c.y - node.y!, c.z - (node.z ?? 0)) || 1;
        return { x: (c.x - node.x!) / len, y: (c.y - node.y!) / len, z: (c.z - (node.z ?? 0)) / len };
      })();
      handle.cameraPosition(
        { x: node.x! + dir.x * distance, y: node.y! + dir.y * distance, z: (node.z ?? 0) + dir.z * distance },
        { x: node.x!, y: node.y!, z: node.z ?? 0 },
        750,
      );
    }
  };
  attempt();
  return () => cancelAnimationFrame(frame);
}, [focusRequest, data, mode]);
```

Notes:
- `ForceGraph3DHandle` gains `cameraPosition(position: Vec3Like, lookAt?:
  Vec3Like, transitionMs?: number): void;` — signature verified against the
  installed `.d.ts`.
- Zooming IN only (`Math.max(current, 2.4)`) respects a user already deeper
  in; `centerAt` retargets either way.
- Mode switch with an active selection does NOT auto-fly (the intro replays
  and frames everything; the node stays highlighted). Re-picking from
  DetailPanel or searching again flies. Deliberate — avoids two cameras
  fighting over one lens.
- `autoRotate` in 3D: leave whatever state the toggle holds; orbiting around
  a focused node is desirable, and the controls-adoption effect already
  reconciles `autoRotate` on its next run.

**Step 3 — 2D focus ring.** In `nodeCanvasObject`, after the label draw:

```ts
if (node.id === focusId) {
  ctx.beginPath();
  ctx.arc(node.x, node.y, radius + 3.5 / globalScale, 0, Math.PI * 2);
  ctx.strokeStyle = "#60a5fa"; // --accent
  ctx.lineWidth = 1.5 / globalScale;
  ctx.stroke();
}
```

(`radius` is already computed there; dep array already includes `focusId`.)

**Verify:** manual in both modes — pick a far-corner node: ~0.75s glide,
node centered, neighbors bright + arrows, rest at `dimAlpha`, ring visible
in 2D; picking DURING the intro cancels the correction cleanly (no snap-back).

---

### Task 5: Playwright acceptance specs

**Objective:** Runnable interaction proofs, immune to canvas flakiness.

**Files:** `e2e/search-focus.spec.ts`

Spec skeleton (each `test` lists its expected outcome inline):

```ts
import { expect, test } from "@playwright/test";

const FIXTURE = "e2e/fixtures/tiny-graph.json";

async function loadGraph(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.setInputFiles("input[type=file]", FIXTURE);
  await expect(page.getByRole("button", { name: "Load file…" })).toBeVisible();
}

test("’/’ focuses the search box", async ({ page }) => {
  await loadGraph(page);
  await page.keyboard.press("/");
  await expect(page.getByRole("textbox", { name: "Search nodes" })).toBeFocused();
});

test("search shows capped results and Enter focuses the node", async ({ page }) => {
  await loadGraph(page);
  await page.keyboard.press("/");
  await page.keyboard.type("userservice");
  const options = page.getByRole("option");
  await expect(options.first()).toBeVisible();               // dropdown opens
  await expect(options).toHaveCount(2);                       // UserService + UserServiceTests
  await page.keyboard.press("Enter");
  await expect(page.locator("aside")).toContainText("UserService"); // DetailPanel reacts
  await expect(page.locator("[data-focus-active='true"])).toHaveCount(1); // camera moved marker
});

test("focused node’s neighborhood is emphasized (pixel proof)", async ({ page }) => {
  await loadGraph(page);
  await page.waitForTimeout(2500);                            // let the intro land
  const before = await page.locator(".graph-backdrop ~ canvas").first().screenshot();
  await page.keyboard.press("/");
  await page.keyboard.type("httpclient");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1000);                            // fly-to tween (750ms)
  const after = await page.locator(".graph-backdrop ~ canvas").first().screenshot();
  expect(before.equals(after)).toBe(false);                   // camera demonstrably moved
});

test("Escape clears query and selection", async ({ page }) => {
  await loadGraph(page);
  await page.keyboard.press("/");
  await page.keyboard.type("cache");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("textbox", { name: "Search nodes" })).toHaveValue("");
  await expect(page.getByRole("option")).toHaveCount(0);
});
```

Supporting change in GraphViewer (one attribute, cheap and honest):
`data-focus-active={focusRequest ? "true" : undefined}` on the root container
div. It is set at fly-to start; the pixel-diff test carries the real proof.

Run: `npx playwright test` → **5 passed** (adjust count to final spec list).
If the dev server is already running, `reuseExistingServer` adopts it.

---

### Task 6: Full verification gate

From repo root on the implementation branch:

| Command | Expected |
|---|---|
| `npm run lint` | exit 0 |
| `npx vitest run` | 35 passed \| 6 skipped, exit 0 |
| `npm run build` | compiles, exits 0 |
| `npx playwright test` | all specs pass |
| `git diff --stat feat/portfolio-b` | only files-in-scope (+ lockfile) |

Manual dev-server checklist (`npm run dev`, drop a real graphify graph.json):

- [ ] `/` focuses search; typing `/` inside the box types a slash
- [ ] Typing filters dropdown; arrows + Enter pick; click picks; Esc clears
      query AND selection (existing behavior intact)
- [ ] Pick → ~0.75s camera glide in 2D AND 3D; node centered; DetailPanel
      populated; neighbors bright with arrows; everything else dimmed
- [ ] Picking during the intro never snap-backs
- [ ] Fresh load + G-toggle intro plays exactly as card B shipped
- [ ] Backdrop, legend, kind chips, auto-rotate toggle, header/stats/drop
      affordance: unchanged
- [ ] Empty state (no graph): `/` does nothing harmful (input not mounted)

Commit style: one commit per task, `feat(t_6a9f4ed4-c): <what>`.

---

## Risks / tradeoffs

- **rAF retry loop** could spin forever if a node never gets coordinates
  (disconnected node pre-tick). Mitigation: bounded to ~120 frames
  (add a counter; bail silently — highlight still applied via selection).
- **Pixel-diff test** could false-pass on static scenes; guarded by asserting
  DetailPanel text separately, and the fixture guarantees the picked node is
  far from viewport center after fit.
- **Playwright weight** (~browser download) is dev-only and CI-optional; the
  vitest baseline gate stays independent of it.
