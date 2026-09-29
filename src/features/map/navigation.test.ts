import { afterEach, describe, expect, it, vi } from "vitest";
import { benchHistoryCloseAction, pushBenchHistoryEntry, readBenchHistoryEntry, type BenchReturnContext } from "./navigation";

// No DOM runtime is needed: only the public History API boundary is mocked.
afterEach(() => { vi.unstubAllGlobals(); });

describe("bench history", () => {
  it("pushes only app-owned state so Next can synchronize its URL hooks", () => {
    const pushState = vi.fn();
    const previousState = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: "router-owned" } };
    vi.stubGlobal("window", {
      location: { href: "https://benchly.example/?action=walk&amenity=wc&filter=sun#map" },
      history: { state: previousState, pushState },
    });
    const returnContext: BenchReturnContext = { kind: "map", cameraInteraction: 0 };

    pushBenchHistoryEntry("osm-node-101", returnContext);

    expect(pushState).toHaveBeenCalledExactlyOnceWith({
      benchly: { version: 1, task: "bench", benchId: "osm-node-101", returnContext },
    }, "", "/?filter=sun&bank=osm-node-101#map");
    expect(previousState).toEqual({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: "router-owned" } });
  });

  it.each<BenchReturnContext>([
    { kind: "map", cameraInteraction: 2 },
    { kind: "list", benchId: "bench / 1", scrollTop: 128, cameraInteraction: 2,
      camera: { center: [8.54, 47.37], zoom: 15, bearing: 12, pitch: 0 } },
    { kind: "walk" },
  ])("retains the $kind return context without private router fields", (returnContext) => {
    const pushState = vi.fn();
    vi.stubGlobal("window", {
      location: { href: "https://benchly.example/?bank=previous" },
      history: { state: null, pushState },
    });
    pushBenchHistoryEntry("bench / 1", returnContext);

    const [state, , path] = pushState.mock.calls[0];
    expect(readBenchHistoryEntry(state)).toEqual({ version: 1, task: "bench", benchId: "bench / 1", returnContext });
    expect(new URL(path, "https://benchly.example").searchParams.get("bank")).toBe("bench / 1");
  });
  it("waits for Next to commit an owned bench URL before traversing history", () => {
    const pending = { benchId: "osm-node-101", backStarted: false };
    expect(benchHistoryCloseAction(pending, "osm-node-101", null)).toBe("wait");
    expect(benchHistoryCloseAction(pending, "osm-node-101", "osm-node-101")).toBe("back");
    expect(benchHistoryCloseAction(pending, null, null)).toBe("complete");
  });

  it("completes an owned close only after both URL views reached the return entry", () => {
    const pending = { benchId: "osm-node-101", backStarted: true };
    expect(benchHistoryCloseAction(pending, null, "osm-node-101")).toBe("wait");
    expect(benchHistoryCloseAction(pending, null, null)).toBe("complete");
    expect(benchHistoryCloseAction(pending, "osm-node-202", "osm-node-202")).toBe("abandon");
  });

});
