"use client";

import { useTransition } from "react";
import { CheckCircle2, Trash2 } from "lucide-react";
import { confirmBench, requestBenchRemoval } from "@/app/actions/benches";
import type { BenchDetail } from "@/lib/types";

export function BenchCommunityActions({ bench, signedIn }: { bench: BenchDetail; signedIn: boolean }) {
  const [pending, startTransition] = useTransition();
  const act = (action: () => Promise<{ ok: boolean; message: string }>) => startTransition(async () => {
    const result = await action(); window.alert(result.message); if (result.ok) window.location.reload();
  });
  if (!signedIn) return <div className="story-card p-4 text-center"><div className="text-2xl">👋</div><p className="mt-2 font-bold">Zum Mitmachen kurz anmelden</p><p className="mt-1 text-sm opacity-55">Oben rechts findest du dein Konto.</p></div>;
  return <div className="space-y-3">
    {bench.verificationStatus === "unverified" && <button disabled={pending} className="btn btn-primary min-h-12 w-full rounded-2xl" onClick={() => act(() => confirmBench(bench.id))}><CheckCircle2 size={19} /> Ja, dieses Bänkli gibt es</button>}
    {bench.removalConfirmationCount > 0 && <div className="rounded-2xl bg-warning/15 p-3 text-sm"><strong>Ist es noch da?</strong><div className="mt-1 opacity-65">{bench.removalConfirmationCount}/{bench.verificationThreshold} Personen vermissen dieses Bänkli.</div></div>}
    <button disabled={pending} className="btn btn-ghost min-h-11 w-full text-error" onClick={() => act(() => requestBenchRemoval(bench.id))}><Trash2 size={17} /> {bench.removalConfirmationCount ? "Fehlen bestätigen" : "Bänkli ist nicht mehr da"}</button>
  </div>;
}
