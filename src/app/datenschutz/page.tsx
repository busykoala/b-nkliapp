import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { OperatorContact } from "@/components/operator-contact";
import { PrivacyFlow } from "@/components/privacy-flow";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const t = await getTranslations("privacy");
  return { title: t("metadata.title") };
}

export default async function PrivacyPage() {
  const t = await getTranslations();
  return <main className="thanks-page legal-page min-h-dvh safe-bottom">
    <nav className="thanks-nav safe-top"><Link className="calm-menu-button" href="/danke" aria-label={t("about.metadata.title")}><ArrowLeft size={19} /></Link></nav>
    <div className="about-section"><h1>{t("privacy.title")}</h1><p>{t("privacy.updated")}</p><PrivacyFlow />
      <section><h2>{t("privacy.purposes.title")}</h2>{(["map", "account", "contributions"] as const).map((key) => <p key={key}>{t(`privacy.purposes.${key}`)}</p>)}</section>
      <section><h2>{t("privacy.providers.title")}</h2><p>{t("privacy.providers.own")}{process.env.BENCHLY_HOSTING_COUNTRY && <> {t("privacy.providers.country", { country: process.env.BENCHLY_HOSTING_COUNTRY })}</>}</p><p>{t("privacy.providers.external")}</p>
        {process.env.BENCHLY_PRIVACY_INFRASTRUCTURE && <p>{process.env.BENCHLY_PRIVACY_INFRASTRUCTURE}</p>}
        <p>{t("privacy.providers.policies")} <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noreferrer">Cloudflare</a>, <a href="https://www.swisstopo.admin.ch/de/rechtliches" target="_blank" rel="noreferrer">swisstopo</a>, <a href="https://transport.opendata.ch/" target="_blank" rel="noreferrer">Transport API</a>. {t("privacy.providers.abroad")}</p>
      </section>
      <section><h2>{t("privacy.storage.title")}</h2><p>{t("privacy.storage.cookies")}</p><p>{t("privacy.storage.language")}</p><p>{t("privacy.storage.retention")}{process.env.BENCHLY_PRIVACY_RETENTION && <> {process.env.BENCHLY_PRIVACY_RETENTION}</>}</p><p>{t("privacy.storage.noTracking")}</p></section>
      <section><h2>{t("privacy.rights.title")}</h2><p>{t("privacy.rights.description")}</p></section>
      <OperatorContact /><p><Link href="/impressum">{t("about.links.imprint")}</Link> · <Link href="/danke">{t("about.links.project")}</Link></p>
    </div>
  </main>;
}
