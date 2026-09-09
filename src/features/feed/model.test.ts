import { describe, expect, it } from "vitest";
import { groupFeed, type FeedEntry } from "./model";

function entry(id: string, createdAt: string) {
  return { id, createdAt } as FeedEntry;
}

describe("feed groups", () => {
  it("creates time chapters without empty headings", () => {
    const now = Date.parse("2026-09-07T12:00:00Z");
    expect(groupFeed([
      entry("1", "2026-09-07T11:00:00Z"),
      entry("2", "2026-09-04T12:00:00Z"),
      entry("3", "2026-08-20T12:00:00Z"),
    ], now).map(({ label, entries }) => [label, entries.map(({ id }) => id)]))
      .toEqual([["Heute", ["1"]], ["Diese Woche", ["2"]], ["Etwas früher", ["3"]]]);
    expect(groupFeed([entry("1", "2026-09-07T11:00:00Z")], now)).toHaveLength(1);
  });
});

import { groupBenchActivity } from "./model";
it("merges bench/day activity across pages while keeping Swiss midnight and neighbours distinct", () => {
  const a = { ...entry("a", "2026-09-08T22:15:00Z"), benchId: "one", benchName: "Hafen" };
  const b = { ...entry("b", "2026-09-09T10:00:00Z"), benchId: "one", benchName: "Hafen" };
  const neighbour = { ...b, id: "c", benchId: "two" };
  const yesterday = { ...a, id: "d", createdAt: "2026-09-08T21:59:00Z" };
  const groups = groupBenchActivity([b, neighbour, a, a, yesterday]);
  expect(groups).toHaveLength(3);
  expect(groups[0].entries.map((item) => item.id)).toEqual(["b", "a"]);
  expect(groups[1].benchId).toBe("two");
  expect(groups[2].date).not.toBe(groups[0].date);
});
