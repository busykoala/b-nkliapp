"use client";

import { useActionState, useState } from "react";
import { Check, Palette, Shuffle } from "lucide-react";
import { saveAvatarAppearance, type AvatarActionState } from "@/app/actions/profile";
import { appearanceFromSeed, avatarOptionLabels, avatarOptionValues, randomAppearance, type AvatarAppearance } from "@/lib/avatar";
import { TrailAvatar } from "@/components/trail-avatar";

const initialActionState: AvatarActionState = { ok: false, message: "" };
const groups: Array<{ key: keyof AvatarAppearance; label: string }> = [
  { key: "skin", label: "Hautton" },
  { key: "hairStyle", label: "Frisur" },
  { key: "hair", label: "Haarfarbe" },
  { key: "coat", label: "Jacke" },
  { key: "accent", label: "Schal" },
  { key: "hat", label: "Kopfbedeckung" },
  { key: "background", label: "Lieblingslandschaft" },
  { key: "companion", label: "Begleitung" },
];

export function AvatarCustomizer({ seed, username, progress }: { seed: string; username: string; progress: number }) {
  const [appearance, setAppearance] = useState(() => appearanceFromSeed(seed));
  const [state, formAction, pending] = useActionState(saveAvatarAppearance, initialActionState);

  function select<Key extends keyof AvatarAppearance>(key: Key, value: AvatarAppearance[Key]) {
    setAppearance((current) => ({ ...current, [key]: value }));
  }

  return <details className="avatar-customizer">
    <summary><Palette size={16} /> Avatar gestalten <span aria-hidden>＋</span></summary>
    <form action={formAction}>
      <div className="avatar-customizer-preview">
        <TrailAvatar seed={seed} username={username} progress={progress} appearance={appearance} />
        <div><small>Deine Mischung</small><strong>{avatarOptionLabels.background[appearance.background]} · {avatarOptionLabels.hairStyle[appearance.hairStyle]}</strong><p>Jede Auswahl wird aus einzelnen Aquarell-Ebenen zusammengesetzt.</p></div>
      </div>
      <button className="avatar-surprise" type="button" onClick={() => setAppearance(randomAppearance(`${Date.now()}:${Math.random()}`))}><Shuffle size={15} /> Überrasche mich</button>
      <div className="avatar-option-groups">
        {groups.map((group) => <fieldset key={group.key}>
          <legend>{group.label}</legend>
          <div>{avatarOptionValues[group.key].map((value) => {
            const checked = appearance[group.key] === value;
            return <label key={value} className={checked ? "is-selected" : undefined} data-avatar-key={group.key} data-avatar-value={value}>
              <input type="radio" name={group.key} value={value} checked={checked} onChange={() => select(group.key, value)} />
              <i aria-hidden />
              <span>{(avatarOptionLabels[group.key] as Record<string, string>)[value]}</span>
            </label>;
          })}</div>
        </fieldset>)}
      </div>
      <div className="avatar-customizer-actions">
        <button className="avatar-save" type="submit" disabled={pending}>{pending ? <span className="loading loading-spinner loading-xs" /> : <Check size={16} />}{pending ? "Wird gemalt …" : "Avatar speichern"}</button>
        <p className={state.ok ? "is-success" : undefined} aria-live="polite">{state.message}</p>
      </div>
    </form>
  </details>;
}
