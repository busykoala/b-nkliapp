"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Send } from "lucide-react";
import { editBenchMetadata } from "@/app/actions/benches";
import { submitBenchMoment } from "@/app/actions/bench-community";
import type { BenchDetail } from "@/lib/types";
import { ContributionFeedback, useContributionSave, useContributionWork } from "./contribution-session";

type Props = { bench: BenchDetail; onChanged?: () => void | Promise<void> };

export function MetadataEditor({ bench, onChanged }: Props) {
  const t = useTranslations();
  const [draft, setDraft] = useState({ name: bench.name ?? "", dedication: bench.dedication ?? "" });
  const [saved, setSaved] = useState(draft);
  const { state, pending, save } = useContributionSave(onChanged);
  const dirty = draft.name !== saved.name || draft.dedication !== saved.dedication;
  useContributionWork(dirty, pending);
  return <form className="contribution-metadata-form" aria-busy={pending} onSubmit={(event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    save(() => editBenchMetadata(bench.id, null, data), () => setSaved(draft));
  }}>
    <fieldset disabled={pending}>
      <legend>{t("community.workspace.nameAndDedication")}</legend>
      <label><span>{t("common.fields.name")} <small>{t("common.fields.optional")}</small></span><input name="name" maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder={t("community.metadata.placeholder")} /></label>
      <label><span>{t("submission.fields.dedication")} <small>{t("community.metadata.dedicationHint")}</small></span><textarea name="dedication" maxLength={180} value={draft.dedication} onChange={(event) => setDraft({ ...draft, dedication: event.target.value })} /></label>
    </fieldset>
    <button type="submit" disabled={pending || !dirty}><Check size={16} aria-hidden="true" />{t(pending ? "common.actions.saving" : "community.metadata.save")}</button>
    <ContributionFeedback state={state} />
  </form>;
}

const momentKinds = ["memory", "recommendation", "poem", "local_fact"] as const;
export function MomentForm({ bench, onChanged }: Props) {
  const t = useTranslations();
  const [kind, setKind] = useState<(typeof momentKinds)[number]>("memory");
  const [body, setBody] = useState("");
  const { state, pending, save } = useContributionSave(onChanged);
  useContributionWork(Boolean(body), pending);
  return <form className="moment-form" aria-busy={pending} onSubmit={(event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    save(() => submitBenchMoment(bench.id, null, data), () => setBody(""));
  }}>
    <fieldset disabled={pending}><legend>{t("community.moments.choose")}</legend><div>{momentKinds.map((value) => <button type="button" key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{t(`community.moments.kinds.${value}`)}</button>)}</div></fieldset>
    <input type="hidden" name="kind" value={kind} />
    <label><span>{t("community.moments.label")}</span><textarea disabled={pending} required name="body" minLength={2} maxLength={500} value={body} onChange={(event) => setBody(event.target.value)} placeholder={t(kind === "poem" ? "community.moments.poemPlaceholder" : "community.moments.placeholder")} /></label>
    <small className="contribution-character-count">{body.length} / 500</small>
    <input name="website" className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" />
    <button type="submit" disabled={pending || body.trim().length < 2}><Send size={16} aria-hidden="true" />{t(pending ? "common.actions.saving" : "community.moments.publish")}</button>
    <ContributionFeedback state={state} />
  </form>;
}
