"use client";

import { formatDate } from "@/i18n/date";
import { useTranslations } from "next-intl";

import { Building2, HeartHandshake, MapPin, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { deleteOwnBenchMoment, toggleBenchFollow } from "@/app/actions/bench-community";
import Link from "next/link";
import type { BenchCareKind, BenchDetail } from "@/lib/types";
import { TrailAvatar } from "./trail-avatar";

export function BenchPlaceCommunity({ bench, signedIn, onChanged }: { bench: BenchDetail; signedIn: boolean; onChanged?: () => void | Promise<void> }) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [followingPlace, setFollowingPlace] = useState(bench.followingPlace);
  const follow = () => startTransition(async () => {
    const result = await toggleBenchFollow(bench.id, "place");
    setMessage(result.message);
    if (!result.ok) return;
    setFollowingPlace(Boolean(result.following));
    if (onChanged) await onChanged();
  });
  const remove = (id: number) => startTransition(async () => {
    const result = await deleteOwnBenchMoment(bench.id, id);
    setMessage(result.message);
    if (result.ok && onChanged) await onChanged();
  });
  const careEntries = Object.entries(bench.care.counts).filter((entry): entry is [BenchCareKind, number] => Number(entry[1]) > 0);
  return <section className="bench-place-community" aria-labelledby="bench-moments-heading">
    <header><div><small>{t("community.place.eyebrow")}</small><h3 id="bench-moments-heading">{t("community.place.title")}</h3></div></header>
    {bench.operatorName && <p className="bench-caretaker"><Building2 size={17} /><span><small>{t("community.place.operator")}</small><strong>{bench.operatorName}</strong></span></p>}
    {signedIn && <div className="follow-place-actions">
      {bench.locationName && <button type="button" disabled={pending} aria-pressed={followingPlace} onClick={follow}><MapPin size={17} /><span><strong>{followingPlace ? t("community.place.followingPlace") : t("community.place.followPlace")}</strong><small>{bench.locationName}</small></span></button>}
      {bench.followingBench && <Link className="ui-button" href="/lieblingsplaetze">{t("community.place.favourites")}</Link>}
    </div>}
    {careEntries.length > 0 && <div className="care-summary"><HeartHandshake size={17} /><p>{careEntries.map(([kind, count]) => `${count}× ${t(`community.care.events.${kind}`)}`).join(" · ")} <small>{t("community.place.recent")}</small></p></div>}
    {bench.moments.length ? <div className="bench-moment-list">{bench.moments.map((moment) => {
      const generatedCaption = moment.kind === "photo" && (!moment.body || moment.body === "Ein Blick von diesem Bänkli.");
      return <article key={moment.id}>
      <TrailAvatar seed={moment.avatarSeed} username={moment.username} compact />
      <div><header><strong>{moment.username}</strong><span>{t(`community.moments.kinds.${moment.kind}`)}</span></header><p lang={generatedCaption ? undefined : bench.dialectPresentation?.appLanguageTag}>{generatedCaption ? t("photos.story.defaultCaption") : moment.body}</p>
        <time dateTime={moment.createdAt}>{formatDate(moment.createdAt, t)}</time>
      </div>
      {moment.mine && <button type="button" disabled={pending} aria-label={t("community.place.deleteOwn")} onClick={() => remove(moment.id)}><Trash2 size={14} /></button>}
    </article>})}</div> : <p className="bench-moments-empty">{t("community.place.empty")}</p>}
    {message && <p className="place-community-status" role="status">{message}</p>}
  </section>;
}
