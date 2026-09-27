import { Cloud, CloudRain, CloudSun, Moon, Snowflake, Sun } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { BenchDetail } from "@/lib/types";
import { resolveWeatherCondition } from "@/lib/presentation";

export function WeatherSummary({ weather, dayPhase, variant = "compact" }: {
  weather: BenchDetail["weather"];
  dayPhase: BenchDetail["dayPhase"];
  variant?: "compact" | "illustrated";
}) {
  const t = useTranslations();
  const format = useFormatter();
  const condition = resolveWeatherCondition(weather);
  const labelKey = condition === "partly-cloudy" ? "partlyCloudy" : condition;
  return <div className={`weather-summary is-${variant} condition-${condition}`}>
    <span className="weather-summary-icon" aria-hidden="true"><ConditionIcon condition={condition} night={dayPhase === "night"} /></span>
    <span>
      <strong>{weather ? `${format.number(weather.temperatureC, { maximumFractionDigits: 0 })}°` : "–"}</strong>
      <small>{t(`bench.weather.conditions.${labelKey}`)}</small>
    </span>
  </div>;
}

function ConditionIcon({ condition, night }: { condition: ReturnType<typeof resolveWeatherCondition>; night: boolean }) {
  if (condition === "rain" || condition === "mixed") return <CloudRain />;
  if (condition === "snow") return <Snowflake />;
  if (condition === "overcast") return <Cloud />;
  if (condition === "cloudy" || condition === "partly-cloudy") return <CloudSun />;
  if (condition === "clear") return night ? <Moon /> : <Sun />;
  return <Cloud />;
}
