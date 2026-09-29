import { expect, test } from "@playwright/test";

// Keep map fixtures under Playwright routing; service-worker requests can bypass
// those routes in WebKit. Offline behaviour has its own service-worker suite.
test.use({ serviceWorkers: "block" });

test("applies facility filters while the basemap is still loading", async ({ page, context }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let requested = false;
  await context.route("**/pending-map-land.json", async (route) => {
    requested = true;
    await pending;
    await route.fulfill({ json: { type: "FeatureCollection", features: [] } });
  });
  await page.route("https://vectortiles.geo.admin.ch/styles/**", (route) => route.fulfill({
    json: {
      version: 8,
      sources: { land: { type: "geojson", data: new URL("/pending-map-land.json", page.url()).href } },
      layers: [{ id: "pending-land", type: "fill", source: "land", paint: { "fill-color": "#f8efdc" } }],
    },
  }));
  try {
    await page.goto("/");
    await expect(page.getByLabel("Karte der Schweizer Sitzbänke")).toHaveAttribute("data-map-ready", "true");
    await expect.poll(() => requested).toBe(true);
    await page.getByRole("button", { name: "Filter öffnen" }).click();
    const response = page.waitForResponse((value) => value.request().method() === "POST"
      && Boolean(value.request().postData()?.includes('"toiletsNearby":true')));
    await page.getByRole("button", { name: "Toilette bis 250 m", exact: true }).click();
    expect((await response).ok()).toBe(true);
    await page.getByRole("button", { name: "Karte ansehen" }).click();
    await expect(page.getByRole("button", { name: "Toilette bis 250 m entfernen" })).toBeVisible();
  } finally {
    release();
  }
});

test("renders geographic features through the packaged map worker", async ({ page }, testInfo) => {
  // A local polygon exercises worker startup, GeoJSON tiling and WebGL rendering
  // without depending on swisstopo availability or accepting a blank ready canvas.
  // Decorative paint is tested separately; it can change the sampled polygon colour.
  await page.route("**/map-art/textures/{palette-wash,field}.webp", (route) => route.abort());
  await page.route("https://vectortiles.geo.admin.ch/styles/**", (route) => route.fulfill({
    json: {
      version: 8,
      sources: {
        land: {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Polygon",
              coordinates: [[[5, 45], [11, 45], [11, 49], [5, 49], [5, 45]]],
            },
          },
        },
      },
      layers: [
        { id: "background", type: "background", paint: { "background-color": "#f8efdc" } },
        { id: "test-land", type: "fill", source: "land", paint: { "fill-color": "#3830d9" } },
      ],
    },
  }));
  await page.goto("/");
  const map = page.getByLabel("Karte der Schweizer Sitzbänke");
  await expect(map).toHaveAttribute("data-map-ready", "true");
  const box = (await map.boundingBox())!;
  await expect.poll(async () => {
    const screenshot = await page.screenshot({
      clip: { x: box.x + box.width / 2 - 20, y: box.y + box.height / 2 - 20, width: 40, height: 40 },
      animations: "disabled",
      scale: "css",
    });
    return page.evaluate(async (encoded) => {
      const image = new Image();
      image.src = `data:image/png;base64,${encoded}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let bluePixels = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 2] > data[i] + 50 && data[i + 2] > data[i + 1] + 50) bluePixels += 1;
      }
      return bluePixels / (canvas.width * canvas.height);
    }, screenshot.toString("base64"));
  }, { message: "The map must paint the geographic polygon, not just initialize", timeout: 10_000 }).toBeGreaterThan(.9);
  await map.screenshot({ path: testInfo.outputPath("rendered-map.png"), animations: "disabled" });
});

test("opens a linked walk before the basemap becomes ready", async ({ page }) => {
  const time = new Date("2026-09-05T10:00:00Z");
  await page.clock.install({ time });
  await page.clock.pauseAt(new Date(time.getTime() + 1_000));
  let release!: () => void;
  const pendingStyle = new Promise<void>((resolve) => { release = resolve; });
  await page.route("https://vectortiles.geo.admin.ch/styles/**", async (route) => {
    await pendingStyle;
    await route.fulfill({ json: {
      version: 8, sources: {},
      layers: [{ id: "paper", type: "background", paint: { "background-color": "#f8efdc" } }],
    } });
  });
  try {
    await page.goto("/?action=walk", { waitUntil: "domcontentloaded" });
    const panel = page.getByRole("complementary", { name: "Spaziergang entdecken", exact: true });
    // Run UI frames, not the three-second basemap fallback: the walk must not
    // depend on which happens to finish first on a fast/slow runner.
    await expect.poll(async () => {
      await page.clock.runFor(50);
      return panel.isVisible();
    }).toBe(true);
    await page.clock.runFor(32);
    await expect(panel.getByRole("heading", { name: "Spaziergang entdecken", exact: true })).toBeFocused();
    await expect(page.getByLabel("Karte der Schweizer Sitzbänke")).not.toHaveAttribute("data-map-ready", "true");
    await expect(panel.getByRole("button", { name: "Bänkli-Spaziergang finden", exact: true })).toBeDisabled();
  } finally {
    release();
    await page.clock.resume();
    await page.unrouteAll({ behavior: "wait" });
  }
});
