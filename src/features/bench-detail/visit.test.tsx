import { describe, expect, it } from "vitest";
import { renderTranslated } from "@/test/render";
import { sourceBench } from "@/test/bench-source-fixture";
import { BenchOverview, BenchRatingLink, BenchVisitWarnings } from "./components/bench-overview";
import { BenchVisitDetails } from "./components/bench-visit-details";
import { visitAccessState } from "./overview";

const noop = () => {};

describe("field-guide visit information", () => {
  it("keeps visit details while excluding operational diagnostics in every language", () => {
    for (const language of ["de", "fr", "it", "rm"] as const) {
      const bench = sourceBench();
      const html = renderTranslated(<BenchVisitDetails bench={bench} />, language);
      expect(html.match(/<details\b/g)).toHaveLength(1);
      expect(html).not.toMatch(/<details[^>]* open/);
      expect(html).toMatch(/7[,.]5/);
      expect(html).not.toMatch(/Lärmmodell|Datenstand|confidence|fixture-noise|fixture-image-model|source-versions|completeness/);
      expect(html).not.toContain("51 dB");
      expect(html).not.toContain("93%");
    }
  });

  it("never certifies an entire approach from a level space or hides known obstacles", () => {
    const bench = sourceBench();
    expect(visitAccessState(bench).unknown).toBe(true);
    bench.knowledge!.approach!.steps = true;
    bench.knowledge!.approach!.stepFreePossible = false;
    bench.removalConfirmationCount = 1;
    const html = renderTranslated(<BenchVisitWarnings bench={bench} />);
    expect(html).toContain("Stufen am Zugang");
    expect(html).toContain("Hindernis bekannt");
    expect(html).toContain("möglicherweise nicht mehr vorhanden");
    expect(html).not.toContain("noch nicht ausreichend bekannt");
    expect(renderTranslated(<BenchVisitDetails bench={bench} />)).toContain("noch nicht ausreichend bekannt");
  });

  it("omits empty ratings and unresolved equipment without fabricating positive facts", () => {
    const bench = sourceBench({ ratingAverage: null, ratingCount: 0, properties: [] });
    expect(renderTranslated(<BenchRatingLink bench={bench} onReviews={noop} />)).toBe("");
    const html = renderTranslated(<BenchOverview bench={bench} />);
    expect(html).not.toContain("Rückenlehne");
    expect(html).not.toContain("overview-fact");
    expect(html).not.toContain("–");
    const conflicting = sourceBench();
    conflicting.properties = [{ ...conflicting.properties[0], evidenceState: "conflicting" }];
    expect(renderTranslated(<BenchOverview bench={conflicting} />)).not.toContain("Rückenlehne");
  });

  it("prioritizes view, seating and modelled traffic without seat counts or raw decibels", () => {
    const bench = sourceBench();
    bench.properties.push({ key: "seats", value: "6", label: "Sitzplätze", canonicalValue: 6, evidenceState: "known", source: "OpenStreetMap" });
    for (const language of ["de", "fr", "it", "rm"] as const) {
      const html = renderTranslated(<><BenchOverview bench={bench} /><BenchVisitDetails bench={bench} /></>, language);
      expect(html).not.toMatch(/Sitzplätze|posti a sedere|places assises|plazzas da seser|dB\(A\)/);
    }
  });

  it("keeps a real rating reachable with its count", () => {
    const html = renderTranslated(<BenchRatingLink bench={sourceBench({ ratingAverage: 4.2, ratingCount: 3 })} onReviews={noop} />);
    expect(html).toMatch(/4[,.]2/);
    expect(html).toContain("3 Bewertungen");
  });
});

it("shows at most three resolved hints without duplicate weather, scenery or unknown traffic", () => {
  const bench = sourceBench();
  let html = renderTranslated(<BenchOverview bench={bench} />);
  expect(html.match(/data-visit-hint=/g)).toHaveLength(3);
  expect(html).not.toMatch(/18 °C|Bergblick|Ohne Dach|Sonne ab|Sonne bis/);
  bench.knowledge!.noise = [];
  html = renderTranslated(<BenchOverview bench={bench} />);
  expect(html.match(/data-visit-hint=/g)).toHaveLength(2);
  expect(html).not.toContain("Verkehrslärm noch nicht erfasst");
  expect(renderTranslated(<BenchOverview bench={{ ...bench, sunnyNow: null, properties: [] }} />)).toBe("");
});
