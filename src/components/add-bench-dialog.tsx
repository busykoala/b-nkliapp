"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Crosshair, MapPin, Plus, X } from "lucide-react";
import { addBench, resolveBenchLocation } from "@/app/actions/benches";

export function AddBenchDialog({ open, coordinates, onUseCurrentLocation, onClose }: { open: boolean; coordinates: { latitude: number; longitude: number }; onUseCurrentLocation: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, formAction] = useActionState(addBench, null);
  const [place, setPlace] = useState<{ key: string; label: string } | null>(null);
  const coordinateKey = `${coordinates.latitude},${coordinates.longitude}`;
  useEffect(() => { if (open && !ref.current?.open) ref.current?.showModal(); if (!open && ref.current?.open) ref.current.close(); }, [open]);
  useEffect(() => { if (state?.ok) { window.setTimeout(() => { onClose(); window.location.reload(); }, 700); } }, [state, onClose]);
  useEffect(() => {
    if (!open) return;
    let current = true;
    void resolveBenchLocation(coordinates.latitude, coordinates.longitude).then((location) => {
      if (current) setPlace({ key: coordinateKey, label: location ? [location.name, location.postcode, location.canton].filter(Boolean).join(" · ") : "Ort wird beim Speichern ergänzt" });
    });
    return () => { current = false; };
  }, [open, coordinates.latitude, coordinates.longitude, coordinateKey]);
  return <dialog ref={ref} onCancel={onClose} onClose={onClose} className="modal modal-bottom sm:modal-middle">
    <div className="modal-box storybook-sheet max-h-[calc(100dvh-env(safe-area-inset-top)-1rem)] overflow-y-auto rounded-t-[2rem] pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-[2rem]">
      <button type="button" aria-label="Schliessen" className="btn btn-circle btn-ghost absolute right-3 top-3" onClick={onClose}><X size={19} /></button>
      <span className="story-icon mb-3"><Plus size={21} /></span>
      <div className="story-eyebrow">Neues Plätzli</div><h2 className="mt-1 text-2xl font-black">Bänkli eintragen</h2>
      <p className="mt-1 flex items-center gap-1 text-sm opacity-60"><MapPin size={15} /> Punkt auf der Karte: {coordinates.latitude.toFixed(6)}, {coordinates.longitude.toFixed(6)}</p>
      <p className="mt-2 min-h-5 pl-5 text-sm text-primary/75">{place?.key === coordinateKey ? place.label : "Ort wird gesucht …"}</p>
      <button type="button" className="btn btn-ghost mt-2 min-h-11 w-full rounded-2xl text-primary" onClick={onUseCurrentLocation}><Crosshair size={18} /> Meinen Standort verwenden</button>
      <form action={formAction} className="mt-4 space-y-3">
        <input type="hidden" name="latitude" value={coordinates.latitude} /><input type="hidden" name="longitude" value={coordinates.longitude} />
        <label className="form-control"><span className="label text-sm font-bold">Name <span className="font-normal opacity-50">(optional)</span></span><input name="name" maxLength={80} className="input story-card min-h-12 w-full" placeholder="Lieblingsbänkli" /></label>
        <label className="form-control"><span className="label text-sm font-bold">Widmung <span className="font-normal opacity-50">(optional)</span></span><textarea name="dedication" maxLength={180} className="textarea story-card min-h-20 w-full" /></label>
        <button className="btn btn-primary min-h-12 w-full rounded-2xl"><Plus size={18} /> Eintragen</button>
      </form>
      {state && <p role="status" className={`mt-3 rounded-xl p-2 text-sm ${state.ok ? "bg-success/15 text-success" : "bg-error/15 text-error"}`}>{state.message}</p>}
    </div><form method="dialog" className="modal-backdrop"><button onClick={onClose}>schliessen</button></form>
  </dialog>;
}
