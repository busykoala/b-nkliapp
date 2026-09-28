"use client";

import { useId, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, BarChart3, Bookmark, BookOpen, Download, Footprints, Info, LogIn, LogOut, Map, Menu, Plus, Rss, Share, X } from "lucide-react";
import { usePathname } from "next/navigation";
import type { CurrentUser } from "@/lib/security";
import { logout } from "@/app/actions/account";
import { AccountDialog } from "@/features/account/components/account-controls";
import { TrailAvatar } from "@/features/account/components/trail-avatar";
import { LanguageSwitcher } from "./language-switcher";
import { DialectToggle } from "./dialect-toggle";
import { ReadingDialog } from "@/features/reading/components/reading-dialog";

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function AppMenu({ user, onAdd, onWalk }: { user: CurrentUser | null; onAdd?: () => void; onWalk?: () => void; }) {
  const t = useTranslations();
  const menuId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const accountDialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installFailed, setInstallFailed] = useState(false);
  const [ios, setIos] = useState(false);
  const [iosHelp, setIosHelp] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    if (standalone) return;
    const detectIos = window.setTimeout(() => setIos(/iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)), 0);
    const offer = (event: Event) => { event.preventDefault(); setInstallEvent(event as InstallEvent); };
    window.addEventListener("beforeinstallprompt", offer);
    return () => { window.clearTimeout(detectIos); window.removeEventListener("beforeinstallprompt", offer); };
  }, []);

  const close = () => dialog.current?.close();
  const openMenu = (trigger: HTMLButtonElement) => {
    // Touch/WebKit need not focus a clicked button: give the native dialog an explicit return target.
    trigger.focus({ preventScroll: true });
    dialog.current?.showModal();
    setOpen(true);
    // Start at the heading, not with a large focus ring around the close icon.
    heading.current?.focus({ preventScroll: true });
  };
  const openAccount = () => { close(); window.setTimeout(() => accountDialog.current?.showModal(), 0); };
  const install = async () => {
    if (ios) { setIosHelp(true); return; }
    if (!installEvent || installing) return;
    setInstalling(true);
    setInstallFailed(false);
    try {
      await installEvent.prompt();
      await installEvent.userChoice;
      setInstallEvent(null);
    } catch { setInstallFailed(true); }
    finally { setInstalling(false); }
  };

  return <>
    <button type="button" aria-label={t("common.navigation.open")} aria-haspopup="dialog" aria-controls={menuId} aria-expanded={open} className="calm-menu-button" onClick={(event) => openMenu(event.currentTarget)}>
      <Menu size={20} aria-hidden="true" />
    </button>
    <dialog ref={dialog} id={menuId} className="app-menu-dialog" aria-labelledby={`${menuId}-title`} onClose={() => { setOpen(false); setReading(false); }} onCancel={(event) => event.stopPropagation()}>
      <div className="app-menu-sheet">
        <header>
          <div><h2 ref={heading} id={`${menuId}-title`} tabIndex={-1}>Bänkli App</h2><p>{t("reading.tagline")}</p></div>
          <button type="button" aria-label={t("common.navigation.close")} onClick={close}><X size={19} aria-hidden="true" /></button>
        </header>
        <div className="app-menu-scroll">
          <nav aria-label={t("common.navigation.label")}>
            <section aria-labelledby={`${menuId}-outside`}>
              <h3 id={`${menuId}-outside`} className="app-menu-group-label">{t("reading.outside")}</h3>
              {pathname !== "/" && <Link aria-label={t("common.navigation.map")} href="/" className="app-menu-row" onClick={close}><Map size={19} aria-hidden="true" />{t("common.navigation.map")}</Link>}
              {onWalk ? <button type="button" className="app-menu-row" onClick={() => { close(); window.setTimeout(onWalk, 0); }}><Footprints size={19} aria-hidden="true" />{t("common.navigation.walk")}</button>
                : <Link className="app-menu-row" href="/?action=walk" onClick={close}><Footprints size={19} aria-hidden="true" />{t("common.navigation.walk")}</Link>}
              {user && <Link href="/lieblingsplaetze" className="app-menu-row" aria-current={pathname === "/lieblingsplaetze" ? "page" : undefined} onClick={close}><Bookmark size={19} aria-hidden="true" />{t("common.navigation.favourites")}</Link>}
            </section>
            <button type="button" className="app-menu-reading" onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); setReading(true); }} aria-haspopup="dialog">
              <span className="app-menu-reading-art" aria-hidden="true"><Image src="/ui-art/benches/wood-back.webp" width={90} height={63} alt="" unoptimized /></span>
              <span className="app-menu-reading-copy"><small>{t("reading.pause")}</small><strong>{t("reading.essay")}</strong><span>{t("reading.essayHint")}</span></span>
              <BookOpen size={19} aria-hidden="true" />
            </button>
            <section aria-labelledby={`${menuId}-around`}>
              <h3 id={`${menuId}-around`} className="app-menu-group-label">{t("reading.around")}</h3>
              <Link aria-label={t("common.navigation.feed")} href="/feed" className="app-menu-row" aria-current={pathname === "/feed" ? "page" : undefined} onClick={close}><Rss size={19} aria-hidden="true" />{t("common.navigation.feed")}</Link>
              {onAdd ? <button type="button" aria-label={t("common.navigation.addBench")} className="app-menu-row" onClick={() => { close(); window.setTimeout(onAdd, 0); }}><Plus size={19} aria-hidden="true" />{t("common.navigation.addBench")}</button>
                : <Link className="app-menu-row" href="/?action=add" onClick={close}><Plus size={19} aria-hidden="true" />{t("common.navigation.addBench")}</Link>}
              <Link aria-label={t("common.navigation.statistics")} href="/statistiken" className="app-menu-row" aria-current={pathname === "/statistiken" || pathname.startsWith("/gemeinde/") ? "page" : undefined} onClick={close}><BarChart3 size={19} aria-hidden="true" />{t("common.navigation.statistics")}</Link>
              <Link aria-label={t("common.navigation.about")} href="/danke" className="app-menu-row" aria-current={pathname === "/danke" ? "page" : undefined} onClick={close}><Info size={19} aria-hidden="true" />{t("common.navigation.about")}</Link>
            </section>
          </nav>
          {user ? <Link aria-label={t("common.navigation.profile")} aria-current={pathname.startsWith("/profil") ? "page" : undefined} href="/profil" className="app-menu-account" onClick={close}>
            <span className="app-menu-account-avatar"><TrailAvatar seed={user.avatarSeed} username={user.username} compact /></span>
            <span><small>{t("common.navigation.profile")}</small><strong>{user.username}</strong></span><ArrowRight size={17} aria-hidden="true" />
          </Link> : <button type="button" aria-label={t("common.navigation.signIn")} className="app-menu-row app-menu-login" onClick={openAccount}><LogIn size={19} aria-hidden="true" />{t("common.navigation.signIn")}</button>}
          <div className="app-menu-preferences"><LanguageSwitcher /><DialectToggle /></div>
          {(ios || installEvent) && <button type="button" className="app-menu-row app-menu-install" disabled={installing} onClick={install}><Download size={19} aria-hidden="true" />{t("common.install.button")}</button>}
          {iosHelp && <p className="ios-help" role="status"><Share size={17} aria-hidden="true" />{t("common.install.ios")}</p>}
          {installFailed && <p className="ios-help" role="status">{t("reading.installFailed")}</p>}
          {user && <form className="app-menu-signout" action={logout}><button onClick={close}><LogOut size={17} aria-hidden="true" />{t("common.navigation.signOut")}</button></form>}
        </div>
      </div>
      <form method="dialog" className="modal-backdrop" aria-hidden="true"><button tabIndex={-1}>{t("common.actions.close")}</button></form>
    </dialog>
    {reading && <ReadingDialog onClose={() => setReading(false)} />}
    <AccountDialog dialogRef={accountDialog} />
  </>;
}
