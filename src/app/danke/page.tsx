import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ChevronDown, Code2, Database, Heart, ShieldCheck, Sparkles } from "lucide-react";
import { AppMenu } from "@/components/app-menu";
import { PrivacyFlow } from "@/components/privacy-flow";
import { dataCatalog } from "@/data/catalog";
import { sourceExplanations } from "@/data/source-explanations";
import { getCurrentUser } from "@/lib/security";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("about.metadata");
  return { title: t("title"), description: t("description") };
}
export const dynamic = "force-dynamic";
const github = "https://github.com/busykoala/b-nkliapp";

export default async function AboutPage() {
  const t = await getTranslations();
  const user = await getCurrentUser();
  const sources = dataCatalog.sources.filter(({ lifecycle }) => lifecycle !== "research-only");
  return <main className="thanks-page about-page min-h-dvh safe-bottom">
    <header className="thanks-nav safe-top"><Link href="/" aria-label={t("common.navigation.map")} className="calm-menu-button"><ArrowLeft size={19} /></Link><AppMenu user={user} /></header>
    <header className="thanks-hero"><span><Sparkles size={15} /> {t("about.hero.eyebrow")}</span><h1> {t.rich("about.hero.title", { br: () => <br /> })}</h1><p>{t("about.hero.description")}</p></header>
    <nav className="about-jump-links" aria-label={t("about.navigation.label")}><a href="#so-gehts">{t("about.navigation.methods")}</a><a href="#quellen">{t("about.navigation.sources")}</a><a href="#datenschutz">{t("about.navigation.privacy")}</a><a href="#mitmachen">{t("about.navigation.contribute")}</a></nav>
    <section className="about-section" id="so-gehts"><h2>{t("about.methods.title")}</h2><p className="about-lead">{t("about.methods.introduction")}</p>
      <div className="about-methods">
        <article><span>01</span><h3>{t("about.methods.position.title")}</h3><p>{t("about.methods.position.description")}</p></article>
        <article><span>02</span><h3>{t("about.methods.sun.title")}</h3><p>{t("about.methods.sun.description")}</p></article>
        <article><span>03</span><h3>{t("about.methods.view.title")}</h3><p>{t("about.methods.view.description")}</p></article>
        <article><span>04</span><h3>{t("about.methods.evidence.title")}</h3><p>{t("about.methods.evidence.description")}</p></article>
      </div>
    </section>
    <section className="about-section" id="quellen"><div className="thanks-section-heading"><Database aria-hidden="true" /><div><small>{t("about.sources.eyebrow")}</small><h2>{t("about.sources.title")}</h2></div></div><p>{t("about.sources.introduction")}</p>
      <details className="about-source-catalog"><summary><span><span className="source-catalog-closed">{t("about.sources.catalog", { count: sources.length })}</span><span className="source-catalog-open">{t("about.sources.catalogOpen")}</span></span><ChevronDown className="disclosure-chevron" size={18} /></summary><div className="about-sources">{sources.map((source) => <details key={source.id}><summary><span><strong>{source.name}</strong><small>{sourceExplanations[source.id] && t(sourceExplanations[source.id]!.summary)}</small></span><ChevronDown className="disclosure-chevron" size={18} /></summary><div><p>{sourceExplanations[source.id] && t(sourceExplanations[source.id]!.description)}</p><p className="source-license">{source.license}</p><a href={source.url} target={source.url.startsWith("http") ? "_blank" : undefined} rel={source.url.startsWith("http") ? "noreferrer" : undefined}>{t("about.sources.link")}</a></div></details>)}</div></details>
    </section>
    <section className="about-section" id="datenschutz"><div className="thanks-section-heading"><ShieldCheck aria-hidden="true" /><div><small>{t("about.privacy.eyebrow")}</small><h2>{t("about.privacy.title")}</h2></div></div><p>{t("about.privacy.description")}</p><PrivacyFlow /><Link className="ui-button" href="/datenschutz">{t("about.privacy.link")}</Link></section>
    <section className="about-section" id="mitmachen"><div className="thanks-section-heading"><Code2 aria-hidden="true" /><div><small>{t("about.contribute.eyebrow")}</small><h2>{t("about.contribute.title")}</h2></div></div><p>{t("about.contribute.description")}</p><div className="about-actions"><a className="ui-button" href={github} target="_blank" rel="noreferrer">{t("about.contribute.code")}</a><a className="ui-button" href={`${github}/issues`} target="_blank" rel="noreferrer">{t("about.contribute.issues")}</a></div>
      <div className="reuse-note"><h3>{t("about.reuse.title")}</h3><p>{t("about.reuse.invitation")}</p><p>{t("about.reuse.pace")}</p><p>{t("about.reuse.rights")}</p></div>
    </section>
    <section className="about-section" aria-labelledby="people-heading"><div className="thanks-section-heading"><Heart aria-hidden="true" /><div><small>{t("about.people.eyebrow")}</small><h2 id="people-heading">{t("about.people.title")}</h2></div></div><p>{t("about.people.description")}</p></section>
    <footer className="about-footer"><Link href="/">{t("common.navigation.map")}</Link><Link href="/impressum">{t("about.links.imprint")}</Link><Link href="/datenschutz">{t("about.links.privacy")}</Link></footer>
  </main>;
}
