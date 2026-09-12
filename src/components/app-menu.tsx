"use client";
import { useTranslations } from "next-intl";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BarChart3, Bookmark, Download, Footprints, Info, LogIn, LogOut, Map, Menu, Plus, Rss, Share, X } from "lucide-react";
import { usePathname } from "next/navigation";
import type { CurrentUser } from "@/lib/security";
import { logout } from "@/app/actions/account";
import { AccountDialog } from "./account-controls";
import { TrailAvatar } from "./trail-avatar";
import { LanguageSwitcher } from "./language-switcher";
import { DialectToggle } from "./dialect-toggle";

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function AppMenu({ user, onAdd, onWalk }: { user: CurrentUser | null; onAdd?: () => void; onWalk?: () => void; }) {
  const t = useTranslations();
  const dialog = useRef<HTMLDialogElement>(null);
  const accountDialog = useRef<HTMLDialogElement>(null);
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [iosHelp, setIosHelp] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    if (standalone) return;
    const detectIos = window.setTimeout(() => setIos(/iPad|iPhone|iPod/.test(navigator.userAgent)), 0);
    const offer = (event: Event) => { event.preventDefault(); setInstallEvent(event as InstallEvent); };
    window.addEventListener("beforeinstallprompt", offer);
    return () => { window.clearTimeout(detectIos); window.removeEventListener("beforeinstallprompt", offer); };
  }, []);

  const close = () => dialog.current?.close();
  const openAccount = () => { close(); window.setTimeout(() => accountDialog.current?.showModal(), 0); };
  const install = async () => {
    if (ios) { setIosHelp(true); return; }
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
  };

  return <>
    <button aria-label={t("common.navigation.open")} className="calm-menu-button" onClick={() => dialog.current?.showModal()}>
      <Menu size={20} />
    </button>
    <dialog ref={dialog} className="app-menu-dialog" aria-labelledby="app-menu-title">
      <div className="app-menu-sheet">
        <header><h2 id="app-menu-title">Bänkli App</h2><button aria-label={t("common.navigation.close")} onClick={close}><X size={19} /></button></header>
        {user && <Link aria-label={t("common.navigation.profile")} aria-current={pathname.startsWith("/profil") ? "page" : undefined} href="/profil" className={`app-menu-account ${pathname.startsWith("/profil") ? "is-current" : ""}`} onClick={close}>
          <span className="app-menu-account-avatar"><TrailAvatar seed={user.avatarSeed} username={user.username} compact /></span>
          <span><small>{t("common.navigation.profile")}</small><strong>{user.username}</strong></span><span aria-hidden="true">→</span>
        </Link>}
        <nav aria-label={t("common.navigation.label")}>
          {pathname !== "/" && <Link aria-label={t("common.navigation.map")} href="/" className="app-menu-row" onClick={close}><Map size={19} /> {t("common.navigation.map")}</Link>}
          {onAdd ? <button aria-label={t("common.navigation.addBench")} className="app-menu-row" onClick={() => { close(); window.setTimeout(onAdd, 0); }}><Plus size={19} /> {t("common.navigation.addBench")}</button>
            : <Link className="app-menu-row" href="/?action=add" onClick={close}><Plus size={19} /> {t("common.navigation.addBench")}</Link>}
          {onWalk ? <button className="app-menu-row" onClick={() => { close(); window.setTimeout(onWalk, 0); }}><Footprints size={19} /> {t("common.navigation.walk")}</button>
            : <Link className="app-menu-row" href="/?action=walk" onClick={close}><Footprints size={19} /> {t("common.navigation.walk")}</Link>}
          <Link aria-label={t("common.navigation.feed")} href="/feed" className={`app-menu-row ${pathname === "/feed" ? "is-current" : ""}`} onClick={close}><Rss size={19} /> {t("common.navigation.feed")}</Link>
          {user && <Link href="/lieblingsplaetze" className={`app-menu-row ${pathname === "/lieblingsplaetze" ? "is-current" : ""}`} aria-current={pathname === "/lieblingsplaetze" ? "page" : undefined} onClick={close}><Bookmark size={19} /> {t("common.navigation.favourites")}</Link>}
          {!user && <button aria-label={t("common.navigation.signIn")} className="app-menu-row" onClick={openAccount}><LogIn size={19} /> {t("common.navigation.signIn")}</button>}
          <Link aria-label={t("common.navigation.statistics")} href="/statistiken" className={`app-menu-row ${pathname === "/statistiken" || pathname.startsWith("/gemeinde/") ? "is-current" : ""}`} onClick={close}><BarChart3 size={19} /> {t("common.navigation.statistics")}</Link>
          {(ios || installEvent) && <button className="app-menu-row" onClick={install}><Download size={19} /> {t("common.install.button")}</button>}
          <Link aria-label={t("common.navigation.about")} href="/danke" className={`app-menu-row ${pathname === "/danke" ? "is-current" : ""}`} onClick={close}><Info size={19} /> {t("common.navigation.about")}</Link>
        </nav>
        <LanguageSwitcher />
        <DialectToggle />
        {iosHelp && <p className="ios-help"><Share size={17} /> {t("common.install.ios")}</p>}
        {user && <form className="app-menu-signout" action={logout}><button onClick={close}><LogOut size={17} /> {t("common.navigation.signOut")}</button></form>}
      </div>
      <form method="dialog" className="modal-backdrop"><button>{t("common.actions.close")}</button></form>
    </dialog>
    <AccountDialog dialogRef={accountDialog} />
  </>;
}
