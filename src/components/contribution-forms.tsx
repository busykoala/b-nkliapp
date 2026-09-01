"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { MessageSquarePlus, Send, Star } from "lucide-react";
import { submitCorrection, submitRating } from "@/app/actions/contributions";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <button className="btn btn-primary min-h-12 w-full" disabled={pending}>{pending ? <span className="loading loading-spinner loading-sm" /> : <Send size={18} />}{pending ? "Wird gespeichert …" : label}</button>;
}

export function RatingForm({ benchId }: { benchId: string }) {
  const action = submitRating.bind(null, benchId);
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="rounded-box border border-base-300 bg-base-100 p-4">
      <h3 className="mb-1 flex items-center gap-2 font-bold"><Star size={19} className="text-warning" /> Bank bewerten</h3>
      <p className="mb-3 text-sm opacity-65">Deine letzte Bewertung für diese Bank wird ersetzt.</p>
      <div className="grid grid-cols-2 gap-3">
        {[["overall", "Gesamt"], ["view", "Aussicht"], ["comfort", "Komfort"], ["quiet", "Ruhe"]].map(([name, label]) => (
          <label className="form-control" key={name}>
            <span className="label pb-1 text-sm font-semibold">{label}</span>
            <select name={name} required defaultValue="" className="select select-bordered min-h-11 w-full" aria-label={`${label} bewerten`}>
              <option value="" disabled>1–5</option>
              {[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>{score} {score === 1 ? "Stern" : "Sterne"}</option>)}
            </select>
          </label>
        ))}
      </div>
      <label className="form-control my-3 block">
        <span className="label pb-1 text-sm font-semibold">Kurze Notiz <span className="font-normal opacity-60">(optional)</span></span>
        <textarea name="note" maxLength={280} className="textarea textarea-bordered min-h-20 w-full" placeholder="Was hat dir gefallen?" />
      </label>
      <input name="website" className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" />
      <SubmitButton label="Bewertung veröffentlichen" />
      {state && <p role="status" className={`mt-3 rounded-lg p-2 text-sm ${state.ok ? "bg-success/15 text-success" : "bg-error/15 text-error"}`}>{state.message}</p>}
    </form>
  );
}

export function CorrectionForm({ benchId }: { benchId: string }) {
  const action = submitCorrection.bind(null, benchId);
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="rounded-box border border-base-300 bg-base-100 p-4">
      <h3 className="mb-1 flex items-center gap-2 font-bold"><MessageSquarePlus size={19} /> Korrektur vorschlagen</h3>
      <p className="mb-3 text-sm opacity-65">Melde nur etwas, das du direkt vor Ort festgestellt hast. Der Hinweis verändert OpenStreetMap nicht.</p>
      <label className="form-control block">
        <span className="label pb-1 text-sm font-semibold">Was stimmt nicht?</span>
        <select aria-label="Was stimmt nicht?" name="field" required className="select select-bordered min-h-12 w-full" defaultValue="">
          <option value="" disabled>Auswählen</option>
          <option value="removed">Bank fehlt oder wurde entfernt</option>
          <option value="location">Position ist ungenau</option>
          <option value="properties">Ausstattung stimmt nicht</option>
          <option value="condition">Beschädigt oder schlecht nutzbar</option>
        </select>
      </label>
      <label className="form-control my-3 block">
        <span className="label pb-1 text-sm font-semibold">Kurzer Hinweis <span className="font-normal opacity-60">(optional)</span></span>
        <textarea name="note" maxLength={160} className="textarea textarea-bordered min-h-20 w-full" placeholder="Zum Beispiel: Rückenlehne fehlt" />
      </label>
      <input name="website" className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" />
      <SubmitButton label="Hinweis veröffentlichen" />
      {state && <p role="status" className={`mt-3 rounded-lg p-2 text-sm ${state.ok ? "bg-success/15 text-success" : "bg-error/15 text-error"}`}>{state.message}</p>}
    </form>
  );
}
