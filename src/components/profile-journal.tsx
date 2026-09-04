import Link from "next/link";
import { ArrowLeft, Armchair, Check, Footprints, LogOut, Map, MapPinPlus, Pencil, Search, Sparkles, Star } from "lucide-react";
import { logout } from "@/app/actions/account";
import type { CurrentUser } from "@/lib/security";
import type { LandscapeKey, ProfileMoment, SeasonKey, TrailProfile } from "@/lib/profile";
import { AppMenu } from "@/components/app-menu";
import { AvatarRedrawButton } from "@/components/avatar-redraw-button";
import { BadgeIllustration, type BadgeArt } from "@/components/badge-illustration";
import { TrailAvatar } from "@/components/trail-avatar";

type Badge = { key: string; name: string; art: string; hint: string; target: number; progress: number; earned: boolean };

export function ProfileJournal({ profile, badges, viewer, own }: { profile: TrailProfile; badges: Badge[]; viewer: CurrentUser | null; own: boolean }) {
  const earnedBadges = badges.filter((badge) => badge.earned);
  const lockedBadges = badges.filter((badge) => !badge.earned);
  const shownBadges = own ? [...earnedBadges, ...lockedBadges.slice(0, Math.max(0, 4 - earnedBadges.length))] : earnedBadges;
  const hiddenBadges = own ? lockedBadges.slice(Math.max(0, 4 - earnedBadges.length)) : [];
  return <main className="profile-page min-h-dvh safe-bottom">
    <header className="profile-nav safe-top">
      <Link href={own ? "/" : "/feed"} aria-label={own ? "Zur Karte" : "Zum Bänkli-Feed"} className="calm-menu-button"><ArrowLeft size={19} /></Link>
      <div className="profile-nav-actions">
        {own && <form action={logout}><button className="profile-logout"><LogOut size={16} /> Raus</button></form>}
        <AppMenu user={viewer} />
      </div>
    </header>

    <div className="profile-journal">
      <section className="profile-portrait">
        <div className="profile-avatar-wrap">
          <TrailAvatar seed={profile.avatarSeed} username={profile.username} progress={profile.uniquePlaces} />
          {own && <AvatarRedrawButton />}
        </div>
        <div className="profile-intro">
          <span><Sparkles size={13} /> {own ? "Dein Wanderbuch" : "Unterwegs mit"}</span>
          <h1>{profile.username}</h1>
          <p>{profile.journey.title}</p>
          <small>Seit {new Intl.DateTimeFormat("de-CH", { month: "long", year: "numeric" }).format(new Date(profile.joinedAt))} unterwegs</small>
        </div>
      </section>

      <section className="profile-section trail-progress-card">
        <header><div><small>Deine Spur</small><h2>{profile.uniquePlaces === 1 ? "Ein besonderer Platz" : `${profile.uniquePlaces} besondere Plätze`}</h2></div><Footprints size={22} /></header>
        <TrailPath journey={profile.journey} places={profile.uniquePlaces} />
        <p>{profile.journey.nextTarget === null
          ? "Deine Karte ist voller Geschichten – und bleibt offen für neue."
          : `Noch ${profile.journey.nextTarget - profile.uniquePlaces} ${profile.journey.nextTarget - profile.uniquePlaces === 1 ? "Platz" : "Plätze"} bis zum nächsten Wegstück.`}</p>
      </section>

      {own && <Link href="/" className="next-trail-card">
        <span><Map size={19} /></span><div><small>Nächste kleine Reise</small><strong>{profile.nextPrompt.title}</strong><p>{profile.nextPrompt.copy}</p></div><b aria-hidden>→</b>
      </Link>}

      <section className="profile-section collection-section">
        <header><div><small>Landschaften</small><h2>Was du schon gefunden hast</h2></div><span>{profile.landscapes.filter((item) => item.found).length}/{profile.landscapes.length}</span></header>
        <div className="landscape-collection">{profile.landscapes.map((item) => {
          const picture = <><LandscapeStamp kind={item.key} found={item.found} /><div><strong>{item.name}</strong><small>{item.found ? item.hint : "Wartet noch auf dich"}</small></div></>;
          return item.found && item.benchId
            ? <Link key={item.key} href={`/bank/${item.benchId}`} className="landscape-token is-found">{picture}</Link>
            : <div key={item.key} className="landscape-token is-locked">{picture}</div>;
        })}</div>
      </section>

      <section className="profile-section season-section">
        <header><div><small>Jahreszeiten</small><h2>Dein Jahr draussen</h2></div></header>
        <div className="season-collection">{profile.seasons.map((season) => <SeasonStamp key={season.key} season={season.key} name={season.name} found={season.found} />)}</div>
      </section>

      <section className="profile-section profile-numbers">
        <header><div><small>Mitgemacht</small><h2>Kleine Dinge, die helfen</h2></div></header>
        <div><ProfileNumber value={profile.activity.added} label="entdeckt" icon={<MapPinPlus />} /><ProfileNumber value={profile.activity.rated} label="bewertet" icon={<Star />} /><ProfileNumber value={profile.activity.confirmed} label="bestätigt" icon={<Check />} /><ProfileNumber value={profile.activity.edited + profile.activity.corrected} label="ergänzt" icon={<Pencil />} /></div>
      </section>

      {profile.recent.length > 0 && <section className="profile-section profile-moments">
        <header><div><small>Letzte Spuren</small><h2>Aus deinem Wanderbuch</h2></div></header>
        <div>{profile.recent.map((moment) => <Link key={moment.id} href={`/bank/${moment.benchId}`}><MomentIcon kind={moment.kind} /><p>{momentSentence(moment)}</p><time>{relativeTime(moment.createdAt)}</time></Link>)}</div>
      </section>}

      <section className="profile-section badge-book">
        <header><div><small>Abzeichenbuch</small><h2>{earnedBadges.length ? `${earnedBadges.length} ${earnedBadges.length === 1 ? "Erinnerung" : "Erinnerungen"} gesammelt` : "Die erste Seite ist noch frei"}</h2></div><Armchair size={21} /></header>
        {shownBadges.length > 0 ? <BadgeGrid badges={shownBadges} /> : <p className="badge-empty">Hier wartet die erste kleine Erinnerung an einen gemeinsamen Platz.</p>}
        {hiddenBadges.length > 0 && <details className="more-badges"><summary>{hiddenBadges.length} weitere Abzeichen entdecken <span aria-hidden>＋</span></summary><BadgeGrid badges={hiddenBadges} /></details>}
      </section>
    </div>
  </main>;
}

