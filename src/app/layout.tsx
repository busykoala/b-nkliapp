import type { Metadata, Viewport } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import { InstallPrompt } from "@/components/install-prompt";

export const metadata: Metadata = {
  applicationName: "Bänkli App",
  title: { default: "Bänkli App – Schweizer Sitzbänke", template: "%s · Bänkli App" },
  description: "Finde Schweizer Sitzbänke mit Sonne, Aussicht und Community-Bewertungen.",
  manifest: "/manifest.webmanifest",
  icons: { icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }], apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Bänkli App" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = { themeColor: "#f6ecd5", viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de" data-theme="benchly">
      <body>
        {children}
        <InstallPrompt />
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
