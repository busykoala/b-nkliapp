"use client";

import { useActionState, useTransition } from "react";
import { CheckCircle2, MapPin, Pencil, Trash2 } from "lucide-react";
import { confirmBench, editBenchMetadata, requestBenchRemoval } from "@/app/actions/benches";
import type { BenchDetail } from "@/lib/types";

export function BenchCommunityActions({ bench, signedIn }: { bench: BenchDetail; signedIn: boolean }) {
  const [pending, startTransition] = useTransition();
  const act = (action: () => Promise<{ ok: boolean; message: string }>) => startTransition(async () => {
    const result = await action(); window.alert(result.message); if (result.ok) window.location.reload();
  });
  if (!signedIn) return <div className="story-card p-4 text-center"><div className="text-2xl">👋</div><p className="mt-2 font-bold">Zum Mitmachen kurz anmelden</p><p className="mt-1 text-sm opacity-55">Oben rechts findest du dein Konto.</p></div>;
  return <div className="space-y-3">
    {bench.verificationStatus === "unverified" && <button disabled={pending} className="btn btn-primary min-h-12 w-full rounded-2xl" onClick={() => act(() => confirmBench(bench.id))}><CheckCircle2 size={19} /> Ja, dieses Bänkli gibt es</button>}
    <MetadataForm bench={bench} />
    <button disabled={pending} className="btn btn-ghost min-h-11 w-full text-error" onClick={() => act(() => requestBenchRemoval(bench.id))}><Trash2 size={17} /> Bänkli ist nicht mehr da</button>
  </div>;
}

function MetadataForm({ bench }: { bench: BenchDetail }) {
  const [state, action] = useActionState(editBenchMetadata.bind(null, bench.id), null);
  return <details className="story-card px-4">
    <summary className="flex min-h-12 cursor-pointer items-center gap-2 py-3 font-bold"><Pencil size={17} /> Name, Widmung oder Ort ergänzen</summary>
    <form action={action} className="space-y-3 pb-4">
      <label className="form-control"><span className="label text-xs font-bold">Name</span><input name="name" maxLength={80} defaultValue={bench.name ?? ""} className="input input-bordered min-h-11 w-full" /></label>
      <label className="form-control"><span className="label text-xs font-bold">Widmung</span><textarea name="dedication" maxLength={180} defaultValue={bench.dedication ?? ""} className="textarea textarea-bordered min-h-20 w-full" /></label>
      <label className="form-control"><span className="label text-xs font-bold"><MapPin size={13} className="inline" /> Ort</span><input name="locationName" required minLength={2} maxLength={100} defaultValue={bench.locationName ?? ""} className="input input-bordered min-h-11 w-full" /></label>
      <div className="grid grid-cols-2 gap-2"><input aria-label="PLZ" name="postcode" maxLength={10} defaultValue={bench.locationPostcode ?? ""} placeholder="PLZ" className="input input-bordered min-h-11 w-full" /><input aria-label="Kanton" name="canton" maxLength={30} defaultValue={bench.locationCanton ?? ""} placeholder="Kanton" className="input input-bordered min-h-11 w-full" /></div>
      <button className="btn btn-primary min-h-11 w-full rounded-2xl">Speichern</button>
      {state && <p className={`text-sm ${state.ok ? "text-success" : "text-error"}`}>{state.message}</p>}
    </form>
  </details>;
}
