import { formatDate } from "@/i18n/date";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Eye, EyeOff, Home, LogOut, ShieldBan } from "lucide-react";
import { adminLogout, blockContributor, setContributionVisibility } from "@/app/actions/admin";
import { sqlite } from "@/db/client";
import { isAdmin } from "@/lib/security";
import { AdminLoginForm } from "@/components/admin-login-form";

export const dynamic = "force-dynamic";

type Item = { id: number; type: "rating" | "correction"; bench_id: string; overall: number; view: number; comfort: number; quiet: number; field: "properties" | "condition" | "location" | "removed" | "environment" | null; proposed: string | null; note: string | null; visible: number; created_at: string; reports: number };

export default async function AdminPage() {
  const t = await getTranslations();
  if (!(await isAdmin())) return <main className="grid min-h-dvh place-items-center bg-base-200 p-4"><AdminLoginForm /></main>;
  const items = sqlite.prepare(`
    SELECT r.id, 'rating' type, b.id bench_id, r.overall,r.view_score AS view,r.comfort,r.quiet,NULL field,NULL proposed,
      r.note, r.visible, r.created_at, (SELECT count(*) FROM reports p WHERE p.target_type='rating' AND p.target_id=r.id) reports
    FROM ratings r JOIN benches b ON b.row_id=r.bench_row_id
    UNION ALL
    SELECT c.id, 'correction' type, b.id bench_id, NULL overall,NULL view,NULL comfort,NULL quiet,c.field,c.proposed_value proposed,
      c.note, c.visible, c.created_at, (SELECT count(*) FROM reports p WHERE p.target_type='correction' AND p.target_id=c.id) reports
    FROM corrections c JOIN benches b ON b.row_id=c.bench_row_id
    ORDER BY created_at DESC LIMIT 200
  `).all() as Item[];
  return <main className="min-h-dvh bg-base-200"><header className="navbar sticky top-0 z-10 border-b border-base-300 bg-base-100 px-4"><div className="flex-1"><h1 className="text-xl font-black">{t("admin.title")}</h1></div><Link href="/" className="btn btn-ghost"><Home size={18} /> {t("common.navigation.map")}</Link><form action={adminLogout}><button className="btn btn-ghost"><LogOut size={18} /> {t("common.navigation.signOut")}</button></form></header><div className="mx-auto max-w-4xl p-4"><div className="stats mb-4 w-full border border-base-300 bg-base-100 shadow-sm"><div className="stat"><div className="stat-title">{t("admin.contributions")}</div><div className="stat-value text-primary">{items.length}</div></div><div className="stat"><div className="stat-title">{t("admin.reports")}</div><div className="stat-value text-warning">{items.reduce((sum, item) => sum + item.reports, 0)}</div></div></div><div className="space-y-3">{items.length === 0 && <div className="alert bg-base-100">{t("admin.empty")}</div>}{items.map((item) => <article key={`${item.type}-${item.id}`} className={`rounded-box border bg-base-100 p-4 ${item.visible ? "border-base-300" : "border-error/40 opacity-60"}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex gap-2"><span className="badge badge-outline">{item.type === "rating" ? t("admin.kinds.rating") : t("admin.kinds.correction")}</span>{item.reports > 0 && <span className="badge badge-warning">{t("admin.reportCount", { count: item.reports })}</span>}{!item.visible && <span className="badge badge-error">{t("admin.hidden")}</span>}</div><h2 className="mt-2 font-bold">{item.type === "rating" ? t("admin.rating", { overall: item.overall, view: item.view, comfort: item.comfort, quiet: item.quiet }) : item.field && ["properties", "condition", "location", "removed", "environment"].includes(item.field) ? t(`community.correction.fields.${item.field}`) : item.proposed}</h2>{item.note && <p className="mt-1 text-sm">{item.note}</p>}<p className="mt-2 text-xs opacity-50">{item.bench_id} · {formatDate(item.created_at, t, "dateTime")}</p></div><div className="flex gap-1"><form action={setContributionVisibility.bind(null, item.type, item.id, !Boolean(item.visible))}><button className="btn btn-sm min-h-11">{item.visible ? <EyeOff size={17} /> : <Eye size={17} />} {item.visible ? t("admin.hide") : t("admin.show")}</button></form><form action={blockContributor.bind(null, item.type, item.id)}><button className="btn btn-sm btn-error min-h-11" title={t("admin.block")}><ShieldBan size={17} /></button></form></div></div></article>)}</div></div></main>;
}
