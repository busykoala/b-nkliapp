import type { Translator } from "./types";

const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"] as const;
const swissParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
type DateStyle = "numeric" | "long" | "monthYear" | "dayMonth" | "dateTime";

/** Named UI styles use catalog month names, including on browsers without rm.
 * Native Intl only extracts Swiss calendar fields; wire timestamps stay intact. */
export function formatDate(value: string | Date, t: Translator, style: DateStyle = "numeric"): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(date.getTime())) return t("common.values.unknown");
  const parts = Object.fromEntries(swissParts.formatToParts(date).map(({ type, value }) => [type, value]));
  if (style === "dateTime") return t("common.calendar.patterns.dateTime", { date: formatDate(date, t, "long"), time: `${parts.hour}:${parts.minute}` });
  return t(`common.calendar.patterns.${style}`, {
    day: style === "numeric" ? parts.day : String(Number(parts.day)),
    month: style === "numeric" ? parts.month : t(`common.calendar.months.${months[Number(parts.month) - 1]}`),
    year: parts.year,
  });
}
