"use client";

import { Bookmark, Building2, HeartHandshake, MapPin, Share2, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { deleteOwnBenchMoment, toggleBenchFollow } from "@/app/actions/bench-community";
import type { BenchCareKind, BenchDetail } from "@/lib/types";
import { TrailAvatar } from "./trail-avatar";

const momentLabels = { memory: "Erinnerung", recommendation: "Empfehlung", poem: "Gedicht", local_fact: "Ortswissen", photo: "Bildmoment" } as const;
const careLabels: Record<BenchCareKind, string> = {
  cleaned: "gereinigt",
  good: "in gutem Zustand gesehen",
  repair: "mit Reparaturbedarf gemeldet",
  beautiful: "heute besonders schön gefunden",
};

export function BenchPlaceCommunity({ bench, signedIn, onChanged }: { bench: BenchDetail; signedIn: boolean; onChanged?: () => void | Promise<void> }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [followingBench, setFollowingBench] = useState(bench.followingBench);
  const [followingPlace, setFollowingPlace] = useState(bench.followingPlace);
  const follow = (scope: "bench" | "place") => startTransition(async () => {
    const result = await toggleBenchFollow(bench.id, scope);
    setMessage(result.message);
    if (!result.ok) return;
    if (scope === "bench") setFollowingBench(Boolean(result.following));
    else setFollowingPlace(Boolean(result.following));
    if (onChanged) await onChanged();
  });
  const remove = (id: number) => startTransition(async () => {
    const result = await deleteOwnBenchMoment(bench.id, id);
    setMessage(result.message);
    if (result.ok && onChanged) await onChanged();
  });
  const share = async () => {
    const data = { title: bench.title, text: `Ein Bänkli-Moment bei ${bench.title}`, url: window.location.href };
    try {
      if (navigator.share) await navigator.share(data);
      else {
        await navigator.clipboard.writeText(`${data.text} ${data.url}`);
        setMessage("Link kopiert – bereit fürs Teilen, auch auf Instagram.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage("Teilen ist in diesem Browser gerade nicht verfügbar.");
    }
  };
  const careEntries = Object.entries(bench.care.counts).filter((entry): entry is [BenchCareKind, number] => Number(entry[1]) > 0);
  return <section className="bench-place-community" aria-labelledby="bench-moments-heading">
    <header><div><small>Menschen an diesem Platz</small><h3 id="bench-moments-heading">Bänkli-Momente</h3></div><button type="button" onClick={share}><Share2 size={16} /> Moment teilen</button></header>
    {bench.operatorName && <p className="bench-caretaker"><Building2 size={17} /><span><small>Betreut vor Ort</small><strong>{bench.operatorName}</strong></span></p>}
    {signedIn && <div className="follow-place-actions">
      <button type="button" disabled={pending} aria-pressed={followingBench} onClick={() => follow("bench")}><Bookmark size={16} />{followingBench ? "Lieblingsplatz" : "Bänkli merken"}</button>
      {bench.locationName && <button type="button" disabled={pending} aria-pressed={followingPlace} onClick={() => follow("place")}><MapPin size={16} />{followingPlace ? `${bench.locationName} abonniert` : `${bench.locationName} folgen`}</button>}
    </div>}
    {careEntries.length > 0 && <div className="care-summary"><HeartHandshake size={17} /><p>{careEntries.map(([kind, count]) => `${count}× ${careLabels[kind]}`).join(" · ")} <small>in den letzten 90 Tagen</small></p></div>}
    {bench.moments.length ? <div className="bench-moment-list">{bench.moments.map((moment) => <article key={moment.id}>
      <TrailAvatar seed={moment.avatarSeed} username={moment.username} compact />
      <div><header><strong>{moment.username}</strong><span>{momentLabels[moment.kind]}</span></header><p>{moment.body}</p>
        {moment.photoUrl && <a href={moment.photoUrl} target="_blank" rel="noreferrer">Öffentliches Bild öffnen ↗</a>}
        <time dateTime={moment.createdAt}>{new Date(moment.createdAt).toLocaleDateString("de-CH")}</time>
      </div>
      {moment.mine && <button type="button" disabled={pending} aria-label="Eigenen Moment löschen" onClick={() => remove(moment.id)}><Trash2 size={14} /></button>}
    </article>)}</div> : <p className="bench-moments-empty">Noch keine Geschichte hier. Das Bänkli wartet geduldig.</p>}
    {message && <p className="place-community-status" role="status">{message}</p>}
  </section>;
}
