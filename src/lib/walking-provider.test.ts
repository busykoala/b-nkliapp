import { afterEach, beforeEach, expect, it, vi } from "vitest";
const a = { label: "Start", latitude: 46.6, longitude: 7.6 }, b = { label: "Bänkli", latitude: 46.61, longitude: 7.61 };
beforeEach(() => { vi.resetModules(); Reflect.deleteProperty(globalThis, "benchlyWalking"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
const answer = { paths: [{ distance: 1000, time: 900000, ascend: 50, points: { coordinates: [[7.6, 46.6, 600], [7.61, 46.61, 650]] }, snapped_waypoints: { coordinates: [[7.6, 46.6], [7.61, 46.61]] } }] };
it("uses a server-configured POST endpoint, slope time, and privacy-separated bounded caches", async () => {
  const fetcher = vi.fn(async () => Response.json(answer)); vi.stubGlobal("fetch", fetcher);
  vi.stubEnv("WALK_ROUTER_URL", "http://graphhopper.routing.svc.cluster.local:8989");
  const { routeWalk } = await import("./walking-provider");
  const signal = new AbortController().signal;
  expect((await routeWalk({ points: [a, b] }, signal))[0]).toMatchObject({ ascent: 50, referenceSeconds: 900 });
  await routeWalk({ points: [a, b] }, signal);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await routeWalk({ points: [a, b] }, signal, false);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(String((fetcher.mock.calls as unknown[][])[0][0])).toBe("http://graphhopper.routing.svc.cluster.local:8989/route");
  expect((fetcher.mock.calls as unknown as [URL, RequestInit][])[0][1]).toMatchObject({ method: "POST", cache: "no-store", redirect: "error" });
});
it("expires personal coordinate caches even without subsequent traffic", async () => {
  vi.useFakeTimers(); const fetcher = vi.fn(async () => Response.json(answer)); vi.stubGlobal("fetch", fetcher);
  const { routeWalk } = await import("./walking-provider");
  await routeWalk({ points: [a, b] }, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(300001);
  await routeWalk({ points: [a, b] }, new AbortController().signal);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("does not retry or contact a public routing service when unavailable", async () => {
  const fetcher = vi.fn(async () => new Response("busy", { status: 503 })); vi.stubGlobal("fetch", fetcher);
  const { routeWalk } = await import("./walking-provider");
  await expect(routeWalk({ points: [a, b] }, new AbortController().signal)).rejects.toThrow();
  await expect(routeWalk({ points: [a, b] }, new AbortController().signal)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("accepts generated round-trip waypoints but checks both ends against the origin", async () => {
  const loop = { paths: [{ ...answer.paths[0], snapped_waypoints: { coordinates: [[7.6, 46.6], [7.61, 46.61], [7.6, 46.6]] } }] };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(loop)));
  const { routeWalk } = await import("./walking-provider");
  const [path] = await routeWalk({ points: [a], roundTrip: { meters: 3500, seed: 0 } }, new AbortController().signal);
  expect(path.warnings).toEqual([]);
});
