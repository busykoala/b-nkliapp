# Prüfung von ML für Umgebungseindrücke

Stand: 6. September 2026. Diese Notiz hält die Entscheidung fest; temporäre
Versuchsskripte, Bilder, Modellgewichte und vollständige Ergebnisdateien werden
nicht im Repository aufbewahrt.

## Fragestellung und Daten

Geprüft wurde, ob kleine Modelle die vorhandenen Regeln für Wald, Seesicht,
Bergsicht, Offenheit und eingeschränkte Sicht sinnvoll ergänzen könnten. Grundlage
waren die 100 manuell geprüften Orte aus `worker/evaluation/benchly-100.jsonl` und
der lokale, zum Laufzeitpunkt aktuelle SQLite-Datenstand.

Die Geomodelle erhielten 60 Merkmale: Distanz und Anzahlen in 25, 75, 200 und
500 Metern für Gebäude, Bäume, Wasser, Wald, Wege und Hauptstrassen sowie sechs
Gruppen der amtlichen Landbedeckung. Koordinaten, Review-Kategorie und Bildanbieter
waren keine Modellmerkmale. Validiert wurde in fünf räumlich getrennten Folds mit
37 ungefähr 2,5 bis 2,8 Kilometer grossen Gruppen.

| Geometrieverfahren | Balanced Accuracy | F1 | ECE |
|---|---:|---:|---:|
| einfache Versuchsregeln | 0,486 | 0,205 | 0,163 |
| regularisierte Logistik | 0,536 | 0,293 | 0,146 |
| PCA + Logistik | 0,558 | 0,322 | 0,140 |
| HistGradientBoosting | 0,582 | 0,329 | 0,149 |
| kalibriertes Boosting | 0,546 | 0,195 | 0,068 |

Die Werte sind Mittel über fünf Zielgrössen. Die Versuchsregeln sind eine kleine,
einheitliche Referenz und nicht identisch mit jeder spezialisierten Produktionsregel.

Nur Wald war klar lernbar. HistGradientBoosting erreichte über sechs weitere
räumliche Aufteilungen im Mittel 0,809 Balanced Accuracy, 0,650 F1 und 0,046 ECE.
Alle elf positiven Waldbeispiele lagen jedoch im selben geografischen Drittel des
Datensatzes. Eine belastbare regionale Gegenprobe war deshalb unmöglich.

## Bildmerkmale auf Apple MPS

Alle 100 dokumentierten Evaluationsbilder waren abrufbar. Verglichen wurden einfache
Farb-/Kantenmerkmale, gefrorene 512-dimensionale ResNet18-Embeddings und deren
Kombination mit Geomerkmalen. Nur kleine logistische Köpfe wurden trainiert.

| Merkmale | räumlicher F1 | räumliche ECE | Provider-Holdout F1 | Provider-Holdout ECE |
|---|---:|---:|---:|---:|
| Geometrie | 0,293 | 0,146 | 0,213 | 0,179 |
| klassische Bildmerkmale | 0,389 | 0,045 | 0,258 | 0,094 |
| ResNet18-Embedding | 0,557 | 0,097 | 0,309 | 0,188 |
| Geometrie + Embedding | 0,566 | 0,100 | 0,304 | 0,193 |

Die 100 Embeddings benötigten auf MPS 1,53 Sekunden, etwa 804 MB Peak-RAM und
200 KB als Float32-Matrix; die vortrainierten Gewichte waren 44,7 MB gross. Der
starke räumliche Wert generalisierte nicht ausreichend über die vier Bildanbieter.
Besonders auffällig: Neun der elf Waldbeispiele stammen aus SWISSIMAGE, während
Panoramax und KartaView kein positives Waldbeispiel enthalten.

## Schweizweite Gegenprobe

Der erste Versuch beantwortete die regionale Frage nicht. Deshalb wurde eine
zweite, quellengetrennte Evaluation über die ganze Schweiz ausgeführt. Aus den
106'146 aktiven Bänkli wurden zunächst 4'160 Orte gezogen: 160 pro Kanton und
höchstens drei pro 4-km-Zelle, bevor dünn besetzte Zellen aufgefüllt wurden.
Als Eingaben dienten ausschliesslich OSM-Distanzen und -Dichten; gefilterte
swissTLM3D-Geometrien und amtliche Landbedeckung bildeten die Referenz.

Die erste Bildgegenprobe verwendete 1'300 einheitliche SWISSIMAGE-Ausschnitte,
50 pro Kanton. Die stabilere Endauswertung verdoppelte dies auf 2'600 Ausschnitte,
genau 100 pro Kanton. Jeder Ausschnitt deckte 300 × 300 Meter bei 256 Pixeln ab.
Validiert wurde mit vollständig ausgelassenen Grossregionen sowie Kantonen.
Koordinaten und Kantonsnamen waren keine Modellmerkmale.

