import { expect, test } from "@playwright/test";

test("offers location only on search focus and releases tracking when exploring the map", async ({ page }) => {
  await page.addInitScript(() => {
    let nextId = 0;
    const watches = new Map<number, PositionCallback>();
    const snapshot = { calls: 0, cleared: 0, latest: null as PositionCallback | null };
    Object.defineProperty(window, "locationTest", { value: snapshot });
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
      watchPosition(callback: PositionCallback) {
        snapshot.calls++; snapshot.latest = callback;
        const id = ++nextId; watches.set(id, callback);
        setTimeout(() => { if (watches.has(id)) callback({ coords: { latitude: 47.3769, longitude: 8.5417, accuracy: 12,
          altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() } as GeolocationPosition); }, 50);
        return id;
      },
      clearWatch(id: number) { snapshot.cleared++; watches.delete(id); },
      getCurrentPosition() { snapshot.calls++; },
    } });
  });
  await page.goto("/");
  const map = page.getByLabel("Karte der Schweizer Sitzbänke");
  await expect(map).toHaveAttribute("data-map-ready", "true");
  const calls = () => page.evaluate(() => (window as Window & { locationTest?: { calls: number } }).locationTest?.calls);
  expect(await calls()).toBe(0);
  await expect(page.getByRole("button", { name: "Meinen Standort anzeigen", exact: true })).toHaveCount(1);
  const search = page.getByRole("combobox", { name: "Ort suchen" });
  await search.focus();
  const suggestions = page.getByRole("listbox", { name: "Suchergebnisse" });
  await expect(suggestions.getByRole("option")).toHaveCount(1);
  expect(await calls()).toBe(0);
  await search.press("Escape");
  await expect(suggestions).not.toBeVisible();
  await search.press("ArrowDown"); await search.press("Enter");
  await expect(map).toHaveAttribute("data-location-mode", "north");
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  await expect(map).toHaveAttribute("data-center-latitude", "47.376900");
  expect(await calls()).toBe(1);
  await page.locator(".maplibregl-canvas").focus();
  await page.keyboard.press("ArrowRight");
  await expect(map).toHaveAttribute("data-location-mode", "browse");
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  const center = await map.getAttribute("data-center-longitude");
  await page.evaluate(() => {
    const state = (window as Window & { locationTest?: { latest: PositionCallback | null; cleared: number } }).locationTest!;
    if (state.cleared < 1) throw new Error("GPS watch was not cleared");
    state.latest?.({ coords: { latitude: 47.5, longitude: 8.8, accuracy: 5 }, timestamp: Date.now() } as GeolocationPosition);
  });
  await expect(map).toHaveAttribute("data-center-longitude", center!);
  await expect(page.locator(".map-location-control")).toHaveAccessibleName("Meinen Standort anzeigen");
});
