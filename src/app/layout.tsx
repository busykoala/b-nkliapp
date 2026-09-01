import type { Metadata, Viewport } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";

export const metadata: Metadata = {
  applicationName: "Benchly",
  title: { default: "Benchly – Schweizer Sitzbänke", template: "%s · Benchly" },
  description: "Finde Schweizer Sitzbänke mit Sonne, Aussicht und Community-Bewertungen.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Benchly" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = { themeColor: "#2f6b4f", viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de" data-theme="benchly">
      <body>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
