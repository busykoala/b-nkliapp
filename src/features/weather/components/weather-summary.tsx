import { CircleHelp, Cloud, CloudMoon, CloudRain, CloudSnow, CloudSun, Moon, Snowflake, Sun } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { BenchDetail } from "@/lib/types";
import { resolveWeatherCondition, weatherIconKind } from "@/features/weather/conditions";

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
    <span className="weather-summary-icon" data-weather-icon={weatherIconKind(condition, dayPhase === "night")} aria-hidden="true"><ConditionIcon condition={condition} night={dayPhase === "night"} /></span>
    <span>
      <strong>{weather && Number.isFinite(weather.temperatureC) ? `${format.number(weather.temperatureC, { maximumFractionDigits: 0 })} °C` : "–"}</strong>
      {condition !== "unknown" && <small>{t(`bench.weather.conditions.${labelKey}`)}</small>}
    </span>
  </div>;
}

function ConditionIcon({ condition, night }: { condition: ReturnType<typeof resolveWeatherCondition>; night: boolean }) {
  if (condition === "rain") return <CloudRain />;
  if (condition === "mixed") return <span className="weather-mixed-icon"><CloudRain /><Snowflake /></span>;
  if (condition === "snow") return <CloudSnow />;
  if (condition === "overcast") return <Cloud />;
  if (condition === "cloudy" || condition === "partly-cloudy") return night ? <CloudMoon /> : <CloudSun />;
  if (condition === "clear") return night ? <Moon /> : <Sun />;
  return <CircleHelp />;
}
