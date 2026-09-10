import { getLocale, getTranslations } from "next-intl/server";
import { languageFromLocale, localeTags } from "@/i18n/config";
import type { MetadataRoute } from "next";

export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = await getTranslations("common.metadata");
  const locale = await getLocale();
  return {
    id: "/",
    name: t("title"),
    short_name: "Bänkli App",
    description: t("description"),
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f7f4e9",
    theme_color: "#2f6b4f",
    lang: localeTags[languageFromLocale(locale)],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
