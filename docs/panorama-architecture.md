# Geografisches Landschaftsaquarell-Panorama

Stand: 2026-09-13. Dieser Vertrag beschreibt den v20-Cutover und trennt ausgelieferte Software von der noch laufenden nationalen Datenaufbereitung.

## Produktvertrag

Im Bänkli-Overlay gibt es keine generische Ersatzlandschaft mehr. Angezeigt werden ausschliesslich ein geografisches v20-WebP, ein während einer Erneuerung weiter nutzbares v20-WebP oder ein neutraler warmer Papierwash. Ältere Renderstile und die frühere `BenchLandscape`-Komposition werden nicht mehr gelesen.

`PanoramaDescriptor` unterscheidet `ready`, `generating`, `stale`, `unavailable` und `error`. `stale` behält das letzte geografische v20-Bild sichtbar. Artefakte werden über eine gleichoriginige, schlüsselvalidierte Media-Route mit ETag und unveränderlichem Cache-Header gestreamt; Server Actions liefern nur Status und Metadaten.

Maus, Touch und Tastatur verschieben den Vollkreis endlos horizontal und innerhalb des vertikalen Overscans. Die erste Ansicht zeigt in die effektive beobachtete oder geschätzte Bänklirichtung. Der Share-Link bleibt die konkrete Bank-URL.

## Geometrie v4

Die geografische Basis ist ein richtungsneutraler Vollkreis mit 0,1°-Spalten. Pro Spalte werden tiefengeprüfte sichtbare Intervalle mit Distanz, Höhe, Semantik, Quelle und Konfidenz gehalten. Der Vertrag enthält ausserdem Skyline, innere Grate, Distanzschichten und sichtbare Gebäude-IDs mit Wand-, Trauf- und Dachprojektion. Die diskreten Intervalle sind das kompakte polare Geländemesh; beim Rendern entstehen daraus zusammenhängende Flächenmasken und ein Tiefenpuffer.

Die Sichtbarkeitshülle steigt von nah nach fern. Ein neuer Höhenanstieg bildet eine sichtbare Fläche, nicht nur einen Horizontpunkt. Nahe Flächen verdecken fernere; dieselbe Tiefenkomposition gilt für Terrain und Gebäude. Innere Grate werden nach Distanzschicht verbunden und bleiben sichtbar, wenn sie unter der äusseren Skyline liegen.

Semantikpriorität: Wasser/Fluss, Gebäude, Wald, Fels/Gletscher, offener Boden, unbekanntes Terrain. Fehlende Strahlen bleiben leer und reduzieren die Quellenvollständigkeit; es wird keine Geografie erfunden.

Gebäude kommen aus swissBUILDINGS3D, sofern normalisierte Zellen vorhanden sind, sonst aus TLM-/OSM-Fussabdrücken. Unter 500 m werden getrennte Wand-, Trauf- und Dachflächen gemalt, bis 2 km vereinfachte Körper, danach zurückhaltende Siedlungswashes. Unbekannte Dächer bleiben konservativ flach. Wald wird als geschlossene Masse dargestellt. Wasser bleibt auf tatsächliche Masken begrenzt und erhält ruhige horizontale Tonstufen und Uferpigment.

## Aquarell-Renderer v20

Der Pillow-Renderer malt deterministisch auf einer weicheren internen Arbeitsfläche und skaliert mit Lanczos auf 4096 × 1024. Er rastert nur so viele Winkelspalten, wie diese Arbeitsfläche tatsächlich darstellen kann, und verwendet gemeinsame Pigmentfelder. Dadurch bleiben Konturen erhalten, während Maskenaufbau und WebP-Encoding deutlich weniger Arbeit benötigen. Der Cache-Schlüssel bindet Geometrie, Saison, Stil und Ausgabeformat ein.

Ferne Distanzschichten werden heller, kühler, entsättigter und weicher. Nahe Flächen bleiben wärmer und kontrastreicher. Mehrere leicht versetzte transparente Washes, zusammenhängende Landbloom- und Kronenmassen, Uferpigment, innere Grate und einmaliges Papierkorn erzeugen die Malwirkung ohne wiederholte Texturkacheln. Felder sind ruhig, Wald bleibt flächig, Wasser besitzt eine vertikale Tiefenstaffelung und Häuser sind kohärente Körper. Es gibt keinen erfundenen Vollbreiten-Vordergrund mehr. Nur direkt unter der im Browser komponierten Bank liegt ein kleiner erd-/sandfarbener Wash für sicheren Bodenkontakt.

Gleiche Geometrie, Saison und Stilversion erzeugen byte-identische WebPs. Die 360°-Naht wird in allen Blur- und Maskenoperationen umlaufend behandelt.

