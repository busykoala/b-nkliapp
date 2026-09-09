import { expect, it } from "vitest";
import { finalWalkingLeg, journeyExternalLinks } from "./journey-links";
import { summarizeJourney, type JourneyLeg } from "./journey";
const from = { label: "Zürich HB", latitude: 47.378, longitude: 8.54, stationId: "8503000" };
const stop = { label: "Spiez", latitude: 46.686, longitude: 7.681, stationId: "8507483" };
const bench = { label: "Bänkli am Hafen", latitude: 46.69, longitude: 7.69 };
const train: JourneyLeg = { id: "train", mode: "rail", from, to: stop, departure: "2026-09-09T23:30:00Z", arrival: "2026-09-10T01:30:00Z", durationSeconds: 7200, predicted: false, geometry: [], geometryQuality: "schematic", warnings: [] };
const walk: JourneyLeg = { ...train, id: "walk", mode: "walk", from: stop, to: bench, departure: train.arrival, arrival: "2026-09-10T01:40:00Z", durationSeconds: 600, geometryQuality: "routed" };
it("hands the selected transit leg to SBB with Swiss time and the full route to maps", () => {
  const option = summarizeJourney("option", [train, walk]);
  const links = journeyExternalLinks(option);
  const sbb = new URL(links.sbb!);
  expect(JSON.parse(sbb.searchParams.get("date")!)).toBe("2026-09-10");
  expect(JSON.parse(sbb.searchParams.get("time")!)).toBe("01:30");
  expect(JSON.parse(sbb.searchParams.get("stops")!)[1].value).toBe("8507483");
  expect(new URL(links.maps!).searchParams.get("destination")).toBe("46.69,7.69");
  expect(finalWalkingLeg(option)).toEqual(walk);
});
it("opens a walking route in maps without inventing an SBB connection", () => {
  const links = journeyExternalLinks(summarizeJourney("walking", [walk]));
  expect(links.sbb).toBeNull();
  expect(new URL(links.maps!).searchParams.get("travelmode")).toBe("walking");
});
