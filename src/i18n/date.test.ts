import { expect, it } from "vitest";
import { formatDate } from "./date";
import { testTranslator } from "@/test/translations";

it("uses the Swiss calendar day and translated months independently of browser locale data", () => {
  const instant = "2026-09-09T23:50:00Z";
  expect(formatDate(instant, testTranslator("de"), "long")).toBe("10. September 2026");
  expect(formatDate(instant, testTranslator("fr"), "long")).toBe("10 septembre 2026");
  expect(formatDate(instant, testTranslator("it"), "long")).toBe("10 settembre 2026");
  expect(formatDate(instant, testTranslator("rm"), "dateTime")).toBe("10 da settember 2026, 01:50");
  expect(formatDate(instant, testTranslator("rm"))).toBe("10-09-2026");
  expect(formatDate("invalid", testTranslator("rm"))).toBe(testTranslator("rm")("common.values.unknown"));
});
