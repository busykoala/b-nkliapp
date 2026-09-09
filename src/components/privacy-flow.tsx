"use client";
import { useState } from "react";
import { ArrowDown, Camera, Map, UserRound } from "lucide-react";

const journeys = [
  { key: "map", label: "Karte anschauen", icon: Map, steps: [
    ["Dein Gerät", "Die Standortfreigabe ist freiwillig. Einstellungen wie dein Gehtempo bleiben im Browser."],
    ["Karte & Wegsuche", "Kartenkacheln gehen direkt an swisstopo. Ein geplanter Weg sendet Start und Ziel an unseren Server; Adress- und Haltestellensuche nutzen zusätzlich GeoAdmin und die Transport API."],
    ["Kurze Pause im Speicher", "Routen mit persönlichen Endpunkten bleiben höchstens fünf Minuten im Arbeitsspeicher. Die App führt kein persönliches Bewegungsprotokoll."],
  ] },
  { key: "account", label: "Mit Konto", icon: UserRound, steps: [
    ["Dein gewählter Name", "Für ein Konto brauchst du einen Benutzernamen und ein Passwort. Das Passwort wird als gesalzener Hash gespeichert."],
    ["Dein Wanderbuch", "Beiträge und der Benutzername sind öffentlich. Gemerkte Bänkli und gefolgte Orte personalisieren deine Ansicht; deine Favoritenliste bleibt privat."],
    ["Wiederkommen", "Ein notwendiges Anmelde-Cookie hält dich bis zu 30 Tage angemeldet. Abmelden beendet diese Sitzung."],
  ] },
  { key: "photo", label: "Foto beitragen", icon: Camera, steps: [
    ["Ein Bänkli, bitte ohne Menschen", "Das Foto wird im Browser verkleinert und neu gespeichert. Dabei werden ursprüngliche EXIF-Metadaten nicht übernommen."],
    ["Bildprüfung auf unserem Modellserver", "Die KI prüft, ob Personen zu sehen sind. Unsichere Bilder werden abgelehnt. Diese Prüfung kann Fehler machen."],
    ["Dein Bild am Platz", "Freigegebene Fotos, Bildtexte und dein Benutzername sind öffentlich. Eigene Bildmomente kannst du am Bänkli wieder löschen."],
  ] },
] as const;

export function PrivacyFlow() {
  const [selected, setSelected] = useState(0);
  return <div className="privacy-flow">
    <div className="privacy-paths" aria-label="Datenweg auswählen">{journeys.map(({ key, label, icon: Icon }, index) => <button className="ui-button" key={key} aria-pressed={selected === index} onClick={() => setSelected(index)}><Icon size={17} />{label}</button>)}</div>
    <ol aria-label={`Datenweg: ${journeys[selected].label}`} aria-live="polite">{journeys[selected].steps.map(([title, description], index) => <li key={title}>{index > 0 && <ArrowDown className="flow-arrow" aria-hidden="true" size={23} />}<div><span aria-hidden="true">{index + 1}</span><h3>{title}</h3><p>{description}</p></div></li>)}</ol>
    <p className="privacy-flow-footnote">Bei jedem Seitenaufruf fallen technische Verbindungsdaten an, etwa eine IP-Adresse. Für Auslieferung und Schutz der Seite wird auch Cloudflare eingesetzt. Die App speichert für Missbrauchsschutz abgeleitete Kennungen statt roher IP-Adressen.</p>
  </div>;
}
