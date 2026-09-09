"use client";

import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";

export function ServiceWorkerRegistration() {
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      const serviceWorker = navigator.serviceWorker;
      let controller = serviceWorker.controller;
      const controllerChanged = () => {
        const next = serviceWorker.controller;
        // The first claim installs the app; only a replacement is an update.
        if (controller && next && controller !== next) setUpdateReady(true);
        controller = next;
      };
      serviceWorker.addEventListener("controllerchange", controllerChanged);
      serviceWorker.register("/sw.js").then((registration) => {
        registration.update().catch(() => undefined);
      }).catch(() => undefined);
      return () => serviceWorker.removeEventListener("controllerchange", controllerChanged);
    }
  }, []);
  if (!updateReady) return null;
  return <div role="status" className="safe-bottom fixed inset-x-3 bottom-0 z-20 mx-auto max-w-sm"><div className="storybook-panel flex items-center gap-2 rounded-[1.5rem] p-3"><RefreshCw size={19} className="text-primary" /><span className="flex-1 text-sm font-semibold">Eine frischere Karte ist bereit.</span><button className="btn btn-primary btn-sm min-h-11 rounded-2xl" onClick={() => window.location.reload()}>Neu laden</button><button aria-label="Update-Hinweis schliessen" className="btn btn-circle btn-ghost btn-sm" onClick={() => setUpdateReady(false)}><X size={16} /></button></div></div>;
}
