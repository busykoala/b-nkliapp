import Link from "next/link";
import { ArrowLeft, Check, MapPinPlus, Pencil, Search, Sparkles, Star } from "lucide-react";
import { getActivityFeed, type FeedEntry } from "@/app/actions/feed";
import { AppMenu } from "@/components/app-menu";
import { getCurrentUser } from "@/lib/security";

export const dynamic = "force-dynamic";

const feedIcons = { added: MapPinPlus, rated: Star, confirmed: Check, missing: Search, edited: Pencil } as const;

export default async function FeedPage() {
  const [entries, user] = await Promise.all([getActivityFeed(), getCurrentUser()]);
  return <main className="feed-page min-h-dvh safe-bottom">
    <header className="feed-nav safe-top"><Link href="/" aria-label="Zur Karte" className="calm-menu-button"><ArrowLeft size={19} /></Link><AppMenu user={user} /></header>
    <section className="feed-intro"><span><Sparkles size={14} /> Was sich bewegt</span><h1>Spuren am Weg</h1><p>Neue Plätze, kleine Pausen und Menschen, die genauer hinschauen.</p></section>
    <section className="feed-scroll" aria-label="Neuigkeiten">
      {entries.length ? entries.map((entry) => <FeedCard key={entry.id} entry={entry} />) : <div className="feed-empty"><span>🍂</span><p>Noch weht kein neuer Eintrag herein.</p></div>}
    </section>
  </main>;
}

function FeedCard({ entry }: { entry: FeedEntry }) {
  const Icon = feedIcons[entry.kind];
  return <article className={`feed-entry feed-${entry.kind}`}>
    <span className="feed-mark"><Icon size={18} aria-hidden="true" /></span>
    <div><p>{feedSentence(entry)}</p><time dateTime={entry.createdAt}>{relativeTime(entry.createdAt)}</time></div>
    <Link href={`/bank/${entry.benchId}`} aria-label={`${entry.benchName} öffnen`}><span aria-hidden>→</span></Link>
  </article>;
}

function feedSentence(entry: FeedEntry) {
  const name = <strong>{entry.username}</strong>;
  const bench = <em>{entry.benchName}</em>;
  if (entry.kind === "added") return <>{name} hat {bench} auf die Karte gesetzt. Ein neues Plätzli wartet.</>;
  if (entry.kind === "rated") return <>{name} hat bei {bench} kurz innegehalten und eine Stimme dagelassen.</>;
  if (entry.kind === "confirmed") return <>{name} hat nachgeschaut: {bench} steht wirklich da.</>;
  if (entry.kind === "missing") return <>{name} vermisst {bench}. Vielleicht ist das Bänkli weitergezogen.</>;
  return <>{name} hat {bench} ein kleines Detail geschenkt.</>;
}

function relativeTime(value: string) {
  const difference = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(difference / 60_000));
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `vor ${days} ${days === 1 ? "Tag" : "Tagen"}`;
  return new Intl.DateTimeFormat("de-CH", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}