### Geodaten ohne Bilder

| Ziel | Verfahren | Balanced Accuracy | F1 | ECE |
|---|---|---:|---:|---:|
| Waldpunkt | einfache OSM-Regel | 0,548 | 0,318 | 0,303 |
| Waldpunkt | HistGradientBoosting | 0,771 | 0,644 | 0,104 |
| Waldpunkt | kalibriertes Boosting | 0,712 | 0,584 | 0,017 |
| Gewässer innerhalb 50 m | einfache OSM-Regel | 0,580 | 0,350 | 0,273 |
| Gewässer innerhalb 50 m | Random Forest | 0,638 | 0,506 | 0,100 |
| Gewässer innerhalb 50 m | kalibrierter Random Forest | 0,603 | 0,394 | 0,015 |

Die direkte bestehende Geometrieauswertung war auf den bereits angereicherten
Überschneidungen wesentlich stärker. Das ist erwartbar: Sie wertet die amtliche
Geometrie aus, statt sie aus unvollständigeren OSM-Merkmalen zu erraten. Fels und
spezielle bewirtschaftete Areale hatten zu wenige beziehungsweise zu heterogene
positive Beispiele für eine brauchbare Klassifikation.

### Einheitliche Luftbilder und mehrere Massstäbe

Verglichen wurden Farb-/Texturmerkmale, ResNet18- und EfficientNet-B0-Embeddings
sowie 80-, 160- und 300-Meter-Ausschnitte. EfficientNet war langsamer und nicht
besser. Der visuelle Fehlercheck zeigte, dass das 300-Meter-Modell häufig den
umliegenden Wald statt des Bänkli-Punkts erkannte. Daraufhin wurden Waldinneres
und Waldrand getrennt: Als Waldinneres galt ein Punkt erst ab 15 Metern Abstand
zur amtlichen Waldgrenze; Grenzfälle wurden für diese binäre Prüfung ausgelassen.

| Ziel und Merkmale | Balanced Accuracy | F1 | AP | ECE |
|---|---:|---:|---:|---:|
| Waldinneres, OSM-Geodaten | 0,796 | 0,555 | 0,594 | 0,059 |
| Waldinneres, ResNet18 bei 80 m | 0,962 | 0,911 | 0,971 | 0,012 |
| Waldinneres, drei Skalen + Geodaten | 0,962 | 0,917 | 0,976 | 0,010 |
| Waldinneres, drei Skalen + Geodaten, kalibriert | 0,931 | 0,902 | 0,974 | 0,011 |
| Waldrand, drei Skalen + Geodaten | 0,777 | 0,649 | 0,668 | 0,105 |
| Gewässer innerhalb 50 m, drei Skalen + Geodaten | 0,670 | 0,569 | 0,628 | 0,204 |
| bewirtschaftetes Spezialareal, drei Skalen + Geodaten | 0,576 | 0,191 | 0,174 | 0,069 |

Das Waldinneres-Modell blieb beim Leave-one-canton-out stabil: F1 0,920, AP
0,978 und ECE 0,011. Beim einfacheren 80-Meter-Modell lag der F1 in allen sieben
Grossregionen zwischen 0,778 und 0,957. Die drei Skalen verbesserten den gesamten
F1 nur um 0,006 und verschlechterten einzelne Regionen; die 80-Meter-Variante ist
daher der sinnvollere Forschungskandidat.

Auf der lokalen Apple-GPU dauerten die drei ResNet18-Embedding-Läufe für 2'600
Orte zusammen rund zehn Sekunden. Die drei Float32-Matrizen belegten zusammen
etwa 15,2 MB; die vortrainierten Gewichte 44,7 MB. Das wäre technisch als
periodischer Offline-Job möglich. Eine Online-Inferenz oder RTX-5090-Abhängigkeit
ist dafür weder nötig noch sinnvoll.

## Entscheidung

Keines der Modelle wird derzeit in App, Worker oder Inference-Service übernommen.
Die schweizweite Gegenprobe ändert aber die Forschungsbewertung:

- Ein kleines, einheitliches 80-Meter-Bildmodell erkennt klar abgegrenztes
  Waldinneres schweizweit und erfüllt Qualitäts- und Kalibrierungsgrenzen.
- Es beweist trotzdem noch keinen Produktionsgewinn: Seine Referenz ist die
  swissTLM3D-Waldgeometrie, welche die bestehende Pipeline direkt, exakt und ohne
  Modell auswertet. Das Modell lernt diese Quelle gut, verbessert sie aber nicht.
