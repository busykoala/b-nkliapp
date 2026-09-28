import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderTranslated } from "@/test/render";
import { sourceBench } from "@/test/bench-source-fixture";
import { testTranslator } from "@/test/translations";
import { BenchSources } from "./components/bench-sources";
import { sourceDuration, sourceFractionPercent, sourceWindows } from "./source-data";
import { sourceEvidenceRows, sourceVersionRows } from "./source-evidence";

const t = testTranslator();

describe("sources appendix: one value, one explanation, one place", () => {
  it("joins evidence to canonical values once, without guessing a conflicting value", () => {
    const bench = sourceBench();
    bench.properties.push(
      { key: "seats", label: "Sitze", value: "2", canonicalValue: 0, evidenceState: "known", source: "Bänkli App" },
      { key: "wasteBasketNearby", label: "Abfall", value: "Ja", canonicalValue: true, evidenceState: "known", source: "OpenStreetMap" },
    );
    bench.knowledge!.attributes[0].conflicting = true;
    const before = JSON.stringify(bench);
    const rows = sourceEvidenceRows(bench, t);
    expect(rows.filter((row) => row.key === "backrest")).toHaveLength(1);
    expect(rows.find((row) => row.key === "backrest")).toMatchObject({ value: t("common.values.open"), conflicting: true, status: "Widersprüchliche Hinweise" });
    expect(rows.find((row) => row.key === "covered")?.value).toBe("Nein");
    expect(rows.find((row) => row.key === "seats")?.value).toBe("0");
    expect(rows.some((row) => row.key === "wasteBasketNearby")).toBe(false);
    expect(JSON.stringify(bench)).toBe(before);
  });

  it("retains zero durations, rejects invalid ones and preserves separate sun windows", () => {
    expect([null, NaN, -1, 0, 90.7, 120].map(sourceDuration)).toEqual([null, null, null, "0 min", "1 h 31 min", "2 h"]);
    expect(sourceWindows([
      { start: "08:30", end: "11:00" }, { start: "08:30", end: "11:00" },
      { start: "15:00", end: "17:00" }, { start: "25:00", end: "26:00" },
      { start: "10:00", end: "10:00" }, { start: "23:30", end: "24:00" },
    ])).toBe("08:30–11:00 · 15:00–17:00 · 23:30–24:00");
  });

  it("uses the worker’s fraction units for canopy radii, without guessing at invalid data", () => {
    expect([null, NaN, -.1, 1.1, 0, .1, .93, 1].map(sourceFractionPercent)).toEqual([null, null, null, null, "0%", "10%", "93%", "100%"]);
  });

  it("has five ordered sections, no nested accordion and no decorative model ratings", () => {
    const html = renderTranslated(createElement(BenchSources, { bench: sourceBench() }));
    expect([...html.matchAll(/<h3>(.*?)<\/h3>/g)].map((match) => match[1])).toEqual([
      "Eintrag &amp; Lage", "Zugang &amp; Einrichtungen", "Licht &amp; Wetter", "Umgebung &amp; Verkehrslärm", "Datenabdeckung &amp; Bildmodelle",
    ]);
    expect(html.match(/<details\b/g)).toHaveLength(1);
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html).not.toMatch(/view-score-art|horizon-ring|confidence-dots|class="slope-gauge"/);
    expect(html).not.toContain("Aussicht 4 von 5");
    expect(html.match(/<h4>Das letzte Wegstück<\/h4>/g)).toHaveLength(1);
    expect(html.match(/<h4>Was den Horizont prägt<\/h4>/g)).toHaveLength(1);
    expect(html.match(/data-attribute="backrest"/g)).toHaveLength(1);
    expect(html).toContain("Himmelsoffenheit: 93%");
    expect(html).toContain("4 von 7 Angaben");
    expect(html).not.toContain("205° · 205°");
    expect(html).toContain("Baumdeckung im Umkreis von 10 m</dt><dd>10%");
  });

  it("keeps provenance, access limits and model coverage readable instead of hiding them in icons", () => {
    const bench = sourceBench();
    bench.knowledge!.attributes[0].conflicting = true;
    const html = renderTranslated(createElement(BenchSources, { bench }));
    expect(html).toContain("Widersprüchliche Hinweise");
    expect(html).toContain("Geländehöhe an 10 von 12 Wegpunkten verfügbar.");
    expect(html).toContain("keine Zusage zur Barrierefreiheit");
    expect(html).toContain("keine Live-Messung");
    expect(html).toContain("Ein Brunnen ist nicht automatisch Trinkwasser.");
    expect(html).toContain("fixture-image-model");
    const versions = sourceVersionRows(bench, t);
    expect(versions.find(([label]) => label.includes("Strasse · Tag"))?.[1]).toBe(bench.knowledge!.noise[0].datasetVersion);
  });

  it("handles a sparse entry without turning missing weather, source versions or openness into zero", () => {
    const bench = sourceBench({ knowledge: undefined, properties: [], weather: null, elevationMeters: null, directionDegrees: null, pipelineVersion: null, osmVersion: null, nearOpenness: null, viewComponents: { openness: null, relief: null, water: null, naturalness: null, remoteness: null } });
    const html = renderTranslated(createElement(BenchSources, { bench }));
    expect(html).toContain(t("common.values.notRecorded"));
    expect(html).toContain(t("bench.weather.empty"));
    expect(html).not.toContain("Himmelsoffenheit: 0%");
    expect(html).not.toContain("Technische Datenstände");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("undefined");
  });

  it.each(["de", "fr", "it", "rm"] as const)("renders source labels in %s with the real translation provider", (language) => {
    const html = renderTranslated(createElement(BenchSources, { bench: sourceBench() }), language);
    const translate = testTranslator(language);
    expect(html).toContain(translate("knowledge.details.temperature"));
    expect(html).not.toContain("knowledge.details.");
    expect(html).not.toContain("[object Object]");
  });
});
