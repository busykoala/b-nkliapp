import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  async headers() {
    const securityHeaders = [
      { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https://*.geo.admin.ch; worker-src 'self' blob:; font-src 'self' data:; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
      { key: "Permissions-Policy", value: "geolocation=(self), camera=(self), microphone=()" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Strict-Transport-Security", value: "max-age=31536000" },
    ];
    const artCacheHeaders = [{ key: "Cache-Control", value: "public, max-age=3600, must-revalidate" }];
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/map-art/:category/:path*", headers: artCacheHeaders },
      { source: "/ui-art/:category/:path*", headers: artCacheHeaders },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
      { source: "/manifest.webmanifest", headers: [{ key: "Cache-Control", value: "no-cache" }] },
    ];
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default createNextIntlPlugin()(nextConfig);
