import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { OperatorContact } from "@/components/operator-contact";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kontakt & Impressum · Bänkli App" };
export default function ImprintPage() {
  return <main className="thanks-page legal-page min-h-dvh safe-bottom">
    <nav className="thanks-nav safe-top"><Link className="calm-menu-button" href="/danke" aria-label="Über die Bänkli App"><ArrowLeft size={19} /></Link></nav>
    <div className="about-section"><h1>Kontakt & Impressum</h1><p>Ein offenes Projekt für Pausen auf Schweizer Bänkli.</p><OperatorContact />
      <section><h2>Eine Bank ist kein Versprechen</h2><p>Angaben können fehlen oder veraltet sein. Sonne, Aussicht, Wege und Fahrzeiten sind teilweise berechnet. Bitte beachte die Lage und Beschilderung vor Ort.</p></section>
      <section><h2>Offene Daten, eigene Rechte</h2><p>Die Nutzungsrechte der einzelnen Daten- und Bildquellen gelten weiter. Unsere Hinweise zur Weiterverwendung und alle Quellen findest du <Link href="/danke#mitmachen">auf der Projektseite</Link>.</p></section>
      <p><Link href="/datenschutz">So gehen wir mit deinen Daten um</Link></p>
    </div>
  </main>;
}
