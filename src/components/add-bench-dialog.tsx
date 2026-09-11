"use client";
import { useTranslations } from "next-intl";

import { useActionState, useEffect, useRef, useState } from "react";
import { Check, MapPin, Plus, X } from "lucide-react";
import { addBench, getNearbyBenches, resolveBenchLocation } from "@/app/actions/benches";
import type { AddBenchResult, NearbyBench } from "@/lib/types";

type Props = {
  coordinates: { latitude: number; longitude: number };
  onChoosePosition: () => void;
  onClose: () => void;
  onCreated: (id: string) => void;
  onExisting: (id: string) => void;
};

export function AddBenchDialog({ coordinates, onChoosePosition, onClose, onCreated, onExisting }: Props) {
  const t = useTranslations();
  const yesNoOptions = [["yes", t("common.values.yes")], ["no", t("common.values.no")]];
  const materialOptions = (["wood", "metal", "stone", "concrete", "plastic", "mixed"] as const).map((value) => [value, t(`bench.materials.${value}`)]);
  const ref = useRef<HTMLDialogElement>(null);
  const [place, setPlace] = useState(t("submission.location.searching"));
  const [nearby, setNearby] = useState<NearbyBench[] | null>(null);
  const [lookupError, setLookupError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [reviewed, setReviewed] = useState(false);
  const [state, formAction, pending] = useActionState(async (_previous: AddBenchResult | null, data: FormData) => {
    const result = await addBench(null, data);
    if (result.ok && result.benchId) onCreated(result.benchId);
    else if (result.nearby) { setNearby(result.nearby); setReviewed(false); }
    return result;
  }, null);
  useEffect(() => { ref.current?.showModal(); }, []);
  useEffect(() => {
    let current = true;
    void resolveBenchLocation(coordinates.latitude, coordinates.longitude).then((location) => {
      if (current) setPlace(location ? [location.name, location.postcode].filter(Boolean).join(" · ") : t("submission.location.onSave"));
    }).catch(() => { if (current) setPlace(t("submission.location.onSave")); });
    void getNearbyBenches(coordinates.latitude, coordinates.longitude).then((benches) => {
      if (current) { setNearby(benches); setLookupError(false); }
    }).catch(() => { if (current) setLookupError(true); });
    return () => { current = false; };
  }, [coordinates.latitude, coordinates.longitude, retry, t]);
  return <dialog ref={ref} onCancel={onClose} aria-labelledby="add-bench-title" className="modal modal-bottom sm:modal-middle">
    <div className="modal-box utility-sheet add-bench-sheet">
      <button type="button" aria-label={t("common.actions.closeTitle")} className="btn btn-circle btn-ghost absolute right-3 top-3" onClick={onClose}><X size={19} /></button>
      <div className="add-bench-scroll">
      <ol className="add-bench-steps" aria-label={t("submission.steps.label")}><li className="is-complete"><Check size={14} /> {t("submission.steps.position")}</li><li aria-current="step"><span>2</span> {t("submission.steps.details")}</li></ol>
      <h2 id="add-bench-title" className="text-2xl font-black">{t("common.navigation.addBench")}</h2>
      <p className="add-location"><MapPin size={18} /> {place}</p>
      <button type="button" className="btn btn-ghost min-h-11" onClick={onChoosePosition}>{t("submission.location.change")}</button>
      <details className="technical-fold"><summary>{t("submission.location.details")}</summary><p>{coordinates.latitude.toFixed(6)}, {coordinates.longitude.toFixed(6)}</p></details>
      <section className="nearby-benches" aria-label={t("submission.nearby.title")}>
        {lookupError ? <p role="alert">{t("submission.nearby.failed")} <button type="button" onClick={() => setRetry((value) => value + 1)}>{t("submission.nearby.retry")}</button></p>
          : nearby === null ? <p role="status">{t("submission.nearby.checking")}</p>
            : nearby.length > 0 ? <><h3>{t("submission.nearby.count", { count: nearby.length })}</h3><p>{t("submission.nearby.question")}</p><ul>{nearby.map((bench) => <li key={bench.id}><button type="button" onClick={() => onExisting(bench.id)}><strong>{bench.title || t("common.values.bench")}</strong><span>{t("submission.nearby.open", { meters: Math.round(bench.distanceMeters) })}</span></button></li>)}</ul></>
              : <p>{t("submission.nearby.empty")}</p>}
      </section>
      <form id="add-bench-form" action={formAction} className="mt-4 space-y-3" aria-busy={pending}>
        <input type="hidden" name="latitude" value={coordinates.latitude} /><input type="hidden" name="longitude" value={coordinates.longitude} />
        <input type="hidden" name="nearbyIds" value={JSON.stringify((nearby ?? []).map((bench) => bench.id).sort())} />
        {!!nearby?.length && <label className="nearby-confirm"><input type="checkbox" name="nearbyReviewed" value="yes" required checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /><span>{t("submission.nearby.confirm")}</span></label>}
        <label className="form-control"><span className="label text-sm font-bold">{t("common.fields.name")} <span className="font-normal">{t("common.fields.optional")}</span></span><input name="name" maxLength={80} className="input min-h-12 w-full" placeholder={t("submission.fields.namePlaceholder")} /></label>
        <label className="form-control"><span className="label text-sm font-bold">{t("submission.fields.dedication")} <span className="font-normal">{t("common.fields.optional")}</span></span><textarea name="dedication" maxLength={180} className="textarea min-h-20 w-full" /></label>
        <details className="new-bench-features"><summary>{t("submission.fields.features")}</summary><fieldset><legend className="sr-only">{t("submission.fields.observation")}</legend><div>
          <BenchSelect name="backrest" label={t("bench.attributes.backrest")} options={yesNoOptions} />
          <BenchSelect name="armrest" label={t("bench.attributes.armrest")} options={yesNoOptions} />
          <BenchSelect name="covered" label={t("bench.attributes.covered")} options={yesNoOptions} />
          <BenchSelect name="wheelchair" label={t("bench.attributes.wheelchair")} options={yesNoOptions} />
          <BenchSelect name="fireplaceNearby" label={t("bench.attributes.fireplaceNearby")} options={yesNoOptions} />
          <BenchSelect name="wasteBasketNearby" label={t("bench.attributes.wasteBasketNearby")} options={yesNoOptions} />
          <BenchSelect name="material" label={t("bench.attributes.material")} options={materialOptions} />
          <BenchSelect name="seats" label={t("bench.attributes.seats")} options={Array.from({ length: 12 }, (_, index) => [String(index + 1), String(index + 1)])} />
          <BenchSelect name="direction" label={t("bench.attributes.direction")} options={[["0",t("bench.directions.n")],["45",t("bench.directions.ne")],["90",t("bench.directions.e")],["135",t("bench.directions.se")],["180",t("bench.directions.s")],["225",t("bench.directions.sw")],["270",t("bench.directions.w")],["315",t("bench.directions.nw")]]} />
        </div></fieldset><p>{t("submission.fields.accessNote")}</p></details>
      </form>
      </div>
      <footer className="add-bench-actions"><button form="add-bench-form" disabled={pending || nearby === null || lookupError || (!!nearby.length && !reviewed)} className="btn btn-primary min-h-12 w-full"><Plus size={18} /> {pending ? t("submission.form.pending") : t("submission.form.submit")}</button>
      {state && <p role={state.ok ? "status" : "alert"} className="contribution-inline-status">{state.message}</p>}</footer>
    </div><form method="dialog" className="modal-backdrop"><button onClick={onClose}>{t("common.actions.close")}</button></form>
  </dialog>;
}
function BenchSelect({ name, label, options }: { name: string; label: string; options: string[][] }) {
  const t = useTranslations();
  return <label><span>{label}</span><select name={name} defaultValue=""><option value="">{t("common.values.open")}</option>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>;
}
