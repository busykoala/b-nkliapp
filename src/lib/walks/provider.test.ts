import { beforeEach, expect, it, vi } from "vitest";
import type { WalkQuery } from "./model";
import type { WalkPath } from "../walking";
const mocks = vi.hoisted(() => ({ route: vi.fn(), rows: vi.fn() }));
vi.mock("@/db/client", () => ({ sqlite: { prepare: () => ({ all: mocks.rows }) } }));
vi.mock("../walking-provider", () => ({ routeWalk: mocks.route }));
vi.mock("./evidence", () => ({ evaluateRoute: () => ({ quiet: 1, nature: .8, view: null, water: null, light: null, coverage: 1, lightCoverage: 0, reasons: ["Wenig Hauptstrasse"], warnings: [], updatedAt: null }) }));
import { discoverWalks } from "./provider";
const query: WalkQuery = { origin: { label: "Start", kind: "location", latitude: 46.68, longitude: 7.68 }, minutes: 30, shape: "one-way", light: "any", speed: 4.2, difficulty: "easy", time: new Date().toISOString() };
beforeEach(() => { mocks.route.mockReset(); mocks.rows.mockReturnValue([{ id: "bench", name: "Hafenbänkli", latitude: 46.685, longitude: 7.685, waterfront: 1, view_score: 80, view_confidence: "mittel" }]); });
it("returns honest no-result state without inventing missing geometry", async () => {
  mocks.route.mockRejectedValue(new Error("offline"));
  expect(await discoverWalks(query)).toMatchObject({ suggestions: [], partial: true });
});
it("uses actual slope-aware duration and labels budget mismatch", async () => {
  const path: WalkPath = { geometry: [[7.68, 46.68], [7.685, 46.685]], distance: 850, referenceSeconds: 600, ascent: 20, warnings: [], instructions: [], details: {} };
  mocks.route.mockResolvedValue([path]);
  const result = await discoverWalks(query);
  expect(result.suggestions[0]).toMatchObject({ durationSeconds: 715, withinBudget: false, extraBenches: [] });
  expect(result.message).toContain("tatsächliche Dauer");
});
it("excludes unresolved access and stays within routing budget", async () => {
  mocks.rows.mockReturnValue(Array.from({ length: 40 }, (_, i) => ({ id: `bench-${i}`, name: null, latitude: 46.685 + i / 100000, longitude: 7.685, waterfront: 0, view_score: null })));
  mocks.route.mockResolvedValue([{ geometry: [[7.68, 46.68], [7.685, 46.685]], distance: 850, referenceSeconds: 600, ascent: 20, warnings: ["Zugang fehlt"], instructions: [], details: {} }]);
  const result = await discoverWalks(query);
  expect(result.suggestions).toHaveLength(0);
  expect(mocks.route.mock.calls.length).toBeLessThanOrEqual(24);
});
it("does not call routing when no active bench candidates exist", async () => {
  mocks.rows.mockReturnValue([]);
  expect((await discoverWalks(query)).message).toContain("kein passendes Bänkli");
  expect(mocks.route).not.toHaveBeenCalled();
});
it("keeps an origin snap gap visible without inventing access to the planned bench", async () => {
  const warning = "Start: 24 m bis zum kartierten Weg. Zugang vor Ort prüfen.";
  const path: WalkPath = { geometry: [[7.68, 46.68], [7.685, 46.685]], distance: 850, referenceSeconds: 600, ascent: 20, warnings: [warning], instructions: [], details: {} };
  mocks.route.mockResolvedValue([path]);
  expect((await discoverWalks(query)).suggestions[0].path.warnings).toEqual([warning]);
  mocks.route.mockResolvedValue([{ ...path, warnings: ["Ziel: 24 m bis zum kartierten Weg. Zugang vor Ort prüfen."] }]);
  expect((await discoverWalks(query)).suggestions).toEqual([]);
});
