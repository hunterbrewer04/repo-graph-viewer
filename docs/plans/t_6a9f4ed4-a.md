# t_6a9f4ed4-a — Header + Stats Bar Implementation Plan

> **For coder:** Work task-by-task, TDD where a test target exists. Do not modify anything outside Files-in-scope. Run acceptance commands after each task and before committing.

**Goal:** Upgrade the app header into a portfolio-quality header + stats bar: prominent app title, prominently displayed loaded-graph name, node/link/build-commit metadata surfaced via the existing loader contract (`loadGraph()` → `stats.nodes` / `stats.links` / `stats.commit`, em-dash fallback for absent commit — locked by PR #1 tests in `src/lib/graphLoader.test.ts`), plus an always-visible drag-and-drop affordance so users know a `graph.json` can be dropped anywhere on the page.

**Architecture:** Extract the currently-inline `<header>` block out of `src/app/page.tsx` into two presentational client components (`src/components/AppHeader.tsx` owning title + graph name + error slot, and `src/components/StatsBar.tsx` owning the stat readouts). Add a persistent drag-and-drop affordance strip inside `FileDrop` so the hint survives after a graph loads. All data flows through existing props/state in `page.tsx`; no state shape changes, no loader changes.

**Tech stack:** Next.js 16.3.0 (App Router — note: this version has breaking changes vs older training data; relevant docs live in `node_modules/next/dist/docs/01-app/`), React 19, Tailwind v4, Vitest 4.

---

## Baseline (recorded on main @ fd31a0b, 2026-08-24)

- `npm test` → `Test Files 2 passed (2)`, `Tests 35 passed | 6 skipped (41)` (6 skipped = corpus tests requiring `GRAPH_CORPUS`)
- `npm run lint` → exit 0, no output
- Re-establish both baselines before starting; the suite must not regress below them.

## Current-state facts (verified by reading the code)

- `src/app/page.tsx` renders everything: inline `Stat` helper, inline `<header>` (title "Repo Graph Viewer", `{source}` name span, 4 stats incl. commit em-dash fallback at line 62, error pill), `FileDrop` wrapper, empty-state drop hint, `GraphViewer`, `DetailPanel`.
- `src/components/FileDrop.tsx`: depth-counter drag overlay ("Drop a graphify graph.json to load it") that only appears **while dragging**, plus a bottom-right "Load file…" picker button. After a graph loads there is zero visible affordance that dropping still works.
- `src/lib/graphLoader.ts`: `stats = { nodes, links, communities, commit }`; `commit` is `built_at_commit.slice(0, 8)` or `""`. Page already renders `graph.stats.commit || "—"`. **Contract is test-locked; do not touch.**
- `src/app/layout.tsx`: metadata title "Repo Graph Viewer" — fine as-is.
- Styling tokens in use: `bg-surface`, `border-border`, `text-muted`, `text-foreground`, `border-accent`, `bg-background` (Tailwind v4 theme vars in `globals.css`). Reuse these; do not invent new color values.

## Assumptions (decided, not blocking)

1. "App title displayed prominently" means larger type hierarchy than today's `text-sm` — bump to `text-base font-semibold tracking-tight` minimum; exact visual tuning is coder discretion within existing tokens.
2. The loaded-graph name shows even when it equals the file name (current behavior); it becomes visually paired with the title rather than a tiny muted span.
3. Drag-and-drop affordance = a persistent, subtle dashed-border hint zone/badge rendered by `FileDrop` at all times (full-screen overlay stays drag-only). No new dependencies.
4. No unit-test harness exists for components (Vitest runs node-env lib tests only). Component verification is via lint + build + manual dev-server checklist; do NOT introduce jsdom/testing-library in this card (that belongs to later polish cards if wanted).

---

## Files-in-scope

| File | Action |
|---|---|
| `src/components/AppHeader.tsx` | **Create** — title bar: app title, loaded-graph name, error slot |
| `src/components/StatsBar.tsx` | **Create** — nodes / links / build-commit readouts (+ communities, kept) |
| `src/app/page.tsx` | **Modify** — replace inline header + `Stat` helper with the two new components |
| `src/components/FileDrop.tsx` | **Modify** — add persistent drag-and-drop affordance element |

## Do-NOT-touch boundaries

- `src/lib/graphLoader.ts` — loader logic and its exported contract are test-locked by PR #1 (`src/lib/graphLoader.test.ts`). Read-only.
- `src/lib/graphLoader.test.ts`, `src/lib/adjacency.ts`, `src/lib/adjacency.test.ts`, `src/lib/testCorpus.ts` — read-only.
- `src/components/GraphViewer.tsx`, `src/components/DetailPanel.tsx` — later cards own these; read-only.
- `package.json` dependencies — no additions.
- Existing passing tests must still pass verbatim (35 passed | 6 skipped baseline).

## Out of scope (later cards)

- Card B/C/D territory: visual polish beyond structural prominence (animations, responsive redesign), search/filter UI, URL state / shareable links, theming work, 3D-mode controls, persistence of last-loaded graph.

---

## Tasks

### Task 1: Create `StatsBar` component

**Objective:** Pure presentational stats readout fed by `GraphData["stats"]`.

**Files:** Create `src/components/StatsBar.tsx`

**Step 1:** Implement:

```tsx
import type { GraphStats } from "@/lib/graphLoader";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col leading-tight">
      <span className="font-mono text-sm text-foreground">{value}</span>
      <span className="text-[10px] uppercase tracking-wider text-muted">
        {label}
      </span>
    </div>
  );
}

/** Node/link/community counts plus the short build commit (em-dash when absent). */
export default function StatsBar({ stats }: { stats: GraphStats }) {
  return (
    <div className="flex items-center gap-6">
      <Stat label="nodes" value={stats.nodes} />
      <Stat label="links" value={stats.links} />
      <Stat label="communities" value={stats.communities} />
      <Stat label="commit" value={stats.commit || "—"} />
    </div>
  );
}
```

**Step 2:** `npm run lint` → exit 0. `npx tsc --noEmit` (if configured) or rely on `npm run build` in Task 4 → success.

### Task 2: Create `AppHeader` component

**Objective:** Owns the whole header row: prominent app title, loaded-graph name, stats slot, error slot.

**Files:** Create `src/components/AppHeader.tsx`

**Step 1:** Implement (props mirror exactly what `page.tsx` has today):

```tsx
import StatsBar from "@/components/StatsBar";
import type { GraphData } from "@/lib/graphLoader";

export interface AppHeaderProps {
  /** Name of the file the current graph came from; empty until one loads. */
  source: string;
  graph: GraphData | null;
  error: string | null;
}

export default function AppHeader({ source, graph, error }: AppHeaderProps) {
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-b border-border bg-surface px-5 py-3">
      <div className="flex items-baseline gap-3">
        <h1 className="text-base font-semibold tracking-tight">
          Repo Graph Viewer
        </h1>
        {/* Loaded-graph name: muted when absent, foreground once a graph is up. */}
        {source ? (
          <span
            className="max-w-xs truncate text-[13px] font-medium text-accent"
            title={source}
          >
            {source}
          </span>
        ) : (
          <span className="text-[13px] text-muted">no graph loaded</span>
        )}
      </div>

      {graph && <StatsBar stats={graph.stats} />}

      {error && (
        <p
          role="alert"
          className="ml-auto max-w-md truncate rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[11px] text-red-300"
          title={error}
        >
          {error}
        </p>
      )}
    </header>
  );
}
```

Notes:
- Keep the exact error-pill markup/classes from today's `page.tsx` (lines 66–74) — behavior parity, just relocated.
- `role="alert"` must survive the move (accessibility regression guard).
- Graph name gets `title={source}` so long filenames truncate gracefully.

### Task 3: Persistent drop affordance in `FileDrop` + wire `page.tsx`

**Objective:** Users can always see the page accepts a dropped `graph.json`, including after a graph loads.

**Files:** Modify `src/components/FileDrop.tsx`, `src/app/page.tsx`

**Step 1 — FileDrop:** Below the existing children (and above the dragging overlay), add a persistent affordance pinned bottom-left (bottom-right is taken by the Load-file button):

```tsx
{/* Always-visible hint: dropping works before AND after a graph loads. */}
<div className="pointer-events-none absolute bottom-4 left-4 flex items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 py-1 text-[10px] uppercase tracking-wider text-muted">
          drop graph.json anywhere
</div>
```

Keep the existing drag-overlay, depth-counter logic, window-level prevent listeners, and the Load-file button **byte-for-byte unchanged**. Only the JSX addition above plus its comment are new.

**Step 2 — page.tsx:**
1. Delete the local `Stat` function (lines 11–20).
2. Delete the entire inline `<header>…</header>` block (lines 49–75).
3. Replace with `<AppHeader source={source} graph={graph} error={error} />`.
4. Imports: remove nothing else; add `import AppHeader from "@/components/AppHeader";`.

The rest of `page.tsx` (state, `applyGraph`, `adjacency` memo, `main` layout, `DetailPanel`) must remain unchanged.

**Step 3:** Manual dev-server checklist:

```bash
npm run dev   # note the URL it prints (Next 16 may differ from :3000)
```

Verify all of:
- [ ] Empty state: title prominent, "no graph loaded" shown, persistent drop hint bottom-left, "Load file…" bottom-right, center hint intact.
- [ ] Drop any valid graphify `graph.json` onto the page → name appears next to title, stats show real numbers, commit shows short sha or `—` when the fixture lacks `built_at_commit`.
- [ ] Drop a malformed `.json` → red error pill appears top-right of header, prior graph stays.
- [ ] While dragging: full-screen dashed overlay still appears above the persistent hint (z-order sane).
- [ ] Clicking nodes / DetailPanel still works (regression check).

### Task 4: Full verification gate

Run from repo root; every command must pass:

| Command | Expected |
|---|---|
| `npm test` | `Test Files 2 passed (2)`; `Tests 35 passed \| 6 skipped` — identical to baseline |
| `npm run lint` | exit 0, no warnings/errors |
| `npm run build` | Compiled successfully; static prerender of `/` succeeds |

Then commit:

```bash
git add src/components/AppHeader.tsx src/components/StatsBar.tsx src/components/FileDrop.tsx src/app/page.tsx
git commit -m "feat(t_6a9f4ed4-a): portfolio header + stats bar with persistent drop affordance"
```
