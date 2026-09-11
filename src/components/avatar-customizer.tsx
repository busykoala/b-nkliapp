"use client";

import { useTranslations } from "next-intl";
import { avatarOptionLabel } from "@/i18n/avatar-labels";
import { useActionState, useState } from "react";
import { Check, Palette, Shuffle } from "lucide-react";
import { saveAvatarAppearance, type AvatarActionState } from "@/app/actions/profile";
import { appearanceFromSeed, avatarOptionValues, randomAppearance, type AvatarAppearance } from "@/lib/avatar";
import { TrailAvatar } from "@/components/trail-avatar";

const initialActionState: AvatarActionState = { ok: false, message: "" };
const groups = Object.keys(avatarOptionValues) as Array<keyof AvatarAppearance>;

export function AvatarCustomizer({ seed, username, progress }: { seed: string; username: string; progress: number }) {
  const t = useTranslations();
  const [appearance, setAppearance] = useState(() => appearanceFromSeed(seed));
  const [state, formAction, pending] = useActionState(saveAvatarAppearance, initialActionState);

  function select<Key extends keyof AvatarAppearance>(key: Key, value: AvatarAppearance[Key]) {
    setAppearance((current) => ({ ...current, [key]: value }));
  }

  return <details className="avatar-customizer">
    <summary><Palette size={16} /> {t("avatar.editor.title")} <span aria-hidden>＋</span></summary>
    <form action={formAction}>
      <div className="avatar-customizer-actions">
        <button className="avatar-save" type="submit" disabled={pending}>{pending ? <span className="loading loading-spinner loading-xs" /> : <Check size={16} />}{pending ? t("avatar.editor.pending") : t("avatar.editor.save")}</button>
        <p className={state.ok ? "is-success" : undefined} aria-live="polite">{state.message}</p>
      </div>
      <div className="avatar-customizer-preview">
        <TrailAvatar seed={seed} username={username} progress={progress} appearance={appearance} />
        <div><small>{t("avatar.editor.mixture")}</small><strong>{avatarOptionLabel("background", appearance.background, t)} · {avatarOptionLabel("hairStyle", appearance.hairStyle, t)}</strong><p>{t("avatar.editor.description")}</p></div>
      </div>
      <button className="avatar-surprise" type="button" onClick={() => setAppearance(randomAppearance(`${Date.now()}:${Math.random()}`))}><Shuffle size={15} /> {t("avatar.editor.random")}</button>
      <div className="avatar-option-groups">
        {groups.map((group) => <fieldset key={group}>
          <legend>{t(`avatar.groups.${group}`)}</legend>
          <div>{avatarOptionValues[group].map((value) => {
            const checked = appearance[group] === value;
            return <label key={value} className={checked ? "is-selected" : undefined} data-avatar-key={group} data-avatar-value={value}>
              <input type="radio" name={group} value={value} checked={checked} onChange={() => select(group, value)} />
              <i aria-hidden />
              <span>{avatarOptionLabel(group, value, t)}</span>
            </label>;
          })}</div>
        </fieldset>)}
      </div>
    </form>
  </details>;
}
