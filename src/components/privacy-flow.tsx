"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, Camera, Map, UserRound } from "lucide-react";
import type { MessageKey } from "@/i18n/types";

const journeys = [
  { key: "map", icon: Map, steps: ["device", "providers", "memory"] },
  { key: "account", icon: UserRound, steps: ["credentials", "profile", "session"] },
  { key: "photo", icon: Camera, steps: ["device", "check", "publication"] },
] as const;
type StepKey = Extract<MessageKey, `privacy.flow.${string}.${string}.${"title" | "description"}`>;

export function PrivacyFlow() {
  const t = useTranslations();
  const [selected, setSelected] = useState(0);
  const journey = journeys[selected];
  return <div className="privacy-flow">
    <div className="privacy-paths" aria-label={t("privacy.flow.choose")}>
      {journeys.map(({ key, icon: Icon }, index) => <button className="ui-button" key={key} aria-pressed={selected === index} onClick={() => setSelected(index)}><Icon size={17} />{t(`privacy.flow.${key}.label`)}</button>)}
    </div>
    <ol aria-label={t("privacy.flow.path", { label: t(`privacy.flow.${journey.key}.label`) })} aria-live="polite">
      {journey.steps.map((step, index) => <li key={step}>
        {index > 0 && <ArrowDown className="flow-arrow" aria-hidden="true" size={23} />}
        <div><span aria-hidden="true">{index + 1}</span><h3>{t(`privacy.flow.${journey.key}.${step}.title` as StepKey)}</h3><p>{t(`privacy.flow.${journey.key}.${step}.description` as StepKey)}</p></div>
      </li>)}
    </ol>
    <p className="privacy-flow-footnote">{t("privacy.flow.footnote")}</p>
  </div>;
}