## Licht, Wetter und Saison

Die langlebige geografische Basis bleibt neutral. Ein kurzlebiges 2048 × 512-Graustufen-WebP enthält gerichtete Beleuchtung für einen auf zehn Minuten gerundeten Sonnenvektor und läuft nach 48 Stunden ab. Hangneigung, Sonnenrichtung, sichtbare Horizonte, Gebäude und Distanzweichzeichnung steuern die Näherung; die Karten werden weich gefiltert, damit Datenfehler keine künstlich harten Kanten erzeugen. `sunnyNow` und `shadeCause` verhindern eine Direktlichtkante am Bänkli, wenn Standortanalyse oder Schutzdach Schatten melden.

Der Browser legt warmes Direktlicht und kühles diffuses Licht über die Basis. Der Bänklischatten zeigt vom Sonnenazimut weg und wird bei tiefer Sonne länger. Ein Schutzdach erhält einen eigenen weichen Bodenschatten. Ohne fertige Lichtkarte bleibt die Szene neutral diffus.

Hohe, mittlere und tiefe Wolken sind getrennte, nicht gekachelte Wash-Felder. Bis 35 % Bewölkung bleiben Schatten lesbar, zwischen 35 und 65 % werden sie weich und kontrastarm, ab 80 % bleibt fast nur diffuses Licht. Sonne und Mond benutzen reale Azimut-/Höhenwerte und die Mondphase; eine geografisch oder stark durch Wolken verdeckte Sonne wird nicht als klarer Kreis gezeigt. Regen und Schnee richten sich nur nach aktuellen Wetterwerten. Bodenaufhellung erscheint nur bei gemeldeter Schneedecke oder -tiefe. Fehlendes Wetter erzeugt keine erfundene Bewölkung oder Niederschlag. Alle Animationen respektieren `prefers-reduced-motion`.

## Bänkli-Familie

Unter `public/ui-art/panorama/benches/` liegen 13 transparente, stilistisch zusammengehörige Rückansichten: Holz, Metall, Stein/Beton und Kunststoff, jeweils mit Rückenlehne plus Armlehnen, nur Rückenlehne und ohne Rückenlehne, dazu eine neutrale Variante. Unbekannte Armlehnen werden nicht gezeigt. Die Varianten teilen Perspektive, Massstab und Fussposition; Licht, Bodenkontakt und Schatten entstehen dynamisch. Ein Schutzdach erscheint nur bei `covered=yes`.

Diese projektgebundenen Rasterassets wurden mit der eingebauten Bildgenerierung erzeugt und anschliessend auf Transparenz und gemeinsame Grundlinie normalisiert. Landschaft, Wetter und Licht werden nie generativ erzeugt.

## Queue, Cache und Betrieb

Migration `0033_panorama_artifacts_v2` ergänzt WebP-/Saison-/Manifest-/Vollständigkeitsfelder, Queue-Priorität, Lease, Retry-Zeit und eine Lichtkartentabelle. Geometrie liegt atomar als kompaktes NPZ, v20-Basisbilder unter `renders-v20/`, Lichtkarten unter `lightmaps-v1/`; SQLite hält nur Zustand, Schlüssel, Provenienz und Pfade. Ein Stilwechsel invalidiert deshalb nur das schnelle Gemälde, nicht die geografische Geometrie.

Ein permanentes Worker-Deployment betreibt vier disjunkte Prozess-Shards. UI-Anfragen gewinnen durch Request-Priorität, danach folgen Backfill-Zeilen. Abgelaufene Leases werden wieder aufgenommen und abgelaufene Lichtkarten bei jedem Lauf aus Datenbank und Dateisystem entfernt. Nationale Downloads und Backfills laufen ausdrücklich ausserhalb der Release-CI.

Der vorhandene lokale Datenträger bietet deutlich mehr als die geplanten 250 GiB freien Platz. Deshalb wird für den Cutover kein zweiter statischer PV angelegt: ein PVC-Wechsel würde ohne Kapazitätsgewinn ein unnötiges Daten- und Rolloutrisiko erzeugen. Der bestehende Datenträger bleibt erhalten, bis nationale Quellen und Backfill validiert sind.

## Lokale Iteration und Review

`render-panorama-fixtures` installiert bereits gecachte Geometrie in eine lokale Datenbank, rendert die Basis und erzeugt ohne Netzwerkzugriff neun feste Licht-/Wetterfälle. Die beiden Referenzen `osm-node-4998419683` und `osm-node-5795964447` liegen gitignoriert im lokalen Fixture-Cache. Damit laufen Renderer-Iterationen auf `localhost:3002`, ohne Clusterzugriff oder Push.

