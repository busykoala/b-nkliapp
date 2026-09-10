import type { Translator } from "@/i18n/types";

const themes = ["winter", "company", "green", "history", "morning", "shade", "water", "grandparents", "evening", "care", "fog", "thought"] as const;

export function communityTheme(t: Translator, date = new Date()) {
  const month = Number(new Intl.DateTimeFormat("en", { timeZone: "Europe/Zurich", month: "numeric" }).format(date));
  const theme = themes[Math.max(1, Math.min(12, month)) - 1];
  return {title: t(`community.theme.monthly.${theme}.title`), prompt: t(`community.theme.monthly.${theme}.prompt`)};
}