- Die interessanteren Fälle sind Waldränder, aktuelle Rodungen, junge Bestände
  und Baumgruppen ausserhalb amtlicher Waldflächen. Genau dort ist die Qualität
  mit F1 0,649 und ECE 0,105 noch nicht ausreichend.
- Wasser im Luftbild belegt Nähe, nicht Wasser *im Blick*. Aussicht, Offenheit,
  saisonaler Schatten und subjektive Natürlichkeit haben weiterhin keine
  ausreichend unabhängigen schweizweiten Labels.
- Die visuell geprüften Widersprüche sind überwiegend Grenz- und
Kontextunterschiede. Sie rechtfertigen eine spätere Review-Priorisierung, aber
kein automatisches Überschreiben der amtlichen Evidenz.

## Regionale Gegenprobe: Stadtbäume in Zürich und Basel

Lokale Open-Data-Kataster dürfen einen Wert innerhalb ihrer ausgewiesenen
Abdeckung verbessern. Dafür wurden 11'870 aktive Bänkli im Zürcher Stadtgebiet
und 3'009 in Basel/Riehen gegen die amtlichen Baumstandorte geprüft. Als Ziel
galt ein Katasterbaum innerhalb von zwölf Metern. Eingaben waren ausschliesslich
bereits verfügbare OSM-Distanzen/-Dichten und bestehende Umgebungswerte; Stadtname
und Koordinaten waren keine Modellmerkmale. Trainiert wurde westlich in Zürich,
ein weiterer Zürcher Streifen diente zur Kalibrierung, das östliche Viertel als
räumlicher Holdout. Basel blieb vollständig als unabhängiger Anbieter-Holdout.

| Verfahren | Zürcher räuml. Balanced Accuracy | F1 | ECE | Basler F1 | Basler ECE |
|---|---:|---:|---:|---:|---:|
| direkte OSM-Baumregel | 0,549 | 0,246 | 0,132 | 0,580 | 0,237 |
| Logistik | 0,567 | 0,294 | 0,177 | 0,661 | 0,048 |
| HistGradientBoosting | 0,633 | 0,382 | 0,154 | 0,647 | 0,078 |
| kalibriertes Boosting | 0,640 | 0,389 | 0,211 | 0,660 | 0,065 |

Die Modelle finden zusätzliche Stadtbaum-Kontexte, erfüllen aber im räumlich
ausgelassenen Zürcher Teil die verlangte ECE von höchstens 0,08 nicht. Der
Provider-Holdout allein reicht nicht, um die schlechte lokale Kalibrierung zu
überstimmen. Zudem stehen die amtlichen Punkte direkt zur Verfügung: Der Zürcher
Kataster enthält sogar Kronendurchmesser. Deshalb werden keine Modellgewichte
übernommen. Stattdessen importiert die Pipeline die Baumkataster von Zürich und
Basel monatlich als regionale Evidenz; ausserhalb ihrer Grenzen bleibt der
nationale OSM-/swissTLM-/swissSURFACE-Fallback unverändert.

Ein Produktivnutzen muss dabei nicht schweizweit sein. Ein Modell darf gezielt
nur in einer Stadt, einem Kanton oder einem klar bezeichneten Landschaftsslice
eingesetzt werden. Gerade der räumlich getrennte Holdout dieses Gebiets muss dann
die gleichen Qualitäts- und Kalibrierungsgrenzen erfüllen, und ausserhalb der
belegten Abdeckung bleibt der direkte nationale Fallback aktiv. Der Zürcher
Holdout verfehlt diese lokale Grenze, obwohl die Übertragung nach Basel gut
aussieht – ein guter Schutz vor einer vorschnellen regionalen Freigabe.

Die temporären GeoJSON-Dateien, scikit-learn-Umgebung und das Versuchsskript
wurden nach dieser Entscheidung entfernt. Die Stadtprüfung ändert auch die
anderen Landschafts-Slices nicht: Wasserlage bleibt eine exakte Geometriefrage,
Wasser *im Blick* benötigt Sicht- oder Community-Evidenz; Wald und alpines Relief
sind durch swissTLM3D beziehungsweise swissALTI3D direkter belegt als durch ein
Modell. Für diese drei Slices zeigte die schweizweite Gegenprobe bereits keinen
praktischen ML-Vorteil.

Ein nächster Versuch lohnt sich mit unabhängigen, zeitlich eingeordneten Labels
für Waldrand, tatsächliche Sicht und Schatten. Community-Beobachtungen können
diese liefern. Bis dahin bleiben die nachvollziehbaren amtlichen Geometrien und
klassischen Evidenzmodelle produktiv; der kleine 80-Meter-Ansatz ist ein belegter
Kandidat für spätere Anomalieprüfung, nicht für die RTX 5090.
