"use client";

import { useState, useTransition } from "react";
import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { setLanguage } from "@/app/actions/language";
import { languageFromLocale, languageNames, languages } from "@/i18n/config";

export function LanguageSwitcher() {
  const t = useTranslations("common.language");
  const language = languageFromLocale(useLocale());
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  return <div className="language-preference"><label className="language-switcher"><Languages size={19} /><span>{t("label")}</span>
    <select aria-label={t("label")} value={language} disabled={pending} onChange={(event) => {
      const next = event.target.value;
      const currentLocation = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      startTransition(async () => {
        setFailed(false);
        try {
          await setLanguage(next);
          // A server action refresh can be based on the route tree from before
          // an in-map native history update. Keep the currently visible map
          // task (bench, walk action, filters, …) instead of jumping to `/`.
          router.replace(currentLocation, { scroll: false });
        } catch { setFailed(true); }
      });
    }}>{languages.map((value) => <option key={value} value={value} lang={value}>{languageNames[value]}</option>)}</select>
  </label>{failed && <p role="status">{t("failed")}</p>}</div>;
}
