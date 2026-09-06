# Bänkli-Wissen verbessern

Diese Liste ist der überprüfbare Umsetzungsstand. Ein Punkt wird erst mit `[x]`
markiert, wenn Implementierung und passende Prüfung abgeschlossen sind.

## Leitplanken

- [x] Automatisch absichern, dass produktiv aktivierte Quellen Open Data sind; Quellen tragen eine validierte Zugriffsklasse und Produktionsjobs dürfen keine reine Evaluationsquelle referenzieren (Python-/TypeScript-Test).
- [x] Experimente sind temporär. Es gibt kein dauerhaftes `worker/benchly/experiments`-Verzeichnis und keine eingecheckten, folgenlosen Resultate.
- [x] App und Worker bleiben in diesem Repository; Datenbank-, GraphHopper- und mögliche GPU-Infrastruktur gehören nach `../server`.

## 1. Ruhige Community-Aktionen

- [x] Lichtfrage für eingeloggte Personen direkt im Lichtabschnitt im mobilen Chromium abnehmen und per Screenshot prüfen.
- [x] Sonne, Schatten und Wechselhaft samt Speichern und Rückgängig im mobilen Browser prüfen.
- [x] Lichtfrage nachts ausblenden und stattdessen den ruhigen Tageslicht-Hinweis im mobilen Browser prüfen.
- [x] Wiederholte Lichtmeldungen derselben Person im Trend auf die neueste vergleichbare Meldung reduzieren und mit Repository-Test belegen.
- [x] Aussicht mit „Passt ungefähr“ oder „Anders erlebt“ im mobilen Browser und per Screenshot abnehmen.
- [x] Vier kurze Korrekturschritte samt Fokusführung und Zurück-Navigation im E2E-Ablauf prüfen.
- [x] Eigene Aussicht unmittelbar anzeigen; öffentliche Lichttrends erst ab drei Personen integrieren und per Browser-/Repository-Test prüfen.
- [x] Community-Evidenz getrennt von Bänkli-Stammdaten speichern.
- [x] Freie Blickrichtungen und Himmelsoffenheit im reinen Aggregationsmodell getrennt berechnen (Unit-Test).
- [x] Objektive Priors und Community-Korrekturen im reinen Modell vorsichtig zusammenführen (Unit-Test).
- [x] Neuberechnete Community-Werte mit einer echten Detailansicht und drei Testpersonen verifizieren; Herkunft und vorsichtige Konfidenz sind auch ausgeloggt sichtbar.
- [x] Lichtbeobachtungen serverseitig anhand des Sonnenstands am Bänkli gegen Nacht absichern und den Kontext per Unit-Test prüfen.
- [x] UI-/E2E-Tests für Login-Grenze, Lichtmeldung, Aussichtsdialog, Löschen und Rückgängig ergänzen (4 mobile Community-Flows).

## 2. Evidenz und Datenquellen

- [x] Beta-/Dirichlet-artiges Shrinkage und unterschiedliche Prior-Gewichte implementieren.
- [x] Wasserbeobachtung als Sichtbarkeitskorrektur behandeln, nicht als Existenzbeweis.
- [x] Quellen-, Community- und Konfidenzinformation über Speicherung, Action und UI hinweg verifizieren.
- [x] Zentralen, Pydantic-validierten Datenkatalog für Anbieter, Versionen, Intervalle, Artefakte und Konsumenten einführen.
- [x] CronJob- und Laufzeitkonfiguration aus dem Datenkatalog generieren.
- [x] Danksagungsseite aus dem Katalog im Browser prüfen; Personen, Community, Datenquellen und GraphHopper sind sichtbar.
- [x] sonBASE, swissSURFACE3D, swissNAMES3D, STATPOP, ASTRA, BAFU-Luftdaten, Wanderland, ISOS und IVS katalogisieren.
- [x] sonBASE als rohe, NoData-sichere Störungsevidenz importieren; ASTRA nicht doppelt werten, weil die Verkehrszahlen bereits in sonBASE einfliessen.
- [x] swissSURFACE3D gemeinsam mit swissALTI3D kachelweise für Horizont und Schatten auswerten; ohne vollständige Oberflächenabdeckung bleibt die Sicherheit ehrlich reduziert.
- [x] swissNAMES3D über die GeoAdmin-Gazetteer-Suche und belegte nahe Ortsbeschreibungen integrieren.
- [x] STATPOP, BAFU-Luftdaten, Wanderland, ISOS und IVS fachlich gegen den aktuellen Bedarf prüfen; mangels belegtem Zusatznutzen nicht importieren und keine bestehende Evidenz doppelt zählen.
- [x] Aktualität und letzter erfolgreicher Import der katalogisierten Quellen öffentlich auf der Danksagungs-/Datenseite und operativ im Statusartefakt sichtbar machen.

