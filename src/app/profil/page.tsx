import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Armchair, LogOut, Sparkles } from "lucide-react";
import { logout } from "@/app/actions/account";
import { BadgeIllustration, type BadgeArt } from "@/components/badge-illustration";
import { getUserBadges } from "@/lib/badges";
import { getCurrentUser } from "@/lib/security";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await getCurrentUser(); if (!user) redirect("/");
  const badges = getUserBadges(user.id);
  return <main className="min-h-dvh bg-base-200 p-4 safe-top safe-bottom">
    <div className="mx-auto max-w-lg">
      <header className="flex items-center justify-between"><Link href="/" className="btn btn-ghost min-h-11"><ArrowLeft size={18} /> Karte</Link><form action={logout}><button className="btn btn-ghost min-h-11"><LogOut size={18} /> Raus</button></form></header>
      <section className="bench-hero mt-4 p-6 text-[#243c34]"><div className="story-eyebrow"><Sparkles size={13} className="inline" /> Dein Sammelalbum</div><h1 className="mt-2 text-3xl font-black">Hoi, {user.username}!</h1><p className="mt-2 opacity-70">Jeder echte Beitrag lässt deine Sammlung wachsen.</p><Armchair className="absolute bottom-5 right-6 h-16 w-16 opacity-20" /></section>
      <div className="badge-album mt-4 grid grid-cols-2 gap-3">{badges.map((badge) => <article key={badge.key} className={`story-card badge-card ${badge.earned ? "is-earned" : "is-locked"}`}><BadgeIllustration kind={badge.art as BadgeArt} label={badge.name} earned={badge.earned} /><div className="badge-copy"><h2>{badge.name}</h2><p>{badge.hint}</p><div className="badge-progress" aria-label={`${badge.progress} von ${badge.target}`}><i style={{ width: `${badge.progress / badge.target * 100}%` }} /></div><small>{badge.progress}/{badge.target}</small></div></article>)}</div>
    </div>
  </main>;
}
