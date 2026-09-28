import { afterEach, describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import { createLocationController, type LocationState } from "./location-controller";
import { showUserHeading } from "./renderer";

vi.mock("./renderer", () => ({ showUserPosition: vi.fn(() => true), showUserHeading: vi.fn() }));

type CameraEvent = { type: string; locationFollow?: boolean };
type CameraListener = (event: CameraEvent) => void;
const disposers: Array<() => void> = [];

function setup() {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(0);
  vi.stubGlobal("performance", { now: () => Date.now() });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  const windowTarget = Object.assign(new EventTarget(), {
    screen: { orientation: { angle: 0 } },
    matchMedia: () => ({ matches: false }),
    DeviceOrientationEvent: Event,
  });
  const documentTarget = Object.assign(new EventTarget(), { hidden: false });
  const canvas = new EventTarget();
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("document", documentTarget);
  let deliverPosition: PositionCallback | undefined;
  const geolocation = {
    watchPosition: vi.fn((success: PositionCallback) => { deliverPosition = success; return 1; }),
    clearWatch: vi.fn(),
  };
  vi.stubGlobal("navigator", { geolocation });
  const dataset: Record<string, string> = {};
  const listeners = new Map<string, Set<CameraListener>>();
  const fire = (type: string, data: Omit<CameraEvent, "type"> = {}) => {
    for (const listener of listeners.get(type) ?? []) listener({ type, ...data });
  };
  let bearing = 0;
  const map = {
    getContainer: () => ({ dataset }),
    getCanvas: () => canvas,
    getZoom: () => 17,
    getBearing: () => bearing,
    getMaxBounds: () => null,
    easeTo: vi.fn((options: { bearing: number }, data: Omit<CameraEvent, "type">) => {
      bearing = options.bearing;
      fire("movestart", data);
      fire("rotate", data);
    }),
    on: (type: string, listener: CameraListener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    off: (type: string, listener: CameraListener) => { listeners.get(type)?.delete(listener); },
  };
  const publish = vi.fn<(state: LocationState) => void>();
  const notify = vi.fn();
  // The camera boundary is controlled here; the controller and scheduler are real.
  const controller = createLocationController(map as unknown as MapLibreMap, publish, notify);
  disposers.push(controller.destroy);
  const position: GeolocationPosition = {
    coords: { latitude: 47.37674, longitude: 8.54183, accuracy: 12.4, altitude: null,
      altitudeAccuracy: null, heading: null, speed: null, toJSON: () => ({}) },
    timestamp: 0,
    toJSON: () => ({}),
  };
  const orient = (heading: number) => windowTarget.dispatchEvent(Object.assign(new Event("deviceorientationabsolute"), {
    alpha: (360 - heading) % 360, absolute: true,
  }));
  const pointer = (type: "pointerdown" | "pointerup", id = 1) => {
    const event = Object.assign(new Event(type), { pointerId: id });
    (type === "pointerdown" ? canvas : windowTarget).dispatchEvent(event);
  };
  const enable = async (heading: number) => {
    controller.locate();
    deliverPosition!(position);
    const permission = controller.toggle();
    orient(heading);
    await permission;
    expect(dataset.locationMode).toBe("heading");
    expect(dataset.deviceHeading).toBe(String(heading));
    map.easeTo.mockClear();
  };
  return { controller, map, dataset, geolocation, documentTarget, publish, notify, orient, pointer, enable, fire,
    deliver: () => deliverPosition!(position) };
}

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("location tracking", () => {
  it.each([[90, 180], [359, 1], [1, 359]])("settles from %s to %s after a single sample, then stops scheduling", async (from, to) => {
    const view = setup();
    await view.enable(from);
    view.orient(to);
    await vi.advanceTimersByTimeAsync(1_200);
    expect(view.dataset.deviceHeading).toBe(String(to));
    expect(view.dataset.locationMode).toBe("heading");
    expect(view.map.easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ bearing: to }), { locationFollow: true });
    expect(vi.getTimerCount()).toBe(0);
    expect(view.map.easeTo.mock.calls.length).toBeLessThanOrEqual(12);
  });

  it("keeps a trailing reading even when it arrives inside the paint interval", async () => {
    const view = setup();
    await view.enable(90);
    view.orient(150);
    await vi.advanceTimersByTimeAsync(112);
    expect(Number(view.dataset.deviceHeading)).toBeGreaterThan(90);
    view.orient(180);
    await vi.advanceTimersByTimeAsync(1_200);
    expect(view.dataset.deviceHeading).toBe("180");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("freezes queued updates for every held pointer and resumes the last accepted target on release", async () => {
    const view = setup();
    await view.enable(90);
    view.orient(180);
    view.pointer("pointerdown");
    view.pointer("pointerdown", 2);
    view.orient(270); // Not accepted while the person holds the map.
    await vi.advanceTimersByTimeAsync(400);
    expect(view.dataset.deviceHeading).toBe("90");
    expect(view.map.easeTo).not.toHaveBeenCalled();
    view.pointer("pointerup");
    await vi.advanceTimersByTimeAsync(200);
    expect(view.dataset.deviceHeading).toBe("90");
    view.pointer("pointerup", 2);
    await vi.advanceTimersByTimeAsync(1_200);
    expect(view.dataset.deviceHeading).toBe("180");
  });

  it("updates the cone in north-up mode without rotating the map", async () => {
    const view = setup();
    await view.enable(90);
    view.controller.north();
    view.map.easeTo.mockClear();
    view.orient(180);
    await vi.advanceTimersByTimeAsync(1_200);
    expect(view.dataset.locationMode).toBe("north");
    expect(view.dataset.deviceHeading).toBe("180");
    expect(showUserHeading).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ latitude: 47.37674 }), 180);
    expect(view.map.easeTo).not.toHaveBeenCalled();
    await view.controller.toggle();
    expect(view.dataset.locationMode).toBe("heading");
    expect(view.map.easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ bearing: 180 }), { locationFollow: true });
  });

  it.each(["explore", "hidden", "destroy"] as const)("cancels queued readings and ignores late GPS/sensor events on %s", async (reason) => {
    const view = setup();
    await view.enable(90);
    view.orient(180);
    if (reason === "explore") view.fire("movestart");
    else if (reason === "hidden") {
      view.documentTarget.hidden = true;
      view.documentTarget.dispatchEvent(new Event("visibilitychange"));
    } else view.controller.destroy();
    expect(view.dataset.locationMode).toBe("browse");
    expect(view.dataset.deviceHeading).toBeUndefined();
    expect(view.geolocation.clearWatch).toHaveBeenCalledWith(1);
    const publications = view.publish.mock.calls.length;
    view.orient(270);
    view.deliver();
    await vi.advanceTimersByTimeAsync(1_200);
    expect(view.map.easeTo).not.toHaveBeenCalled();
    expect(view.publish.mock.calls.length).toBe(publications);
    expect(vi.getTimerCount()).toBe(0);
  });
});
