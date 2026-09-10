import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { OperatorContact } from "@/components/operator-contact";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const t = await getTranslations("legal");
  return { title: t("metadata.title") };
}

export default async function ImprintPage() {
  const t = await getTranslations();
  return <main className="thanks-page legal-page min-h-dvh safe-bottom">
    <nav className="thanks-nav safe-top"><Link className="calm-menu-button" href="/danke" aria-label={t("about.metadata.title")}><ArrowLeft size={19} /></Link></nav>
    <div className="about-section"><h1>{t("about.links.imprint")}</h1><p>{t("legal.introduction")}</p><OperatorContact />
      <section><h2>{t("legal.reliability.title")}</h2><p>{t("legal.reliability.description")}</p></section>
      <section><h2>{t("legal.rights.title")}</h2><p>{t.rich("legal.rights.description", { project: (chunks) => <Link href="/danke#mitmachen">{chunks}</Link> })}</p></section>
      <p><Link href="/datenschutz">{t("legal.privacyLink")}</Link></p>
    </div>
  </main>;
}