function TrailPath({ journey, places }: { journey: TrailProfile["journey"]; places: number }) {
  const milestones = [1, 5, 15, 40, 100];
  const pathProgress = trailPosition(places);
  return <div className="trail-path" role="progressbar" aria-label="Fortschritt auf deinem Weg" aria-valuemin={journey.currentFloor} aria-valuemax={journey.nextTarget ?? 100} aria-valuenow={places}>
    <svg viewBox="0 0 420 94" aria-hidden="true"><path className="trail-path-paper" d="M7 72C65 10 109 91 165 45S272 13 315 53s70 25 98-20" pathLength="100" /><path className="trail-path-ink" d="M7 72C65 10 109 91 165 45S272 13 315 53s70 25 98-20" pathLength="100" style={{ strokeDasharray: `${pathProgress} 100` }} />{milestones.map((target, index) => <g key={target} className={places >= target ? "is-reached" : undefined} transform={`translate(${[32, 117, 207, 302, 390][index]} ${[50, 60, 29, 46, 42][index]})`}><circle r="8" /><path d="m-3 0 2 3 5-6" /></g>)}</svg>
  </div>;
}

function trailPosition(places: number) {
  const stops = [{ value: 0, position: 0 }, { value: 1, position: 7 }, { value: 5, position: 28 }, { value: 15, position: 50 }, { value: 40, position: 73 }, { value: 100, position: 100 }];
  const upperIndex = stops.findIndex((stop) => places <= stop.value);
  if (upperIndex <= 0) return upperIndex < 0 ? 100 : stops[upperIndex].position;
  const lower = stops[upperIndex - 1]; const upper = stops[upperIndex];
  return lower.position + ((places - lower.value) / (upper.value - lower.value)) * (upper.position - lower.position);
}

function BadgeGrid({ badges }: { badges: Badge[] }) {
  return <div className="badge-album">{badges.map((badge) => <article key={badge.key} className={`story-card badge-card ${badge.earned ? "is-earned" : "is-locked"}`}><BadgeIllustration kind={badge.art as BadgeArt} label={badge.name} earned={badge.earned} /><div className="badge-copy"><h3>{badge.name}</h3><p>{badge.hint}</p><div className="badge-progress" aria-label={`${badge.progress} von ${badge.target}`}><i style={{ width: `${badge.progress / badge.target * 100}%` }} /></div><small>{badge.progress}/{badge.target}</small></div></article>)}</div>;
}

