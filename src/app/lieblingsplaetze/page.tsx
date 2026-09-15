import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ArrowLeft, Bookmark, Map, Route } from "lucide-react";
import { redirect } from "next/navigation";
import { AppMenu } from "@/components/app-menu";
import { sqlite } from "@/db/client";
import { getCurrentUser } from "@/lib/security";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const t = await getTranslations();
  return {title: t("favourites.metadata")};
}

export default async function FavouritesPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const t = await getTranslations();
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const { before } = await searchParams;
  const cursorId = before && /^\d{1,15}$/.test(before) ? Number(before) : null;
  const cursor = cursorId === null ? null : sqlite.prepare("SELECT f.created_at FROM bench_follows f WHERE f.user_id=? AND f.bench_row_id=?").get(user.id, cursorId) as { created_at: string } | undefined;
  const rows = sqlite.prepare(`SELECT b.row_id, b.id, coalesce(nullif(b.name,''),nullif(b.location_name,''),nullif(nullif(b.description,'Sitzbank'),'')) title,
    b.location_name place, b.active, f.created_at saved_at, b.backrest, b.material
    FROM bench_follows f JOIN benches b ON b.row_id=f.bench_row_id
    WHERE f.user_id=? AND (? IS NULL OR f.created_at<? OR (f.created_at=? AND b.row_id<?))
    ORDER BY f.created_at DESC, b.row_id DESC LIMIT 49`).all(user.id, cursor?.created_at ?? null, cursor?.created_at ?? null, cursor?.created_at ?? null, cursorId ?? 0) as Array<{ row_id: number; id: string; title: string | null; place: string | null; active: number; saved_at: string; backrest: string | null; material: string | null }>;
  const benches = rows.slice(0, 48);
  return <main className="feed-page min-h-dvh safe-bottom">
    <header className="feed-nav safe-top"><Link href="/" className="calm-menu-button" aria-label={t("feed.page.map")}><ArrowLeft size={19} /></Link><AppMenu user={user} /></header>
    <section className="feed-intro favourites-intro"><span><Bookmark size={16} /> {t("favourites.eyebrow")}</span><div><h1>{t("favourites.title")}</h1><b aria-label={`${benches.length} · ${t("favourites.label")}`}>{benches.length}</b></div><p>{t("favourites.intro")}</p></section>
    <section className="feed-scroll saved-benches" aria-label={t("favourites.label")}>
      {benches.map((bench) => !bench.active ? <div className="saved-bench-unavailable" key={bench.id}><Bookmark size={20} /><span><strong>{bench.title ?? t("common.values.bench")}</strong><small>{t("favourites.removed", {place: bench.place ?? t("favourites.place")})}</small></span></div> : <div className="saved-bench-item" key={bench.id}><Link href={`/bank/${bench.id}?from=favourites`}><Bookmark size={20} /><span><strong>{bench.title ?? t("common.values.bench")}</strong><small>{bench.place ?? t("favourites.place")}</small></span><span aria-hidden="true">→</span></Link><Link className="saved-bench-route" href={`/?bank=${encodeURIComponent(bench.id)}&action=journey`} aria-label={`${t("bench.story.directions")} · ${bench.title ?? t("common.values.bench")}`}><Route size={18} /> {t("bench.story.directions")}</Link></div>)}
      {!benches.length && (before ? <p>{t("favourites.end")}</p> : <div className="favourites-empty"><Bookmark size={28} aria-hidden="true" /><p>{t("favourites.empty", { action: t("community.place.save") })}</p><Link className="ui-button" href="/"><Map size={18} /> {t("common.navigation.map")}</Link></div>)}
      {rows.length > 48 && <Link className="ui-button" href={`/lieblingsplaetze?before=${benches.at(-1)!.row_id}`}>{t("favourites.more")}</Link>}
    </section>
  </main>;
}
