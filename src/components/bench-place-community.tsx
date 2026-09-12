"use client";

import { formatDate } from "@/i18n/date";
import { useTranslations } from "next-intl";

import { Bookmark, Building2, HeartHandshake, MapPin, Share2, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { deleteOwnBenchMoment, toggleBenchFollow } from "@/app/actions/bench-community";
import Link from "next/link";
import { PhotoGallery } from "./photo-gallery";
import type { BenchCareKind, BenchDetail } from "@/lib/types";
import { TrailAvatar } from "./trail-avatar";
import { canonicalBenchShareUrl } from "@/lib/bench-share";

export function BenchPlaceCommunity({ bench, signedIn, onChanged }: { bench: BenchDetail; signedIn: boolean; onChanged?: () => void | Promise<void> }) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [followingBench, setFollowingBench] = useState(bench.followingBench);
  const [followingPlace, setFollowingPlace] = useState(bench.followingPlace);
  const follow = (scope: "bench" | "place") => startTransition(async () => {
    const result = await toggleBenchFollow(bench.id, scope);
    setMessage(result.message);
    if (!result.ok) return;
    if (scope === "bench") setFollowingBench(Boolean(result.following));
    else setFollowingPlace(Boolean(result.following));
    if (onChanged) await onChanged();
  });
  const remove = (id: number) => startTransition(async () => {
    const result = await deleteOwnBenchMoment(bench.id, id);
    setMessage(result.message);
    if (result.ok && onChanged) await onChanged();
  });
  const share = async () => {
    const title = bench.title || t("common.values.bench");
    const data = {
      title,
      text: t("community.place.shareText", { bench: title }),
      url: canonicalBenchShareUrl(window.location.href, bench.id),
    };
    try {
      if (navigator.share) await navigator.share(data);
      else {
        await navigator.clipboard.writeText(`${data.text} ${data.url}`);
        setMessage(t("community.place.copied"));
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage(t("community.place.shareUnavailable"));
    }
  };
  const careEntries = Object.entries(bench.care.counts).filter((entry): entry is [BenchCareKind, number] => Number(entry[1]) > 0);
  return <section className="bench-place-community" aria-labelledby="bench-moments-heading">
    <header><div><small>{t("community.place.eyebrow")}</small><h3 id="bench-moments-heading">{t("community.place.title")}</h3></div><button type="button" aria-label={t("community.place.share")} onClick={share}><Share2 size={17} /><span>{t("community.place.shareShort")}</span></button></header>
    {bench.operatorName && <p className="bench-caretaker"><Building2 size={17} /><span><small>{t("community.place.operator")}</small><strong>{bench.operatorName}</strong></span></p>}
    {signedIn && <div className="follow-place-actions">
      <button type="button" disabled={pending} aria-pressed={followingBench} onClick={() => follow("bench")}><Bookmark size={17} /><span><strong>{followingBench ? t("community.place.favourite") : t("community.place.save")}</strong><small>{t("community.place.saveHint")}</small></span></button>
      {bench.locationName && <button type="button" disabled={pending} aria-pressed={followingPlace} onClick={() => follow("place")}><MapPin size={17} /><span><strong>{followingPlace ? t("community.place.followingPlace") : t("community.place.followPlace")}</strong><small>{bench.locationName}</small></span></button>}
      {followingBench && <Link className="ui-button" href="/lieblingsplaetze">{t("community.place.favourites")}</Link>}
    </div>}
    {careEntries.length > 0 && <div className="care-summary"><HeartHandshake size={17} /><p>{careEntries.map(([kind, count]) => `${count}× ${t(`community.care.events.${kind}`)}`).join(" · ")} <small>{t("community.place.recent")}</small></p></div>}
    {bench.moments.length ? <div className="bench-moment-list">{bench.moments.map((moment) => <article key={moment.id}>
      <TrailAvatar seed={moment.avatarSeed} username={moment.username} compact />
      <div><header><strong>{moment.username}</strong><span>{t(`community.moments.kinds.${moment.kind}`)}</span></header><p>{moment.kind === "photo" && (!moment.body || moment.body === "Ein Blick von diesem Bänkli.") ? t("photos.story.defaultCaption") : moment.body}</p>
        {moment.hasPhoto && <PhotoGallery photos={bench.moments.filter((item) => item.hasPhoto).map((item) => ({ id: String(item.id), src: item.photoUrl, momentId: item.id, caption: t("photos.gallery.by", { username: item.username }), credit: item.username }))} thumbnailIndex={bench.moments.filter((item) => item.hasPhoto).findIndex((item) => item.id === moment.id)} />}
        <time dateTime={moment.createdAt}>{formatDate(moment.createdAt, t)}</time>
      </div>
      {moment.mine && <button type="button" disabled={pending} aria-label={t("community.place.deleteOwn")} onClick={() => remove(moment.id)}><Trash2 size={14} /></button>}
    </article>)}</div> : <p className="bench-moments-empty">{t("community.place.empty")}</p>}
    {message && <p className="place-community-status" role="status">{message}</p>}
  </section>;
}
