import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ChevronDown, Code2, Database, Heart, ShieldCheck, Sparkles } from "lucide-react";
import { AppMenu } from "@/components/app-menu";
import { PrivacyFlow } from "@/components/privacy-flow";
import { dataCatalog } from "@/data/catalog";
import { sourceExplanations } from "@/data/source-explanations";
import { getCurrentUser } from "@/lib/security";

export const metadata: Metadata = { title: "Über die Bänkli App", description: "Wie aus offenen Daten ein guter Platz für eine Pause wird. Menschen, Methoden und Datenschutz." };
export const dynamic = "force-dynamic";
const github = "https://github.com/busykoala/b-nkliapp";

export default async function AboutPage() {
  const user = await getCurrentUser();
  const sources = dataCatalog.sources.filter(({ lifecycle }) => lifecycle !== "research-only");
  return <main className="thanks-page about-page min-h-dvh safe-bottom">
    <header className="thanks-nav safe-top"><Link href="/" aria-label="Zur Karte" className="calm-menu-button"><ArrowLeft size={19} /></Link><AppMenu user={user} /></header>
    <header className="thanks-hero"><span><Sparkles size={15} /> Viel Technik. Zum wenig Tun.</span><h1>Ein guter Platz<br />für eine Pause.</h1><p>Die Bänkli App verbindet offene Karten, ein bisschen KI und Menschen vor Ort. Damit du weisst, wo du dich als Nächstes hinsetzen möchtest.</p></header>
    <nav className="about-jump-links" aria-label="Auf dieser Seite"><a href="#so-gehts">So funktioniert’s</a><a href="#quellen">Datenquellen</a><a href="#datenschutz">Deine Daten</a><a href="#mitmachen">Mitmachen</a></nav>
    <section className="about-section" id="so-gehts"><h2>Von der Karte zur Pause</h2><p className="about-lead">Messen, schätzen, nachfragen. Die drei Dinge halten wir auseinander.</p>
      <div className="about-methods">
        <article><span>01</span><h3>Wo steht das Bänkli?</h3><p>Offene Karten und Inventare liefern Position und Ausstattung. Gemeindegrenzen helfen bei der Zuordnung. Ähnliche Bänkli in enger Nachbarschaft werden nur bei eindeutigen Hinweisen zusammengeführt.</p></article>
        <article><span>02</span><h3>Wann ist hier Sonne?</h3><p>Wir folgen dem Sonnenstand über den Tag. Berge, Gebäude und Baumkronen bilden den Horizont davor. Liegt die Sonne dahinter, erwarten wir Schatten. Wolken und wechselndes Laub bleiben zusätzliche Unsicherheiten.</p></article>
        <article><span>03</span><h3>Was könnte ich sehen?</h3><p>Gelände und Umgebung geben erste Hinweise. Die KI betrachtet passende Fotos und ergänzt sichtbare Merkmale. Eine nahe Wasserfläche oder ein einzelnes Bild genügt allein nicht für einen sicheren Seeblick.</p></article>
        <article><span>04</span><h3>Und stimmt das auch?</h3><p>Deine Beobachtung vor Ort hilft. Wir bewahren Herkunft, Alter und widersprüchliche Hinweise. Wo Daten fehlen, steht offen statt nein. Modellwerte bleiben Schätzungen – dein Lieblingsblick gehört weiterhin dir.</p></article>
      </div>
    </section>
    <section className="about-section" id="quellen"><div className="thanks-section-heading"><Database aria-hidden="true" /><div><small>Offen gelegt</small><h2>Was wir womit machen</h2></div></div><p>Ein kurzer Blick hinter jede Quelle. Welche Angaben an einer einzelnen Bank vorhanden sind, siehst du in ihren Details.</p>
      <div className="about-sources">{sources.map((source) => <details key={source.id}><summary><span><strong>{source.name}</strong><small>{source.provides[0]}</small></span><ChevronDown className="disclosure-chevron" size={18} /></summary><div><p>{sourceExplanations[source.id] ?? source.statusNote ?? source.provides.join(". ")}</p><p className="source-license">{source.license}</p><a href={source.url} target={source.url.startsWith("http") ? "_blank" : undefined} rel={source.url.startsWith("http") ? "noreferrer" : undefined}>Zur Quelle ↗</a></div></details>)}</div>
    </section>
    <section className="about-section" id="datenschutz"><div className="thanks-section-heading"><ShieldCheck aria-hidden="true" /><div><small>Kein Kleingedruckt-Labyrinth</small><h2>Wohin gehen deine Daten?</h2></div></div><p>Wähle, was du in der App machst. Der Weg darunter zeigt, was dabei passiert.</p><PrivacyFlow /><Link className="ui-button" href="/datenschutz">Datenschutz & Kontakt</Link></section>
    <section className="about-section" id="mitmachen"><div className="thanks-section-heading"><Code2 aria-hidden="true" /><div><small>Die Bank ist lang genug</small><h2>Mach’s dir zu eigen</h2></div></div><p>Fehler gefunden oder eine Idee? Code und Diskussionen sind öffentlich. Auch kleine Verbesserungen helfen.</p><div className="about-actions"><a className="ui-button" href={github} target="_blank" rel="noreferrer">Code & Beiträge ↗</a><a className="ui-button" href={`${github}/issues`} target="_blank" rel="noreferrer">Fehler oder Idee melden ↗</a></div>
      <div className="reuse-note"><h3>Daten mitnehmen? Sehr gern.</h3><p>Scrapen, forschen, neu bauen: Unsere öffentlichen Bänkli-Daten dürfen weiterverwendet werden. Bitte im Spaziergangstempo – der Server ist eine Parkbank, kein Hochgeschwindigkeitszug.</p><p>Eine Anfrage pro Sekunde, eine nach der anderen, zwischenspeichern und bei Fehlern oder einer 429-Antwort pausieren.</p><p>Die Lizenzen der Quellen reisen mit: etwa die ODbL bei OpenStreetMap und die Quellenangabe bei swisstopo. Fotos, Texte und Community-Beiträge gehören ihren Urheberinnen und Urhebern; eine pauschale Freigabe dafür können wir nicht erteilen. Private Kontodaten sind kein offener Datensatz.</p></div>
    </section>
    <section className="about-section" aria-labelledby="people-heading"><div className="thanks-section-heading"><Heart aria-hidden="true" /><div><small>Die Menschen dahinter</small><h2 id="people-heading">Danke fürs Bänkli.</h2></div></div><p>Stephan für die Idee, Matthias für die technische Umsetzung, Jonas fürs genaue Hinschauen. Und allen, die draussen sitzen, etwas entdecken und ihr Wissen teilen.</p></section>
    <footer className="about-footer"><Link href="/">Zur Karte</Link><Link href="/impressum">Kontakt & Impressum</Link><Link href="/datenschutz">Datenschutz</Link></footer>
  </main>;
}
