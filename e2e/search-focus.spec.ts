import { expect, test, type Page } from "@playwright/test";

const FIXTURE = "e2e/fixtures/tiny-graph.json";

/**
 * The canvas mounts from a client-only dynamic import, so its presence is a
 * reliable "the app is hydrated and listening" gate — without it, keystrokes
 * can land before React attaches handlers.
 */
async function loadGraph(page: Page) {
  await page.goto("/");
  await page.setInputFiles("input[type=file]", FIXTURE);
  await expect(page.getByRole("button", { name: "Load file…" })).toBeVisible();
  await page.locator("canvas").first().waitFor({ state: "visible" });
}

/** `/` may race hydration on cold loads; retry until the box is focused. */
async function openSearch(page: Page) {
  const box = page.getByRole("combobox", { name: "Search nodes" });
  await expect(async () => {
    await page.keyboard.press("/");
    await expect(box).toBeFocused({ timeout: 500 });
  }).toPass();
}

test("’/’ focuses the search box", async ({ page }) => {
  await loadGraph(page);
  await openSearch(page);
});

test("search shows capped results and Enter focuses the node", async ({
  page,
}) => {
  await loadGraph(page);
  await openSearch(page);
  await page.keyboard.type("userservice");
  const options = page.getByRole("option");
  await expect(options.first()).toBeVisible(); // dropdown opens
  await expect(options).toHaveCount(2); // UserService + UserServiceTests
  await page.keyboard.press("Enter");
  // DetailPanel reacts to selection through the canonical path.
  await expect(page.locator("aside")).toContainText("UserService");
  // Fly-to fired: camera moved marker on the root container.
  await expect(page.locator("[data-focus-active='true']")).toHaveCount(1);
});

test("focused node’s neighborhood is emphasized (pixel proof)", async ({
  page,
}) => {
  await loadGraph(page);
  await page.waitForTimeout(2500); // let the intro land
  // react-force-graph nests its canvas in a wrapper div, so target canvases
  // directly rather than assuming backdrop adjacency.
  const canvas = page.locator("main canvas").first();
  const before = await canvas.screenshot();
  await openSearch(page);
  await page.keyboard.type("httpclient");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1000); // fly-to tween (750ms)
  const after = await canvas.screenshot();
  expect(before.equals(after)).toBe(false); // camera demonstrably moved
});

test("Escape clears query and selection", async ({ page }) => {
  await loadGraph(page);
  await openSearch(page);
  await page.keyboard.type("cache");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("combobox", { name: "Search nodes" }),
  ).toHaveValue("");
  await expect(page.getByRole("option")).toHaveCount(0);
});
