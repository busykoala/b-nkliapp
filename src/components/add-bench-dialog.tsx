"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { MapPin, Plus, X } from "lucide-react";
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
  const ref = useRef<HTMLDialogElement>(null);
  const [place, setPlace] = useState("Ort wird gesucht …");
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
      if (current) setPlace(location ? [location.name, location.postcode].filter(Boolean).join(" · ") : "Ort wird beim Speichern ergänzt");
    }).catch(() => { if (current) setPlace("Ort wird beim Speichern ergänzt"); });
    void getNearbyBenches(coordinates.latitude, coordinates.longitude).then((benches) => {
      if (current) { setNearby(benches); setLookupError(false); }
    }).catch(() => { if (current) setLookupError(true); });
    return () => { current = false; };
  }, [coordinates.latitude, coordinates.longitude, retry]);
  return <dialog ref={ref} onCancel={onClose} aria-labelledby="add-bench-title" className="modal modal-bottom sm:modal-middle">
    <div className="modal-box utility-sheet max-h-[calc(100dvh-env(safe-area-inset-top)-1rem)] overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]">
      <button type="button" aria-label="Schliessen" className="btn btn-circle btn-ghost absolute right-3 top-3" onClick={onClose}><X size={19} /></button>
      <h2 id="add-bench-title" className="text-2xl font-black">Bänkli eintragen</h2>
      <p className="add-location"><MapPin size={18} /> {place}</p>
      <button type="button" className="btn btn-ghost min-h-11" onClick={onChoosePosition}>Position ändern</button>
      <details className="technical-fold"><summary>Details zur Position</summary><p>{coordinates.latitude.toFixed(6)}, {coordinates.longitude.toFixed(6)}</p></details>
      <section className="nearby-benches" aria-label="Bänkli in der Nähe">
        {lookupError ? <p role="alert">Die Suche in der Nähe ist fehlgeschlagen. <button type="button" onClick={() => setRetry((value) => value + 1)}>Erneut prüfen</button></p>
          : nearby === null ? <p role="status">Bestehende Bänkli in der Nähe werden geprüft …</p>
            : nearby.length > 0 ? <><h3>{nearby.length} Bänkli innerhalb von 25 m</h3><p>Ist deines schon dabei?</p><ul>{nearby.map((bench) => <li key={bench.id}><button type="button" onClick={() => onExisting(bench.id)}><strong>{bench.title}</strong><span>{Math.round(bench.distanceMeters)} m · Bänkli ansehen</span></button></li>)}</ul></>
              : <p>Kein eingetragenes Bänkli innerhalb von 25 m gefunden.</p>}
      </section>
      <form action={formAction} className="mt-4 space-y-3" aria-busy={pending}>
        <input type="hidden" name="latitude" value={coordinates.latitude} /><input type="hidden" name="longitude" value={coordinates.longitude} />
        <input type="hidden" name="nearbyIds" value={JSON.stringify((nearby ?? []).map((bench) => bench.id).sort())} />
        {!!nearby?.length && <label className="nearby-confirm"><input type="checkbox" name="nearbyReviewed" value="yes" required checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /><span>Geprüft: Meins ist ein weiteres Bänkli.</span></label>}
        <label className="form-control"><span className="label text-sm font-bold">Name <span className="font-normal">(optional)</span></span><input name="name" maxLength={80} className="input min-h-12 w-full" placeholder="Lieblingsbänkli" /></label>
        <label className="form-control"><span className="label text-sm font-bold">Widmung <span className="font-normal">(optional)</span></span><textarea name="dedication" maxLength={180} className="textarea min-h-20 w-full" /></label>
        <details className="new-bench-features"><summary>Ausstattung ergänzen (freiwillig)</summary><fieldset><legend className="sr-only">Was siehst du am Bänkli?</legend><div>
          <BenchSelect name="backrest" label="Rückenlehne" options={yesNoOptions} />
          <BenchSelect name="armrest" label="Armlehnen" options={yesNoOptions} />
          <BenchSelect name="covered" label="Überdacht" options={yesNoOptions} />
          <BenchSelect name="wheelchair" label="Mit Rollstuhl nutzbar" options={yesNoOptions} />
          <BenchSelect name="fireplaceNearby" label="Feuerstelle nahebei" options={yesNoOptions} />
          <BenchSelect name="wasteBasketNearby" label="Abfalleimer nahebei" options={yesNoOptions} />
          <BenchSelect name="material" label="Material" options={materialOptions} />
          <BenchSelect name="seats" label="Sitzplätze" options={Array.from({ length: 12 }, (_, index) => [String(index + 1), String(index + 1)])} />
          <BenchSelect name="direction" label="Blickrichtung" options={[["0","N"],["45","NO"],["90","O"],["135","SO"],["180","S"],["225","SW"],["270","W"],["315","NW"]]} />
        </div></fieldset><p>Rollstuhlnutzung am Bänkli und Zugangsweg bitte getrennt beurteilen.</p></details>
        <button disabled={pending || nearby === null || lookupError || (!!nearby.length && !reviewed)} className="btn btn-primary min-h-12 w-full"><Plus size={18} /> {pending ? "Wird eingetragen …" : "Eintragen"}</button>
      </form>
      {state && <p role={state.ok ? "status" : "alert"} className="contribution-inline-status">{state.message}</p>}
    </div><form method="dialog" className="modal-backdrop"><button onClick={onClose}>schliessen</button></form>
  </dialog>;
}
const yesNoOptions = [["yes", "Ja"], ["no", "Nein"]];
const materialOptions = [["wood", "Holz"], ["metal", "Metall"], ["stone", "Stein"], ["concrete", "Beton"], ["plastic", "Kunststoff"], ["mixed", "Gemischt"]];
function BenchSelect({ name, label, options }: { name: string; label: string; options: string[][] }) {
  return <label><span>{label}</span><select name={name} defaultValue=""><option value="">Noch offen</option>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>;
}
