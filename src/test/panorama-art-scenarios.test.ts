import { describe, expect, it } from "vitest";
import { artScenarios, artSeasons } from "../../scripts/panorama-art/scenarios";

describe("offline art review astronomical scenarios", () => {
  it("finds real daylight, twilight, star-only and illuminated moon states in every season", () => {
    for (const season of artSeasons) {
      const scenes = artScenarios(47.5669145, 9.349783, season);
      const byId = (id: string) => scenes.find((scene) => scene.id === id)!;
      expect(scenes).toHaveLength(19);
      expect(byId("noon-clear").sun.altitude).toBeGreaterThan(15);
      expect(byId("sunrise").sun.phase).toBe("dawn");
      expect(byId("sunset").sun.phase).toBe("dusk");
      expect(byId("stars").sun.altitude).toBeLessThan(-12);
      expect(byId("stars").moon.altitude).toBeLessThan(-8);
      expect(byId("moon-full").moon.fraction).toBeGreaterThan(.88);
      expect(byId("moon-full").moon.altitude).toBeGreaterThan(15);
      expect(byId("moon-crescent").moon.fraction).toBeLessThan(.35);
      expect(byId("moon-crescent").moon.altitude).toBeGreaterThan(8);
      expect(byId("overcast").weather.cloudCover).toBe(1);
      expect(byId("snowfall").weather.snowDepthCm).toBe(0);
      expect(byId("snow-cover").weather.precipitationType).toBe("none");
      expect(byId("snow-cover").weather.snowDepthCm).toBeGreaterThan(0);
      expect(byId("rain-heavy").weather.precipitationRateMmH).toBeGreaterThan(byId("rain-light").weather.precipitationRateMmH!);
    }
  });
});
