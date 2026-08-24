# t_6a9f4ed4-d — Portfolio Sprint Sub-card D: Shareable State in URL

> **For coder:** Work on branch `feat/portfolio-c` @ `0dd749e` as base (PR #4;
> cards A–C live in this lineage — do not regress them). Read `AGENTS.md`:
> Next.js 16.3.0 has breaking changes vs training data — consult
> `node_modules/next/dist/docs/` before assuming any Next API.
> Mirror of this living doc: gbrain `plans/t_6a9f4ed4-d`.

## Goal

A loaded view must be linkable: pasting the URL into a fresh browser tab
restores the same graph. Plus a README refresh documenting this sprint's UI
features.

## Chosen approach (decision, with rationale)

**Hash-fragment graph encoding (`#g=<deflate+base64url>`) is the primary and
only guaranteed mechanism. An optional `?graph=<name>` file-handle fetch is a
secondary convenience path. No other URL scheme.**

Rationale, grounded in recon:

1. The app is deliberately backend-free ("Fully client-side. No backend." —
   README) and presets were removed in 56c6451 ("starts empty and renders
   whatever you give it"). There is NO corpus/fetch path today
   (`public/` holds only Next's stock SVGs; `testCorpus.ts` reads a local disk
   path that never ships). So bare `?graph=<name>` cannot resolve anything.
2. Encoding the graph itself into the URL fragment makes every loaded view
   shareable on ANY static host, forever, with zero infrastructure. The data
   lives in the **hash**, not the query string, so oversized URLs never hit
   servers, proxies, or analytics — and never get logged.
3. Compression first: real graphify graphs are large. `CompressionStream`
   (`deflate-raw`) + base64url typically shrinks them 5–15×. A 400-node /
   2k-edge graph encodes to well under 100 KB — fine for modern browsers
   (hash capacity is effectively megabytes). Graphs beyond the guard below get
   an honest "too large to share" message instead of a silently truncated link.

### URL grammar (complete)

```
/#g=<payload>[&n=<nodeId>]     primary: shared graph (+optional initial selection)
/?graph=<name>                 secondary: fetches ./graphs/<name>.json relative to origin
```

- `<payload>` = `deflate-raw(JSON.stringify(raw graphify JSON))` → base64url,
  no padding. We re-serialize the RAW uploaded JSON (not the normalized
  `GraphData`) so the loader's defensive normalization stays the single
  code path — decode output feeds straight into the untouched `loadGraph`.
- `n=<nodeId>` restores the selected node (percent-encoded). Camera position /
  zoom are intentionally NOT persisted (out of scope).
- Precedence: `?graph=` wins over `#g=` (an explicit name is a more specific
  intent); if the fetch fails we do NOT fall through to `#g=` — one clear
  error beats surprising dual behavior.

### Why NOT `useSearchParams`

Per `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md`,
`useSearchParams` forces client-side rendering up to the nearest Suspense
boundary during prerendering, and our `/` route is currently fully static
(verified: `npm run build` emits `○ (Static)`). All URL reads/writes here go
through `window.location.hash` / `history.replaceState` inside `useEffect`s —
no hook, no Suspense restructuring, no build-output change. This is deliberate;
do not "modernize" it to `useSearchParams`.

## Assumptions (decided, not blocking)

1. Encode the raw dropped JSON, decode through the untouched `loadGraph`.
   Loader semantics stay byte-for-byte identical.
2. Size guard: reject encode when the resulting hash would exceed **2,000,000
   chars**, reject decode when decompressed output exceeds **16 MB**. Both
   surface through the EXISTING `error` channel (`AppHeader`), same as a bad
   drop.
3. Dropping/picking a new file replaces the hash (`history.replaceState`, no
   history spam) — so "Copy Link" after a fresh drop always reflects what's on
   screen, and a stale `#g=` never resurrects.
4. Restoring from `#g=` sets `source` to `"shared link"` (header shows it like
   a filename). Restoring from `?graph=x.json` sets source to `x.json`.
5. Invalid/undecodable `#g=` → error "This shared link's graph data is
   corrupted or incomplete." + empty start state. Missing `?graph=` file →
   "No graph is published at “<name>” — ask the owner to add graphs/<name>.json,
   or drop a graph.json directly."
6. `n=<id>` referencing an absent node id is ignored silently (selection stays
   null); the graph still loads. Selection is cosmetic; failing the whole load
   for it would be hostile.
7. CompressionStream/DecompressionStream exist in all evergreen browsers and in
   Node ≥ 18 (so vitest unit-tests run unskipped). If `DecompressionStream` is
   somehow missing, decode throws → caught → same corrupted-link error.
8. README screenshots: **placeholders, not binaries**. A public repo carrying
   PNGs of a dev tool invites rot; instead the README gets a Screenshots
   subsection with one-line capture instructions per feature. Revisit only if
   Hunter asks for real images.

## Files-in-scope

| File | Action |
|---|---|
| `src/lib/shareUrl.ts` | Create — pure codec: `encodeSharePayload(json)`, `decodeSharePayload(payload)`, `buildShareHash(json, nodeId?)`, `parseShareHash(hash)` |
| `src/lib/shareUrl.test.ts` | Create — unit tests incl. round-trip + guards |
| `src/app/page.tsx` | Modify — bootstrap effect (reads `?graph=` / `#g=` once on mount), hash-sync inside `applyGraph` success path, `initialSelectedId` plumbed to `GraphViewer` |
| `src/components/GraphViewer.tsx` | Modify — MINIMAL: accept optional `initialSelectedId?: string \| null` prop; one effect applies it once post-mount (selects node, fires existing fly-to). Nothing else changes. |
| `README.md` | Modify — Sharing-a-view section + sprint feature docs + screenshot placeholders |
| `e2e/share-url.spec.ts` | Create — Playwright specs (below) |

No new dependencies. No config changes.

## Code sketches

### `shareUrl.ts` (core)

```ts
const MAX_HASH_CHARS = 2_000_000;
const MAX_DECOMPRESSED = 16 * 1024 * 1024;

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function encodeSharePayload(graphJson: string): Promise<string> {
  const stream = new Blob([graphJson])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  const payload = bytesToBase64Url(bytes);
  if (payload.length > MAX_HASH_CHARS)
    throw new Error(
      "This graph is too large to encode in a share link (limit ~2 MB compressed).",
    );
  return payload;
}

export async function decodeSharePayload(payload: string): Promise<string> {
  const stream = new Blob([base64UrlToBytes(payload)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const text = await new Response(stream).text();
  if (text.length > MAX_DECOMPRESSED) throw new Error("Shared graph exceeds size limit.");
  return text;
}
```

(`parseShareHash` splits on `&`, percent-decodes `n`; `buildShareHash` composes
`#g=…` + optional `&n=…`. Keep both synchronous and pure for easy testing.)

### `page.tsx` wiring

```tsx
// One-time bootstrap: URL -> graph, BEFORE any user interaction.
useEffect(() => {
  const sp = new URLSearchParams(window.location.search);
  const named = sp.get("graph");
  const hash = window.location.hash;
  (async () => {
    if (named) {
      // secondary path: fetch ./graphs/<name>.json relative to origin
      try {
        const res = await fetch(`graphs/${encodeURIComponent(named)}`);
        if (!res.ok) throw new Error();
        applyGraph(await res.text(), named);
      } catch {
        setError(`No graph is published at "${named}" …`);
      }
      return; // precedence: named wins; no #g fallback
    }
    const m = /^#g=([^&]+)(?:&n=(.*))?$/.exec(hash);
    if (!m) return;
    try {
      const json = await decodeSharePayload(m[1]);
      setPendingNodeId(m[2] ? decodeURIComponent(m[2]) : null);
      applyGraph(json, "shared link");
    } catch (cause) {
      setError(cause instanceof Error && cause.message.includes("large")
        ? cause.message
        : "This shared link's graph data is corrupted or incomplete.");
    }
  })();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design
}, []);

// Inside applyGraph's SUCCESS path (after setError(null)):
history.replaceState(null, "", buildShareHash(rawJsonText)); // raw text, pre-loadGraph
```

Note: `applyGraph` must keep its current failure contract — a failed
`loadGraph` leaves whatever was on screen up and does NOT rewrite the URL.

### `GraphViewer` prop (whole diff intent)

```ts
export interface GraphViewerProps {
  data: GraphData;
  adjacency: Adjacency;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  initialSelectedId?: string | null;   // NEW, optional
}
```

One effect keyed on `initialSelectedId` (runs once per non-null value):
if a node with that id exists → `onSelect(id)` + reuse card C's
`setFocusRequest({ id, nonce })` so the restored view flies to the node.
Absent id → no-op (assumption 6).

## Tasks

1. `shareUrl.ts` + unit tests (round-trip, padding-free base64url, size-guard
   rejects, garbage-payload throws, `parseShareHash` edge cases: no match,
   `#g=` alone, `&n=` variants). Verify: `npx vitest run src/lib/shareUrl.test.ts`.
2. `page.tsx`: bootstrap effect + hash-sync in `applyGraph` +
   `pendingNodeId` plumbing. Verify: manual — drop fixture, URL gains `#g=`;
   reload same URL → graph returns; header shows "shared link".
3. `GraphViewer.initialSelectedId` wiring. Verify: `#…&n=<fixture-node-id>`
   selects it, DetailPanel populates, `[data-focus-active='true']`.
4. `e2e/share-url.spec.ts` + README rewrite. Verify full gate below.

## Edge cases matrix

| Case | Behavior |
|---|---|
| No params at all | Identical to today's app. Zero regression surface. |
| `#g=<garbage>` | Corrupted-link error via existing error channel; empty state. |
| `#g=<valid-but-not-a-graph>` | Flows through `loadGraph` → its existing messages ("not valid JSON", "no nodes", …) unchanged. |
| Oversized `#g=` (encode side) | Error thrown at copy time — i.e. at DROP time, since hash is written on load. User sees it immediately, not when sharing. |
| `?graph=foo.json`, no such file | Graceful not-published error; empty state. |
| `?graph=` + `#g=` both | `?graph=` wins; `#g=` ignored entirely. |
| Fresh drop while viewing a shared graph | New graph loads, hash replaced with new payload; old links remain valid independently (they carry their own data). |
| `n=<unknown-id>` | Ignored; graph still renders. |
| Dev-mode double-effect invocation (StrictMode-style remounts) | Bootstrap is idempotent: same URL → same result; `fetch` of named graph may fire twice harmlessly. |

## Acceptance commands (expected outcomes)

Baseline recorded on feat/portfolio-c @ 0dd749e:
`npm run lint` exit 0 · `npx vitest run` **35 passed | 6 skipped**, exit 0 ·
`npm run build` ✓ static, exit 0.

| Command | Expected |
|---|---|
| `npm run lint` | exit 0 |
| `npx vitest run` | baseline **35 passed \| 6 skipped** PLUS new shareUrl tests (≈ +10), all passed, exit 0 |
| `npm run build` | compiles; `/` still `○ (Static)`; exit 0 |
| `npx playwright test` | ALL specs pass, including cards B–C's `search-focus.spec.ts` verbatim and new `share-url.spec.ts` |
| `git diff --stat feat/portfolio-c` | only files-in-scope (lockfile unchanged — zero deps) |

Dev server (for manual/e2e): `npm run dev` → http://localhost:3000
(playwright.config already auto-starts it, `reuseExistingServer: true`).

### `e2e/share-url.spec.ts` required checks

Reuse card C's fixture-loading helper pattern (`setInputFiles` on
`input[type=file]`, canvas-visible gate):

