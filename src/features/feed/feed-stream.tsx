"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ChevronDown, Rss } from "lucide-react";
import { getFeedPage } from "@/app/actions/feed";
import { groupBenchActivity, type FeedEntry, type FeedPage } from "./model";

const labels: Record<FeedEntry["kind"], string> = { added: "entdeckt", rated: "bewertet", confirmed: "bestätigt", missing: "vermisst", edited: "ergänzt", moment: "Momente", care: "Pflegezeichen" };
export function FeedStream({ initial }: { initial: FeedPage }) {
  const [entries, setEntries] = useState(initial.entries);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const more = () => startTransition(async () => {
    setError(null);
    try {
      const page = await getFeedPage(cursor);
      setEntries((current) => [...current, ...page.entries]);
      setCursor(page.nextCursor);
      setAnnouncement(`${page.entries.length} weitere Beiträge geladen.`);
    } catch { setError("Der Feed macht gerade Pause. Bitte versuche es noch einmal."); }
  });
  const groups = groupBenchActivity(entries);
  return <div aria-busy={pending}>
    {groups.map((group) => {
      const counts = new Map<FeedEntry["kind"], number>();
      group.entries.forEach((entry) => counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1));
      const people = [...new Set(group.entries.map((entry) => entry.username))];
      return <article className="feed-bench-group" key={group.key}>
        <header><Rss size={18} /><div><h2><Link href={`/bank/${group.benchId}`}>{group.benchName}</Link></h2><time dateTime={group.date}>{new Intl.DateTimeFormat("de-CH", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Zurich" }).format(new Date(group.entries[0].createdAt))}</time></div><Link className="feed-arrow" href={`/bank/${group.benchId}`} aria-label={`${group.benchName} öffnen`}>→</Link></header>
        <p>{[...counts].map(([kind, count]) => `${count}× ${labels[kind]}`).join(" · ")}</p>
        <p className="feed-participants">{people.slice(0, 3).map((name, index) => <span key={name}>{index > 0 && ", "}<Link href={`/profil/${encodeURIComponent(name)}`}>{name}</Link></span>)}{people.length > 3 && ` und ${people.length - 3} weitere`}</p>
        <details><summary>Beiträge ansehen ({group.entries.length}) <ChevronDown size={16} /></summary><ul>{group.entries.map((entry) => <li key={entry.id}><Link href={`/profil/${encodeURIComponent(entry.username)}`}>{entry.username}</Link><span>{labels[entry.kind]}</span>{entry.detail && ["moment", "rated"].includes(entry.kind) && <q>{entry.detail}</q>}</li>)}</ul></details>
      </article>;
    })}
    {!groups.length && <div className="feed-empty"><p>Noch weht kein neuer Eintrag herein.</p></div>}
    {error && <p role="alert">{error}</p>}
    <p className="sr-only" role="status">{announcement}</p>
    {cursor ? <button className="ui-button feed-load-more" disabled={pending} onClick={more}>{pending ? "Wird geladen …" : "Mehr Beiträge laden"}</button> : groups.length > 0 && <p className="feed-end">Hier beginnt die Geschichte. Du hast alle Beiträge gesehen.</p>}
  </div>;
}
