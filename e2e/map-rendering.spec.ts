import { expect, test } from "@playwright/test";

test("renders geographic features through the packaged map worker", async ({ page }, testInfo) => {
  // A local polygon exercises worker startup, GeoJSON tiling and WebGL rendering
  // without depending on swisstopo availability or accepting a blank ready canvas.
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
