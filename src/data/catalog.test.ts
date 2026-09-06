import { describe, expect, it } from "vitest";
import { dataCatalog, sourcesFor } from "./catalog";

describe("data catalog", () => {
  it("is one complete graph of jobs, sources and artifacts", () => {
    expect(dataCatalog.jobs.length).toBeGreaterThanOrEqual(18);
    expect(dataCatalog.sources.some(({ id }) => id === "graphhopper")).toBe(true);
    for (const job of dataCatalog.jobs) {
      expect(sourcesFor(job).map(({ id }) => id).sort()).toEqual([...job.sourceIds].sort());
    }
  });

  it("documents every refresh in human-readable language", () => {
    for (const job of dataCatalog.jobs) {
      expect(job.frequency.length).toBeGreaterThan(4);
      expect(job.schedule.split(" ")).toHaveLength(5);
    }
  });

  it("keeps evaluation-only data out of production jobs", () => {
    const sourceById = new Map(dataCatalog.sources.map((source) => [source.id, source]));
    for (const job of dataCatalog.jobs.filter(({ purpose }) => purpose === "production")) {
      expect(job.sourceIds.map((id) => sourceById.get(id)?.access)).not.toContain("evaluation-only");
    }
    expect(dataCatalog.sources.filter(({ lifecycle }) => lifecycle === "active").every(({ access }) => access !== "evaluation-only")).toBe(true);
  });

  it("documents the active vision model and resolved research decisions", () => {
    const visionModel = dataCatalog.sources.find(({ id }) => id === "qwen3-vl-benchly");
    expect(visionModel).toMatchObject({ lifecycle: "active", access: "open-source" });
    expect(visionModel?.statusNote).toContain("benchly-vision");
    expect(dataCatalog.sources.filter(({ lifecycle }) => lifecycle === "experimental")).toEqual([]);
    expect(dataCatalog.sources.filter(({ lifecycle }) => lifecycle === "research-only").every(({ statusNote }) => Boolean(statusNote))).toBe(true);
  });
});
