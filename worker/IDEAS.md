# Ideas

## Gemeinsame Pause

```
# «Gemeinsame Pause» direkt integrieren

## Zusammenfassung

Die App erhält eine sofort verfügbare Funktion für kurzlebige gemeinsame Pausen am Bänkli. Eine Einladung gilt 30 Minuten, erlaubt höchstens drei Gäste und verwendet vorgegebene Nachrichten. Es gibt keine Altersangabe, keinen freien Chat und keine betreute Meldestelle.

Vor einer persönlichen Freigabe sehen andere nur eine markierte Suchgegend. Das konkrete Bänkli wird auf der Karte erst für die einladende Person und angenommene Gäste markiert. Die Funktion wird direkt veröffentlicht, ohne Feature-Schalter, Pilotphase oder vorgängige Datenschutz-Folgenabschätzung.

## Bedienung und Karte

- In den Bänkli-Details startet «Gesellschaft willkommen» eine Einladung mit Anlass und Gesprächssprachen.
- Die Person bestätigt eine feste, ungefähr fünf Quadratkilometer grosse Suchgegend. GPS bleibt für diesen Vorgang auf dem Gerät.
- Der Kartenschalter «Gemeinsame Pausen» zeigt Gebiete mit aktiven Einladungen durch ein Sprechblasen-Symbol.
- Eine Angebotskarte zeigt Anlass, Sprachen, verbleibende Zeit und «Darf ich dazukommen?». Profile, Namen, Fotos, Alter und Geschlecht bleiben verborgen.
- Die einladende Person nimmt Anfragen einzeln an. Anschliessend bestätigt der Gast die Teilnahme.
- Für die einladende Person und angenommene Gäste erhält das bestehende Bänkli-Icon lokal ein gut sichtbares Sprechblasen-Badge. Öffentliche Bankmarker und Cluster verraten den Treffpunkt nicht.
- Eine Statusleiste bietet Restzeit, Ablehnen, Verlassen, Beenden und Blockieren. Ein anderes Bänkli erfordert eine neue Einladung.
- Einladungen erscheinen weder im Feed noch auf Profilen und erzeugen keine Besuchsbestätigung.
- Alle Texte werden in einem eigenen Funktionsbereich `pauses` für Deutsch, Französisch, Italienisch und Rumantsch Grischun gepflegt.

## Schnittstellen und Datenhaltung

- Ein eigenes Pausenmodul stellt authentifizierte `/api/pauses/*`-Endpunkte für Entdecken, Erstellen, Anfragen, Annehmen, Bestätigen, Verlassen und Blockieren bereit.
- Öffentliche Angebotsdaten enthalten nur eine zufällige ID, Suchgebiet, Anlass, Sprachen und Ablaufzeit. Konto, Bänkli und Teilnehmerbeziehungen fehlen in diesen Antworten.
- Aktive Einladungen, Anfragen, Zuordnungen und kurzlebige Limits liegen in einem eigenen Valkey-Pod ohne Volume, Replikation, RDB, AOF oder Backups. Ein Valkey-Ausfall beendet aktive Einladungen; es gibt keinen SQLite-Ersatz.
- Dauerhaft speichert SQLite nur gegenseitige Kontaktsperren ohne Treffpunkt, Einladung oder Verlauf.
- Das genaue Bänkli wird mit HPKE separat für jeden angenommenen Gast verschlüsselt. Schlüssel bleiben im Arbeitsspeicher des Browsers. Empfänger, Einladung und Ablauf werden an die Nachricht gebunden; wiederholte oder manipulierte Nachrichten werden verworfen.
- Ein gesalzener Treffpunktnachweis verhindert, dass verschiedene Gäste innerhalb derselben Einladung unterschiedliche Bänkli erhalten. Treffpunkte müssen zu bestätigten Bänkli der gewählten Gegend gehören.
- Der entschlüsselte Treffpunkt und sein Karten-Badge werden zunächst lokal dargestellt. Erst eine ausdrücklich gewählte Routenberechnung übermittelt Start und Ziel an den bestehenden Routendienst.
- Private Antworten verwenden `Cache-Control: private, no-store`. Treffpunkte, Schlüssel und Teilnahmeverläufe gelangen nicht in öffentliche APIs, Datenexporte, Logs, Fehlerberichte oder Caches.
- Der Browser aktualisiert alle zehn Sekunden und sendet bei sichtbarer App alle 30 Sekunden ein Lebenszeichen ohne GPS. Nach 90 Sekunden ohne Lebenszeichen verschwindet die Einladung aus der Suche; spätestens nach 30 Minuten endet sie.
- Ein Neuladen mit verlorenem Schlüssel beendet die lokale Teilnahme. Ende, Ablauf und Sperre entfernen die private Kartenmarkierung.

## Missbrauchsbegrenzung

- Anmeldung ist zum Erstellen, Entdecken und Teilnehmen erforderlich.
- Pro Konto sind eine aktive Pause und eine ausstehende Anfrage zulässig.
- Anfangslimits: fünf Einladungen pro Stunde, drei Anfragen in zehn Minuten und zehn Anfragen pro Tag. Nach einer Ablehnung gilt gegenüber demselben Konto eine Pause von 24 Stunden.
- Registrierung und Anmeldung erhalten ebenfalls Limits gegen massenhaft erstellte Konten und automatisierte Zugriffe.
- Kontaktsperren gelten dauerhaft über neue Sitzungen hinweg und zwischen allen Mitgliedern einer Pause. Eine Sperre wird der betroffenen Gegenseite nicht mitgeteilt.
- Die Oberfläche erklärt knapp, dass Zustimmung keine Identität oder Absicht bestätigt und ein einmal freigegebener Treffpunkt nicht zurückgerufen werden kann.
- Es wird keine bearbeitete Meldestelle oder Sicherheitsgarantie versprochen. Nach Ablauf bleibt kein Begegnungsarchiv bestehen.

## Umsetzung und Tests

- Unit-Tests decken Zustandswechsel, Ablaufzeiten, Kapazität, Limits, Sperren, Berechtigungen und verschlüsselte Nachrichten ab.
- API-Tests stellen sicher, dass vor der Freigabe weder Bänkli noch Konto sichtbar werden und direkte, wiederholte oder manipulierte Aufrufe scheitern.
- Mehrere parallele Browser prüfen die atomare Vergabe des letzten freien Platzes sowie Ablehnen, Abbruch, Ablauf, Netzverlust, Neuladen und Valkey-Neustart.
- Kartentests prüfen Gebietssymbol und privates Bänkli-Badge bei verschiedenen Zoomstufen, Clustern und Filtern.
- Browser-Tests prüfen den vollständigen Ablauf in allen vier Sprachen, mit Tastatur sowie auf mobilem Safari und Chrome.
- Bestehende CI- und Quality-Gates werden ausgeführt. Danach wird die Funktion ohne gestaffelte Einführung direkt veröffentlicht und die Kubernetes-Bereitstellung auf Bereitschaft, Neustarts und Fehler geprüft.
```