Geprüft werden 390 px, 430 px und 1440 px, endloses Ziehen, der von 16 auf 36 Prozent erhöhte vertikale Overscan, Bänklirichtung, 360°-Naht, Gebäude-/Wasser-/Waldmassen, innere Grate, atmosphärische Tiefe, lokaler Bodenkontakt, Wetter, Mondphase und Schattenrichtung. Synthetische Tests decken Tiefenverdeckung, Geländegrate, deterministische WebPs, semantischen Vordergrund, Lichtkarten, niedrige/hohe Sonne und Bewölkungsreduktion ab.

Auf identischer lokaler Hardware sank der Median für ein ungecachtes 4096 × 1024-Aquarell bei `osm-node-4998419683` von 566 ms auf 221 ms und bei `osm-node-5795964447` von 835 ms auf 300 ms. Einschliesslich unverändertem Geometrie-Decoding sank der lokale End-to-End-Median von 683 auf 338 ms beziehungsweise von 1’033 auf 498 ms – 50,5 und 51,8 Prozent. Horizontales oder vertikales Verschieben löst weiterhin weder Geometrie- noch Renderarbeit aus. Der maximale Raster-Abtastfehler beträgt horizontal und vertikal je rund 0,142°, deutlich unter einem Ausgabepixel im UI. Der mittlere Farbfehler an der realen 360°-Naht beträgt bei den beiden Bildern nur 1,11 beziehungsweise 1,47 von 255; ein gecachtes WebP wird im Median in 0,014 beziehungsweise 0,015 ms gelesen.

Das Vorher-Profil zeigte Maskenaufbau (272 ms), Washes (127 ms) und WebP-Encoding (125 ms) als eigentliche Stil-Bottlenecks. v20 rastert nur darstellbare Winkelspalten, erzeugt Masken lazy, teilt deterministische Pigmentfelder zwischen Washes und verwendet den schnelleren WebP-Pfad. Der lokale Review deckt mit drei realen Blickrichtungen Dorf, See/Alpen und Wald ab. Verbleibende Kosten sind primär das Decoding der grossen Geometrie (rund 117/198 ms) und der Maskenaufbau; Remote-Quelldownloads sind bewusst nicht Teil dieses Offline-Benchmarks und bleiben durch den bestehenden persistenten Quell- und Geometriecache vom Stilrender getrennt.

## Quellendaten und verbleibende Phase-F-Arbeit

Die Softwarepfade für swissALTI3D, regionales Terrain, grenzüberschreitendes Terrain, TLM-/OSM-Semantik, swissBUILDINGS3D und swissSURFACE3D sind versioniert und resumierbar. Die folgenden Punkte sind Betriebsarbeit und werden nicht durch einen Code-Deploy vorgetäuscht:

- swissALTI3D national als 2/10/30/90-m-Pyramide vervollständigen;
- Copernicus GLO-90 und swissTLMRegio für den Grenz-/Fernbereich fertig normalisieren;
- swissBUILDINGS3D kachelweise importieren und Roharchive erst nach Prüfsummen- und Stichprobenkontrolle entfernen;
- Alpen-, Jura-, See-, Tal-, Wald-, Dorf- und Stadtreferenzen im Review-Satz ergänzen;
- p95-Zeiten und die 99-%-Abdeckung während des nationalen Backfills messen, nicht schätzen.

Unvollständige Quellen erzeugen weiterhin ein als `partial` markiertes geografisches Bild. Wo selbst dafür keine belastbare Basis vorhanden ist, zeigt die UI nur Papierwash und Retry – niemals eine dekorativ erfundene Landschaft.

## Live-Freigabe 2026-09-13

Migration `0033` und das permanente Vier-Prozess-Deployment sind produktiv. Vor dem v20-Cutover lieferten beide Referenzbänkli v19-Basisbild und Lichtkarte über die gleichoriginige Media-Route als WebP mit ETag und unveränderlichem Cache-Header. Mobile und Desktop wurden live geprüft; Tastatur sowie kombinierter horizontaler und vertikaler Mauszug verändern die Ansicht ohne Reload. Der priorisierte Worker reserviert pro Prozess nur noch ein Bänkli und prüft danach die UI-Queue erneut.

Der nationale Backfill bleibt eine laufende Betriebsaufgabe. Bei der v19-Freigabe waren 172 Basisbilder und 172 Lichtkarten fertig; diese Zahl ist ausdrücklich kein Nachweis des 99-%-Ziels. v20 verwendet die vorhandene v4-Geometrie weiter und erzeugt nur neue Gemälde.
