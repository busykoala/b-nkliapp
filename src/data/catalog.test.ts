import { describe, expect, it } from "vitest";
import { dataCatalog, sourcesFor } from "./catalog";

describe("data catalog", () => {
  it("is one complete graph of jobs, sources and artifacts", () => {
    expect(dataCatalog.jobs).toHaveLength(14);
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
});

