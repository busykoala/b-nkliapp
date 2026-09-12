"use client";

import { formatDate } from "@/i18n/date";
import { useTranslations } from "next-intl";

import Link from "next/link";
import { useState, useTransition } from "react";
import { CheckCircle2, ChevronDown, HeartHandshake, MessageCircleHeart, Pencil, Plus, Star, XCircle } from "lucide-react";
import { getFeedPage } from "@/app/actions/feed";
import { groupBenchActivity, groupFeed, type FeedEntry, type FeedPage, type FeedScope } from "./model";
import { TrailAvatar } from "@/components/trail-avatar";

const eventIcons = {
  added: Plus,
  rated: Star,
  confirmed: CheckCircle2,
  missing: XCircle,
  edited: Pencil,
  moment: MessageCircleHeart,
  care: HeartHandshake,
};

const eventPriority: FeedEntry["kind"][] = ["moment", "added", "rated", "care", "confirmed", "edited", "missing"];

export function FeedStream({ initial, scope }: { initial: FeedPage; scope: FeedScope }) {
  const t = useTranslations();
  const [entries, setEntries] = useState(initial.entries);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const more = () => startTransition(async () => {
    setError(null);
    try {
      const page = await getFeedPage(cursor, 48, scope);
      setEntries((current) => [...current, ...page.entries]);
      setCursor(page.nextCursor);
      setAnnouncement(t("feed.stream.loaded", {count: page.entries.length}));
    } catch { setError(t("feed.stream.failed")); }
  });
  const periods = groupFeed(entries);
  return <div aria-busy={pending}>
    {periods.map((period) => <section className="feed-period" key={period.key} aria-labelledby={`feed-period-${period.key}`}>
      <header className="feed-period-heading"><h2 id={`feed-period-${period.key}`}>{t(`feed.stream.period.${period.key}`)}</h2><span>{t("feed.stream.activityCount", {count: period.entries.length})}</span></header>
      {groupBenchActivity(period.entries).map((group) => {
      const counts = new Map<FeedEntry["kind"], number>();
      group.entries.forEach((entry) => counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1));
      const people = [...new Set(group.entries.map((entry) => entry.username))];
      const dominant = eventPriority.find((kind) => counts.has(kind)) ?? group.entries[0].kind;
      const Icon = eventIcons[dominant];
      const featured = group.entries.find((entry) => entry.detail && ["moment", "rated"].includes(entry.kind));
      return <article className={`feed-bench-group feed-kind-${dominant}`} key={group.key}>
        <header><span className="feed-event-mark"><Icon size={18} /></span><div><h3><Link href={`/bank/${group.benchId}?from=feed`}>{group.benchName ?? t("common.values.bench")}</Link></h3><time dateTime={group.date}>{formatDate(group.entries[0].createdAt, t, "long")}</time></div><Link className="feed-arrow" href={`/bank/${group.benchId}?from=feed`} aria-label={t("feed.stream.openBench", { name: group.benchName ?? t("common.values.bench") })}>→</Link></header>
        <div className="feed-event-chips">{[...counts].map(([kind, count]) => { const EventIcon = eventIcons[kind]; return <span key={kind}><EventIcon size={14} />{count > 1 && <b>{count}×</b>}{t(`feed.events.${kind}`)}</span>; })}</div>
        {featured && <blockquote>{featured.detail}</blockquote>}
        <div className="feed-participants"><span className="feed-avatar-stack" aria-hidden="true">{people.slice(0, 3).map((name) => { const entry = group.entries.find((item) => item.username === name)!; return <TrailAvatar key={name} seed={entry.avatarSeed} username={name} compact />; })}</span><p>{people.slice(0, 3).map((name, index) => <span key={name}>{index > 0 && ", "}<Link href={`/profil/${encodeURIComponent(name)}`}>{name}</Link></span>)}{people.length > 3 && t("feed.stream.morePeople", {count: people.length - 3})}</p></div>
        <details><summary>{t("feed.stream.posts", {count: group.entries.length})} <ChevronDown size={16} /></summary><ul>{group.entries.map((entry) => <li key={entry.id}><Link href={`/profil/${encodeURIComponent(entry.username)}`}>{entry.username}</Link><span>{t(`feed.events.${entry.kind}`)}</span>{entry.detail && ["moment", "rated"].includes(entry.kind) && <q>{entry.detail}</q>}</li>)}</ul></details>
      </article>;
      })}
    </section>)}
    {!periods.length && <div className="feed-empty"><p>{scope === "following" ? t("feed.stream.emptyFollowing") : t("feed.stream.empty")}</p>{scope === "following" && <Link className="ui-button" href="/feed">{t("feed.stream.allPosts")}</Link>}</div>}
    {error && <p role="alert">{error}</p>}
    <p className="sr-only" role="status">{announcement}</p>
    {cursor ? <button className="ui-button feed-load-more" disabled={pending} onClick={more}>{pending ? t("feed.stream.loading") : t("feed.stream.more")}</button> : periods.length > 0 && <p className="feed-end">{t("feed.stream.end")}</p>}
  </div>;
}
