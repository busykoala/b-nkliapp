# Dialekt / lokal: Produkt- und Sprachkonzept

Die App hat genau vier Sprachen: Deutsch, Français, Italiano und Rumantsch. Der
Dialekt ist keine fünfte Sprache, sondern ein unabhängiger Schalter. Die Sprache
wird ein Jahr lang in `benchly_language`, der Schalter ebenso lange separat in
`benchly_dialect` gespeichert.

## Was im UI wechselt

- Navigation, Konto und Seiten ohne ausgewähltes Bänkli bleiben immer in der
  gewählten Sprache. Ohne Wahl gilt die unterstützte Browsersprache.
- Der vollständige Informationsbereich eines geöffneten Bänklis wechselt in die
  örtliche Sprache: Deutsch, Französisch, Italienisch oder Rumantsch. In den
  deutschsprachigen Regionen wird der vollständige App-Text zusätzlich mit
  vorsichtigen, regionalen Mundartformen geschrieben.
- Eine sichtbare Sprachplakette nennt die erkannte regionale Varietät. Die kurze
  Platzstimme darf lesbare Mundart beziehungsweise ein rätoromanisches Idiom
  verwenden und trägt ein eigenes `lang`-Attribut.
- Namen, amtliche Ortsangaben, Quellenwerte und Community-Texte werden nie
  übersetzt oder als vermeintlicher Dialekt umgeschrieben.

Diese Abstufung ist absichtlich. Eine App kann die Sprache einer Region recht
verlässlich wählen, aber nicht aus einer Koordinate die individuelle Mundart
einer Person ableiten.

## Deutschsprachige Schweiz

Schweizerdeutsch ist ein alemannisches Dialektkontinuum, nicht eine Sammlung
kantonsgenauer Sprachen. Die App verwendet deshalb breite, gut lesbare Räume:
Basel, Bern, Nordwest-, Nordost-, Zentral- und Ostschweiz/Zürich, Wallis sowie
Graubünden. Mehrsprachige Kantone werden zuerst anhand der amtlichen Gemeinde
und erst danach grob geografisch geteilt. Die Gliederung orientiert sich an der
[Dialekteinteilung des Schweizerischen Idiotikons](https://idiotikon.ch/Texte/Landolt/VolksausgabeStudie.pdf).

## Suisse romande

Die App unterscheidet Waadt, Genf, französisches Wallis, französisches Freiburg,
Neuenburg und Jura. Der Bänkli-Bereich wird auf Französisch bedient. Historische
Patois werden in der Plakette nur dort benannt, wo die Sprachfamilie belastbar
ist; sie werden nicht als flächendeckende Alltagssprache ausgegeben.

Das ist wichtig, weil die meisten historischen Mundarten der Romandie
frankoprovenzalisch sind, während die jurassischen Varietäten als einzige der
Schweiz zur Oïl-Gruppe gehören. Zudem können sich etwa die Walliser Patois von
Ort zu Ort stark unterscheiden. Grundlage sind das
[Glossaire des patois de la Suisse romande der Universität Neuenburg](https://www.unine.ch/isla/glossaire-des-patois-de-la-suisse-romande-gpsr/),
die eidgenössische Darstellung der
[jurassischen Dialekte](https://www.lebendige-traditionen.ch/tradition/de/home/traditionen/jurassische-dialekte.html)
und jene zum
[Unterwalliser Patois](https://www.lebendige-traditionen.ch/tradition/de/home/traditionen/unterwalliser-patois.html).

## Svizzera italiana

Im Tessin unterscheidet die UI Sopraceneri und Sottoceneri; Poschiavo,
Bregaglia, Mesolcina und Calanca werden als Italienischbünden erkannt. Der
Informationsbereich verwendet Schweizer Italienisch und nennt die Teilregion.
Eine exakte Dorfschreibweise wird bewusst nicht erfunden: Der kantonale
[Lessico dialettale della Svizzera italiana](https://www4.ti.ch/decs/dcsu/cde/pubblicazioni/lessico-dialettale-della-svizzera-italiana)
dokumentiert rund 191'000 Formen aus fast 300 Gemeinden, jeweils mit lokal
unterschiedlichen Varianten. Das ergänzende
[Repertorio italiano-dialetti](https://www4.ti.ch/decs/dcsu/cde/pubblicazioni/repertorio-italiano-dialetti/)
bestätigt, dass selbst ein einzelner italienischer Begriff viele örtliche
Entsprechungen haben kann.

## Grischun rumantsch

Rumantsch ist nicht nur eine weitere regionale Färbung. Die fünf Idiome besitzen
eigene Schriftsprachen. Die App ordnet sie entsprechend der amtlichen
Sprachräume zu:

| Raum | Angezeigte Varietät |
| --- | --- |
| Vorderrheintal und Lumnezia | Sursilvan |
| Schams und Domleschg | Sutsilvan |
| Albulatal und Surses | Surmiran |
| Oberengadin | Puter |
| Unterengadin | Vallader |
| Val Müstair | Jauer, örtliche Vallader-Varietät |

Die vollständigen Sachtexte verwenden vorerst den geprüften Katalog in
Rumantsch Grischun; die kurze Ortsstimme zeigt das zugeordnete Idiom. Diese
Grenze bleibt sichtbar, bis ein muttersprachliches Review einen vollständigen
Idiom-Katalog rechtfertigt. Die Zuordnung folgt der offiziellen Übersicht des
[Kantons Graubünden](https://www.gr.ch/RM/instituziuns/administraziun/ekud/afk/kbg/online/av-portal/sammlungen/Seiten/Ethnographika.aspx)
und dessen genauerer
[Beschreibung der Sprachräume](https://www.gr.ch/RM/chantun/Seiten/Ueberblick.aspx).

## Technische Regeln

Die Zuordnung und Stimmen liegen in `src/lib/dialect.ts`; die begrenzten
Client-Kataloge in `src/i18n/local-bench-messages.ts`. Änderungen müssen:

1. amtliche Geografie vor importierten Freitextadressen verwenden;
2. bei fehlender Geografie nur konservative Koordinaten-Fallbacks einsetzen;
3. deterministisch rendern und korrekte `lang`-Attribute setzen;
4. alle vier Landessprachen sowie mehrsprachige Kantone in Tests abdecken;
5. neue Dialekttexte von kompetenten Sprecherinnen oder Sprechern prüfen lassen,
   bevor sie als genauer als «vorsichtig regionalisiert» bezeichnet werden.
