import { expect, it } from "vitest";
import type { PlaceResult } from "@/lib/types";
import { distinctPlaceResults, placeLabel } from "./place-label";

it("removes repeated place context while preserving the supplied name", () => {
  expect(placeLabel(["Lindenhof, Zürich", "Lindenhof, Zürich", "Zürich"])).toBe("Lindenhof, Zürich");
  expect(placeLabel(["Le repos, Genève", "GENÈVE", "GE"])).toBe("Le repos, Genève · GE");
  expect(placeLabel(["Zürich, Zürich", "Zürich"])).toBe("Zürich, Zürich");
});

it("keeps distinguishing context and postcodes without matching partial words", () => {
  expect(placeLabel(["Zürichblick", "Zürich", "ZH"])).toBe("Zürichblick · Zürich · ZH");
  expect(placeLabel(["8001", "Zürich", "Zürich"], " ")).toBe("8001 Zürich");
  expect(placeLabel([null, "", undefined, "Bern"])).toBe("Bern");
});

const result = (id: string, kind: PlaceResult["kind"], label = "Lindenhof, Zürich"): PlaceResult => ({ id, kind, label, latitude: 47.3767, longitude: 8.5418 });

it("keeps bench and locality choices even when their display names match", () => {
  expect(distinctPlaceResults([result("bench-101", "bench"), result("local-1", "place")]).map(item => item.id)).toEqual(["bench-101", "local-1"]);
});

it("removes repeated suggestions only within the same kind", () => {
  const suggestions = [result("local-1", "place"), result("remote-1", "place", "LINDENHOF, ZÜRICH"), result("station-1", "station"), result("address-1", "address"), result("local-2", "place", "Lindenhof, Bern")];
  expect(distinctPlaceResults(suggestions).map(item => item.id)).toEqual(["local-1", "station-1", "address-1", "local-2"]);
});
