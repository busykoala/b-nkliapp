import type { Metadata, Viewport } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { isDialectLocale, languageFromLocale, localeTags } from "@/i18n/config";

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
  const language = languageFromLocale(locale);
  return (
    <html lang={localeTags[language]} data-language-mode={isDialectLocale(locale) ? "dialect" : "fixed"} data-theme="benchly">
      <body>
        <NextIntlClientProvider>{children}<ServiceWorkerRegistration /></NextIntlClientProvider>
      </body>
    </html>
  );
}
