"use client";
import type { Translator } from "@/i18n/types";
import { useTranslations } from "next-intl";

/* eslint-disable @next/next/no-img-element -- local blob previews do not belong in Next Image */

import { Camera, Check, ImagePlus, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { uploadBenchPhoto } from "@/app/actions/bench-photos";
import type { ActionResult } from "@/lib/types";

const preparedPhotoLimit = 1_600_000;

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

async function encodePhoto(canvas: HTMLCanvasElement, quality: number, t: Translator) {
  const webp = await canvasBlob(canvas, "image/webp", quality);
  if (webp?.type === "image/webp") return webp;
  const jpeg = await canvasBlob(canvas, "image/jpeg", quality);
  if (!jpeg) throw new Error(t("photos.errors.prepare"));
  return jpeg;
}

async function preparePhoto(file: File, t: Translator) {
  if (file.size > 24_000_000) throw new Error(t("photos.errors.originalTooLarge"));
  let source: CanvasImageSource;
  let width: number;
  let height: number;
  let close: (() => void) | undefined;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    source = bitmap; width = bitmap.width; height = bitmap.height; close = () => bitmap.close();
  } catch {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.src = objectUrl;
    try { await image.decode(); } finally { URL.revokeObjectURL(objectUrl); }
    source = image; width = image.naturalWidth; height = image.naturalHeight;
  }
  if (!width || !height) throw new Error(t("photos.errors.decode"));
  const scale = Math.min(1, 1600 / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error(t("photos.errors.prepare"));
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  close?.();
  let output = canvas;
  let blob = await encodePhoto(output, .82, t);
  for (const quality of [.7, .58, .46]) {
    if (blob.size <= preparedPhotoLimit) break;
    blob = await encodePhoto(output, quality, t);
  }
  if (blob.size > preparedPhotoLimit) {
    const reduced = document.createElement("canvas");
    const reducedScale = Math.min(1, 1280 / Math.max(output.width, output.height));
    reduced.width = Math.round(output.width * reducedScale); reduced.height = Math.round(output.height * reducedScale);
    const reducedContext = reduced.getContext("2d", { alpha: false });
    if (!reducedContext) throw new Error(t("photos.errors.prepare"));
    reducedContext.drawImage(output, 0, 0, reduced.width, reduced.height); output = reduced;
    for (const quality of [.7, .58, .46]) {
      blob = await encodePhoto(output, quality, t);
      if (blob.size <= preparedPhotoLimit) break;
    }
  }
  if (blob.size > preparedPhotoLimit) throw new Error(t("photos.errors.tooDetailed"));
  const type = blob.type === "image/webp" ? "image/webp" : "image/jpeg";
  return new File([blob], type === "image/webp" ? "baenkli.webp" : "baenkli.jpg", { type });
}

export function BenchPhotoCapture({ benchId, onChanged }: { benchId: string; onChanged?: () => void | Promise<void> }) {
  const t = useTranslations();
  const input = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [state, setState] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const choose = async (file?: File) => {
    if (!file) return;
    setState(null);
    try {
      const prepared = await preparePhoto(file, t);
      if (preview) URL.revokeObjectURL(preview);
      setPhoto(prepared); setPreview(URL.createObjectURL(prepared));
    } catch (error) { setState({ ok: false, message: error instanceof Error ? error.message : t("photos.errors.read") }); }
  };
  const submit = (form: HTMLFormElement) => startTransition(async () => {
    if (!photo) return;
    try {
      const data = new FormData(form); data.set("photo", photo);
      const result = await uploadBenchPhoto(benchId, data); setState(result);
      if (result.ok) { setPhoto(null); setPreview(null); form.reset(); if (onChanged) await onChanged(); }
    } catch {
      setState({ ok: false, message: t("photos.errors.upload") });
    }
  });
  return <form className="bench-photo-capture" onSubmit={(event) => { event.preventDefault(); submit(event.currentTarget); }}>
    <div className="bench-photo-intro"><Camera aria-hidden="true" /><div><strong>{t("photos.capture.title")}</strong><p>{t("photos.capture.intro")}</p></div></div>
    <input ref={input} className="sr-only" type="file" aria-label={t("photos.capture.select")} accept="image/*" onChange={(event) => { void choose(event.target.files?.[0]); event.currentTarget.value = ""; }} />
    {preview ? <div className="bench-photo-preview"><img src={preview} alt={t("photos.capture.preview")} /><button type="button" onClick={() => input.current?.click()}><RotateCcw size={16} /> {t("photos.capture.change")}</button></div>
      : <button className="bench-photo-choose" type="button" onClick={() => input.current?.click()}><ImagePlus size={18} /> {t("photos.capture.choose")}</button>}
    {photo && <><label><span>{t("photos.capture.caption")} <small>{t("common.fields.optional")}</small></span><input name="caption" maxLength={180} placeholder={t("photos.capture.captionPlaceholder")} /></label><button className="bench-photo-submit" disabled={pending}>{pending ? <span className="loading loading-spinner loading-xs" /> : <Check size={16} />}{pending ? t("photos.capture.checking") : t("photos.capture.publish")}</button></>}
    <input name="website" className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" />
    {state && <p className={state.ok ? "is-success" : "is-error"} role="status">{state.message}</p>}
  </form>;
}
