import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Benchly – Schweizer Sitzbänke",
    short_name: "Benchly",
    description: "Finde Schweizer Sitzbänke mit Sonne, Aussicht und Community-Bewertungen.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f7f4e9",
    theme_color: "#2f6b4f",
    lang: "de-CH",
    icons: [
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
