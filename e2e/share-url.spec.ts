import { expect, test, type Page } from "@playwright/test";

const FIXTURE = "e2e/fixtures/tiny-graph.json";

/**
 * The canvas mounts from a client-only dynamic import, so its presence is a
 * reliable "the app is hydrated and listening" gate — same helper pattern as
 * card C's search-focus.spec.ts.
 */
async function dropGraph(page: Page) {
  await page.goto("/");
  await page.setInputFiles("input[type=file]", FIXTURE);
  await expect(page.getByRole("button", { name: "Load file…" })).toBeVisible();
  await page.locator("canvas").first().waitFor({ state: "visible" });
}

test("dropping a graph produces a share link in the URL hash", async ({
  page,
}) => {
  await dropGraph(page);
  expect(new URL(page.url()).hash).toMatch(/^#g=[A-Za-z0-9_-]+$/);
});

test("pasting the share URL into a fresh page restores the same view", async ({
  page,
}) => {
  await dropGraph(page);
  const url = page.url();

  const fresh = await page.context().newPage();
  await fresh.goto(url);
  await fresh.locator("canvas").first().waitFor({ state: "visible" });
  // Header source reads like a file, but names the link as the origin.
  await expect(fresh.getByText("shared link")).toBeVisible();
  // Same fixture, same stats: 14 nodes (StatsBar renders value + label spans).
  await expect(
    fresh.locator("header span", { hasText: /^14$/ }),
  ).toHaveCount(1);
  await expect(fresh.getByText("nodes")).toBeVisible();
  await fresh.close();
});

test("selection deep-link (&n=) selects the node and flies to it", async ({
  page,
}) => {
  await dropGraph(page);
  const base = new URL(page.url());
  const deep = `${base.origin}${base.pathname}${base.hash}&n=n-http-client`;

  const fresh = await page.context().newPage();
  await fresh.goto(deep);
  await fresh.locator("canvas").first().waitFor({ state: "visible" });
  // DetailPanel populated with the deep-linked node.
  await expect(fresh.locator("aside")).toContainText("HttpClient");
  // Fly-to fired on mount (card C's camera-moved marker).
  await expect(fresh.locator("[data-focus-active='true']")).toHaveCount(1);
  await fresh.close();
});

test("corrupted hash degrades gracefully to the empty state", async ({
  page,
}) => {
  await page.goto("/#g=!!!not-real");
  await expect(
    page.getByText(/corrupted or incomplete/),
  ).toBeVisible();
  // No crash: the empty-state prompt is shown instead of a graph.
  await expect(
    page.getByText(/Drop a graphify/),
  ).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);
});

test("a fresh drop supersedes the previous shared graph", async ({ page }) => {
  await dropGraph(page);
  const firstHash = new URL(page.url()).hash;
  // Drop again (same fixture — the payload is deterministic, so assert the
  // replaceState rewrote the same shape and stats stayed consistent).
  await page.setInputFiles("input[type=file]", FIXTURE);
  await expect(page.locator("canvas").first()).toBeVisible();
  const secondHash = new URL(page.url()).hash;
  expect(secondHash).toMatch(/^#g=/);
  expect(secondHash.length).toBeGreaterThan("#g=".length);
  // Deterministic codec: identical raw input must reproduce the payload,
  // proving the hash tracks what is on screen (not the stale first load).
  expect(secondHash).toBe(firstHash);

  // And a genuinely different graph rewrites the payload entirely.
  await page.evaluate(() => {
    const input = document.querySelector(
      "input[type=file]",
    ) as HTMLInputElement | null;
    if (!input) return;
    const file = new File(
      [
        JSON.stringify({
          nodes: [
            { id: "solo", label: "Solo", community: 0 },
            { id: "peer", label: "Peer", community: 0 },
          ],
          links: [{ source: "solo", target: "peer" }],
        }),
      ],
      "tiny-alt.json",
      { type: "application/json" },
    );
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page.getByRole("button", { name: "Load file…" })).toBeVisible();
  await page.locator("canvas").first().waitFor({ state: "visible" });
  // buildShareHash is async; wait for replaceState to land rather than racing it.
  await expect
    .poll(() => new URL(page.url()).hash, { timeout: 5_000 })
    .not.toBe(firstHash);
});
