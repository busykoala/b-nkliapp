import type { BenchDetail } from "./types";

type Poem = { first: string; second: string };

function hash(value: string) {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function choose(phrases: readonly string[], seed: number, salt: number) {
  return phrases[((seed + Math.imul(salt, 2654435761)) >>> 0) % phrases.length];
}

function hasView(bench: BenchDetail, fragment: string) {
  return bench.viewLabels.some((label) => label.toLocaleLowerCase("de-CH").includes(fragment));
}

function lightLine(bench: BenchDetail, seed: number) {
  if (bench.shadeCause === "nacht") {
    return bench.moonVisible
      ? choose([
          "Mondlicht ruht auf der Bank",
          "Silberlicht streift den stillen Platz",
          "Der Mond zeichnet leise Konturen",
          "Sanfter Mondschein findet die Bank",
          "Die Nacht legt Silber auf den Platz",
          "Mondlicht sammelt sich am Weg",
          "Ein heller Mond bewacht den Platz",
          "Die Bank träumt im Licht des Mondes",
        ], seed, 1)
      : choose([
          "Der Platz ruht unter Sternen",
          "Stille Nacht umhüllt die Bank",
          "Die Dunkelheit macht diesen Ort ganz leise",
          "Unter weitem Nachthimmel wartet die Bank",
          "Die Nacht hält hier für einen Moment inne",
          "Ein stiller Platz schläft unter dunklem Himmel",
        ], seed, 1);
  }
  if (bench.sunnyNow === null) {
    return choose([
      "Licht und Schatten erzählen hier noch ein Geheimnis",
      "Der Platz wartet noch auf seine Lichtspur",
      "Das Licht dieses Ortes wird noch erkundet",
      "Sonne und Schatten sind hier noch auf Entdeckungsreise",
    ], seed, 1);
  }
  if (bench.sunnyNow) {
    return choose([
      "Sonnenwärme liegt auf der Bank",
      "Goldenes Licht lädt zum Bleiben",
      "Die Sonne wärmt diesen stillen Platz",
      "Helles Licht tanzt über den Platz",
      "Ein warmer Sonnenfleck wartet hier",
      "Die Bank fängt das Licht des Tages ein",
      "Sonne zeichnet Wärme auf den Weg",
      "Der Tag leuchtet auf dieser Bank",
    ], seed, 1);
  }
  const phrases = bench.shadeCause === "gebäude"
    ? ["Ein Haus schenkt der Bank kühlen Schatten", "Geborgener Schatten liegt auf dem Platz", "Die Häuser lassen das Licht hier weich werden", "Zwischen Mauern ruht ein kühler Augenblick", "Ein stiller Gebäudeschatten lädt zur Pause"]
      : bench.shadeCause === "vegetation"
      ? ["Blätter malen Schatten auf die Bank", "Grüner Schatten wiegt sich über dem Platz", "Licht flüstert durch die Blätter", "Unter Blättern wird die Welt leise", "Tanzende Schatten ruhen auf dem Platz", "Ein Blätterdach siebt das Sonnenlicht"]
      : bench.shadeCause === "gelände"
        ? ["Der Hang hält die Sonne noch zurück", "Das Gelände schenkt dem Platz kühlen Schatten", "Hinter den Höhen wartet das Licht", "Der Horizont hütet einen stillen Schatten"]
        : bench.shadeCause === "überdacht"
          ? ["Ein kleines Dach bewahrt diesen stillen Platz", "Geschützt vor dem Himmel wartet die Bank", "Unter einem Dach findet der Tag Ruhe", "Geborgen liegt die Bank unter ihrem Dach"]
          : ["Stiller Schatten lädt zum Verweilen", "Das Licht wird hier ganz leise", "Ein kühler Augenblick wartet", "Sanfter Schatten umarmt den Platz", "Hier atmet der Tag ein wenig aus", "Die Bank ruht abseits des hellen Lichts"];
  return choose(phrases, seed, 1);
}

function weatherLine(bench: BenchDetail, seed: number) {
  const weather = bench.weather;
  if (!weather) return null;
  if (weather.precipitationType === "snow") return choose(["Flocken machen die Welt weich", "Schnee fällt lautlos durch die Luft", "Winterweiss sammelt sich am Weg", "Leise Flocken suchen den Boden", "Schnee dämpft jeden Schritt"], seed, 2);
  if (weather.precipitationType === "rain") return choose(["Regen zeichnet Kreise in die Stille", "Tropfen erzählen vom Himmel", "Der Regen lässt den Ort leise glänzen", "Nasser Glanz liegt über dem Weg", "Tropfen ziehen silberne Spuren"], seed, 2);
  if (weather.precipitationType === "mixed") return choose(["Regen und Flocken begegnen sich", "Der Himmel wechselt zwischen Wasser und Weiss", "Nasser Schnee zieht leise vorüber", "Flocken schmelzen auf dem stillen Weg"], seed, 2);
  if (weather.cloudCover >= .78) return choose(["Wolken tragen den Himmel ganz nah", "Ein weicher Wolkenhimmel spannt sich darüber", "Das Licht wandert still durch dichte Wolken", "Wolken machen den Tag sanft und leise"], seed, 2);
  if (weather.cloudCover >= .35) return choose(["Wolken ziehen langsam durch das Licht", "Sonne und Wolken wechseln sich leise ab", "Ein paar Wolken wandern über den Platz", "Lichtinseln ziehen über die Landschaft"], seed, 2);
  if ((weather.windKmh ?? 0) >= 20) return choose(["Der Wind trägt den Augenblick weiter", "Eine frische Brise streicht über den Platz", "Wind bewegt die Landschaft in leisen Wellen", "Die Luft ist wach und in Bewegung"], seed, 2);
  return null;
}

function viewLine(bench: BenchDetail, seed: number) {
  if (hasView(bench, "berg")) return choose(["Berge wachen in der Ferne", "Gipfel tragen den Blick zum Horizont", "Die Alpen öffnen eine weite Ferne", "Berglinien schweben über dem Land", "Der Blick steigt hinauf zu den Gipfeln", "Ferne Berge geben dem Ort Weite", "Am Horizont stehen die Berge still", "Die Gipfel halten den Blick für einen Moment"], seed, 3);
  if (hasView(bench, "hügel")) return choose(["Sanfte Hügel tragen den Blick", "Grüne Höhen säumen die Ferne", "Der Horizont schwingt in weichen Linien", "Hügel rollen leise davon", "Weiche Höhen rahmen diesen Ort", "Der Blick folgt den ruhigen Hügeln"], seed, 3);
  if (bench.waterfront || hasView(bench, "see") || hasView(bench, "wasser")) return choose(["Das Wasser trägt den Blick davon", "Am Ufer wird die Zeit weit", "Licht wandert über das Wasser", "Der See schenkt dem Blick Ruhe", "Wasser und Himmel werden eins", "Das Ufer lässt den Augenblick treiben", "Über dem Wasser öffnet sich die Ferne"], seed, 3);
  if (bench.inForest || hasView(bench, "wald")) return choose(["Der Wald flüstert ringsum", "Zwischen Bäumen wohnt die Ruhe", "Das Grün hält die Welt für einen Moment fern", "Blätter rahmen diesen stillen Ort", "Der Wald atmet ganz in der Nähe", "Zwischen Stämmen verliert sich die Zeit"], seed, 3);
  if (hasView(bench, "weit")) return choose(["Der Himmel macht den Blick weit", "Weite liegt still vor den Augen", "Der Horizont darf offen bleiben", "Der Blick findet freien Raum", "Hier wird der Himmel ein wenig grösser", "Die Landschaft öffnet sich ganz leise"], seed, 3);
  if (hasView(bench, "eingeschränkt") || hasView(bench, "keine besondere")) return choose(["Die Nähe macht diesen Platz geborgen", "Der Blick bleibt nah und der Moment ganz hier", "Geschützt vor der Ferne wird es still", "Dieser kleine Winkel behält die Welt bei sich", "Nah am Weg findet der Blick Ruhe"], seed, 3);
  return choose(["Ein stiller Weg zieht vorbei", "Die Welt wird für einen Moment leise", "Hier darf der Augenblick bleiben", "Ein kleiner Ort zum Durchatmen", "Die Zeit geht hier etwas langsamer", "Der Platz wartet ohne Eile"], seed, 3);
}

function benchLine(bench: BenchDetail, seed: number) {
  const property = (label: string) => bench.properties.find((item) => item.label === label)?.value;
  const backrest = property("Rückenlehne") === "Ja";
  const armrests = property("Armlehnen") === "Ja";
  const covered = property("Überdacht") === "Ja";
  const material = property("Material");
  if (covered) return choose(["Unter ihrem Dach darf die Pause länger dauern", "Ein kleines Dach hält den Platz geborgen", "Geschützt wartet die Bank auf eine Pause", "Hier sitzt man ein wenig behüteter"], seed, 4);
  if (backrest && armrests) return choose(["Die Bank empfängt müde Schultern mit offenen Armen", "Hier dürfen Rücken und Hände zur Ruhe kommen", "Die Bank ist bereit für eine lange Pause", "Bequem lehnt sich der Augenblick zurück"], seed, 4);
  if (backrest) return choose(["Hier darf sich auch der Rücken ausruhen", "Die Lehne lädt zum längeren Bleiben", "Angelehnt wird aus einem Halt eine Pause", "Die Bank schenkt dem Rücken Ruhe", "Hier sitzt es sich entspannt in die Ferne"], seed, 4);
  if (material === "Holz") return choose(["Warmes Holz wartet auf eine kleine Pause", "Das Holz trägt Spuren vieler stiller Momente", "Eine schlichte Holzbank lädt zum Bleiben", "Holz macht diesen Halt ein wenig wärmer"], seed, 4);
  return null;
}

export function scenePoem(bench: BenchDetail): Poem {
  // The wording moves with the hourly scene while remaining stable during a visit.
  const seed = hash(`${bench.id}:${Math.floor(bench.localMinutesNow / 60)}:${bench.season}`);
  const light = lightLine(bench, seed);
  const weather = weatherLine(bench, seed);
  const view = viewLine(bench, seed);
  const seat = benchLine(bench, seed);
  const second = weather && weather !== light ? `${weather} — ${view}` : seat ?? view;
  return { first: `${light}.`, second: `${second}.` };
}