1. **Drop produces a share link** — load fixture → `page.url()` matches
   `/\/?#g=/` (non-empty payload).
2. **Paste URL in a NEW page → same view** — take the URL from (1),
   `await page.context().newPage()`, `goto(url)`; expect: canvas visible AND
   StatsBar/header reflect the fixture's node count AND header source reads
   "shared link".
3. **Selection deep-link** — append `&n=<known fixture id>`; new page shows
   DetailPanel containing that node's name and
   `[data-focus-active='true']`.
4. **Corrupted link degrades gracefully** — goto `/#g=!!!not-real`; expect the
   corrupted-link error visible AND no canvas crash (empty-state prompt shown).
5. **Fresh drop supersedes** — from a shared-link page, setInputFiles the
   fixture again; URL's `#g=` payload changes and stats update.

## Do-NOT-touch boundaries

- `src/lib/graphLoader.ts` + `graphLoader.test.ts` (test-locked, PR #1);
  `adjacency.ts/.test.ts`; `testCorpus.ts` — read-only. Decode output MUST
  enter through the public `loadGraph(text)` entry point.
- Existing tests and e2e from cards B/C: `search-focus.spec.ts`,
  `adjacency.test.ts` — green verbatim, no edits.
- Card A/B/C shipped UI components — `AppHeader`, `StatsBar`, `FileDrop`,
  `CommunityLegend`, `DetailPanel`, `SearchBox` — zero DOM/behavior changes.
  The ONLY GraphViewer change permitted is the additive optional prop above;
  intro, glow, legend, fly-to, focus-ring, `/` shortcut, mode toggle: untouch.
- `applyGraph`'s failure contract (error leaves current graph up) — extend the
  success path only.
- `next.config.*`, `tsconfig.json`, `layout.tsx`, `globals.css` tokens,
  package.json dependencies.
- Loader normalization semantics: never persist normalized `GraphData` into
  URLs (would fork the normalization pipeline).

## Out of scope

- Camera position / zoom / mode (2D-3D) persistence.
- Server-side graph hosting, a reinstated preset manifest, upload endpoints.
- Short-link service, URL shorteners, IndexedDB-backed recent graphs.
- Real committed screenshots (placeholder instructions only, per assumption 8).
