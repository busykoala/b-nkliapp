# Ortsstimme: sprachliche Leitplanken

Die Ortsstimme ist eine spielerische, standortabhängige Färbung der kurzen
Platzgeschichte. Sie ist **keine Behauptung, den exakten Ortsdialekt einer
Person zu treffen**. Bedienelemente, Sicherheitsinformationen und Sachangaben
bleiben in der gewählten Standardsprache.

## Warum breite Regionen statt Kantonsdialekte

Schweizerdeutsch ist ein alemannisches Dialektkontinuum. Sprachgrenzen folgen
nicht sauber den Kantonsgrenzen; selbst benachbarte Orte können sich
unterscheiden. Die App verwendet deshalb breite, transparent bezeichnete
Sprachräume und bevorzugt vorhandene Gemeinde-/Kantonsdaten. Fehlen diese,
liefert die Koordinate nur eine grobe Annäherung.

Die Regionen orientieren sich an der Übersicht des Schweizerischen
Idiotikons: Baselstadt, Nordwestschweiz, Bern, Wallis, Nordostschweiz,
Zürich/Mittelland, Zentralschweiz und Graubünden. Mehrsprachige Kantone werden
mit Ortsnamen und – wo das nicht reicht – vorsichtig geografisch aufgeteilt.

## Sprachliche Merkmale

- Westliche und östliche Infinitivkonstruktionen werden nicht gleichgezogen:
  westlich etwa «für … z …», östlich etwa «zum …».
- Baseldeutsch erhält niederalemannische Formen wie «kasch» statt eines
  pauschalen schweizerdeutschen «chasch».
- Walliserdeutsch bleibt als eigener höchstalemannischer Raum erkennbar, ohne
  schwer lesbare Lautschrift zu imitieren.
- Romanische Regionen verwenden eine lokale Stimme in Französisch,
  Italienisch oder Rumantsch statt künstlich eingedeutschter Schreibweisen.
- Es gibt keine allgemein verbindliche schweizerdeutsche Orthografie. Die
  Schreibweise soll gut lesbar bleiben und regionale Merkmale nur dort zeigen,
  wo sie gezielt kuratiert wurden.

Der Modus «Frech» ist zeitgenössisch und absurd, aber nicht als «Ghetto»- oder
Gruppenkarikatur gestaltet. Humor richtet sich an das Bänkli und die Situation,
nicht an Herkunft, Klasse oder Sprecherinnen und Sprecher.

## Forschungsgrundlage

- [UZH: Wie viele Dialekte gibt es?](https://www.linguistik.uzh.ch/de/easyling/faq/glaser-wieviele-dialekte.html)
- [UZH: Syntaktischer Atlas der deutschen Schweiz](https://dialektsyntax.linguistik.uzh.ch/)
- [UZH Dialektressource: Syntax](https://dlf.uzh.ch/sites/dialektressource/linguistik/syntax/)
- [UZH: Dialektschreibungen und Citizen Linguistics](https://www.art-science.uzh.ch/en/Exhibitions/alt_CitizenScience/citizenlinguistics.html)
- [Schweizerisches Idiotikon: Dialekteinteilung der deutschen Schweiz (PDF)](https://idiotikon.ch/Texte/Landolt/VolksausgabeStudie.pdf)

## Technische Regeln

Die Zuordnung und Texte liegen in `src/lib/dialect.ts`. Neue Varianten müssen:

1. deterministisch sein, damit Texte beim Rendern nicht springen;
2. mit einem korrekten `lang`-Attribut ausgegeben werden;
3. mit Tests für Kanton, mehrsprachige Sonderfälle und Koordinaten-Fallback
   ergänzt werden;
4. als «regional angelehnt» sichtbar bleiben.
