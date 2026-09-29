"use client";
import { useTranslations } from "next-intl";

/* eslint-disable @next/next/no-img-element -- local blob previews do not belong in Next Image */

import { Camera, Check, ImagePlus, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { getBenchPhotoSubmission, uploadBenchPhoto } from "@/app/actions/bench-photos";
import type { BenchPhotoSubmissionResult } from "@/app/actions/bench-photos";

import { useContributionWork } from "@/features/bench-community/components/contribution-session";
import { preparePhoto } from "./prepare-photo";

function storedSubmission(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function rememberSubmission(key: string, id: string) {
  try { localStorage.setItem(key, id); } catch { /* Polling continues for the current page. */ }
}

function forgetSubmission(key: string) {
  try { localStorage.removeItem(key); } catch { /* The final state is still visible on this page. */ }
}

type CaptureProps = { benchId: string; onChanged?: () => void | Promise<void> };
export function BenchPhotoCapture(props: CaptureProps) { return <PhotoCaptureForm key={props.benchId} {...props} />; }

function PhotoCaptureForm({ benchId, onChanged }: CaptureProps) {
  const t = useTranslations();
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const preparation = useRef(0);
  const submitting = useRef(false);
  const [preparing, setPreparing] = useState(false);
  const [pollStopped, setPollStopped] = useState(false);
  const [pollAttempt, setPollAttempt] = useState(0);
  const onChangedRef = useRef(onChanged);
  const translationsRef = useRef(t);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [state, setState] = useState<BenchPhotoSubmissionResult | null>(null);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const storageKey = `benchly:photo-submission:${benchId}`;
  const processing = preparing || pending || Boolean(submissionId);
  // Once uploaded, the existing submission ID can resume moderation after closing.
  useContributionWork(Boolean(photo) && !submissionId, preparing || pending);
  useEffect(() => () => { preparation.current++; }, [benchId]);
  useEffect(() => { onChangedRef.current = onChanged; translationsRef.current = t; }, [onChanged, t]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => {
    const saved = storedSubmission(storageKey);
    if (!saved) return;
    const timer = setTimeout(() => {
      setSubmissionId(saved);
      setState({ ok: true, status: "pending", submissionId: saved, message: t("photos.capture.checking") });
    }, 0);
    return () => clearTimeout(timer);
  }, [storageKey, t]);
  useEffect(() => {
    if (!submissionId) return;
    let active = true;
    let failures = 0;
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await getBenchPhotoSubmission(submissionId);
        if (!active) return;
        setState(result);
        failures = 0;
        if (result.ok && result.status === "pending") {
          if (Date.now() - startedAt > 120_000) { setPollStopped(true); return; }
          timer = setTimeout(poll, 2_000);
          return;
        }
        forgetSubmission(storageKey);
        setSubmissionId(null);
        if (result.ok && result.status === "accepted") {
          setPhoto(null);
          setPreview(null);
          form.current?.reset();
          try { await onChangedRef.current?.(); }
          catch { setState((current) => current?.ok && current.submissionId === result.submissionId
            ? { ...current, message: translationsRef.current("photos.errors.refresh") } : current); }
        }
      } catch {
        if (!active) return;
        failures++;
        if (failures >= 3) { setPollStopped(true); return; }
        timer = setTimeout(poll, 2_000 * failures);
      }
    };
    timer = setTimeout(poll, 750);
    return () => { active = false; clearTimeout(timer); };
  }, [storageKey, submissionId, pollAttempt]);
  const choose = async (file?: File) => {
    if (!file || pending || submissionId) return;
    const token = ++preparation.current;
    setState(null); setPreparing(true); setPhoto(null); setPreview(null);
    try {
      const prepared = await preparePhoto(file, t);
      if (token !== preparation.current) return;
      setPhoto(prepared); setPreview(URL.createObjectURL(prepared));
    } catch (error) {
      if (token === preparation.current) setState({ ok: false, status: "rejected", message: error instanceof Error ? error.message : t("photos.errors.read") });
    } finally { if (token === preparation.current) setPreparing(false); }
  };
  const clear = () => {
    preparation.current++;
    setPhoto(null); setPreview(null); setState(null); setPreparing(false);
  };
  const submit = (element: HTMLFormElement) => {
    if (!photo || processing || submitting.current) return;
    submitting.current = true;
    const data = new FormData(element); data.set("photo", photo);
    startTransition(async () => {
      try {
        const result = await uploadBenchPhoto(benchId, data); setState(result);
        if (result.ok && result.status === "pending") {
          setPollStopped(false); setSubmissionId(result.submissionId);
          rememberSubmission(storageKey, result.submissionId);
        }
      } catch { setState({ ok: false, status: "rejected", message: t("photos.errors.upload") }); }
      finally { submitting.current = false; }
    });
  };
  return <form ref={form} className="bench-photo-capture" aria-busy={preparing || pending} onSubmit={(event) => { event.preventDefault(); submit(event.currentTarget); }}>
    <div className="bench-photo-intro"><Camera aria-hidden="true" /><div><strong>{t("photos.capture.title")}</strong><p>{t("photos.capture.intro")}</p></div></div>
    <input ref={input} className="sr-only" type="file" disabled={processing} aria-label={t("photos.capture.select")} accept="image/*" onChange={(event) => { void choose(event.target.files?.[0]); event.currentTarget.value = ""; }} />
    {preview ? <div className="bench-photo-preview"><img src={preview} alt={t("photos.capture.preview")} /><div><button type="button" disabled={processing} onClick={() => input.current?.click()}><RotateCcw size={16} /> {t("photos.capture.change")}</button><button type="button" disabled={processing} onClick={clear}><Trash2 size={16} /> {t("common.actions.remove")}</button></div></div>
      : <button className="bench-photo-choose" type="button" disabled={processing} onClick={() => input.current?.click()}><ImagePlus size={18} /> {t("photos.capture.choose")}</button>}
    {photo && <><label><span>{t("photos.capture.caption")} <small>{t("common.fields.optional")}</small></span><input name="caption" disabled={processing} maxLength={180} placeholder={t("photos.capture.captionPlaceholder")} /></label><button className="bench-photo-submit" disabled={processing}>{processing ? <span className="loading loading-spinner loading-xs" /> : <Check size={16} />}{processing ? t("photos.capture.checking") : t("photos.capture.publish")}</button></>}
    <input name="website" className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" />
    {preparing && <p role="status">{t("photos.capture.preparing")}</p>}
    {pollStopped && submissionId && <div className="bench-photo-retry"><p role="status">{t("photos.errors.status")}</p>
      <button type="button" onClick={() => { setPollStopped(false); setPollAttempt((attempt) => attempt + 1); }}>{t("photos.capture.retry")}</button></div>}
    {state && !pollStopped && <p className={state.ok ? "is-success" : "is-error"} role="status">{state.message}</p>}
  </form>;
}
