import type { BenchDetail, PrecipitationType } from "@/lib/types";

export type WeatherCondition = "unknown" | "clear" | "partly-cloudy" | "cloudy" | "overcast" |
  Exclude<PrecipitationType, "none" | "unknown">;

export function resolveWeatherCondition(weather: BenchDetail["weather"]): WeatherCondition {
  if (!weather) return "unknown";
  if (["rain", "snow", "mixed"].includes(weather.precipitationType)) {
    return weather.precipitationType as "rain" | "snow" | "mixed";
  }
  if (weather.cloudCover === null) return "unknown";
  if (weather.cloudCover >= .88) return "overcast";
  if (weather.cloudCover >= .55) return "cloudy";
  if (weather.cloudCover >= .12) return "partly-cloudy";
  return "clear";
}

/** Neutral atmosphere for art only; never expose this as an observation. */
export function panoramaCloudCover(weather: BenchDetail["weather"]) {
  if (weather?.cloudCover !== null && weather?.cloudCover !== undefined) return weather.cloudCover;
  if (weather && ["rain", "snow", "mixed"].includes(weather.precipitationType)) return .9;
  return .2;
}


export function weatherIconKind(condition: ReturnType<typeof resolveWeatherCondition>, night: boolean) {
  if (condition === "rain") return "rain";
  if (condition === "mixed") return "mixed-precipitation";
  if (condition === "snow") return "snow";
  if (condition === "overcast") return "overcast";
  if (condition === "cloudy" || condition === "partly-cloudy") return night ? "cloud-moon" : "cloud-sun";
  if (condition === "clear") return night ? "moon" : "sun";
  return "unknown";
}
