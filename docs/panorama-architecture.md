# Geografisches Bänkli-Panorama

Stand: 2026-09-12. Dieses Dokument hält Audit und Architekturentscheid für Phase A/B fest. Die aktuelle UI enthält bereits experimentelle Teile späterer Phasen; sie sind nicht der Massstab für die Vollständigkeit der geografischen Basis.

## 1. Bestehende Darstellung und Aufrufstellen

`BenchDetailContent` bindet genau eine Bildkomponente ein: `BenchPanorama`. Diese lädt serverseitig ein gecachtes 360°-SVG und fällt während Generierung oder bei Fehlern auf `BenchLandscape` zurück. `BenchLandscape` ist die ältere adaptive, aber generische Komposition. Es gibt keine zweite produktive Aufrufstelle.

Die Panorama-Interaktion verschiebt drei nahtlos wiederholte Kopien des Vollkreises. Die Initialrichtung ist die effektive beobachtete oder geschätzte Blickrichtung. Maus, Touch und Tastatur verändern nur den Crop und invalidieren keine Geometrie.

## 2. Bestehende Kunst und Stil

Die alten Ortsbilder (`place-city`, `place-village`, `place-forest`, `place-open`) kodieren einen generischen Ort. `relief-hills`/`relief-mountains` und `water-lake`/`water-river` sind ebenso generische Kulissen. Sie gehören nur in den temporären Fallback, nicht in ein berechnetes Panorama. Das bisherige vollständige `shelter.webp` wirkt als freigestelltes Objekt und wird in der neuen Hauptansicht nicht verwendet.

Behalten werden können Papier-, Wasser-, Berg- und Dachpigment-Texturen sowie die zurückhaltenden Wolken-, Sonnen- und Mond-Washes. Die alte Bankfamilie zeigt Bänke überwiegend von vorne oder schräg. Nur `bench-rear-watercolor-v2.webp` ist eine echte Rückansicht; sie deckt aber nur Holz mit Rückenlehne ab und ist deshalb keine vollständige Phase-C-Lösung.

Der Benchly-Stil besteht aus warmem Papiergrund, Salbei-/Tannengrün, gedämpftem Blau, Ocker und Terrakotta, weichen transparenten Farbwashes, feinen unregelmässigen Kanten, geringer Sättigung und schwacher kühler Verschattung. Details nehmen mit Distanz ab. Gebäude dürfen geometrisch korrekt, aber nie wie CAD oder Fototexturen wirken.

## 3. Bereits verfügbare Eingaben

- Sonne/Mond: berechnete Azimut- und Höhenwinkel, Tagesphase, Mond-Sichtbarkeit und Mondphase liegen im `BenchDetail` vor.
- Banklicht: `sunnyNow`, Sonnenfenster und die bestehende Hindernis-/Horizontanalyse sind vorhanden. Bewölkung ist davon getrennt zu behandeln.
- Wetter: Bewölkung, Niederschlagsart, Temperatur sowie Aktualität liegen vor.
- Bank: Rücken-/Armlehne, Material und Schutzdach sind als normalisierte Eigenschaften verfügbar.
- Blickrichtung: beobachtete Richtung gewinnt vor veröffentlichter Schätzung; der teure Vollkreis ist richtungsneutral.
- Gebäude: nationale swissTLM3D- und OSM-Fussabdrücke sind indexiert. OSM-Höhen sind lückenhaft. swissBUILDINGS3D-Importcode besteht, in Produktion sind aber noch keine Zellen importiert.
- Terrain/Oberfläche: ein swissALTI3D-Rastercache und ein kleiner swissSURFACE3D-Cache bestehen. Der Höhenbestand ist noch nicht national vollständig.
- Semantik: TLM-/OSM-Flächen für Wasser, Wald, Fels, Gletscher, Siedlung und verschiedene offene Nutzungen sind räumlich indexiert.

## 4. Phase-A/B-Vertrag

`PanoramaGeometry` ist ein versionierter, vollständiger Kreis. Pro 0,1°-Spalte hält er sichtbare, tiefengeprüfte Winkelintervalle mit Distanz, Terrainhöhe, Semantik, Quelle und Konfidenz. Zusätzlich werden innere Geländekanten mit Distanz und Kantenart gespeichert. Gebäude behalten ID, Grundriss, Boden-, Trauf- und Firsthöhe, Quellenqualität sowie eine aus den Sichtstrahlen abgeleitete Projektion. Wetter, Palette, Bildgrösse, Blickrichtung und Banktyp gehören nicht in diesen Vertrag.

