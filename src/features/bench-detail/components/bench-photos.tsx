"use client";

import { Camera } from "lucide-react";
import { useTranslations } from "next-intl";
import type { BenchDetail } from "@/lib/types";
import { PhotoGallery } from "@/features/bench-photos/components/photo-gallery";
import { galleryImageUrl } from "@/features/bench-photos/media-source";

export function BenchPhotos({ bench, onAdd }: { bench: BenchDetail; onAdd: () => void }) {
  const t = useTranslations();
  const media = [...bench.media.filter((item) => item.relation === "exact"), ...bench.media.filter((item) => item.relation === "nearby")];
  const userPhotos = bench.moments.filter((item) => item.hasPhoto).map((item) => ({ id: `moment-${item.id}`, src: item.photoUrl, momentId: item.id, caption: t("photos.gallery.by", { username: item.username }), credit: item.username }));
  const photos = [...userPhotos, ...media.flatMap((item) => {
    const src = galleryImageUrl(item.thumbnailUrl);
    return src ? [{ id: String(item.id), src, caption: item.relation === "nearby" ? t("photos.story.nearby") : item.title ?? t("photos.story.place"), credit: `${item.author ?? item.provider} · ${item.license ?? t("photos.story.license")}`, sourceUrl: item.sourceUrl }] : [];
  })];
  const links = media.filter((item) => !galleryImageUrl(item.thumbnailUrl) && /^https?:\/\//.test(item.sourceUrl));
  if (!photos.length && !links.length) return null;
  return <section className="photo-story">
    <header><h3>{photos.length || links.length ? t("photos.story.title") : t("photos.capture.title")}</h3><button type="button" onClick={onAdd}><Camera size={17} />{t("photos.capture.choose")}</button></header>
    {photos.length > 0 && <PhotoGallery photos={photos} />}
    {links.map((item) => <p key={item.id}><a href={item.sourceUrl} target="_blank" rel="noreferrer">{t("photos.story.external")}</a></p>)}
  </section>;
}
