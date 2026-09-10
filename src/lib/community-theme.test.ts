import { describe, expect, it } from "vitest";
import { testTranslator } from "@/test/translations";
import { communityTheme } from "./community-theme";

describe("community theme", () => {
  it("changes by local calendar month without popularity mechanics", () => {
    expect(communityTheme(testTranslator(), new Date("2026-07-10T12:00:00Z")).title).toBe("Wasser in Sicht");
    expect(communityTheme(testTranslator(), new Date("2026-11-10T12:00:00Z")).title).toBe("Nebel & Nähe");
  });
});