Die Semantikpriorität ist: Wasser/Fluss vor Gebäude vor Wald vor Fels/Gletscher vor offenem Boden vor unbekanntem Terrain. Gebäude werden als diskrete Massen tiefengeprüft und nicht als Bodenklasse in das Geländeraster gebacken.

## 5. Datenfluss

1. Einen Bank-Snapshot mit Koordinate, Bodenhöhe und Quellversionen lesen.
2. Einmal pro Ansicht alle benötigten Geopunkte für den 360°-LOD-Abstandsplan berechnen.
3. Höhen gebündelt pro Rastertile lesen; keine einzelne Datenbank- oder WMS-Abfrage pro Strahl.
4. Semantische Kandidaten einmal räumlich laden und alle Punkte über einen STRtree klassifizieren.
5. Nur Gebäude im konfigurierten Radius laden, nach Quelle deduplizieren, einmal nach LV95 transformieren und distanzabhängig vereinfachen.
6. Terrain-Sichtbarkeit mit Erdkrümmung und Refraktion aufbauen. Nahe Höhen verdecken tiefere Fernhöhen; sichtbare Flächen unter der Skyline bleiben erhalten.
7. Gebäude pro Strahl als Grund-/Trauf-/Dachwinkel projizieren und gemeinsam mit Terrain sowie anderen Gebäuden nach Tiefe zusammensetzen.
8. Ein versioniertes Geometrieartefakt atomar schreiben.
9. Daraus einen deterministischen, richtungsneutralen Aquarell-Vollkreis rendern. Der Browser croppt ihn auf die Bankrichtung.

## 6. Quellenpriorität für Gebäude

1. swissBUILDINGS3D mit nutzbarer Boden-/Trauf-/Dachhöhe;
2. OSM/TLM-Fussabdruck mit zuverlässiger expliziter Höhe;
3. Fussabdruck mit aus swissSURFACE3D gegen swissALTI3D abgeleiteter Höhe;
4. Fussabdruck mit konservativer, als unsicher markierter Standardhöhe;
5. reine Oberflächenobstruktion ohne erfundene Architektur;
6. kein Gebäude und reduzierte Vollständigkeit/Konfidenz.

Eine komplexe Dachform wird nur bei entsprechender Geometrie übernommen. Sonst bleibt das Dach absichtlich flach oder geometrisch neutral.

## 7. Sichtbarkeit und Geländekanten

Der Phase-B-Kern bleibt ein deterministischer Winkel-/Tiefenpuffer statt eines 3D-Engines. Für jede Richtung steigt eine Sichtbarkeitshülle von nah nach fern. Jeder Anstieg erzeugt eine sichtbare Fläche; ihre obere Kante ist entweder eine innere Geländekante oder die äussere Skyline. So können Grate innerhalb eines Bergmassivs sichtbar werden und nicht nur dessen Horizontkontur.

Gebäude schneiden dieselben Winkelintervalle. Pro Intervall gewinnt die nächste Geometrie. Dadurch verdeckt ein nahes Haus einen Berg, ein naher Hügel ein Haus dahinter und ein nahes Haus ein weiter entferntes Haus. Die Gebäudesilhouette folgt den projizierten Trauf-/Dachhöhen; Fenster und Türen sind nicht Teil des Geometrievertrags.

## 8. Caches und Speicher

Cache A enthält gzip-komprimierte Geometrie und wird adressiert durch Standort, Boden-/Augenhöhe, Algorithmus, DTM-, Semantik-, Gebäude- und Oberflächenversion, LOD sowie Suchradien. Cache B enthält die deterministische Darstellung und wird durch Geometrieschlüssel, Stilversion, Ausgabeparameter und – in späteren Phasen – Wetter-, Licht- und Bankvarianten adressiert. Beide werden atomar geschrieben. In SQLite liegen nur Zustand, Schlüssel, Provenienz, Grössen und Pfade.

Die Produktions-DB ist bereits ungefähr 19,8 GB gross. Nationale Raster und 3D-Geometrie werden deshalb nicht als grosse Blobs darin abgelegt.

## 9. swissBUILDINGS3D-Entscheid

Die offizielle Vollabdeckung benötigt ungefähr 50–55 GB Rohdownload. swissALTI3D benötigt offiziell ungefähr 44 GB für rund 43'500 1-km²-Kacheln. Eine schweizweite Gebäudenormalisierung soll in ein separates gekacheltes Laufzeitformat erfolgen. Die erwarteten 5–15 GB normalisiert sind nur eine Planungsspanne; eine repräsentative Stadt-, Dorf- und Alpental-Pilotmenge muss Kompressionsrate und CPU-Zeit messen, bevor der Vollimport freigegeben wird.

