"use client";
import { useTranslations } from "next-intl";

/* eslint-disable @next/next/no-img-element -- licensed remote images and local photo responses */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { loadBenchPhoto } from "@/app/actions/bench-photos";

export type GalleryPhoto = { id: string; src: string | null; caption: string; credit: string; sourceUrl?: string; momentId?: number };

function PhotoThumbnail({ photo, src, remember }: { photo: GalleryPhoto; src: string | null; remember: (id: string, src: string) => void }) {
  const t = useTranslations();
  const container = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (src || !photo.momentId || !container.current) return;
    let cancelled = false;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      loadBenchPhoto(photo.momentId!).then((result) => {
        if (!cancelled && result.ok) remember(photo.id, result.dataUrl);
      }).catch(() => { /* Opening the viewer provides an explicit retry. */ });
    }, { rootMargin: "120px" });
    observer.observe(container.current);
    return () => { cancelled = true; observer.disconnect(); };
  }, [photo.id, photo.momentId, src, remember]);
  return <span ref={container} className="photo-thumbnail-image">{src ? <img src={src} alt={photo.caption} loading="lazy" decoding="async" /> : <span className="photo-placeholder">{t("photos.gallery.view")}</span>}</span>;
}

export function PhotoGallery({ photos, thumbnailIndex }: { photos: GalleryPhoto[]; thumbnailIndex?: number }) {
  const t = useTranslations();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [loaded, setLoaded] = useState<Record<string, string>>({});
  const remember = useCallback((id: string, value: string) => setLoaded((current) => ({ ...current, [id]: value })), []);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const label = useId();
  const photo = selected === null ? null : photos[selected];
  const src = photo ? loaded[photo.id] ?? photo.src : null;

  useEffect(() => {
    if (selected === null) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.showModal();
    return () => { document.body.style.overflow = previous; };
  }, [selected]);

  useEffect(() => {
    if (!photo?.momentId || src) return;
    let cancelled = false;
    loadBenchPhoto(photo.momentId).then((result) => {
      if (cancelled) return;
      if (result.ok) setLoaded((current) => ({ ...current, [photo.id]: result.dataUrl }));
      else setError(true);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [photo?.id, photo?.momentId, src, retry]);

  const show = (index: number) => { setError(false); setSelected(index); };
  const close = () => { dialog.current?.close(); setSelected(null); };
  const move = (step: number) => { if (selected !== null) show((selected + step + photos.length) % photos.length); };
  const thumbnails = thumbnailIndex === undefined ? photos.map((item, index) => ({ item, index })) : [{ item: photos[thumbnailIndex], index: thumbnailIndex }];
  return <>
    <div className="photo-ribbon">{thumbnails.map(({ item, index }) => <button type="button" key={item.id} className="photo-thumbnail" onClick={(event) => { opener.current = event.currentTarget; show(index); }} aria-label={t("photos.gallery.enlarge", { caption: item.caption })}>
      <PhotoThumbnail photo={item} src={loaded[item.id] ?? item.src} remember={remember} />
      <span>{item.caption}</span><small>{item.credit}</small>
    </button>)}</div>
    <dialog ref={dialog} className="photo-viewer" aria-labelledby={label} onClose={() => { setSelected(null); opener.current?.focus(); }} onCancel={close} onKeyDown={(event) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); move(event.key === "ArrowLeft" ? -1 : 1); }
    }}>
      {photo && <div className="photo-viewer-content">
        <header><span aria-live="polite">{selected! + 1} / {photos.length}</span><button className="photo-control" type="button" aria-label={t("photos.gallery.close")} onClick={close} autoFocus><X size={24} /></button></header>
        <div className="photo-stage" onTouchStart={(event) => { start.current = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null; }} onTouchEnd={(event) => {
          if (!start.current) return;
          const dx = event.changedTouches[0].clientX - start.current.x, dy = event.changedTouches[0].clientY - start.current.y;
          if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && photos.length > 1) move(dx > 0 ? -1 : 1);
          start.current = null;
        }} onTouchCancel={() => { start.current = null; }}>
          {error ? <div role="status"><p>{t("photos.gallery.unavailable")}</p><button className="photo-control" onClick={() => { setError(false); setRetry((value) => value + 1); }}>{t("photos.gallery.retry")}</button></div>
            : src ? <img key={`${photo.id}-${retry}`} src={src} alt={photo.caption} onError={() => setError(true)} /> : <p role="status">{t("photos.gallery.loading")}</p>}
        </div>
        <footer><div><p id={label}>{photo.caption}</p><small>{photo.credit}</small>{photo.sourceUrl && <a href={photo.sourceUrl} target="_blank" rel="noreferrer">{t("photos.gallery.source")}</a>}</div>
          {photos.length > 1 && <nav aria-label={t("photos.gallery.label")}><button className="photo-control" aria-label={t("photos.gallery.previous")} onClick={() => move(-1)}><ChevronLeft size={24} /></button><button className="photo-control" aria-label={t("photos.gallery.next")} onClick={() => move(1)}><ChevronRight size={24} /></button></nav>}
        </footer>
      </div>}
    </dialog>
  </>;
}
