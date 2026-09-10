import { expect, it } from "vitest";
import { actionError, UserFacingError } from "./action-error";
import { pointLabel } from "./point-label";
import { languages } from "./config";
import { testTranslator } from "@/test/translations";

it("renders expected failures in the current language without exposing implementation errors", () => {
  for (const language of languages) {
    const t = testTranslator(language);
    expect(actionError(t, new UserFacingError("common.errors.signIn"), "common.errors.unavailable")).toBe(t("common.errors.signIn"));
    expect(actionError(t, new Error("SQLITE_BUSY internal.db"), "common.errors.unavailable")).toBe(t("common.errors.unavailable"));
  }
});

it("translates generated route labels while preserving proper names and coordinates", () => {
  const point = { label: "location", labelKind: "location" as const, latitude: 46.7, longitude: 7.6 };
  const original = JSON.stringify(point);
  for (const language of languages) {
    const t = testTranslator(language);
    expect(pointLabel(point, t)).toBe(t("routing.origin.current"));
    expect(pointLabel({ ...point, labelKind: undefined, label: "Lindenhof" }, t)).toBe("Lindenhof");
  }
  expect(JSON.stringify(point)).toBe(original);
});
