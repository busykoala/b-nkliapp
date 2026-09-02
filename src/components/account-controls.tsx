"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useActionState } from "react";
import { useRouter } from "next/navigation";
import { Armchair, LogIn, Plus, UserRound, X } from "lucide-react";
import { login, register } from "@/app/actions/account";
import type { CurrentUser } from "@/lib/security";

export function AccountControls({ user, onAdd }: { user: CurrentUser | null; onAdd?: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return <div className="flex gap-2">
    {onAdd && <button aria-label="Bänkli eintragen" className="btn btn-circle storybook-panel min-h-12 min-w-12 border-0 text-primary" onClick={() => user ? onAdd() : dialog.current?.showModal()}><Plus size={21} /></button>}
    {user ? <Link aria-label="Mein Profil" href="/profil" className="btn btn-circle storybook-panel min-h-12 min-w-12 border-0 text-primary"><UserRound size={20} /></Link>
      : <button aria-label="Anmelden" className="btn btn-circle storybook-panel min-h-12 min-w-12 border-0 text-primary" onClick={() => dialog.current?.showModal()}><LogIn size={20} /></button>}
    {!user && <AccountDialog dialogRef={dialog} />}
  </div>;
}

function AccountDialog({ dialogRef }: { dialogRef: React.RefObject<HTMLDialogElement | null> }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const action = mode === "login" ? login : register;
  const [state, formAction] = useActionState(action, null);
  const router = useRouter();
  useEffect(() => { if (state?.ok) { dialogRef.current?.close(); router.refresh(); } }, [state, router, dialogRef]);
  return <dialog ref={dialogRef} className="modal modal-bottom sm:modal-middle">
    <div className="modal-box storybook-sheet rounded-t-[2rem] sm:rounded-[2rem]">
      <button aria-label="Schliessen" className="btn btn-circle btn-ghost absolute right-3 top-3" onClick={() => dialogRef.current?.close()}><X size={19} /></button>
      <span className="story-icon mb-3"><Armchair size={21} /></span>
      <div className="story-eyebrow">Mach mit</div>
      <h2 className="mt-1 text-2xl font-black">{mode === "login" ? "Willkommen zurück" : "Dein Bänkli-Konto"}</h2>
      <p className="mt-1 text-sm opacity-60">Nur Benutzername und Passwort. Ganz ohne E-Mail.</p>
      <form action={formAction} className="mt-5 space-y-3">
        <label className="form-control"><span className="label text-sm font-bold">Benutzername</span><input name="username" autoComplete="username" required minLength={3} maxLength={24} className="input story-card min-h-12 w-full" /></label>
        <label className="form-control"><span className="label text-sm font-bold">Passwort</span><input type="password" name="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} className="input story-card min-h-12 w-full" /></label>
        <button className="btn btn-primary min-h-12 w-full rounded-2xl">{mode === "login" ? "Anmelden" : "Konto erstellen"}</button>
      </form>
      {state && <p role="status" className={`mt-3 text-sm ${state.ok ? "text-success" : "text-error"}`}>{state.message}</p>}
      <button className="btn btn-ghost mt-2 min-h-11 w-full" onClick={() => setMode(mode === "login" ? "register" : "login")}>{mode === "login" ? "Neu hier? Konto erstellen" : "Ich habe schon ein Konto"}</button>
    </div>
    <form method="dialog" className="modal-backdrop"><button>schliessen</button></form>
  </dialog>;
}
