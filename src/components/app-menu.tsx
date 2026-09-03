"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Download, Footprints, LogIn, Menu, Plus, Share, SlidersHorizontal, UserRound, X } from "lucide-react";
import { usePathname } from "next/navigation";
import type { CurrentUser } from "@/lib/security";
import { AccountDialog } from "./account-controls";

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function AppMenu({ user, onFilter, onAdd, activeFilters = 0 }: { user: CurrentUser | null; onFilter?: () => void; onAdd?: () => void; activeFilters?: number }) {
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
      <Menu size={20} />{activeFilters > 0 && <span className="menu-dot" />}
    </button>
    <dialog ref={dialog} className="app-menu-dialog">
      <div className="app-menu-sheet">
        <header><span>Bänkli App</span><button aria-label="Menü schliessen" onClick={close}><X size={19} /></button></header>
        <nav>
          <Link aria-label="Entdeckerfeed" href="/feed" className={`app-menu-row ${pathname === "/feed" ? "is-current" : ""}`} onClick={close}><Footprints size={19} /> Spuren am Weg</Link>
          {onFilter && <button className="app-menu-row" onClick={() => { close(); onFilter(); }}><SlidersHorizontal size={19} /> Bänke auswählen {activeFilters > 0 && <small>{activeFilters}</small>}</button>}
          {onAdd && <button aria-label="Bänkli eintragen" className="app-menu-row" onClick={() => { if (user) { close(); onAdd(); } else openAccount(); }}><Plus size={19} /> Bänkli eintragen</button>}
          {user ? <Link aria-label="Mein Profil" href="/profil" className="app-menu-row" onClick={close}><UserRound size={19} /> Mein Profil</Link>
            : <button aria-label="Anmelden" className="app-menu-row" onClick={openAccount}><LogIn size={19} /> Anmelden</button>}
          {(ios || installEvent) && <button className="app-menu-row" onClick={install}><Download size={19} /> App installieren</button>}
        </nav>
        <p className="map-sources"><a href="https://www.swisstopo.admin.ch/de/nutzungsbedingungen-kostenlose-geodaten-und-geodienste" target="_blank" rel="noreferrer">Karte: swisstopo</a><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">Bankdaten: OpenStreetMap</a></p>
        {iosHelp && <p className="ios-help"><Share size={17} /> In Safari „Teilen“ und danach „Zum Home-Bildschirm“ wählen.</p>}
      </div>
      <form method="dialog" className="modal-backdrop"><button>schliessen</button></form>
    </dialog>
    {!user && <AccountDialog dialogRef={accountDialog} />}
  </>;
}
