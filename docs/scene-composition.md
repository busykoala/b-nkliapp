# Dynamische Bänkli-Szene

Die Illustration ist keine Rekonstruktion eines Fotos. Sie erzählt nur jene
Ortsmerkmale, die mit genügend guter Evidenz belegt sind. Ein einzelnes
Hintergrundbild darf deshalb nicht gleichzeitig über Ort, Aussicht, Gewässer
und Relief entscheiden.

## Kombinationsgraph

```text
                          ┌──────────── Ort ────────────┐
Geodaten + Community ───▶ │ Stadt · Dorf · Wald · Offen │
                          └─────────────┬───────────────┘
                                        │
                ┌───────────────────────┼────────────────────────┐
                ▼                       ▼                        ▼
       Relief / Aussicht           Gewässerblick             Jahreszeit
       flach · Hügel · Berg        kein · Fluss · See        Frühling … Winter
                │                       │                        │
                └──────────────┬────────┴───────────┬────────────┘
                               ▼                    ▼
                         Licht am Bänkli       Atmosphäre
                         Sonne · Schatten      Wolken · Regen
                         Nacht · unbekannt     Schnee · Wind
                               │                    │
                               └─────────┬──────────┘
                                         ▼
                           Sonne / Mond an echter Position
                                  Mond mit Phase
                                         │
                                         ▼
                                   Bänkli-Sprite
```

## Tiefenstaffelung

1. Papier und Himmel
2. ferner Hügel- oder Berghorizont
3. See oder Fluss, nur wenn tatsächlich sichtbar
4. Ortsebene: Stadt, Dorf, Wald oder offenes Gelände
5. jahreszeitliche Pigmente und Bodenschnee
6. Sonne/Mond hinter Horizont, Häusern und Baumkronen
7. lokale Lichtlasur und Bänkli
8. Regen oder Schnee im Vordergrund

## Evidenz- und Kombinationsregeln

- `Seeblick` entsteht nur aus einer sichtbaren Wassergeometrie, die als See
  oder Reservoir typisiert ist oder mindestens 20'000 m² Fläche und eine
  Mindestbreite von 80 m besitzt. Eine lange schmale Flussgeometrie wird nicht
  durch ihre Bounding Box zum See.
- `Wasserblick` wird als Fluss/Bach dargestellt. `waterfront` alleine beschreibt
  Nähe und löst keine sichtbare Wasserfläche aus.
- Ort und Aussicht sind orthogonal: ein Dorf kann am See liegen, eine Stadt an
  einem Fluss und ein Wald vor Bergen.
- Berg und Hügel schliessen sich als Hauptrelief gegenseitig aus; Schnee ist
  ein Modifier und kann mit jedem Ort und mit Bergsicht kombiniert werden.
- Sonne und Mond werden aus Azimut und Höhe platziert und vor Ortssilhouetten
  maskiert. Wolken können beide abschwächen, tragen aber nie die einzige
  Wetterinformation.
- Die Szene nennt Unsicherheit im Alternativtext und lässt bei fehlender
  Evidenz lieber ein Element weg, als einen konkreten Ort zu erfinden.
- Alle Landschaftselemente bleiben namenlos und ohne erkennbares Wahrzeichen,
  damit dieselbe Bildsprache schweizweit glaubwürdig bleibt.
