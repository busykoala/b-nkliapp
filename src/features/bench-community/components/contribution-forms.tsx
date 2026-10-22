"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Send, Star } from "lucide-react";
import { submitCorrection, submitRating } from "@/app/actions/contributions";
import { ContributionFeedback, useContributionSave, useContributionWork } from "./contribution-session";

type Rating = { overall: number; view: number | null; comfort: number | null; quiet: number | null; note: string | null };
type Refresh = () => void | Promise<void>;

export function RatingForm({ benchId, rating, onChanged }: { benchId: string; rating: Rating | null; onChanged?: Refresh }) {
  const t = useTranslations();
  const [draft, setDraft] = useState({ overall: rating?.overall ?? 0, note: rating?.note ?? "" });
  const [saved, setSaved] = useState(draft);
  const { state, pending, save } = useContributionSave(onChanged);
  useContributionWork(JSON.stringify(draft) !== JSON.stringify(saved), pending);
  return <form className="contribution-rating-form" aria-busy={pending} onSubmit={(event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    save(() => submitRating(benchId, null, data), () => {
      setSaved(draft);
    });
  }}>
    <p className="contribution-intro">{t(rating ? "community.rating.existing" : "community.rating.intro")}</p>
    <div className="rating-controls">
      <StarRating name="overall" label={t("community.rating.fields.overall")} value={draft.overall} onChange={(value) => setDraft({ ...draft, overall: value })} pending={pending} required />
    </div>
    <label className="contribution-text-field"><span>{t("community.rating.note")} <small>{t("community.rating.optional")}</small></span><textarea name="note" value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} disabled={pending} maxLength={280} placeholder={t("community.rating.placeholder")} /></label>
    <input name="website" className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" />
    <button type="submit" className="contribution-primary" disabled={pending || draft.overall === 0}><Send size={18} aria-hidden="true" />{t(pending ? "common.actions.saving" : rating ? "community.rating.update" : "community.rating.publish")}</button>
    <ContributionFeedback state={state} />
  </form>;
}

export function CorrectionForm({ benchId, onChanged, initialField = "" }: { benchId: string; onChanged?: Refresh; initialField?: "environment" | "" }) {
  const t = useTranslations();
  const [draft, setDraft] = useState({ field: initialField as string, note: "" });
  const { state, pending, save } = useContributionSave(onChanged);
  useContributionWork(Boolean(draft.note || draft.field !== initialField), pending);
  return <form className="contribution-correction-form" aria-busy={pending} onSubmit={(event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    save(() => submitCorrection(benchId, null, data), () => setDraft({ field: initialField, note: "" }));
  }}>
    <p className="contribution-intro">{t("community.correction.intro")}</p>
    {initialField ? <input type="hidden" name="field" value={initialField} /> : <label className="contribution-text-field"><span>{t("community.correction.field")}</span><select name="field" required disabled={pending} value={draft.field} onChange={(event) => setDraft({ ...draft, field: event.target.value })}>
      <option value="" disabled>{t("community.correction.choose")}</option>
      {(["removed", "location", "properties", "condition", "environment"] as const).map((field) => <option key={field} value={field}>{t(`community.correction.options.${field}`)}</option>)}
    </select></label>}
    <label className="contribution-text-field"><span>{t("community.correction.observation")} <small>{t("community.rating.optional")}</small></span><textarea name="note" maxLength={160} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} disabled={pending} placeholder={t("community.correction.placeholder")} /></label>
    <input name="website" className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" />
    <button type="submit" className="contribution-primary" disabled={pending || !draft.field}><Send size={18} aria-hidden="true" />{t(pending ? "common.actions.saving" : "community.correction.publish")}</button>
    <ContributionFeedback state={state} />
  </form>;
}

function StarRating({ name, label, value, onChange, pending, required = false }: { name: string; label: string; value: number; onChange: (value: number) => void; pending: boolean; required?: boolean }) {
  const t = useTranslations();
  return <fieldset className="rating-control" disabled={pending}><legend>{label}</legend><div>{[1, 2, 3, 4, 5].map((score) => <label key={score} className={score <= value ? "is-filled" : ""}>
    <input type="radio" name={name} value={score} required={required} checked={value === score} onChange={() => onChange(score)} aria-label={t("community.rating.stars", { count: score })} />
    <Star size={25} aria-hidden="true" />
  </label>)}<output aria-live="polite">{value ? t("community.rating.stars", { count: value }) : "—"}</output></div></fieldset>;
}
