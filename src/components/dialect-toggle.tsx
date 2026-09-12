"use client";

import { useState, useTransition } from "react";
import { MessagesSquare } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { setDialectMode } from "@/app/actions/language";
import { isDialectLocale } from "@/i18n/config";

export function DialectToggle() {
  const t = useTranslations("common.dialect");
  const enabled = isDialectLocale(useLocale());
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  return <div className="dialect-preference">
    <button type="button" role="switch" aria-checked={enabled} disabled={pending} onClick={() => {
      startTransition(async () => {
        setFailed(false);
        try { await setDialectMode(!enabled); } catch { setFailed(true); }
      });
    }}>
      <MessagesSquare size={19} />
      <span className="dialect-preference-copy"><strong>{t("label")}</strong><small>{t("hint")}</small></span>
      <span className={`dialect-switch ${enabled ? "is-on" : ""}`} aria-hidden="true"><span /></span>
      <span className="sr-only">{enabled ? t("on") : t("off")}</span>
    </button>
    {failed && <p role="status">{t("failed")}</p>}
  </div>;
}