Preprocessing ist I/O- und Geometrie-lastig, aber einmalig/resumierbar. Renderzeit liest nur wenige angrenzende Indexkacheln; weder FileGDB noch nationale Geometrie werden pro Bank geöffnet. Updates erzeugen ein neues Manifest, normalisieren nur geänderte Quellkacheln und schalten nach Validierung atomar auf die neue Version.

Für Phase B reichen die bereits indexierten OSM-/TLM-Fussabdrücke plus konservative Höhen aus, um Position, Massierung und Occlusion zu validieren. swissSURFACE3D kann fehlende Höhen verbessern. Für verlässliche Dachsilhouetten und hohe Abdeckung ist swissBUILDINGS3D in Phase F dennoch sinnvoll.

## 10. Renderer

Die Reihenfolge lautet Papier und Himmel, ferne zu nahe Terrainflächen, semantische Washes, sichtbare Gebäude, innere Grate und Architekturkanten, atmosphärischer Schleier und Papierkorn. Der Nahbereich endet immer in einer neutralen, sand-/wegartigen Sitzfläche; Wasser wird nicht bis unter die Bank gezogen. Standortnamen und generische Stadt-/Dorfzeichen werden nicht gerendert.

Phase B nutzt kontrollierte Farben und einfache Wäschen. Wetter, Himmelskörper, Bank, Schutzdach und endgültige Pigmentqualität bleiben getrennte Folgephasen, damit geografische Fehler nicht durch Dekoration kaschiert werden.

## 11. Dateien und Deployment

- `worker/benchly/panorama/models.py`: versionierter Vertrag.
- `datasets.py`: LOD-Höhen, Semantik und Gebäudeadapter.
- `visibility.py`: Sichtbarkeits-/Tiefenberechnung und Kanten.
- `watercolor.py`: deterministischer Phase-B-Renderer.
- `cache.py`, `repository.py`, `jobs.py`: Cacheidentität, Zustände, Provenienz und Instrumentierung.
- `src/features/bench-panorama/*`, `src/app/actions/panorama.ts`: private Artefaktauslieferung und Anforderung.
- `src/components/bench-panorama.tsx`: Richtungscrop und später die Präsentationsebenen.

Eine Geometrieversionsänderung macht alte Artefakte nicht gefährlich: Sie bleiben als vorherige Ansicht lesbar, während der Worker neu rechnet. Die reguläre CI führt keine nationalen Downloads oder schweren Backfills aus. Migrationen betreffen nur kleine Metadatentabellen.

## 12. Risiken und Phasen

Offen sind vollständige DTM-Abdeckung, ein geeignetes grenzüberschreitendes Fern-DEM, tatsächliche swissBUILDINGS3D-Normalisierungsgrösse, fehlende Gebäudedachattribute, lokale Vegetationsqualität und das Laufzeitbudget der 0,1°-Strahlen. Alle Pipeline-Stufen werden einzeln gemessen; unvollständige Quellen erzeugen partielle Resultate statt erfundener Landschaft.

- Phase A: dieses Audit, Verträge, Quellen-/Cacheentscheid und Ingestion-Tests.
- Phase B: Terrain-/Semantik-/Gebäudesichtbarkeit, innere Geländekanten, einfacher Aquarell-Vollkreis und Richtungscrop.
- Phase C: vollständige Rückansicht-Bankfamilie und produktive Ersetzung mit Fallback.
- Phase D: Sonnen-/Gebäudeschatten, Mondphase, deterministische Bewölkung/Niederschlag und Traufe.
- Phase E: Pigment, Tiefe, Vegetation, Gebäudewash und visuelle Referenzmatrix.
- Phase F: nationale Indizes, Backfill, Monitoring, Speicherpflege und Deploymentbetrieb.

## 13. Quellen und Aktualisierung

- [swissALTI3D](https://www.swisstopo.admin.ch/en/height-model-swissalti3d): 2-m-COGs, landesweit rund 44 GB; regionale Aktualisierung im Sechsjahreszyklus.
- [swissBUILDINGS3D 3.0 Beta](https://www.swisstopo.admin.ch/en/landscape-model-swissbuildings3d-3-0-beta): landesweit rund 50–55 GB; Regionen werden zweimal jährlich publiziert, Gesamterneuerung ungefähr alle drei Jahre.
- [swissTLMRegio](https://www.swisstopo.admin.ch/en/landscape-model-swisstlmregio): homogene, generalisierte Fernbereichsgeometrie mit ungefähr 20–60 m Lagegenauigkeit.

Jedes erzeugte Artefakt hält seine konkreten Quellenstände. Die sichtbare Produktinformation lautet sinngemäss: „Berechnete Aussicht aus Gelände-, Landschafts- und Gebäudedaten; kein Foto. Details können fehlen.“
