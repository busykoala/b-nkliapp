import type { Metadata, Viewport } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.metadata");
  return {
  applicationName: "Bänkli App",
  title: { default: t("title"), template: "%s · Bänkli App" },
  description: t("description"),
  manifest: "/manifest.webmanifest",
  icons: { icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }], apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Bänkli App" },
  formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = { themeColor: "#f6ecd5", viewportFit: "cover" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  return (
    <html lang={locale} data-theme="benchly">
      <body>
        <NextIntlClientProvider>{children}<ServiceWorkerRegistration /></NextIntlClientProvider>
      </body>
    </html>
  );
}
