import { formatDate } from "@/i18n/date";
import { useTranslations } from "next-intl";
import type { Translator } from "@/i18n/types";
import type { BadgeKey } from "@/lib/badges";
import Link from "next/link";
import { ArrowLeft, Armchair, Bookmark, Check, Footprints, Map, MapPinPlus, Pencil, Search, Sparkles, Star } from "lucide-react";
import type { CurrentUser } from "@/lib/security";
import type { ProfileMoment, TrailProfile } from "@/lib/profile";
import { AppMenu } from "@/components/app-menu";
import { AvatarCustomizer } from "@/components/avatar-customizer";
import { BadgeIllustration, type BadgeArt } from "@/components/badge-illustration";
import { TrailAvatar } from "@/components/trail-avatar";
import { LandscapeStamp, SeasonStamp } from "@/components/profile-stamps";

type Badge = { key: BadgeKey; art: string; target: number; progress: number; earned: boolean };

export function ProfileJournal({ profile, badges, viewer, own }: { profile: TrailProfile; badges: Badge[]; viewer: CurrentUser | null; own: boolean }) {
  const t = useTranslations();
  const next = profile.nextPrompt;
  const earnedBadges = badges.filter((badge) => badge.earned);
  const lockedBadges = badges.filter((badge) => !badge.earned);
  const shownBadges = own ? [...earnedBadges, ...lockedBadges.slice(0, Math.max(0, 4 - earnedBadges.length))] : earnedBadges;
  const hiddenBadges = own ? lockedBadges.slice(Math.max(0, 4 - earnedBadges.length)) : [];
  return <main className="profile-page min-h-dvh safe-bottom">
    <header className="profile-nav safe-top">
      <Link href={own ? "/" : "/feed"} aria-label={own ? t("feed.page.map") : t("profile.navigation.feed")} className="calm-menu-button"><ArrowLeft size={19} /></Link>
      <div className="profile-nav-actions">
        <AppMenu user={viewer} />
      </div>
    </header>

    <div className="profile-journal">
      <section className="profile-portrait">
        <div className="profile-avatar-wrap">
          <TrailAvatar seed={profile.avatarSeed} username={profile.username} progress={profile.uniquePlaces} />
        </div>
        <div className="profile-intro">
          <span><Sparkles size={13} /> {own ? t("profile.intro.own") : t("profile.intro.public")}</span>
          <h1>{profile.username}</h1>
          <p>{t(`profile.stages.${profile.journey.key}`)}</p>
          <small>{t("profile.intro.since", {date: formatDate(profile.joinedAt, t, "monthYear")})}</small>
        </div>
      </section>
      <nav className="profile-jump-links" aria-label={t("common.navigation.label")}>
        <a href="#profile-activity">{t("profile.activity.eyebrow")}</a>
        <a href="#profile-trail">{t("profile.trail.eyebrow")}</a>
        <a href="#profile-collection">{t("profile.collection.landscapes")}</a>
      </nav>
      {own && <Link href="/lieblingsplaetze" className="ui-button profile-favourites"><Bookmark size={18} /> {t("favourites.title")}</Link>}
      <section id="profile-activity" className="profile-section profile-numbers">
        <header><div><small>{t("profile.activity.eyebrow")}</small><h2>{t("profile.activity.title")}</h2></div></header>
        <div><ProfileNumber value={profile.activity.added} label={t("feed.events.added")} icon={<MapPinPlus />} /><ProfileNumber value={profile.activity.rated} label={t("feed.events.rated")} icon={<Star />} /><ProfileNumber value={profile.activity.confirmed} label={t("feed.events.confirmed")} icon={<Check />} /><ProfileNumber value={profile.activity.edited + profile.activity.corrected} label={t("feed.events.edited")} icon={<Pencil />} /></div>
      </section>

      {profile.recent.length > 0 && <section className="profile-section profile-moments">
        <header><div><small>{t("profile.activity.recent")}</small><h2>{t("profile.activity.contributed")}</h2></div></header>
        <div>{profile.recent.map((moment) => <Link key={moment.id} href={`/bank/${moment.benchId}`}><MomentIcon kind={moment.kind} /><p>{momentSentence(moment, t)}</p><time>{relativeTime(moment.createdAt, t)}</time></Link>)}</div>
      </section>}

      {own && <section className="profile-section profile-pending"><header><div><small>{t("profile.pending.eyebrow")}</small><h2>{t("profile.pending.title")}</h2></div></header>{profile.awaitingConfirmation.length ? <ul>{profile.awaitingConfirmation.map((bench) => <li key={bench.id}><Link href={`/bank/${bench.id}`}><strong>{bench.title ?? t("common.values.bench")}</strong><span>{t("profile.pending.remaining", {count: bench.remaining})}</span></Link></li>)}</ul> : <p>{profile.activity.added ? t("profile.pending.complete") : t("profile.pending.empty")}</p>}</section>}

      {own && <AvatarCustomizer seed={profile.avatarSeed} username={profile.username} progress={profile.uniquePlaces} />}

      <section id="profile-trail" className="profile-section trail-progress-card">
        <header><div><small>{t("profile.trail.eyebrow")}</small><h2>{t("profile.trail.places", {count: profile.uniquePlaces})}</h2></div><Footprints size={22} /></header>
        <TrailPath journey={profile.journey} places={profile.uniquePlaces} />
        <p>{profile.journey.nextTarget === null
          ? t("profile.trail.complete")
          : t("profile.trail.remaining", {count: profile.journey.nextTarget - profile.uniquePlaces})}</p>
      </section>

      {own && <Link href="/" className="next-trail-card">
        <span><Map size={19} /></span><div><small>{t("profile.trail.next")}</small><strong>{next.kind === "landscape" ? t("profile.prompts.landscape", {landscape: t(`profile.landscapes.${next.landscape}.name`)}) : t(`profile.prompts.${next.kind}.title`)}</strong><p>{next.kind === "landscape" ? t(`profile.landscapes.${next.landscape}.hint`) : t(`profile.prompts.${next.kind}.copy`)}</p></div><b aria-hidden>→</b>
      </Link>}

      <section id="profile-collection" className="profile-section collection-section">
        <header><div><small>{t("profile.collection.landscapes")}</small><h2>{t("profile.collection.found")}</h2></div><span>{profile.landscapes.filter((item) => item.found).length}/{profile.landscapes.length}</span></header>
        <div className="landscape-collection">{profile.landscapes.map((item) => {
          const picture = <><LandscapeStamp kind={item.key} found={item.found} /><div><strong>{t(`profile.landscapes.${item.key}.name`)}</strong><small>{item.found ? t(`profile.landscapes.${item.key}.hint`) : t("profile.collection.waiting")}</small></div></>;
          return item.found && item.benchId
            ? <Link key={item.key} href={`/bank/${item.benchId}`} className="landscape-token is-found">{picture}</Link>
            : <div key={item.key} className="landscape-token is-locked">{picture}</div>;
        })}</div>
      </section>

      <section className="profile-section season-section">
        <header><div><small>{t("profile.collection.seasons")}</small><h2>{t("profile.collection.year")}</h2></div></header>
        <div className="season-collection">{profile.seasons.map((season) => <SeasonStamp key={season.key} season={season.key} name={t(`bench.light.seasons.${season.key}`)} found={season.found} />)}</div>
      </section>

      <section className="profile-section badge-book">
        <header><div><small>{t("profile.badges.title")}</small><h2>{earnedBadges.length ? t("profile.badges.collected", {count: earnedBadges.length}) : t("profile.badges.firstPage")}</h2></div><Armchair size={21} /></header>
        {shownBadges.length > 0 ? <BadgeGrid badges={shownBadges} /> : <p className="badge-empty">{t("profile.badges.empty")}</p>}
        {hiddenBadges.length > 0 && <details className="more-badges"><summary>{t("profile.badges.more", {count: hiddenBadges.length})} <span aria-hidden>＋</span></summary><BadgeGrid badges={hiddenBadges} /></details>}
      </section>
    </div>
  </main>;
}

