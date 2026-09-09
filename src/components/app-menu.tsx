"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bookmark, Download, Footprints, Info, LogIn, LogOut, Menu, Plus, Rss, Share, X } from "lucide-react";
import { usePathname } from "next/navigation";
import type { CurrentUser } from "@/lib/security";
import { logout } from "@/app/actions/account";
import { AccountDialog } from "./account-controls";
import { TrailAvatar } from "./trail-avatar";

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function AppMenu({ user, onAdd, onWalk }: { user: CurrentUser | null; onAdd?: () => void; onWalk?: () => void; }) {
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
    <button aria-label="Menü öffnen" className="calm-menu-button" onClick={() => dialog.current?.showModal()}>
      <Menu size={20} />
    </button>
    <dialog ref={dialog} className="app-menu-dialog" aria-labelledby="app-menu-title">
      <div className="app-menu-sheet">
        <header><h2 id="app-menu-title">Bänkli App</h2><button aria-label="Menü schliessen" onClick={close}><X size={19} /></button></header>
        <nav aria-label="Hauptnavigation">
          {onAdd ? <button aria-label="Bänkli eintragen" className="app-menu-row" onClick={() => { close(); window.setTimeout(onAdd, 0); }}><Plus size={19} /> Bänkli eintragen</button>
            : <Link className="app-menu-row" href="/?action=add" onClick={close}><Plus size={19} /> Bänkli eintragen</Link>}
          {onWalk ? <button className="app-menu-row" onClick={() => { close(); window.setTimeout(onWalk, 0); }}><Footprints size={19} /> Spaziergang</button>
            : <Link className="app-menu-row" href="/?action=walk" onClick={close}><Footprints size={19} /> Spaziergang</Link>}
          <Link aria-label="Bänkli-Feed" href="/feed" className={`app-menu-row ${pathname === "/feed" ? "is-current" : ""}`} onClick={close}><Rss size={19} /> Bänkli-Feed</Link>
          {user && <Link href="/lieblingsplaetze" className="app-menu-row" onClick={close}><Bookmark size={19} /> Meine Lieblingsplätze</Link>}
          {user ? <Link aria-label="Mein Profil" href="/profil" className="app-menu-row" onClick={close}><span className="app-menu-avatar"><TrailAvatar seed={user.avatarSeed} username={user.username} compact /></span> Mein Profil</Link>
            : <button aria-label="Anmelden" className="app-menu-row" onClick={openAccount}><LogIn size={19} /> Anmelden</button>}
          {user && <form action={logout}><button className="app-menu-row" onClick={close}><LogOut size={19} /> Abmelden</button></form>}
          {(ios || installEvent) && <button className="app-menu-row" onClick={install}><Download size={19} /> App installieren</button>}
          <Link aria-label="Über die Bänkli App" href="/danke" className={`app-menu-row ${pathname === "/danke" ? "is-current" : ""}`} onClick={close}><Info size={19} /> Über die Bänkli App</Link>
        </nav>
        {iosHelp && <p className="ios-help"><Share size={17} /> In Safari „Teilen“ und danach „Zum Home-Bildschirm“ wählen.</p>}
      </div>
      <form method="dialog" className="modal-backdrop"><button>schliessen</button></form>
    </dialog>
    <AccountDialog dialogRef={accountDialog} />
  </>;
}