## 3. Python- und Codearchitektur

- [x] Root-`pyproject.toml`, `uv.lock` und `pytest`-Tests unter `worker/tests` einführen.
- [x] Grossen Worker-Einstieg in dünne CLI und vertikale Jobs zerlegen.
- [x] Transit-, Landschafts- und Wetterpipeline in ihre Feature-Slices verschieben.
- [x] Pydantic-Abdeckung aller externen Verträge prüfen; STAC, Commons, GTFS-Katalog, Wetter, GeoJSON, Geländeprofil und Inference werden an der jeweiligen Feature-Grenze validiert.
- [x] SQLModel-Modelle und Repositories für Python-Schreibvorgänge verwenden.
- [x] Raw-`INSERT`, `UPDATE` und Schema-Schreibstatements ausserhalb der Repositories entfernen und per Architekturtest verhindern.
- [x] Unnötige `.mjs`-Skripte und veraltete Test-/Requirements-Einstiege entfernen.
- [x] Container-Test als Target des produktiven Worker-Dockerfiles definieren; keine Dockerdateien unter `worker/tests`.
- [x] Bildanalyse in konkrete Module für Inference-Client, Analyse-Orchestrierung und Qualitätsprüfung zerlegen; die vollständige Worker-Suite besteht.
- [x] Verbliebene grosse Python-Module auf konkrete, nicht-generische Trennmöglichkeiten prüfen; STAC/Download, Vektorimport und Geländeprofil-Client sind getrennt, rein rechnerische Module bleiben bewusst zusammenhängend.
- [x] Worker-Testtarget im produktiven Dockerfile als verpflichtendes CI-Gate ausführen; GitHub Actions hat Build und Tests erfolgreich abgeschlossen.

## 4. Datenbankentscheidung

- [x] SQLite-RTree-Queryplan korrigieren.
- [x] Vorläufige Beibehaltung von SQLite und Grenzen des früheren Vergleichs in `docs/storage-decision.md` festhalten.
- [x] Temporäre Container, Indizes, Messdaten und Benchmarkcode nach der Entscheidung entfernen.
- [x] SQLite vorerst beibehalten, weil der Vergleich keinen ausreichend vollständigen, betrieblich validierten Migrationsentscheid begründet.

## 5. ML- und Modellprüfung

- [x] Produktive Modelle nicht nur schweizweit beurteilen: Ein belegter Gewinn in einer Stadt, einem Kanton oder einem klar abgegrenzten Landschaftsslice genügt, wenn ein räumlich getrennter lokaler Holdout die Qualitäts- und Kalibrierungsgrenzen erfüllt und die Abdeckung transparent bleibt.
- [x] Kantonale und städtische Open-Data-Slices als regionale Verbesserungen prüfen; Zürich und Basel ergänzen direkte Baum-Evidenz mit expliziter Abdeckung und nationalem Fallback.
- [x] Regionale Modelle/Daten für Stadt, Seeufer, Wald und Alpenraum gegen die heutige direkte Evidenz auswerten; der Zürich→Basel-ML-Holdout verfehlt lokal die Kalibrierungsgrenze, direkte Geometrie bleibt stärker.

