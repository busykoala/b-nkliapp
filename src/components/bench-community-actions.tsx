"use client";

import { useRef, useState, useTransition } from "react";
import { AccountDialog } from "./account-controls";
import { CheckCircle2, Trash2 } from "lucide-react";
import { confirmBench, requestBenchRemoval } from "@/app/actions/benches";
import type { BenchDetail } from "@/lib/types";

export function BenchCommunityActions({ bench, signedIn, onChanged }: { bench: BenchDetail; signedIn: boolean; onChanged?: () => void | Promise<void> }) {
  const account = useRef<HTMLDialogElement>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [missing, setMissing] = useState(false);
  const confirmedToday = confirmed || bench.myLastConfirmedAt?.slice(0, 10) === new Date().toISOString().slice(0, 10);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const act = (action: () => Promise<{ ok: boolean; message: string }>) => startTransition(async () => {
    try {
      const result = await action();
      setMessage(result.message);
      if (result.ok && onChanged) await onChanged();
    } catch { setMessage("Aktion konnte nicht gespeichert werden. Bitte erneut versuchen."); }
  });
  if (!signedIn && !authenticated) return <div><button className="btn" onClick={() => account.current?.showModal()}>Zum Mitmachen anmelden</button><AccountDialog dialogRef={account} intent="Bänkli bestätigen" onAuthenticated={() => setAuthenticated(true)} /></div>;
  return <div className="space-y-3">
    <button disabled={pending || confirmedToday} className="btn btn-primary min-h-12 w-full rounded-2xl" onClick={() => act(async () => { const result = await confirmBench(bench.id); if (result.ok) setConfirmed(true); return result; })}><CheckCircle2 size={19} /> {confirmedToday ? "Heute von dir bestätigt" : "Ist noch da"}</button>
    {bench.removalConfirmationCount > 0 && <div className="rounded-2xl bg-warning/15 p-3 text-sm"><strong>Ist es noch da?</strong><div className="mt-1 opacity-65">{bench.removalConfirmationCount}/{bench.verificationThreshold} Personen vermissen dieses Bänkli.</div></div>}
    <button disabled={pending || missing} className="btn btn-ghost min-h-11 w-full text-error" onClick={() => act(async () => { const result = await requestBenchRemoval(bench.id); if (result.ok) setMissing(true); return result; })}><Trash2 size={17} /> {missing ? "Fehlen von dir gemeldet" : bench.removalConfirmationCount ? "Fehlen bestätigen" : "Bänkli ist nicht mehr da"}</button>
    {message && <p role="status" className="contribution-inline-status">{message}</p>}
  </div>;
}