function LandscapeStamp({ kind, found }: { kind: LandscapeKey; found: boolean }) {
  return <svg className="landscape-stamp" viewBox="0 0 112 76" aria-hidden="true" data-kind={kind} data-found={found}>
    <path className="stamp-sky" d="M4 8q24-7 49 0 27-8 55 2v62H4Z" />
    {(kind === "mountain" || kind === "hill") && <path className={kind === "mountain" ? "stamp-mountain" : "stamp-hills"} d={kind === "mountain" ? "M0 61 28 25l16 20 20-33 39 49Z" : "M0 57q28-31 57 0 27-26 59 1v18H0Z"} />}
    {kind === "water" && <><path className="stamp-hills" d="M0 49q28-23 58 0 26-20 58 1v26H0Z" /><path className="stamp-water" d="M0 54q35-8 65 1 28 8 51-1v22H0Z" /></>}
    {kind === "city" && <g className="stamp-city"><path d="M10 31h25v34H10zm32 12h21v22H42zm30-19h29v41H72z" /><path d="m8 31 14-11 15 11m33-7 16-13 17 13" /></g>}
    {(kind === "forest" || kind === "open") && <path className="stamp-hills" d="M0 53q34-25 67 2 24-19 49-7v28H0Z" />}
    {kind === "forest" && <g className="stamp-trees"><path d="M22 24 8 58h28Zm30-12L34 60h38Zm38 17L78 61h25Z" /></g>}
    {kind === "open" && <g className="stamp-sun"><circle cx="84" cy="23" r="9" /><path d="M84 8V2m0 42v-6m15-15h7M63 23h7m24-11 5-5M69 38l5-5" /></g>}
    <g className="stamp-bench"><path d="M42 50h38v7H42Zm-4 10h46v7H38Z" /><path d="M44 57v15m34-15v15" /></g>
  </svg>;
}

function SeasonStamp({ season, name, found }: { season: SeasonKey; name: string; found: boolean }) {
  return <div className={`season-token ${found ? "is-found" : "is-locked"}`}><svg viewBox="0 0 64 58" aria-hidden="true" data-season={season}><path className="season-ground" d="M2 49q30-13 60 0v8H2Z" /><path className="season-trunk" d="M29 20h6v32h-6Z" /><path className="season-crown" d="M32 4q14 0 16 14 10 6 4 16-8 10-20 2-13 8-21-2-5-10 5-16Q18 4 32 4Z" />{season === "winter" && <path className="season-snow" d="M12 21q8-8 17-3 10-7 22 3-10-17-19-17-10 0-20 17Z" />}{season === "spring" && <g className="season-blossom"><circle cx="21" cy="17" r="2" /><circle cx="39" cy="12" r="2" /><circle cx="44" cy="27" r="2" /></g>}</svg><small>{name}</small></div>;
}

function ProfileNumber({ value, label, icon }: { value: number; label: string; icon: React.ReactNode }) {
  return <span>{icon}<strong>{value}</strong><small>{label}</small></span>;
}

function MomentIcon({ kind }: { kind: ProfileMoment["kind"] }) {
  const Icon = kind === "added" ? MapPinPlus : kind === "rated" ? Star : kind === "confirmed" ? Check : kind === "missing" ? Search : Pencil;
  return <span><Icon size={15} /></span>;
}

function momentSentence(moment: ProfileMoment) {
  if (moment.kind === "added") return <><strong>{moment.benchName}</strong> auf die Karte gesetzt.</>;
  if (moment.kind === "rated") return <><strong>{moment.benchName}</strong> eine Stimme dagelassen.</>;
  if (moment.kind === "confirmed") return <><strong>{moment.benchName}</strong> vor Ort bestätigt.</>;
  if (moment.kind === "missing") return <><strong>{moment.benchName}</strong> vermisst.</>;
  return <><strong>{moment.benchName}</strong> ein Detail geschenkt.</>;
}

function relativeTime(value: string) {
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000));
  if (days === 0) return "heute";
  if (days === 1) return "gestern";
  if (days < 14) return `vor ${days} Tagen`;
  return new Intl.DateTimeFormat("de-CH", { day: "numeric", month: "short" }).format(new Date(value));
}
