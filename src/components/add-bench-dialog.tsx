"use client";

import { useActionState, useEffect, useRef } from "react";
import { Crosshair, MapPin, Plus, X } from "lucide-react";
import { addBench } from "@/app/actions/benches";

export function AddBenchDialog({ open, coordinates, onUseCurrentLocation, onClose }: { open: boolean; coordinates: { latitude: number; longitude: number }; onUseCurrentLocation: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, formAction] = useActionState(addBench, null);
  useEffect(() => { if (open && !ref.current?.open) ref.current?.showModal(); if (!open && ref.current?.open) ref.current.close(); }, [open]);
  useEffect(() => { if (state?.ok) { window.setTimeout(() => { onClose(); window.location.reload(); }, 700); } }, [state, onClose]);
  return <dialog ref={ref} onCancel={onClose} onClose={onClose} className="modal modal-bottom sm:modal-middle">
    <div className="modal-box storybook-sheet max-h-[calc(100dvh-env(safe-area-inset-top)-1rem)] overflow-y-auto rounded-t-[2rem] pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-[2rem]">
      <button type="button" aria-label="Schliessen" className="btn btn-circle btn-ghost absolute right-3 top-3" onClick={onClose}><X size={19} /></button>
      <span className="story-icon mb-3"><Plus size={21} /></span>
      <div className="story-eyebrow">Neues Plätzli</div><h2 className="mt-1 text-2xl font-black">Bänkli eintragen</h2>
      <p className="mt-1 flex items-center gap-1 text-sm opacity-60"><MapPin size={15} /> Punkt auf der Karte: {coordinates.latitude.toFixed(6)}, {coordinates.longitude.toFixed(6)}</p>
      <button type="button" className="btn btn-ghost mt-2 min-h-11 w-full rounded-2xl text-primary" onClick={onUseCurrentLocation}><Crosshair size={18} /> Meinen Standort verwenden</button>
      <form action={formAction} className="mt-4 space-y-3">
        <input type="hidden" name="latitude" value={coordinates.latitude} /><input type="hidden" name="longitude" value={coordinates.longitude} />
        <label className="form-control"><span className="label text-sm font-bold">Ort *</span><input name="locationName" required minLength={2} maxLength={100} className="input story-card min-h-12 w-full" placeholder="z. B. Thun" /></label>
        <div className="grid grid-cols-2 gap-2"><label className="form-control"><span className="label text-sm font-bold">PLZ</span><input name="postcode" maxLength={10} className="input story-card min-h-12 w-full" /></label><label className="form-control"><span className="label text-sm font-bold">Kanton</span><input name="canton" maxLength={30} className="input story-card min-h-12 w-full" placeholder="BE" /></label></div>
        <label className="form-control"><span className="label text-sm font-bold">Name <span className="font-normal opacity-50">(optional)</span></span><input name="name" maxLength={80} className="input story-card min-h-12 w-full" placeholder="Lieblingsbänkli" /></label>
        <label className="form-control"><span className="label text-sm font-bold">Widmung <span className="font-normal opacity-50">(optional)</span></span><textarea name="dedication" maxLength={180} className="textarea story-card min-h-20 w-full" /></label>
        <button className="btn btn-primary min-h-12 w-full rounded-2xl"><Plus size={18} /> Eintragen</button>
      </form>
      {state && <p role="status" className={`mt-3 rounded-xl p-2 text-sm ${state.ok ? "bg-success/15 text-success" : "bg-error/15 text-error"}`}>{state.message}</p>}
    </div><form method="dialog" className="modal-backdrop"><button onClick={onClose}>schliessen</button></form>
  </dialog>;
}
