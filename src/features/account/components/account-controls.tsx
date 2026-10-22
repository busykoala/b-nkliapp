"use client";
import { useTranslations } from "next-intl";
import { markAccountSession, useAuthenticated } from "@/features/account/auth-session";

import Link from "next/link";
import { useId, useRef, useState, useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Armchair, Eye, EyeOff, LogIn, Plus, UserRound, X } from "lucide-react";
import { login, register } from "@/app/actions/account";
import styles from "./account-sheet.module.css";
import type { CurrentUser } from "@/lib/security";

export function AccountControls({ user, onAdd }: { user: CurrentUser | null; onAdd?: () => void }) {
  const t = useTranslations();
  const authenticated = useAuthenticated(Boolean(user));
  const dialog = useRef<HTMLDialogElement>(null);
  const addAfterLogin = useRef(false);
  return <div className="flex gap-2">
    {onAdd && <button aria-label={t("common.navigation.addBench")} className="btn btn-circle storybook-panel min-h-12 min-w-12 border-0 text-primary" onClick={() => { if (authenticated) onAdd(); else { addAfterLogin.current = true; dialog.current?.showModal(); } }}><Plus size={21} /></button>}
    {authenticated ? <Link aria-label={t("common.navigation.profile")} href="/profil" className="btn btn-circle storybook-panel min-h-12 min-w-12 border-0 text-primary"><UserRound size={20} /></Link>
      : <button aria-label={t("common.navigation.signIn")} className="btn btn-circle storybook-panel min-h-12 min-w-12 border-0 text-primary" onClick={() => dialog.current?.showModal()}><LogIn size={20} /></button>}
    <AccountDialog dialogRef={dialog} onAuthenticated={() => { if (addAfterLogin.current) { addAfterLogin.current = false; onAdd?.(); } }} />
  </div>;
}

export function AccountDialog({ dialogRef, onAuthenticated, intent }: { dialogRef: React.RefObject<HTMLDialogElement | null>; onAuthenticated?: () => void; intent?: string }) {
  const t = useTranslations();
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
  useEffect(() => {
    const node = dialogRef.current;
    const viewport = window.visualViewport;
    if (!isOpen || !node || !viewport) return;
    const measure = () => {
      node.style.setProperty("--account-viewport-height", `${viewport.height}px`);
      node.style.setProperty("--account-viewport-top", `${viewport.offsetTop}px`);
    };
    measure(); viewport.addEventListener("resize", measure); viewport.addEventListener("scroll", measure);
    return () => {
      viewport.removeEventListener("resize", measure); viewport.removeEventListener("scroll", measure);
      node.style.removeProperty("--account-viewport-height"); node.style.removeProperty("--account-viewport-top");
    };
  }, [dialogRef, isOpen]);
  return <dialog ref={dialogRef} className={`modal modal-bottom sm:modal-middle ${styles.dialog}`} aria-labelledby={titleId} aria-describedby={descriptionId}>
    <div className={`modal-box utility-sheet account-sheet ${styles.sheet}`}>
      <button type="button" aria-label={t("common.actions.closeTitle")} className="btn btn-circle btn-ghost absolute right-3 top-3" onClick={() => dialogRef.current?.close()}><X size={19} /></button>
      <span className="story-icon mb-3"><Armchair size={21} /></span>
      <div className="story-eyebrow">{t("account.dialog.invitation")}</div>
      <h2 id={titleId} className="mt-1 text-2xl font-black">{mode === "login" ? t("account.dialog.welcome") : t("account.dialog.createTitle")}</h2>
      <p id={descriptionId} className="mt-1 text-base-content/70">{intent ? t("account.dialog.intent", { intent }) : t("account.dialog.description")}</p>
      <div className="account-mode-switch" role="group" aria-label={t("account.dialog.invitation")}>
        <button type="button" aria-pressed={mode === "login"} onClick={() => setMode("login")}>{t("account.dialog.login")}</button>
        <button type="button" aria-pressed={mode === "register"} onClick={() => setMode("register")}>{t("account.dialog.registerTab")}</button>
      </div>
      {isOpen && <AccountForm key={mode} mode={mode} onSuccess={() => { dialogRef.current?.close(); onAuthenticated?.(); router.refresh(); }} />}
      <p className="account-privacy-note"><a href="/datenschutz" target="_blank" rel="noreferrer">{t("account.dialog.privacy")}</a></p>
    </div>
    <form method="dialog" className="modal-backdrop" aria-hidden="true"><button tabIndex={-1}>{t("common.actions.close")}</button></form>
  </dialog>;
}

function AccountForm({ mode, onSuccess, referralToken }: { mode: "login" | "register"; onSuccess: () => void; referralToken?: string }) {
  const t = useTranslations();
  const [showPassword, setShowPassword] = useState(false);
  const [state, formAction, pending] = useActionState(async (_previous: import("@/lib/types").ActionResult | null, data: FormData) => {
    const result = await (mode === "login" ? login : register)(null, data);
    if (result.ok) { markAccountSession(true); onSuccess(); }
    return result;
  }, null);
  const statusId = useId();
  const passwordId = useId();
  const usernameHintId = useId();
  return <>
    <form action={formAction} className="mt-5 space-y-3" aria-busy={pending}>
      {referralToken && <input type="hidden" name="referralToken" value={referralToken} />}
      <label className="form-control"><span className="label text-sm font-bold">{t("account.fields.username")}</span><input autoFocus name="username" autoComplete="username" required minLength={3} maxLength={24} aria-describedby={[mode === "register" ? usernameHintId : null, state && !state.ok ? statusId : null].filter(Boolean).join(" ") || undefined} className="input story-card min-h-12 w-full" />{mode === "register" && <small id={usernameHintId} className="account-field-hint">{t("account.fields.usernamePublicHint")}</small>}</label>
      <div className="form-control"><label htmlFor={passwordId} className="label text-sm font-bold">{t("account.fields.password")}</label><span className="account-password-field"><input id={passwordId} type={showPassword ? "text" : "password"} name="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} aria-describedby={state && !state.ok ? statusId : mode === "register" ? `${statusId}-hint` : undefined} className="input story-card min-h-12 w-full" /><button type="button" aria-label={showPassword ? t("account.fields.hidePassword") : t("account.fields.showPassword")} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span>{mode === "register" && <small id={`${statusId}-hint`} className="account-field-hint">{t("account.validation.passwordShort")}</small>}</div>
      <button disabled={pending} className="btn btn-primary min-h-12 w-full rounded-2xl">{pending && <span className="loading loading-spinner loading-sm" aria-hidden="true" />}{pending ? mode === "login" ? t("account.form.signingIn") : t("account.form.registering") : mode === "login" ? t("common.navigation.signIn") : t("account.form.register")}</button>
    </form>
    {state && <p id={statusId} role={state.ok ? "status" : "alert"} className={`mt-3 rounded-xl px-3 py-2 text-sm ${state.ok ? "bg-success/10 text-success" : "bg-error/10 text-error"}`}>{state.message}</p>}
  </>;
}

export function ReferralSignup({ token }: { token: string }) {
  const router = useRouter();
  return <AccountForm mode="register" referralToken={token} onSuccess={() => router.push("/profil")} />;
}
