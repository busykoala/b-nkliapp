"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { MessageSquarePlus, Send, Star } from "lucide-react";
import type { ActionResult } from "@/lib/types";
import { submitCorrection, submitRating } from "@/app/actions/contributions";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <button className="btn btn-primary min-h-12 w-full rounded-2xl" disabled={pending}>{pending ? <span className="loading loading-spinner loading-sm" /> : <Send size={18} />}{pending ? "Wird gespeichert …" : label}</button>;
}

export function RatingForm({ benchId, rating, onChanged }: { benchId: string; onChanged?: () => void | Promise<void>; rating: { overall: number; view: number; comfort: number; quiet: number; note: string | null } | null }) {
  const action = async (_previous: ActionResult | null, data: FormData) => { const result = await submitRating(benchId, null, data); if (result.ok) await onChanged?.(); return result; };
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="story-card p-4">
      <div className="story-eyebrow flex items-center gap-1.5"><Star size={14} /> Dein Eindruck</div>
      <h3 className="mt-1 text-lg font-extrabold">Wie war deine Pause?</h3>
      <p className="mb-3 mt-1 text-sm opacity-60">{rating ? "Deine frühere Bewertung ist vorausgefüllt – du kannst sie ändern." : "Vier kleine Eindrücke helfen anderen bei der Wahl."}</p>
      <div className="rating-controls">
        {([ ["overall", "Gesamt"], ["view", "Aussicht"], ["comfort", "Komfort"], ["quiet", "Ruhe"] ] as const).map(([name, label]) => <StarRating key={name} name={name} label={label} initialValue={rating?.[name] ?? 0} />)}
      </div>
      <label className="form-control my-3 block">
        <span className="label pb-1 text-sm font-bold">Ein Gedanke dazu <span className="font-normal opacity-50">(freiwillig)</span></span>
        <textarea name="note" defaultValue={rating?.note ?? ""} maxLength={280} className="textarea story-card min-h-20 w-full" placeholder="Was hat dir hier gefallen?" />
      </label>
      <input name="website" className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" />
      <SubmitButton label={rating ? "Bewertung aktualisieren" : "Bewertung veröffentlichen"} />
      {state && <p role="status" className={`mt-3 rounded-lg p-2 text-sm ${state.ok ? "bg-success/15 text-success" : "bg-error/15 text-error"}`}>{state.message}</p>}
    </form>
  );
}

export function CorrectionForm({ benchId, onChanged }: { benchId: string; onChanged?: () => void | Promise<void> }) {
  const action = async (_previous: ActionResult | null, data: FormData) => { const result = await submitCorrection(benchId, null, data); if (result.ok) await onChanged?.(); return result; };
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="story-card p-4">
      <div className="story-eyebrow flex items-center gap-1.5"><MessageSquarePlus size={14} /> Kurz Bescheid geben</div>
      <h3 className="mt-1 text-lg font-extrabold">Etwas stimmt nicht?</h3>
      <p className="mb-3 mt-1 text-sm opacity-60">Nur für Dinge, die du gerade vor Ort gesehen hast.</p>
      <label className="form-control block">
        <span className="label pb-1 text-sm font-semibold">Was stimmt nicht?</span>
        <select aria-label="Was stimmt nicht?" name="field" required className="select story-card min-h-12 w-full" defaultValue="">
          <option value="" disabled>Auswählen</option>
          <option value="removed">Bank fehlt oder wurde entfernt</option>
          <option value="location">Position ist ungenau</option>
          <option value="properties">Ausstattung stimmt nicht</option>
          <option value="condition">Beschädigt oder schlecht nutzbar</option>
          <option value="environment">Umgebung, Aussicht oder Licht stimmt nicht</option>
        </select>
      </label>
      <label className="form-control my-3 block">
        <span className="label pb-1 text-sm font-bold">Was hast du gesehen? <span className="font-normal opacity-50">(freiwillig)</span></span>
        <textarea name="note" maxLength={160} className="textarea story-card min-h-20 w-full" placeholder="Zum Beispiel: Die Rückenlehne fehlt" />
      </label>
      <input name="website" className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" />
      <SubmitButton label="Hinweis veröffentlichen" />
      {state && <p role="status" className={`mt-3 rounded-lg p-2 text-sm ${state.ok ? "bg-success/15 text-success" : "bg-error/15 text-error"}`}>{state.message}</p>}
    </form>
  );
}

function StarRating({ name, label, initialValue }: { name: string; label: string; initialValue: number }) {
  const [value, setValue] = useState(initialValue);
  return <fieldset className="rating-control"><legend>{label}</legend><div>{[1, 2, 3, 4, 5].map((score) => <label key={score} className={score <= value ? "is-filled" : ""}>
    <input type="radio" name={name} value={score} required checked={value === score} onChange={() => setValue(score)} aria-label={`${score} ${score === 1 ? "Stern" : "Sterne"}`} />
    <Star size={25} aria-hidden="true" />
  </label>)}</div></fieldset>;
}
