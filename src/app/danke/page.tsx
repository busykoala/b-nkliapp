import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Database, Heart, RefreshCw, Sparkles } from "lucide-react";
import { dataCatalog, sourcesFor } from "@/data/catalog";

export const metadata: Metadata = {
  title: "Danke, Daten & andere tragende Dinge",
  description: "Menschen, offene Daten und Software hinter der Bänkli App.",
};

export default function AcknowledgementsPage() {
  return <main className="thanks-page min-h-dvh safe-bottom">
    <nav className="thanks-nav safe-top"><Link href="/" aria-label="Zur Karte" className="calm-menu-button"><ArrowLeft size={19} /></Link></nav>
    <header className="thanks-hero">
      <span><Sparkles size={15} /> Vollkommen unverzichtbare Infrastruktur fürs Herumsitzen</span>
      <h1>Danke fürs<br />Bänkli.</h1>
      <p>Eine App, die mit erstaunlich viel Technik zuverlässig Orte findet, an denen man anschliessend möglichst wenig tut.</p>
    </header>

    <section className="thanks-people" aria-labelledby="people-heading">
      <div className="thanks-section-heading"><Heart aria-hidden="true" /><div><small>Die Menschen dahinter</small><h2 id="people-heading">Vier tragende Beine</h2></div></div>
      <div className="thanks-people-grid">
        <ThankYou name="Stephan" text="für die reizende Idee, Schweizer Sitzgelegenheiten den digitalen Ernst zu geben, den sie nie verlangt haben." />
        <ThankYou name="Matthias" text="für die technische Umsetzung – von Aquarellbergen bis zu Datenbanken, die deutlich weniger gemütlich sind als ein Bänkli." />
        <ThankYou name="Jonas" text="für grossartige Inputs, geduldiges Feedback und den Blick für all die Stellen, an denen ein Bänkli noch nicht bänklich genug war." />
        <ThankYou name="Community" text="für neue Plätze, Korrekturen, Bewertungen und jeden kleinen Beitrag. Ohne euch wäre das hier bloss eine sehr hübsche leere Karte." />
      </div>
    </section>

    <section className="thanks-data" aria-labelledby="sources-heading">
      <div className="thanks-section-heading"><Database aria-hidden="true" /><div><small>Was die Maschine weiss</small><h2 id="sources-heading">Daten & Werkzeuge</h2></div></div>
      <p className="thanks-lead">Diese Liste kommt direkt aus dem Datenkatalog der App. Ändert sich eine Quelle, ändert sich auch diese Seite – ganz ohne archäologische Expedition durch den Code.</p>
      <div className="source-grid">
        {dataCatalog.sources.map((source) => <article className="source-card" key={source.id}>
          <div><span>{source.kind}</span><h3>{source.name}</h3></div>
          <p>{source.provides.join(" · ")}</p>
          <small>{source.license}</small>
          {source.url.startsWith("/")
            ? <Link href={source.url}>Mehr dazu</Link>
            : <a href={source.url} target="_blank" rel="noreferrer">Zur Quelle ↗</a>}
        </article>)}
      </div>
    </section>

    <section className="thanks-refresh" aria-labelledby="refresh-heading">
      <div className="thanks-section-heading"><RefreshCw aria-hidden="true" /><div><small>Wann welches Rädchen dreht</small><h2 id="refresh-heading">Datenküche</h2></div></div>
      <p className="thanks-lead">Zeitzone {dataCatalog.timeZone}. Die Zeiten sind keine Dekoration: Dieselbe Konfiguration erzeugt die CronJobs im Cluster.</p>
      <div className="refresh-list">
        {dataCatalog.jobs.map((job) => <details key={job.id}>
          <summary><span><strong>{job.title}</strong><small>{job.frequency}</small></span><code>{job.schedule}</code></summary>
          <p>Kommt von {sourcesFor(job).map(({ name }) => name).join(", ")}.</p>
        </details>)}
      </div>
      <p className="thanks-version">Katalog {dataCatalog.catalogVersion} · Schema {dataCatalog.schemaVersion}. Ernsthaft gepflegt für ein Projekt über Pausen.</p>
    </section>
  </main>;
}

function ThankYou({ name, text }: { name: string; text: string }) {
  return <article><span aria-hidden="true">✦</span><h3>{name}</h3><p>{text}</p></article>;
}

