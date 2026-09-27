# Musterbilder: dynamischer Aquarellhimmel

Alle Bilder stammen aus der echten Benchly-Detailansicht. Verwendet wurden eine
vorhandene Aquarelllandschaft, eine dazu passende verlustfreie Materialmaske und
feste Wetter-/Zeitdaten. Nur der HUD wurde für den Export ausgeblendet.

| Muster | Vorher | Nachher | Feste Mockdaten |
| --- | --- | --- | --- |
| Tag · Regen und Wolken | [Vorher](./01-tag-regen-wolken.png) | [Nachher](./after/01-tag-regen-wolken.png) | 5. September 2026, 12:00; 88 % Wolken; 3,4 mm/h Regen |
| Tag · Schnee und Wolken | [Vorher](./02-tag-schnee-wolken.png) | [Nachher](./after/02-tag-schnee-wolken.png) | 5. September 2026, 12:00; 92 % Wolken; 1,8 mm/h Niederschlag; Schneefall und 18 cm Schneedecke |
| Nacht · Regen, Wolken, Vollmond | [Vorher](./03-nacht-regen-wolken-vollmond.png) | [Nachher](./after/03-nacht-regen-wolken-vollmond.png) | 28. September 2026, 01:00; 72 % Wolken; 2,4 mm/h Regen; nahezu voller Mond |
| Nacht · Neumond und Sterne | [Vorher](./04-nacht-leermond-sterne.png) | [Nachher](./after/04-nacht-leermond-sterne.png) | 10. Oktober 2026, 20:00; klar; Neumond ohne künstliche Scheibe |
| Nacht · abnehmender Mond und Sterne | [Vorher](./05-nacht-abnehmender-mond-sterne.png) | [Nachher](./after/05-nacht-abnehmender-mond-sterne.png) | 3. Oktober 2026, 06:00; klar; abnehmender Halbmond |

Die Aufnahmen sind 1440 × 900 bei DPR 1. Positionen von Sonne, Mond und
Sternen sowie Mondphase und Geländeverdeckung stammen aus der Laufzeitlogik.
Der Renderer wird jeweils bis an die obere Pitch-Grenze bewegt, damit der
erweiterte Himmel beurteilt werden kann.

## Reproduktion

Die Galerie-Fixture liegt in `e2e/sky-mock-gallery.spec.ts`. Sie erwartet die
lokalen Referenzartefakte unter `data/panorama-cache-v1` und
`data/panorama-fixtures`, startet die echte App und schreibt standardmässig nach
`docs/sky-mock-gallery/after`.

```sh
BENCHLY_SKY_GALLERY_SCENARIO=day-rain BENCHLY_E2E_NOW=2026-09-05T12:00:00+02:00 npx playwright test e2e/sky-mock-gallery.spec.ts --project=mobile-chrome --workers=1
BENCHLY_SKY_GALLERY_SCENARIO=day-snow BENCHLY_E2E_NOW=2026-09-05T12:00:00+02:00 npx playwright test e2e/sky-mock-gallery.spec.ts --project=mobile-chrome --workers=1
BENCHLY_SKY_GALLERY_SCENARIO=night-full-rain BENCHLY_E2E_NOW=2026-09-28T01:00:00+02:00 npx playwright test e2e/sky-mock-gallery.spec.ts --project=mobile-chrome --workers=1
BENCHLY_SKY_GALLERY_SCENARIO=night-new BENCHLY_E2E_NOW=2026-10-10T20:00:00+02:00 npx playwright test e2e/sky-mock-gallery.spec.ts --project=mobile-chrome --workers=1
BENCHLY_SKY_GALLERY_SCENARIO=night-waning BENCHLY_E2E_NOW=2026-10-03T06:00:00+02:00 npx playwright test e2e/sky-mock-gallery.spec.ts --project=mobile-chrome --workers=1
```

Der Test prüft zusätzlich, dass Wolken und Niederschlag alle drei Bilddrittel
beeinflussen, die Partikelzahl im festgelegten Bereich bleibt, Neumond keine
leuchtende Scheibe erhält, klare Nächte genügend Sternkerne enthalten und der
360°-Übergang keinen sichtbaren Helligkeitssprung erzeugt.

Für CI ohne lokale Kunst-Assets erzeugt `e2e/panorama-fixture.ts` eine portable,
exakt passende Aquarell-/Semantik-Paarung. Sie enthält zusätzlich einen hohen
149°-Gipfel für einen echten Partial-Occlusion-Pixeltest. Die bestehende
Ein-Pixel-Maske bleibt als kontrollierte All-Sky-Fixture verfügbar.
