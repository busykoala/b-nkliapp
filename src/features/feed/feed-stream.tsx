"use client";

import { formatDate } from "@/i18n/date";
import { useTranslations } from "next-intl";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ChevronDown, Rss } from "lucide-react";
import { getFeedPage } from "@/app/actions/feed";
import { groupBenchActivity, type FeedEntry, type FeedPage, type FeedScope } from "./model";

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
  const groups = groupBenchActivity(entries);
  return <div aria-busy={pending}>
    {groups.map((group) => {
      const counts = new Map<FeedEntry["kind"], number>();
      group.entries.forEach((entry) => counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1));
      const people = [...new Set(group.entries.map((entry) => entry.username))];
      return <article className="feed-bench-group" key={group.key}>
        <header><Rss size={18} /><div><h2><Link href={`/bank/${group.benchId}?from=feed`}>{group.benchName ?? t("common.values.bench")}</Link></h2><time dateTime={group.date}>{formatDate(group.entries[0].createdAt, t, "long")}</time></div><Link className="feed-arrow" href={`/bank/${group.benchId}?from=feed`} aria-label={t("feed.stream.openBench", { name: group.benchName ?? t("common.values.bench") })}>→</Link></header>
        <p>{[...counts].map(([kind, count]) => `${count}× ${t(`feed.events.${kind}`)}`).join(" · ")}</p>
        <p className="feed-participants">{people.slice(0, 3).map((name, index) => <span key={name}>{index > 0 && ", "}<Link href={`/profil/${encodeURIComponent(name)}`}>{name}</Link></span>)}{people.length > 3 && t("feed.stream.morePeople", {count: people.length - 3})}</p>
        <details><summary>{t("feed.stream.posts", {count: group.entries.length})} <ChevronDown size={16} /></summary><ul>{group.entries.map((entry) => <li key={entry.id}><Link href={`/profil/${encodeURIComponent(entry.username)}`}>{entry.username}</Link><span>{t(`feed.events.${entry.kind}`)}</span>{entry.detail && ["moment", "rated"].includes(entry.kind) && <q>{entry.detail}</q>}</li>)}</ul></details>
      </article>;
    })}
    {!groups.length && <div className="feed-empty"><p>{scope === "following" ? t("feed.stream.emptyFollowing") : t("feed.stream.empty")}</p>{scope === "following" && <Link className="ui-button" href="/feed">{t("feed.stream.allPosts")}</Link>}</div>}
    {error && <p role="alert">{error}</p>}
    <p className="sr-only" role="status">{announcement}</p>
    {cursor ? <button className="ui-button feed-load-more" disabled={pending} onClick={more}>{pending ? t("feed.stream.loading") : t("feed.stream.more")}</button> : groups.length > 0 && <p className="feed-end">{t("feed.stream.end")}</p>}
  </div>;
}
