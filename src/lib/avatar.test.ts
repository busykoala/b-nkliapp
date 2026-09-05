import { describe, expect, it } from "vitest";
import { appearanceFromSeed, parseAvatarAppearance, randomAppearance, serializeAvatarAppearance } from "./avatar";

describe("composed avatars", () => {
  it("round-trips every selected component", () => {
    const appearance = {
      skin: "brown",
      hair: "copper",
      hairStyle: "curls",
      coat: "lake",
      accent: "sage",
      hat: "brim",
      background: "forest",
      companion: "fox",
    } as const;
    expect(parseAvatarAppearance(serializeAvatarAppearance(appearance))).toEqual(appearance);
  });

  it("keeps legacy seeds deterministic", () => {
    expect(appearanceFromSeed("old-random-seed")).toEqual(randomAppearance("old-random-seed"));
    expect(appearanceFromSeed("old-random-seed")).toEqual(appearanceFromSeed("old-random-seed"));
  });

  it("rejects malformed or unknown component values", () => {
    expect(parseAvatarAppearance("avatar-v1|unknown")).toBeNull();
    expect(parseAvatarAppearance("avatar-v1|porcelain|charcoal|short|pine|gold|none|space|none")).toBeNull();
  });
});
