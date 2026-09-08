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
