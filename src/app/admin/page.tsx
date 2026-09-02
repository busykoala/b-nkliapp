import Link from "next/link";
import { Eye, EyeOff, Home, LogOut, ShieldBan } from "lucide-react";
import { adminLogout, blockContributor, setContributionVisibility } from "@/app/actions/admin";
import { sqlite } from "@/db/client";
import { isAdmin } from "@/lib/security";
import { AdminLoginForm } from "@/components/admin-login-form";

export const dynamic = "force-dynamic";

type Item = { id: number; type: "rating" | "correction"; bench_id: string; content: string; note: string | null; visible: number; created_at: string; reports: number };

export default async function AdminPage() {
  if (!(await isAdmin())) return <main className="grid min-h-dvh place-items-center bg-base-200 p-4"><AdminLoginForm /></main>;
  const items = sqlite.prepare(`
    SELECT r.id, 'rating' type, b.id bench_id, 'Gesamt ' || r.overall || '/5 · Aussicht ' || r.view_score || '/5 · Komfort ' || r.comfort || '/5 · Ruhe ' || r.quiet || '/5' content,
      r.note, r.visible, r.created_at, (SELECT count(*) FROM reports p WHERE p.target_type='rating' AND p.target_id=r.id) reports
    FROM ratings r JOIN benches b ON b.row_id=r.bench_row_id
    UNION ALL
    SELECT c.id, 'correction' type, b.id bench_id, c.field || ': ' || c.proposed_value content,
      c.note, c.visible, c.created_at, (SELECT count(*) FROM reports p WHERE p.target_type='correction' AND p.target_id=c.id) reports
    FROM corrections c JOIN benches b ON b.row_id=c.bench_row_id
    ORDER BY created_at DESC LIMIT 200
  `).all() as Item[];
  return <main className="min-h-dvh bg-base-200"><header className="navbar sticky top-0 z-10 border-b border-base-300 bg-base-100 px-4"><div className="flex-1"><h1 className="text-xl font-black">Bänkli App Moderation</h1></div><Link href="/" className="btn btn-ghost"><Home size={18} /> Karte</Link><form action={adminLogout}><button className="btn btn-ghost"><LogOut size={18} /> Abmelden</button></form></header><div className="mx-auto max-w-4xl p-4"><div className="stats mb-4 w-full border border-base-300 bg-base-100 shadow-sm"><div className="stat"><div className="stat-title">Beiträge</div><div className="stat-value text-primary">{items.length}</div></div><div className="stat"><div className="stat-title">Meldungen</div><div className="stat-value text-warning">{items.reduce((sum, item) => sum + item.reports, 0)}</div></div></div><div className="space-y-3">{items.length === 0 && <div className="alert bg-base-100">Noch keine Community-Beiträge.</div>}{items.map((item) => <article key={`${item.type}-${item.id}`} className={`rounded-box border bg-base-100 p-4 ${item.visible ? "border-base-300" : "border-error/40 opacity-60"}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex gap-2"><span className="badge badge-outline">{item.type === "rating" ? "Bewertung" : "Korrektur"}</span>{item.reports > 0 && <span className="badge badge-warning">{item.reports} Meldung(en)</span>}{!item.visible && <span className="badge badge-error">Verborgen</span>}</div><h2 className="mt-2 font-bold">{item.content}</h2>{item.note && <p className="mt-1 text-sm">{item.note}</p>}<p className="mt-2 text-xs opacity-50">{item.bench_id} · {new Date(item.created_at).toLocaleString("de-CH")}</p></div><div className="flex gap-1"><form action={setContributionVisibility.bind(null, item.type, item.id, !Boolean(item.visible))}><button className="btn btn-sm min-h-11">{item.visible ? <EyeOff size={17} /> : <Eye size={17} />} {item.visible ? "Verbergen" : "Zeigen"}</button></form><form action={blockContributor.bind(null, item.type, item.id)}><button className="btn btn-sm btn-error min-h-11" title="Browser sperren"><ShieldBan size={17} /></button></form></div></div></article>)}</div></div></main>;
}