function TrailPath({ journey, places }: { journey: TrailProfile["journey"]; places: number }) {
  const t = useTranslations();
  const milestones = [1, 5, 15, 40, 100];
  const pathProgress = trailPosition(places);
  return <div className="trail-path" role="progressbar" aria-label={t("profile.trail.progress")} aria-valuemin={journey.currentFloor} aria-valuemax={journey.nextTarget ?? 100} aria-valuenow={places}>
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
  const t = useTranslations();
  return <div className="badge-album">{badges.map(badge => {
    const name = t(`profile.badges.catalog.${badge.key}.name`);
    return <article key={badge.key} className={`story-card badge-card ${badge.earned ? "is-earned" : "is-locked"}`}>
      <BadgeIllustration kind={badge.art as BadgeArt} label={name} earned={badge.earned} />
      <div className="badge-copy"><h3>{name}</h3><p>{t(`profile.badges.catalog.${badge.key}.hint`)}</p>
        <div className="badge-progress" aria-label={t("profile.badges.progress", {progress: badge.progress, target: badge.target})}><i style={{width: `${badge.progress / badge.target * 100}%`}} /></div>
        <small>{badge.progress}/{badge.target}</small>
      </div>
    </article>;
  })}</div>;
}

function ProfileNumber({ value, label, icon }: { value: number; label: string; icon: React.ReactNode }) {
  return <span>{icon}<strong>{value}</strong><small>{label}</small></span>;
}

function MomentIcon({ kind }: { kind: ProfileMoment["kind"] }) {
  const Icon = kind === "added" ? MapPinPlus : kind === "rated" ? Star : kind === "confirmed" ? Check : kind === "missing" ? Search : Pencil;
  return <span><Icon size={15} /></span>;
}

function momentSentence(moment: ProfileMoment, t: Translator) {
  const kind = moment.kind === "corrected" ? "edited" : moment.kind;
  return t.rich(`profile.moments.${kind}`, {name: moment.benchName ?? t("common.values.bench"), bench: chunks => <strong>{chunks}</strong>});
}

function relativeTime(value: string, t: Translator) {
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000));
  if (days === 0) return t("profile.time.today");
  if (days === 1) return t("profile.time.yesterday");
  if (days < 14) return t("profile.time.daysAgo", {days});
  return formatDate(value, t, "dayMonth");
}
