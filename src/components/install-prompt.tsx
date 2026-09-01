"use client";

import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [ios, setIos] = useState(false);
  const [instructions, setInstructions] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    if (standalone || localStorage.getItem("benchly-install-dismissed") === "true") return;
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const visited = localStorage.getItem("benchly-visited") === "true";
    localStorage.setItem("benchly-visited", "true");
    let deferred: InstallEvent | null = null;
    let engaged = false;
    const reveal = () => {
      engaged = true;
      if (isIos) { setIos(true); setVisible(true); }
      else if (deferred) setVisible(true);
    };
    const offer = (event: Event) => {
      event.preventDefault();
      deferred = event as InstallEvent;
      setInstallEvent(deferred);
      if (engaged) setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", offer);
    window.addEventListener("benchly:engaged", reveal);
    const timer = window.setTimeout(reveal, visited ? 30_000 : 45_000);
    return () => { window.removeEventListener("beforeinstallprompt", offer); window.removeEventListener("benchly:engaged", reveal); window.clearTimeout(timer); };
  }, []);

  if (!visible || (!ios && !installEvent)) return null;
  const close = () => {
    setVisible(false);
    localStorage.setItem("benchly-install-dismissed", "true");
  };
  const install = async () => {
    if (ios) { setInstructions(true); return; }
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === "accepted") setVisible(false);
    setInstallEvent(null);
  };

  return (
    <aside aria-label="Benchly installieren" className="safe-bottom fixed inset-x-3 bottom-0 z-50 mx-auto max-w-sm">
      <div className="rounded-box border border-base-300 bg-base-100/98 p-2.5 shadow-2xl backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-content"><Download size={19} /></div>
          <div className="min-w-0 flex-1"><div className="font-bold leading-tight">Benchly installieren</div><p className="truncate text-xs opacity-60">Schneller zur nächsten Bank</p></div>
          {!instructions && <button className="btn btn-primary btn-sm min-h-11" onClick={install}>{ios ? <Share size={17} /> : <Download size={17} />} Installieren</button>}
          <button aria-label="Installationshinweis schliessen" className="btn btn-circle btn-ghost btn-sm" onClick={close}><X size={17} /></button>
        </div>
        {instructions && <p className="mt-2 flex items-center gap-2 rounded-xl bg-base-200 p-2.5 text-sm"><Share size={18} className="shrink-0 text-primary" /> In Safari: „Teilen“ → „Zum Home-Bildschirm“.</p>}
      </div>
    </aside>
  );
}
