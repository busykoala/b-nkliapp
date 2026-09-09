import Link from "next/link";
import { ArrowLeft, Bookmark } from "lucide-react";
import { redirect } from "next/navigation";
import { AppMenu } from "@/components/app-menu";
import { sqlite } from "@/db/client";
import { getCurrentUser } from "@/lib/security";

export const dynamic = "force-dynamic";
export const metadata = { title: "Meine Lieblingsplätze · Bänkli App" };

export default async function FavouritesPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const { before } = await searchParams;
  const cursor = before && /^\d{1,15}$/.test(before) ? Number(before) : Number.MAX_SAFE_INTEGER;
  const rows = sqlite.prepare(`SELECT b.row_id, b.id, coalesce(nullif(b.name,''),nullif(b.location_name,''),nullif(b.description,''), 'Ein Bänkli') title,
    b.location_name place, b.active FROM bench_follows f JOIN benches b ON b.row_id=f.bench_row_id
    WHERE f.user_id=? AND b.row_id<? ORDER BY b.row_id DESC LIMIT 49`).all(user.id, cursor) as Array<{ row_id: number; id: string; title: string; place: string | null; active: number }>;
  const benches = rows.slice(0, 48);
  return <main className="feed-page min-h-dvh safe-bottom">
    <header className="feed-nav safe-top"><Link href="/" className="calm-menu-button" aria-label="Zur Karte"><ArrowLeft size={19} /></Link><AppMenu user={user} /></header>
    <section className="feed-intro"><span><Bookmark size={16} /> Für die nächste Pause</span><h1>Meine Lieblingsplätze</h1><p>Alle Bänkli, die du dir gemerkt hast. Diese Liste ist nur für dich sichtbar.</p></section>
    <section className="feed-scroll saved-benches" aria-label="Gemerkte Bänkli">
      {benches.map((bench) => !bench.active ? <div className="saved-bench-unavailable" key={bench.id}><Bookmark size={20} /><span><strong>{bench.title}</strong><small>{bench.place} · nicht mehr vorhanden</small></span></div> : <Link key={bench.id} href={`/bank/${bench.id}`}><Bookmark size={20} /><span><strong>{bench.title}</strong><small>{bench.place ?? "Ein Platz auf der Karte"}{!bench.active && " · nicht mehr vorhanden"}</small></span><span aria-hidden="true">→</span></Link>)}
      {!benches.length && <p>{before ? "Keine weiteren Lieblingsplätze." : "Noch kein Lieblingsplatz? Öffne ein Bänkli auf der Karte und tippe auf „Bänkli merken“."}</p>}
      {rows.length > 48 && <Link className="ui-button" href={`/lieblingsplaetze?before=${benches.at(-1)!.row_id}`}>Mehr Lieblingsplätze</Link>}
    </section>
  </main>;
}
