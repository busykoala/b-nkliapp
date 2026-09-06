# Entscheidungen zu zusätzlichen Umgebungsdaten

Stand: 6. September 2026. Der Datenkatalog bleibt die technische Quelle für
URLs, Lizenzen, Intervalle und Jobs. Diese Notiz erklärt die fachlichen
Entscheidungen und verhindert, dass «mehr Daten» automatisch «bessere Werte»
bedeutet.

## Produktiv verwendet

- **BAFU sonBASE Strassenlärm am Tag:** Das amtliche 10-m-Raster wird
  versioniert, grössenbegrenzt und atomar geladen. Der Landschaftsindex speichert
  den Rohwert und leitet daraus einen begrenzten Ruhe-Prior ab. NoData bleibt
  unbekannt. ASTRA- und kantonale Verkehrszahlen sind bereits Eingaben des
  sonBASE-Modells; eine zweite ASTRA-Wertung würde dieselbe Evidenz doppelt
  zählen und wird deshalb nicht eingeführt.
- **Baumkataster Zürich und Basel-Stadt:** Monatliche Punktimporte ergänzen
  Einzelbäume in den expliziten Stadtgrenzen. Zürichs Kronendurchmesser wird
  berücksichtigt. Ausserhalb der regionalen Abdeckung oder bei fehlendem Import
  gelten unverändert OSM, swissTLM3D und swissSURFACE3D. Ein Zürich→Basel-
  ML-Holdout verfehlte die lokale Kalibrierungsgrenze; direkte Geometrie ist die
  bessere Lösung.
- **Lokale und kantonale Modelle:** Ein Modell muss keinen schweizweiten Effekt
  haben. Ein nachweisbarer Gewinn in einer Stadt, einem Kanton oder einem klaren
  Landschaftsslice genügt, sofern ein räumlich getrennter lokaler Holdout die
  Qualitätsgrenzen erfüllt und die UI die begrenzte Abdeckung nicht verschleiert.
- **swissNAMES3D:** Die bestehende GeoAdmin-Ortssuche verwendet den
  `gazetteer`-Ursprung, der swissNAMES3D enthält. Für eine fehlende lokale
  Bänkli-Bezeichnung wird zusätzlich der nächste explizit als swissNAMES3D
  gekennzeichnete Treffer verwendet. ÖV-Haltestellen aus demselben Gazetteer
  werden nicht als Ortsname ausgegeben.
- **swissSURFACE3D/swissALTI3D:** Räumlich gebündelte Worker-Jobs laden nur die
  benötigten Kacheln und berechnen Gelände- und Oberflächenhorizont gemeinsam.
  Ergebnisse ohne vollständige Oberflächenabdeckung erhalten keine hohe
  Sicherheit. Die Abdeckung wächst resumierbar; eine nationale Rasterkopie wird
  nicht bloss für schnellere Vollständigkeit dauerhaft vorgehalten.

## Beobachtet, derzeit nicht als Wert importiert

- **STATPOP** beschreibt Urbanität, nicht Schönheit, Ruhe oder Aussicht. Die
  aktuelle Gebäude-/Strassen-Geometrie beantwortet die verwendeten Fragen
  direkter.
- **BAFU-Luftdaten** sind eine eigenständige Umweltinformation. Ohne ruhige,
  verständliche Produktdarstellung würden sie «Natürlichkeit» fachlich
  verfälschen.
- **Wanderland, ISOS und IVS** sind wertvolle Weg- und Kulturdaten. Für die
  aktuelle Spaziergangsrangfolge fehlt jedoch eine unabhängig geprüfte
  Verbesserung. GraphHopper/OSM liefern die erlaubte Fussgeometrie; ein
  undokumentierter Bonus würde die gleiche Wegeevidenz teilweise doppelt zählen.

Diese Quellen bleiben mit ihren Prüfintervallen im Katalog. Ein Import folgt
erst, wenn eine konkrete Anzeige oder ein gegen reale Vorschläge validiertes
Rankingmerkmal davon profitiert. Versionen zu prüfen ist billig; ungenutzte
Gigabytes zu importieren ist es nicht.

## Regionale Kandidaten

Die Baumkataster von Bern, Luzern und Winterthur wurden ebenfalls geprüft. Sie
sind fachlich passend, verwenden aber unterschiedliche WFS-/WMS-Modelle und
liefern gegenüber den nun produktiven Zürich-/Basel-Slices noch keine neue
Validierungsfrage. Sie werden nicht vorsorglich in einen generischen Importer
gepresst. Ein weiterer Adapter wird erst ergänzt, wenn dort genug aktive Bänkli
oder Community-Widersprüche einen messbaren Nutzen erwarten lassen.
