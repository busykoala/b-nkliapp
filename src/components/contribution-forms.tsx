"use client";
import { useTranslations } from "next-intl";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { MessageSquarePlus, Send, Star } from "lucide-react";
import type { ActionResult } from "@/lib/types";
import { submitCorrection, submitRating } from "@/app/actions/contributions";

function SubmitButton({ label }: { label: string }) {
  const t = useTranslations();
  const { pending } = useFormStatus();
  return <button className="btn btn-primary min-h-12 w-full rounded-2xl" disabled={pending}>{pending ? <span className="loading loading-spinner loading-sm" /> : <Send size={18} />}{pending ? t("common.actions.saving") : label}</button>;
}

export function RatingForm({ benchId, rating, onChanged }: { benchId: string; onChanged?: () => void | Promise<void>; rating: { overall: number; view: number; comfort: number; quiet: number; note: string | null } | null }) {
  const t = useTranslations();
  const action = async (_previous: ActionResult | null, data: FormData) => { const result = await submitRating(benchId, null, data); if (result.ok) await onChanged?.(); return result; };
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="story-card p-4">
      <div className="story-eyebrow flex items-center gap-1.5"><Star size={14} /> {t("community.rating.eyebrow")}</div>
      <h3 className="mt-1 text-lg font-extrabold">{t("community.chapters.rating.title")}</h3>
      <p className="mb-3 mt-1 text-sm opacity-60">{rating ? t("community.rating.existing") : t("community.rating.intro")}</p>
      <div className="rating-controls">
        {([ ["overall", t("community.rating.fields.overall")], ["view", t("community.rating.fields.view")], ["comfort", t("community.rating.fields.comfort")], ["quiet", t("community.rating.fields.quiet")] ] as const).map(([name, label]) => <StarRating key={name} name={name} label={label} initialValue={rating?.[name] ?? 0} />)}
      </div>
      <label className="form-control my-3 block">
        <span className="label pb-1 text-sm font-bold">{t("community.rating.note")} <span className="font-normal opacity-50">{t("community.rating.optional")}</span></span>
        <textarea name="note" defaultValue={rating?.note ?? ""} maxLength={280} className="textarea story-card min-h-20 w-full" placeholder={t("community.rating.placeholder")} />
      </label>
      <input name="website" className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" />
      <SubmitButton label={rating ? t("community.rating.update") : t("community.rating.publish")} />
      {state && <p role="status" className={`mt-3 rounded-lg p-2 text-sm ${state.ok ? "bg-success/15 text-success" : "bg-error/15 text-error"}`}>{state.message}</p>}
    </form>
  );
}

export function CorrectionForm({ benchId, onChanged }: { benchId: string; onChanged?: () => void | Promise<void> }) {
  const t = useTranslations();
  const action = async (_previous: ActionResult | null, data: FormData) => { const result = await submitCorrection(benchId, null, data); if (result.ok) await onChanged?.(); return result; };
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="story-card p-4">
      <div className="story-eyebrow flex items-center gap-1.5"><MessageSquarePlus size={14} /> {t("community.correction.eyebrow")}</div>
      <h3 className="mt-1 text-lg font-extrabold">{t("community.correction.title")}</h3>
      <p className="mb-3 mt-1 text-sm opacity-60">{t("community.correction.intro")}</p>
      <label className="form-control block">
        <span className="label pb-1 text-sm font-semibold">{t("community.correction.field")}</span>
        <select aria-label={t("community.correction.field")} name="field" required className="select story-card min-h-12 w-full" defaultValue="">
          <option value="" disabled>{t("community.correction.choose")}</option>
          <option value="removed">{t("community.correction.options.removed")}</option>
          <option value="location">{t("community.correction.options.location")}</option>
          <option value="properties">{t("community.correction.options.properties")}</option>
          <option value="condition">{t("community.correction.options.condition")}</option>
          <option value="environment">{t("community.correction.options.environment")}</option>
        </select>
      </label>
      <label className="form-control my-3 block">
        <span className="label pb-1 text-sm font-bold">{t("community.correction.observation")} <span className="font-normal opacity-50">{t("community.rating.optional")}</span></span>
        <textarea name="note" maxLength={160} className="textarea story-card min-h-20 w-full" placeholder={t("community.correction.placeholder")} />
      </label>
      <input name="website" className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" />
      <SubmitButton label={t("community.correction.publish")} />
      {state && <p role="status" className={`mt-3 rounded-lg p-2 text-sm ${state.ok ? "bg-success/15 text-success" : "bg-error/15 text-error"}`}>{state.message}</p>}
    </form>
  );
}

function StarRating({ name, label, initialValue }: { name: string; label: string; initialValue: number }) {
  const t = useTranslations();
  const [value, setValue] = useState(initialValue);
  return <fieldset className="rating-control"><legend>{label}</legend><div>{[1, 2, 3, 4, 5].map((score) => <label key={score} className={score <= value ? "is-filled" : ""}>
    <input type="radio" name={name} value={score} required checked={value === score} onChange={() => setValue(score)} aria-label={t("community.rating.stars", { count: score })} />
    <Star size={25} aria-hidden="true" />
  </label>)}<output aria-live="polite">{value ? t("community.rating.stars", { count: value }) : "—"}</output></div></fieldset>;
}
