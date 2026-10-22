"use client";

import Link from "next/link";
import { BookOpen, Footprints, Map, X } from "lucide-react";
import { useId, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuthenticated } from "@/features/account/auth-session";
import { AccountDialog } from "@/features/account/components/account-controls";
import { AtlasDrawing } from "./atlas-art";
import styles from "./atlas-navigation.module.css";

export function AtlasNavigation({ current, signedIn, onWalk }: { current: "map" | "walk" | "book"; signedIn: boolean; onWalk?: () => void }) {
  const t = useTranslations();
  const authenticated = useAuthenticated(signedIn);
  const router = useRouter();
  const introduction = useRef<HTMLDialogElement>(null);
  const account = useRef<HTMLDialogElement>(null);
  const bookTitle = useId();
  const item = (key: "map" | "walk" | "book") => current === key ? "page" as const : undefined;
  return <>
    <nav className={styles.navigation} aria-label={t("reading.atlas.navigation")}>
      <Link href="/" aria-current={item("map")}><Map size={22} aria-hidden="true" /><span>{t("reading.atlas.map")}</span></Link>
      {onWalk ? <button type="button" aria-current={item("walk")} onClick={onWalk}><Footprints size={22} aria-hidden="true" /><span>{t("reading.atlas.walk")}</span></button>
        : <Link href="/?action=walk" aria-current={item("walk")}><Footprints size={22} aria-hidden="true" /><span>{t("reading.atlas.walk")}</span></Link>}
      {authenticated ? <Link href="/profil" aria-current={item("book")}><BookOpen size={22} aria-hidden="true" /><span>{t("reading.atlas.book")}</span></Link>
        : <button type="button" onClick={event => { event.currentTarget.focus({ preventScroll: true }); introduction.current?.showModal(); }}><BookOpen size={22} aria-hidden="true" /><span>{t("reading.atlas.book")}</span></button>}
    </nav>
    <dialog ref={introduction} className={`modal ${styles.introduction}`} aria-labelledby={bookTitle}>
      <div className="modal-box utility-sheet">
        <form method="dialog"><button className={styles.close} aria-label={t("common.actions.close")}><X size={20} /></button></form>
        <AtlasDrawing kind="remember" />
        <h2 id={bookTitle}>{t("reading.atlas.book")}</h2>
        <p>{t("reading.atlas.bookIntro")}</p>
        <button className="btn btn-primary" type="button" onClick={() => { introduction.current?.close(); account.current?.showModal(); }}>{t("common.navigation.signIn")}</button>
      </div>
      <form method="dialog" className="modal-backdrop"><button tabIndex={-1}>{t("common.actions.close")}</button></form>
    </dialog>
    <AccountDialog dialogRef={account} intent={t("reading.atlas.bookIntro")} onAuthenticated={() => router.push("/profil")} />
  </>;
}
