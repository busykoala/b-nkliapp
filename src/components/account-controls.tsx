"use client";

import Link from "next/link";
import { useId, useRef, useState, useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Armchair, LogIn, Plus, UserRound, X } from "lucide-react";
import { login, register } from "@/app/actions/account";
import type { CurrentUser } from "@/lib/security";

export function AccountControls({ user, onAdd }: { user: CurrentUser | null; onAdd?: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const addAfterLogin = useRef(false);
  return <div className="flex gap-2">
    {onAdd && <button aria-label="Bänkli eintragen" className="btn btn-circle storybook-panel min-h-12 min-w-12 border-0 text-primary" onClick={() => { if (user) onAdd(); else { addAfterLogin.current = true; dialog.current?.showModal(); } }}><Plus size={21} /></button>}
    {user ? <Link aria-label="Mein Profil" href="/profil" className="btn btn-circle storybook-panel min-h-12 min-w-12 border-0 text-primary"><UserRound size={20} /></Link>
      : <button aria-label="Anmelden" className="btn btn-circle storybook-panel min-h-12 min-w-12 border-0 text-primary" onClick={() => dialog.current?.showModal()}><LogIn size={20} /></button>}
    <AccountDialog dialogRef={dialog} onAuthenticated={() => { if (addAfterLogin.current) { addAfterLogin.current = false; onAdd?.(); } }} />
  </div>;
}

export function AccountDialog({ dialogRef, onAuthenticated, intent }: { dialogRef: React.RefObject<HTMLDialogElement | null>; onAuthenticated?: () => void; intent?: string }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [isOpen, setIsOpen] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const router = useRouter();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    // Observe the native open attribute: dialog toggle events are not supported
    // by every Safari version. Closed dialogs must not keep hidden login forms.
    const observer = new MutationObserver(() => setIsOpen(dialog.open));
    observer.observe(dialog, { attributes: true, attributeFilter: ["open"] });
    return () => observer.disconnect();
  }, [dialogRef]);
  return <dialog ref={dialogRef} className="modal modal-bottom sm:modal-middle" aria-labelledby={titleId} aria-describedby={descriptionId}>
    <div className="modal-box utility-sheet max-h-[calc(100dvh-env(safe-area-inset-top)-1rem)] overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]">
      <button type="button" aria-label="Schliessen" className="btn btn-circle btn-ghost absolute right-3 top-3" onClick={() => dialogRef.current?.close()}><X size={19} /></button>
      <span className="story-icon mb-3"><Armchair size={21} /></span>
      <div className="story-eyebrow">Mach mit</div>
      <h2 id={titleId} className="mt-1 text-2xl font-black">{mode === "login" ? "Willkommen zurück" : "Dein Bänkli-Konto"}</h2>
      <p id={descriptionId} className="mt-1 text-sm text-base-content/70">Nur Benutzername und Passwort. Ganz ohne E-Mail.</p>
      {intent && <p className="auth-intent">Danach geht es weiter: {intent}.</p>}
      {isOpen && <AccountForm key={mode} mode={mode} onSuccess={() => { dialogRef.current?.close(); onAuthenticated?.(); router.refresh(); }} />}
      <button type="button" className="btn btn-ghost mt-2 min-h-11 w-full" onClick={() => setMode(mode === "login" ? "register" : "login")}>{mode === "login" ? "Neu hier? Konto erstellen" : "Ich habe schon ein Konto"}</button>
    </div>
    <form method="dialog" className="modal-backdrop"><button>schliessen</button></form>
  </dialog>;
}

function AccountForm({ mode, onSuccess }: { mode: "login" | "register"; onSuccess: () => void }) {
  const [state, formAction, pending] = useActionState(async (_previous: import("@/lib/types").ActionResult | null, data: FormData) => {
    const result = await (mode === "login" ? login : register)(null, data);
    if (result.ok) onSuccess();
    return result;
  }, null);
  const statusId = useId();
  return <>
    <form action={formAction} className="mt-5 space-y-3" aria-busy={pending}>
      <label className="form-control"><span className="label text-sm font-bold">Benutzername</span><input autoFocus name="username" autoComplete="username" required minLength={3} maxLength={24} aria-describedby={state && !state.ok ? statusId : undefined} className="input story-card min-h-12 w-full" /></label>
      <label className="form-control"><span className="label text-sm font-bold">Passwort</span><input type="password" name="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} aria-describedby={state && !state.ok ? statusId : undefined} className="input story-card min-h-12 w-full" /></label>
      <button disabled={pending} className="btn btn-primary min-h-12 w-full rounded-2xl">{pending && <span className="loading loading-spinner loading-sm" aria-hidden="true" />}{pending ? mode === "login" ? "Wird angemeldet …" : "Konto entsteht …" : mode === "login" ? "Anmelden" : "Konto erstellen"}</button>
    </form>
    {state && <p id={statusId} role={state.ok ? "status" : "alert"} className={`mt-3 rounded-xl px-3 py-2 text-sm ${state.ok ? "bg-success/10 text-success" : "bg-error/10 text-error"}`}>{state.message}</p>}
  </>;
}
