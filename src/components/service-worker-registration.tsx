"use client";

import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";

export function ServiceWorkerRegistration() {
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").then((registration) => {
        registration.update().catch(() => undefined);
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) setUpdateReady(true);
          });
        });
      }).catch(() => undefined);
    }
  }, []);
  if (!updateReady) return null;
  return <div role="status" className="safe-bottom fixed inset-x-3 bottom-0 z-[60] mx-auto max-w-sm"><div className="alert border border-base-300 bg-base-100 shadow-2xl"><RefreshCw size={19} /><span className="text-sm">Eine neue Benchly-Version ist bereit.</span><button className="btn btn-primary btn-sm min-h-11" onClick={() => window.location.reload()}>Aktualisieren</button><button aria-label="Update-Hinweis schliessen" className="btn btn-circle btn-ghost btn-sm" onClick={() => setUpdateReady(false)}><X size={16} /></button></div></div>;
}