- [x] Räumliche Rohmerkmale für den manuell geprüften `benchly-100`-Datensatz extrahieren und Methodik dokumentieren.
- [x] Regelbasis, regularisierte logistische Modelle, PCA-Ablation und HistGradientBoosting mit räumlich getrennten Holdouts vergleichen.
- [x] Kalibrierung und mögliche regionale Slices auswerten; saisonale Slices sind für die statischen Labels nicht anwendbar.
- [x] ResNet18-Bildmerkmale lokal auf Apple MPS gegen klassische/geografische Merkmale und per Provider-Holdout prüfen.
- [x] Laufzeit, Speicher, Artefaktgrösse und Qualitätsgewinn in `docs/environment-model-evaluation.md` dokumentieren.
- [x] Aus dem ersten 100er-Versuch kein Modell übernehmen, da Kalibrierung sowie regionale und anbieterübergreifende Evidenz die Qualitätsgrenzen verfehlten; die spätere schweizweite Gegenprobe ist separat dokumentiert.
- [x] Temporäre Versuchsskripte, Bilder, Modellgewichte und Paketcaches nach der Entscheidung löschen.
- [x] RTX-5090-Integration mangels praktischem Produktionsvorteil gegenüber direkter amtlicher Geometrie verwerfen; bestehenden Inference-Service unverändert lassen.

### Schweizweite Gegenprobe

- [x] Eine reproduzierbare, grossregional und kantonal ausgewogene Stichprobe aus allen aktiven Schweizer Bänkli erstellen; geprüft wurden 4'160 Geopunkte und 2'600 Bilder aus allen 26 Kantonen.
- [x] swissTLM3D-/Landbedeckungsmerkmale als Referenz verwenden und OSM-, Distanz- und Dichtemerkmale strikt quellengetrennt aufbereiten.
- [x] Einfache Regeln, lineare Modelle, HistGradientBoosting, Random Forest und Extra Trees mit kantonsweisen und grossregionalen Holdouts vergleichen; koordinatenbasiertes kNN wegen räumlicher Leakage bewusst nicht verwenden.
- [x] Wald, Waldrand, Wasserlage, Fels und bewirtschaftete Areale getrennt auswerten; Aussicht, Offenheit und Natürlichkeit mangels unabhängiger schweizweiter Labels ausdrücklich nicht als gelöst darstellen.
- [x] Kalibrierung, regionale Ausreisser, Waldgrenzfälle sowie Grossregions- und Kantons-Slices prüfen und mit der direkten heutigen Geometrieauswertung vergleichen.
- [x] Bildmerkmale mit einer schweizweit einheitlichen Aufnahmeart (SWISSIMAGE) statt eines verzerrten Provider-Mixes prüfen; der frühere echte Provider-Holdout bleibt als separate Gegenprobe dokumentiert.
- [x] Das generalisierende 80-m-Waldinneres-Modell dokumentieren, aber mangels Vorteil gegenüber der direkt verfügbaren amtlichen Geometrie nicht produktiv übernehmen.
- [x] Temporäre Stichproben, 2'600 Bilder, Modellgewichte, Paket-Caches, Ergebnisdateien und Versuchsskripte nach der Entscheidung wieder löschen.

## 6. UI-/UX-Gegenprobe

- [x] Community-Aktionen auf Informationshierarchie, Ruhe und progressive Offenlegung anhand realer Screenshots überprüfen.
- [x] Mobile Darstellung von Einstieg, Editor und gespeichertem Zustand mit realer Detailansicht visuell prüfen.
- [x] Semantische Rollen, Fokusführung, mindestens 44 px grosse Touchziele und Reduced Motion im mobilen Browser prüfen.
- [x] Prüfen, dass Unsicherheiten sichtbar bleiben, aber die Hauptinformation nicht verdrängen.
- [x] UI nach Review vereinfachen und die Designentscheidung in `docs/community-observation-ux.md` dokumentieren.

## 7. Abschluss

- [x] Aktueller Stand: 131 TypeScript- und 64 Python-Tests bestehen; TypeScript-Check ist grün.
- [x] Gesamte Unit- und Worker-Suite sowie vollständige Produktions-Mobile-E2E-Suite ausführen (131 + 64 + 51 bestanden, 3 plattformspezifisch übersprungen).
- [x] Lint ohne Warnungen und Produktions-Build erfolgreich ausführen.
- [x] Generierte Katalogdateien lokal auf Synchronität prüfen; CI-Regel ist vorhanden.
- [x] Änderungen prüfen, committen und pushen.
- [x] App und Worker über immutable Digests releasen/deployen; Infrastruktur blieb ausschliesslich in `../server`.
- [ ] Produktionszustand, CronJobs, Datenalter und Kernabläufe nach dem Deployment verifizieren.
