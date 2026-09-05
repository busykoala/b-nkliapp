import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JourneyPoint, JourneyQuery } from "./journey";
vi.mock("./security", () => ({ consumeRateLimit: vi.fn() }));
vi.mock("./journey-gtfs", () => ({ lookupTransfer: () => null, transitFeedDate: () => null }));
const origin = { kind: "station" as const, label: "Bern", latitude: 46.949, longitude: 7.439, stationId: "8507000" };
const destination: JourneyPoint = { label: "Spiez Hafenbank", latitude: 46.68844, longitude: 7.68949 };
const query: JourneyQuery = { benchId: "osm-node-1", origin, mode: "walk", time: "2026-09-05T08:00:00Z", arriveBy: false, speedKmh: 4.2, bufferMinutes: 3 };
beforeEach(() => { vi.resetModules(); Reflect.deleteProperty(globalThis, "journeyNetwork"); Reflect.deleteProperty(globalThis, "benchlyWalking"); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
function walkingResponse(points: number[][] = [[7.439,46.949],[7.68949,46.68844]], distance = 700, gap = 0) { const snapped = points.map((p) => [...p]); if (gap) snapped[snapped.length-1][1] += gap / 111195; return { paths: [{ distance, time: distance / (5 / 3.6) * 1000, ascend: 0, points: { coordinates: snapped }, snapped_waypoints: { coordinates: snapped } }] }; }

describe("journey providers", () => {
  it.each([
    { speedKmh: 4.2 as const, bufferMinutes: 3 as const, delay: 0, count: 1 },
    { speedKmh: 3 as const, bufferMinutes: 3 as const, delay: 0, count: 0 },
    { speedKmh: 4.2 as const, bufferMinutes: 6 as const, delay: 0, count: 0 },
    { speedKmh: 4.2 as const, bufferMinutes: 3 as const, delay: 3, count: 0 },
  ])("applies pace $speedKmh, buffer $bufferMinutes and delay $delay to feasibility", async ({ speedKmh, bufferMinutes, delay, count }) => {
    const bern = { id: "8507000", name: "Bern", coordinate: { x: 46.949, y: 7.439 } };
    const spiez = { id: "8507483", name: "Spiez", coordinate: { x: 46.68644, y: 7.67957 } };
    const bus = { id: "8507484", name: "Spiez Bus", coordinate: { x: 46.685, y: 7.680 } };
    const harbour = { id: "8507154", name: "Spiez Schiffstation", coordinate: { x: 46.688478, y: 7.689893 } };
    vi.stubGlobal("fetch", vi.fn(async (input: URL, init?: RequestInit) => {
      const url = new URL(input);
      if (url.pathname.endsWith("locations")) return Response.json({ stations: [harbour] });
      if (url.pathname.endsWith("connections")) return Response.json({ connections: [{ sections: [
        { departure: { station: bern, departure: "2026-09-05T08:05:00Z" }, arrival: { station: spiez, arrival: "2026-09-05T08:35:00Z", prognosis: { arrival: `2026-09-05T08:${35 + delay}:00Z` } }, journey: { category: "RE" } },
        { departure: { station: spiez, departure: "2026-09-05T08:35:00Z" }, arrival: { station: bus, arrival: "2026-09-05T08:41:00Z" }, walk: { duration: 0 } },
        { departure: { station: bus, departure: "2026-09-05T08:45:00Z", platform: "A", prognosis: { platform: "B" } }, arrival: { station: harbour, arrival: "2026-09-05T08:50:00Z" }, journey: { category: "BUS", number: "1" } },
      ] }] });
      const points = JSON.parse(String(init?.body)).points; const walk = walkingResponse(points, points[0][0] === 7.67957 ? 420 : 40);
      return Response.json(walk);
    }));
    const { planJourney } = await import("./journey-provider");
    const result = await planJourney({ ...query, mode: "transit", speedKmh, bufferMinutes }, destination);
    expect(result.options).toHaveLength(count);
    if (count) {
      expect(result.options[0].legs[2].transfer).toMatchObject({ tone: "fits", requiredSeconds: 360, availableSeconds: 600 });
      expect(result.options[0].legs[2].platformChanges?.[0]).toContain("B statt A");
    }
  });
  it("routes the Spiez station-to-harbour walk even when the timetable says duration zero", async () => {
    const bern = { id: "8507000", name: "Bern", coordinate: { x: 46.949, y: 7.439 } };
    const spiez = { id: "8507483", name: "Spiez", coordinate: { x: 46.68644, y: 7.67957 } };
    const harbour = { id: "8507154", name: "Spiez Schiffstation", coordinate: { x: 46.688478, y: 7.689893 } };
    vi.stubGlobal("fetch", vi.fn(async (input: URL, init?: RequestInit) => {
      const url = new URL(input);
      if (url.pathname.endsWith("locations")) return Response.json({ stations: [harbour] });
      if (url.pathname.endsWith("connections")) return Response.json({ connections: [{ sections: [
        { departure: { station: bern, departure: "2026-09-05T08:05:00Z" }, arrival: { station: spiez, arrival: "2026-09-05T08:35:00Z" }, journey: { category: "RE", number: "8", passList: [] } },
        { departure: { station: spiez, departure: "2026-09-05T08:35:00Z" }, arrival: { station: harbour, arrival: "2026-09-05T08:50:00Z" }, walk: { duration: 0 }, journey: null },
      ] }] });
      const points = JSON.parse(String(init?.body)).points; const walk = walkingResponse(points, points[0][0] === 7.67957 ? 850 : 40);
      return Response.json(walk);
    }));
    const { planJourney } = await import("./journey-provider");
    const result = await planJourney({ ...query, mode: "transit" }, destination);
    expect(result.options).toHaveLength(1);
    const option = result.options[0];
    expect(option.legs.map((l) => l.mode)).toEqual(["rail", "walk", "walk"]);
    expect(option.legs[1]).toMatchObject({ from: { label: "Spiez" }, to: { label: "Spiez Schiffstation" }, geometryQuality: "routed", distanceMeters: 850 });
    expect(option.legs[1].durationSeconds).toBeGreaterThan(700);
    expect(option.legs[0].geometryQuality).toBe("schematic");
  });
  it("uses a real foot backend, preserves geometry and adjusts walking-only arrival time", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(walkingResponse())); vi.stubGlobal("fetch", fetcher);
    const { planJourney } = await import("./journey-provider");
    const result = await planJourney({ ...query, arriveBy: true }, destination);
    expect(result.options[0]).toMatchObject({ arrival: new Date(query.time).toISOString(), walkingSeconds: 600, complete: true });
    expect(Date.parse(result.options[0].departure)).toBe(Date.parse(query.time) - 600000);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("127.0.0.1:8989/route");
  });
  it("marks snapped endpoint gaps instead of claiming to reach an unmapped bench", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(walkingResponse(undefined, 700, 80))));
    const { planJourney } = await import("./journey-provider");
    const result = await planJourney(query, destination);
    expect(result.options[0].complete).toBe(false);
    expect(result.options[0].legs[0].warnings[0]).toContain("80 m");
  });
  it("fails softly without inventing a walking line", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: "NoRoute" })));
    const { planJourney } = await import("./journey-provider");
    expect(await planJourney(query, destination)).toMatchObject({ options: [], partial: true });
  });
  it("enforces a 15 second deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }))));
    const { planJourney } = await import("./journey-provider");
    const pending = planJourney(query, destination);
    await vi.advanceTimersByTimeAsync(15001);
    expect(await pending).toMatchObject({ options: [], partial: true });
  });
});
